// ═══════════════════════════════════════════════════════════════════════════
// OfficeTool.js — Native Office, Excel & PowerPoint Engine for MAX & Satellite
// Provides audit-grade spreadsheet variance analysis, formula gap repair,
// and automated PowerPoint generation for client workflows.
// ═══════════════════════════════════════════════════════════════════════════

import XLSX from 'xlsx';
import pptxgen from 'pptxgenjs';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const FORMULA_ERRORS = new Set(['#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NAME?', '#NUM!', '#NULL!']);

function fmtNum(n) {
    if (typeof n !== 'number') return String(n);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Re-evaluate a SUM formula numerically using the sheet's cached values
function reEvalSum(ws, formula) {
    const rangeMatch = formula.match(/SUM\(([^)]+)\)/i);
    if (!rangeMatch) return null;

    const rangeStr = rangeMatch[1].replace(/^[^!]+!/, ''); // strip sheet prefix
    let range;
    try { range = XLSX.utils.decode_range(rangeStr); }
    catch { return null; }

    let sum = 0;
    let cellCount = 0;
    for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = ws[addr];
            if (cell && typeof cell.v === 'number') {
                sum += cell.v;
                cellCount++;
            }
        }
    }
    return { sum: parseFloat(sum.toFixed(10)), cellCount, rangeStr, range };
}

// Detect whether rows exist immediately above/below a SUM range that contain numbers
// but are NOT included in the range — the classic "inserted row outside range" bug.
function detectRangeGaps(ws, formula, sumCellAddr) {
    const rangeMatch = formula.match(/SUM\(([^)]+)\)/i);
    if (!rangeMatch) return [];

    const rangeStr = rangeMatch[1].replace(/^[^!]+!/, '');
    let range;
    try { range = XLSX.utils.decode_range(rangeStr); }
    catch { return []; }

    const gaps = [];

    // Row immediately above the range start
    if (range.s.r > 0) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: range.s.r - 1, c: C });
            const cell = ws[addr];
            if (cell && typeof cell.v === 'number' && cell.v !== 0) {
                gaps.push({
                    type: 'gap_above',
                    cell: addr,
                    value: cell.v,
                    formula: cell.f || null,
                    suggestedRange: `${XLSX.utils.encode_cell({ r: range.s.r - 1, c: range.s.c })}:${XLSX.utils.encode_cell({ r: range.e.r, c: range.e.c })}`,
                    message: `Cell ${addr} (value: ${fmtNum(cell.v)}) is immediately above SUM range ${rangeStr} but omitted`
                });
            }
        }
    }

    // Row immediately below the range end (before the SUM cell itself)
    const sumCell = XLSX.utils.decode_cell(sumCellAddr);
    const gapRow = range.e.r + 1;
    if (gapRow < sumCell.r) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const addr = XLSX.utils.encode_cell({ r: gapRow, c: C });
            const cell = ws[addr];
            if (cell && typeof cell.v === 'number' && cell.v !== 0) {
                gaps.push({
                    type: 'gap_below',
                    cell: addr,
                    value: cell.v,
                    formula: cell.f || null,
                    suggestedRange: `${XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c })}:${XLSX.utils.encode_cell({ r: gapRow, c: range.e.c })}`,
                    message: `Cell ${addr} (value: ${fmtNum(cell.v)}) is immediately below SUM range ${rangeStr} but omitted`
                });
            }
        }
    }

    return gaps;
}

export class OfficeTool {
    constructor(max = null) {
        this.max = max;
    }

    /**
     * Audit an Excel workbook for formula errors, SUM gaps, and discrepancies.
     */
    async analyzeSpreadsheet({ filePath, varianceThreshold = 0.01 }) {
        const resolvedPath = path.resolve(filePath);
        if (!existsSync(resolvedPath)) {
            return { ok: false, error: `File not found: ${resolvedPath}` };
        }

        let wb;
        try {
            wb = XLSX.readFile(resolvedPath, { cellFormula: true, cellNF: true, cellDates: true });
        } catch (e) {
            return { ok: false, error: `Cannot parse Excel file: ${e.message}` };
        }

        const sheets = [];
        for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            if (!ws) continue;

            const ref = ws['!ref'];
            if (!ref) {
                sheets.push({ sheetName, cellCount: 0, findings: [] });
                continue;
            }

            let range;
            try { range = XLSX.utils.decode_range(ref); }
            catch { continue; }

            const findings = [];
            let cellCount = 0;

            for (let R = range.s.r; R <= range.e.r; R++) {
                for (let C = range.s.c; C <= range.e.c; C++) {
                    const addr = XLSX.utils.encode_cell({ r: R, c: C });
                    const cell = ws[addr];
                    if (!cell) continue;
                    cellCount++;

                    // 1. Broken Formula Errors (#REF!, #DIV/0!, etc.)
                    if (cell.t === 'e' || FORMULA_ERRORS.has(String(cell.v))) {
                        findings.push({
                            type: 'formula_error',
                            severity: 'critical',
                            cell: addr,
                            sheet: sheetName,
                            formula: cell.f || null,
                            value: cell.v,
                            message: `${addr}: Formula error ${cell.v}${cell.f ? ` in =${cell.f}` : ''}`
                        });
                        continue;
                    }

                    // Only examine formulas for gaps and logic
                    if (!cell.f) continue;
                    const formula = cell.f;

                    // 2. SUM Range Gaps
                    if (/SUM\(/i.test(formula)) {
                        const gaps = detectRangeGaps(ws, formula, addr);
                        for (const gap of gaps) {
                            findings.push({
                                type: 'sum_range_gap',
                                severity: 'high',
                                cell: addr,
                                sheet: sheetName,
                                formula,
                                cachedValue: cell.v,
                                gap,
                                message: gap.message
                            });
                        }

                        // 3. Re-computation discrepancy
                        if (typeof cell.v === 'number') {
                            const eval_ = reEvalSum(ws, formula);
                            if (eval_ && Math.abs(eval_.sum - cell.v) > varianceThreshold) {
                                const delta = cell.v - eval_.sum;
                                findings.push({
                                    type: 'sum_discrepancy',
                                    severity: Math.abs(delta) > 1000 ? 'critical' : 'high',
                                    cell: addr,
                                    sheet: sheetName,
                                    formula,
                                    cachedValue: cell.v,
                                    recomputedValue: eval_.sum,
                                    delta,
                                    message: `${addr}: Cached SUM shows ${fmtNum(cell.v)} but range ${eval_.rangeStr} totals ${fmtNum(eval_.sum)} (Δ ${fmtNum(delta)})`
                                });
                            }
                        }
                    }

                    // 4. Hardcoded numbers inside formulas
                    const hardcodedMatch = formula.match(/[+\-\*\/]\s*(\d{4,})/g);
                    if (hardcodedMatch && /[A-Z]\d/.test(formula)) {
                        const constants = hardcodedMatch.map(m => m.replace(/[+\-\*\/\s]/g, ''));
                        findings.push({
                            type: 'hardcoded_constant',
                            severity: 'medium',
                            cell: addr,
                            sheet: sheetName,
                            formula,
                            constants,
                            message: `${addr}: Formula contains hardcoded constant(s) [${constants.join(', ')}] mixed with cell references`
                        });
                    }
                }
            }

            sheets.push({ sheetName, cellCount, findings });
        }

        const totalFindings = sheets.reduce((n, s) => n + s.findings.length, 0);
        const critical = sheets.flatMap(s => s.findings.filter(f => f.severity === 'critical'));
        const high = sheets.flatMap(s => s.findings.filter(f => f.severity === 'high'));

        return {
            ok: true,
            filePath: resolvedPath,
            sheetCount: wb.SheetNames.length,
            totalFindings,
            criticalCount: critical.length,
            highCount: high.length,
            sheets,
            summary: `Audit complete: found ${critical.length} critical and ${high.length} high-severity findings across ${wb.SheetNames.length} sheet(s).`
        };
    }

    /**
     * Repair an Excel workbook: heals SUM range gaps and broken formulas, writing to a new file.
     */
    async repairSpreadsheet({ filePath, outputPath = null, autoHealGaps = true }) {
        const resolvedPath = path.resolve(filePath);
        const outPath = outputPath ? path.resolve(outputPath) : resolvedPath.replace(/\.xlsx$/i, '_audited_repaired.xlsx');

        const audit = await this.analyzeSpreadsheet({ filePath: resolvedPath });
        if (!audit.ok) return audit;

        const wb = XLSX.readFile(resolvedPath, { cellFormula: true, cellNF: true, cellDates: true });
        const repairs = [];

        for (const sheet of audit.sheets) {
            const ws = wb.Sheets[sheet.sheetName];
            if (!ws) continue;

            for (const finding of sheet.findings) {
                if (finding.type === 'sum_range_gap' && autoHealGaps && finding.gap?.suggestedRange) {
                    const oldFormula = ws[finding.cell]?.f || finding.formula;
                    const newFormula = oldFormula.replace(/SUM\([^)]+\)/i, `SUM(${finding.gap.suggestedRange})`);
                    ws[finding.cell].f = newFormula;
                    
                    repairs.push({
                        sheet: sheet.sheetName,
                        cell: finding.cell,
                        type: 'sum_range_gap_healed',
                        from: oldFormula,
                        to: newFormula,
                        reason: finding.message
                    });
                }
            }
        }

        XLSX.writeFile(wb, outPath);

        return {
            ok: true,
            originalPath: resolvedPath,
            repairedPath: outPath,
            repairsCount: repairs.length,
            repairs,
            summary: repairs.length > 0
                ? `Successfully healed ${repairs.length} formula gap(s). Repaired workbook saved to ${path.basename(outPath)}.`
                : `No automatic repairs applied. Workbook re-verified and saved to ${path.basename(outPath)}.`
        };
    }

    /**
     * Generate a presentation (.pptx) from structured slides.
     */
    async generatePresentation({ title = "Executive Presentation", subtitle = "Prepared by Maxwell Satellite", slides = [], outputPath = null, theme = 'dark' }) {
        const outPath = outputPath ? path.resolve(outputPath) : path.join(process.cwd(), '.max', 'presentations', `Deck_${Date.now()}.pptx`);
        await fs.mkdir(path.dirname(outPath), { recursive: true });

        const pres = new pptxgen();
        pres.title = title;
        pres.company = "MAX Sovereign Systems";

        const isDark = theme === 'dark';
        const bgColor = isDark ? "0F172A" : "F8FAFC";
        const titleColor = isDark ? "38BDF8" : "0284C7";
        const textColor = isDark ? "E2E8F0" : "334155";
        const cardBg = isDark ? "1E293B" : "FFFFFF";

        // 1. Title Slide
        const titleSlide = pres.addSlide();
        titleSlide.background = { color: bgColor };
        titleSlide.addText(title, {
            x: 1.0, y: 2.2, w: 8.0, h: 1.5,
            fontSize: 38, bold: true, color: titleColor, align: 'left'
        });
        titleSlide.addText(subtitle, {
            x: 1.0, y: 3.8, w: 8.0, h: 0.8,
            fontSize: 20, color: textColor, align: 'left'
        });

        // 2. Content Slides
        for (const slideData of slides) {
            const slide = pres.addSlide();
            slide.background = { color: bgColor };

            // Header
            slide.addText(slideData.header || "Key Topic", {
                x: 0.8, y: 0.6, w: 8.4, h: 0.8,
                fontSize: 24, bold: true, color: titleColor
            });

            // Bullets or Cards
            if (Array.isArray(slideData.bullets) && slideData.bullets.length > 0) {
                const bulletItems = slideData.bullets.map(b => ({
                    text: typeof b === 'string' ? b : (b.text || ''),
                    options: { fontSize: 16, color: textColor, bullet: true, breakLine: true }
                }));

                slide.addText(bulletItems, {
                    x: 0.8, y: 1.6, w: 8.4, h: 4.5,
                    lineSpacing: 28, valign: 'top'
                });
            } else if (slideData.content) {
                slide.addText(String(slideData.content), {
                    x: 0.8, y: 1.6, w: 8.4, h: 4.5,
                    fontSize: 16, color: textColor, valign: 'top'
                });
            }
        }

        await pres.writeFile({ fileName: outPath });

        return {
            ok: true,
            outputPath: outPath,
            slideCount: slides.length + 1,
            summary: `Created presentation with ${slides.length + 1} slide(s) at ${path.basename(outPath)}.`
        };
    }
}

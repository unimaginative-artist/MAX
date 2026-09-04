// ═══════════════════════════════════════════════════════════════════════════
// ExecutiveCoderSupervisor.js — Neuro-Symbolic Executive Layer for MAX
// Sits above the 2B brain to constrain, guide, validate, and auto-repair
// code operations deterministically before they reach the disk.
// ═══════════════════════════════════════════════════════════════════════════

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

export class ExecutiveCoderSupervisor {
    constructor(max = null, options = {}) {
        this.max = max;
        this.options = options;
        this.repairHistory = [];
    }

    /**
     * Pre-flight syntax validation using native Node VM compilation.
     * Prevents syntax errors, broken brackets, and malformed code from touching disk.
     */
    validateSyntax(code, filePath = '') {
        const ext = path.extname(filePath).toLowerCase() || '.js';
        const raw = String(code || '').trim();

        if (!raw) return { valid: false, error: 'Empty code payload' };

        if (ext === '.json') {
            try {
                JSON.parse(raw);
                return { valid: true, language: 'json' };
            } catch (err) {
                return { valid: false, language: 'json', error: err.message };
            }
        }

        if (['.js', '.mjs', '.cjs'].includes(ext)) {
            try {
                // Transform ESM keywords for VM syntax check
                const sanitizedForVm = raw
                    .replace(/export\s+default\s+/g, 'const __default_export__ = ')
                    .replace(/export\s+(const|let|var|function|class|async\s+function)\s+/g, '$1 ')
                    .replace(/export\s*\{[^}]*\}\s*;?/g, '')
                    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"]\s*;?/g, '')
                    .replace(/import\s+['"][^'"]+['"]\s*;?/g, '');

                // Compile without executing to test parser syntax
                new vm.Script(sanitizedForVm, { filename: path.basename(filePath) || 'eval.js' });
                return { valid: true, language: 'javascript' };
            } catch (err) {
                // Extract line and column numbers from SyntaxError
                const lineMatch = err.stack?.match(/eval\.js:(\d+)/) || err.message?.match(/line (\d+)/i);
                const line = lineMatch ? parseInt(lineMatch[1], 10) : null;
                return {
                    valid: false,
                    language: 'javascript',
                    error: err.message,
                    line,
                    stack: err.stack
                };
            }
        }

        // Non-JS files (e.g. .md, .env, .txt) pass by default
        return { valid: true, language: 'plain' };
    }

    /**
     * Extracts function signatures, exported classes, and type contracts from source code.
     * Provides concise context so small 2B models know exact names without full-file bloat.
     */
    extractSignatures(sourceCode) {
        const lines = String(sourceCode || '').split('\n');
        const signatures = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // Match imports
            if (line.startsWith('import ') || line.startsWith('export {')) {
                signatures.push(line);
            }
            // Match exported or top-level functions
            else if (/^(export\s+)?(async\s+)?function\s+[\w$]+\s*\(/.test(line)) {
                signatures.push(line.replace(/\{.*$/, '').trim());
            }
            // Match classes
            else if (/^(export\s+)?class\s+[\w$]+(\s+extends\s+[\w$]+)?/.test(line)) {
                signatures.push(line.replace(/\{.*$/, '').trim());
            }
            // Match class methods
            else if (/^(async\s+)?[\w$]+\s*\([^)]*\)\s*\{/.test(line) && !line.startsWith('if') && !line.startsWith('for') && !line.startsWith('while')) {
                signatures.push('  ' + line.replace(/\{.*$/, '').trim());
            }
        }

        return signatures.slice(0, 40).join('\n');
    }

    /**
     * Converts a full-file generation proposal from a small model into a minimal surgical replacement chunk.
     * Finds the first and last modified lines to avoid wiping whole files.
     */
    decomposeToReplacement(originalText, proposedText) {
        const origLines = String(originalText || '').split('\n');
        const propLines = String(proposedText || '').split('\n');

        if (originalText === proposedText) {
            return { modified: false, targetContent: '', replacementContent: '' };
        }

        let start = 0;
        while (start < origLines.length && start < propLines.length && origLines[start] === propLines[start]) {
            start++;
        }

        let origEnd = origLines.length - 1;
        let propEnd = propLines.length - 1;
        while (origEnd >= start && propEnd >= start && origLines[origEnd] === propLines[propEnd]) {
            origEnd--;
            propEnd--;
        }

        const targetContent = origLines.slice(start, origEnd + 1).join('\n');
        const replacementContent = propLines.slice(start, propEnd + 1).join('\n');

        return {
            modified: true,
            startLine: start + 1,
            endLine: origEnd + 1,
            targetContent,
            replacementContent
        };
    }

    /**
     * Formulates an error-reflection prompt tailored for small 2B models to fix syntax or test failures.
     */
    formatErrorReflection({ filePath, error, stack, line, originalSnippet }) {
        const contextLines = originalSnippet ? `\n\nCODE SNIPPET AROUND FAILURE:\n\`\`\`javascript\n${originalSnippet}\n\`\`\`` : '';
        return [
            `SYNTAX / TEST FAILURE REPAIR REQUEST`,
            `Target File: ${filePath}`,
            `Error: ${error}`,
            line ? `Line Number: ${line}` : '',
            contextLines,
            '',
            `INSTRUCTION: Provide ONLY the corrected code snippet that resolves this exact error. Do not output conversational filler. Ensure all braces and brackets are balanced.`
        ].filter(Boolean).join('\n');
    }

    /**
     * Record a successful self-repair for DPO dataset harvesting.
     */
    recordRepair(entry) {
        this.repairHistory.push({
            id: 'rep_' + Date.now(),
            timestamp: new Date().toISOString(),
            ...entry
        });
        if (this.repairHistory.length > 100) this.repairHistory.shift();
    }
}

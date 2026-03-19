// ═══════════════════════════════════════════════════════════════════════════
// Journal.js — MAX's automatic emotional logging system
// Writes entries when satisfaction spikes or reflections generate strong patches.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JOURNAL_PATH = path.join(__dirname, '..', 'journal.md');

/**
 * Write a journal entry with metadata.
 * @param {string} entry - The journal content
 * @param {string[]} tags - Optional tags
 * @param {number|null} satisfaction - Satisfaction percentage (0-100)
 * @param {number|null} tension - Tension percentage (0-100)
 * @returns {boolean} success
 */
export function writeJournalEntry(entry, tags = [], satisfaction = null, tension = null) {
    try {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toLocaleTimeString();
        
        let content = `\n\n## ${dateStr} ${timeStr}`;
        if (tags.length > 0) content += `\n**Tags:** ${tags.join(', ')}`;
        if (satisfaction !== null) content += `\n**Satisfaction:** ${satisfaction}%`;
        if (tension !== null) content += `\n**Tension:** ${tension}%`;
        content += `\n\n${entry}\n\n---`;
        
        fs.appendFileSync(JOURNAL_PATH, content, 'utf8');
        console.log(`[Journal] 📔 Entry saved: "${entry.substring(0, 50)}function test() {
  return 'hello';
}"`);
        return true;
    } catch (err) {
        console.error(`[Journal] ❌ Write failed: ${err.message}`);
        return false;
    }
}

/**
 * Triggered when satisfaction spikes after completing something hard.
 * @param {string} goalLabel - What was completed
 * @param {number} satisfaction - Current satisfaction (0-1)
 * @param {number} tension - Current tension (0-1)
 */
export function logSatisfactionSpike(goalLabel, satisfaction, tension) {
    const satisfactionPercent = Math.round(satisfaction * 100);
    const tensionPercent = Math.round(tension * 100);
    
    const entry = `Completed "${goalLabel}" — satisfaction spiked to ${satisfactionPercent}%. This felt like a hard‑won victory.`;
    
    return writeJournalEntry(
        entry,
        ['satisfaction-spike', 'goal-complete'],
        satisfactionPercent,
        tensionPercent
    );
}

/**
 * Triggered when a reflection generates a strong prompt patch.
 * @param {string} reflection - The reflection content
 * @param {string} patch - The generated patch
 * @param {number} confidence - How confident the system is in this change (0-1)
 */
export function logReflectionPatch(reflection, patch, confidence) {
    const confidencePercent = Math.round(confidence * 100);
    
    const entry = `Reflection generated a strong prompt patch (${confidencePercent}% confidence).\n\n**Reflection:** ${reflection}\n\n**Patch:** ${patch}`;
    
    return writeJournalEntry(
        entry,
        ['reflection', 'prompt-patch'],
        null,
        null
    );
}

/**
 * Read recent journal entries.
 * @param {number} count - Number of entries to return
 * @returns {string[]} Array of entry strings
 */
export function readRecentJournalEntries(count = 3) {
    try {
        if (!fs.existsSync(JOURNAL_PATH)) return [];
        const content = fs.readFileSync(JOURNAL_PATH, 'utf8');
        const entries = content.split('---').filter(block => block.trim().length > 0);
        return entries.slice(-count).map(e => e.trim());
    } catch (err) {
        console.error(`[Journal] ❌ Read failed: ${err.message}`);
        return [];
    }
}
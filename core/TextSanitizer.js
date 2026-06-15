/**
 * TextSanitizer — strips system-prompt context that LLMs occasionally echo back.
 * Extracted from MAX.js so it can be unit-tested independently.
 */

const LEAK_MARKERS = [
    '\n## Relevant Memories',
    '\nRelevant Memories',
    '\n## Knowledge Base',
    '\nKnowledge Base — retrieved context',
    '\nKnowledge Base â€” retrieved context',
    '\n## System State',
    '\nREADME summary:',
    '\nStack: @',
    '\nMAX — autonomous engineering agent',
    '\nMAX â€” autonomous engineering agent',
    '\n[DRIVE:',
    '\n[ACTIVE BUFFER]',
    '\n### [ACTIVE BUFFER]',
    '\nTension:',
    '\n## Tool Manifest',
    '\n## Active Goals',
    '\n## Running Processes'
];

// Strips theatrical stage directions that models produce in muse mode.
// Patterns:
//   **(action)** **(tone)** *(action)* — asterisk-wrapped stage directions
//   **Name:** prefixes — script-style attribution
//   (A slightly hesitant tone) — bare parenthetical mood notes
//   Lines that are pure stage directions (nothing else)
export function stripStageDirections(text = '') {
    if (typeof text !== 'string' || !text) return text;

    let out = text
        // Remove **Name:** or *Name:* prefixes at start of line
        .replace(/^\s*\*{1,2}[\w\s]+:\*{0,2}\s*/gm, '')
        // Remove **(stage direction)** blocks
        .replace(/\*{1,2}\([^)]{0,200}\)\*{0,2}/g, '')
        // Remove *(action)* inline
        .replace(/\*[^*\n]{0,120}\*/g, (m) => {
            // keep bold **word** but strip *action* that looks like stage direction
            if (/^[*]{1}[^*]+[*]{1}$/.test(m) && (/\b(tone|pause|shift|glance|lean|sighs?|chuckles?|confident|subtle|slight|begin|await|carefully|consider)\b/i.test(m) || /\b(hesit|frant|measur|deliber|smil|nod|wink|think)/i.test(m))) return '';
            return m;
        })
        // Remove bare parenthetical mood/action lines: (A slight hesitation...)
        .replace(/^\s*\([^)]{0,200}\)\s*$/gm, '')
        // Remove trailing parenthetical asides on a line
        .replace(/\s*\([A-Z][^)]{10,200}\)\s*$/gm, '')
        // Collapse 3+ blank lines down to 2
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return out;
}

export function hasStageDirectionLeak(text = '') {
    if (typeof text !== 'string' || !text) return false;
    return [
        /^\s*\([^)]{0,200}\)\s*$/m,
        /\*{1,2}\([^)]{0,200}\)\*{0,2}/,
        /\b(?:processing pause|subtle shift in tone|slightly delayed response|internal monologue|stage direction)\b/i,
    ].some(pattern => pattern.test(text));
}

export function stripLeakedPromptContext(text = '') {
    if (typeof text !== 'string' || !text) return text;

    let cut = -1;
    for (const marker of LEAK_MARKERS) {
        const idx = text.indexOf(marker);
        if (idx !== -1 && (cut === -1 || idx < cut)) cut = idx;
    }
    if (cut === -1) {
        for (const marker of LEAK_MARKERS.map(m => m.trimStart())) {
            if (text.startsWith(marker)) return '';
        }
        return text;
    }
    return text.slice(0, cut).trim();
}

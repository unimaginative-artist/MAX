
import readline from 'readline';

/**
 * TUI.mjs — The Command Bridge Terminal UI.
 * Handles colors, box drawing, spinners, and live redraws.
 */

export const COLORS = {
    MINT:  '\x1b[36m',
    CYAN:  '\x1b[36m',
    BLUE:  '\x1b[34m',
    MAGENTA: '\x1b[35m',
    GOLD:  '\x1b[33m',
    PINK:  '\x1b[38;5;213m',
    WHITE: '\x1b[37m',
    BOLD:  '\x1b[1m',
    DIM:   '\x1b[90m',
    RESET: '\x1b[0m'
};

const BOX_WIDTH = 60;
const INNER = BOX_WIDTH - 4;

const SPINNER_CHARS = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

export class TUI {
    constructor() {
        this.COLORS = COLORS; // Exposed for InputBridge
        this._spinnerTimer = null;
        this._spinnerPaused = false;
        this._rl = null;
        this._bgBuffer = []; 
        this.activeTask = null; // Currently executing goal
    }

    setReadline(rl) {
        this._rl = rl;
    }

    setActiveTask(title) {
        this.activeTask = title;
    }

    printMAX(text) {
        console.log(`\n${COLORS.BOLD}${COLORS.PINK}MAX:${COLORS.RESET} ${text}`);
    }

    printChoko(text) {
        console.log(`\n${COLORS.BOLD}${COLORS.MAGENTA}Choko:${COLORS.RESET} ${COLORS.MAGENTA}${text}${COLORS.RESET}`);
    }

    /**
     * Print a message without tearing the current input line.
     * Buffers the message if MAX is thinking.
     */
    printLive(msg, isThinking = false) {
        if (isThinking) {
            this._bgBuffer.push(msg);
            return;
        }

        if (this._rl) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(msg + '\n');
            process.stdout.write('YOU: ' + (this._rl.line || ''));
        } else {
            process.stdout.write(msg + '\n');
        }
    }

    flushBuffer() {
        if (this._bgBuffer.length === 0) return;
        
        process.stdout.write('\n');
        for (const msg of this._bgBuffer) {
            process.stdout.write(msg + '\n');
        }
        this._bgBuffer = [];
        
        if (this._rl && !this._spinnerTimer) {
            process.stdout.write('YOU: ' + (this._rl.line || ''));
        }
    }

    startSpinner(label = 'thinking') {
        let i = 0;
        this._spinnerPaused = false;
        if (this._spinnerTimer) clearInterval(this._spinnerTimer);

        this._spinnerTimer = setInterval(() => {
            if (!this._spinnerPaused) {
                process.stdout.write(`\r  ${SPINNER_CHARS[i++ % SPINNER_CHARS.length]}  MAX is ${label}...`);
            }
        }, 80);

        return () => this.stopSpinner();
    }

    stopSpinner() {
        if (this._spinnerTimer) {
            clearInterval(this._spinnerTimer);
            this._spinnerTimer = null;
        }
        process.stdout.write('\r' + ' '.repeat(40) + '\r');
    }

    pauseSpinner() {
        if (this._spinnerTimer && !this._spinnerPaused) {
            this._spinnerPaused = true;
            process.stdout.write('\r' + ' '.repeat(40) + '\r');
        }
    }

    resumeSpinner() {
        this._spinnerPaused = false;
    }

    printBox(title, lines, source = 'SYSTEM') {
        const border = '═'.repeat(BOX_WIDTH);
        const div    = '─'.repeat(BOX_WIDTH);
        
        console.log(`\n╔${border}╗`);
        console.log(`║  💡 ${title} [${source}]`);
        console.log(`╟${div}╢`);

        for (const line of lines) {
            const wrapped = this._wrapLine(line);
            for (const wl of wrapped) console.log(`║  ${wl.padEnd(INNER)}  ║`);
        }
        console.log(`╚${border}╝`);
    }

    _wrapLine(text) {
        const words = text.split(' ').filter(Boolean);
        const lines = [];
        let cur = '';
        for (const word of words) {
            if (cur.length + word.length + 1 > INNER) {
                if (cur) lines.push(cur);
                cur = word;
            } else {
                cur = cur ? `${cur} ${word}` : word;
            }
        }
        if (cur) lines.push(cur);
        return lines;
    }

    cleanReply(text) {
        return text
            .replace(/^(?:(?:\*\*|__)?(?:MAX|M\.A\.X)(?:\*\*|__)?[:.]\s*)*/i, '')
            .replace(/^[^\w\n]{0,4}(?:Companion|Muse|Grinder|Architect|Paranoid|Breaker|Explainer|Devil(?:'s Advocate)?)\s+mode[^.\n]*[.\n]+\n*/i, '')
            .trimStart();
    }
}

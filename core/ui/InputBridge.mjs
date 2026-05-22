
import readline from 'readline';

/**
 * InputBridge.mjs — The Command Bridge Input Loop.
 * Handles user typing, line buffering, and command dispatch.
 */

export class InputBridge {
    constructor(max, tui) {
        this.max = max;
        this.tui = tui;
        this.rl = null;
        this._inputBuffer = '';
        this._bufferTimer = null;
        this._pendingInput = null;
    }

    start(onInput) {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true
        });

        this.tui.setReadline(this.rl);

        this.rl.on('line', (line) => {
            if (!this._bufferTimer) this.tui.pauseSpinner();

            this._inputBuffer += (this._inputBuffer ? '\n' : '') + line;
            if (this._bufferTimer) clearTimeout(this._bufferTimer);

            this._bufferTimer = setTimeout(() => {
                this._bufferTimer = null;
                const fullInput = this._inputBuffer;
                this._inputBuffer = '';
                
                if (this.max.isThinking) {
                    this._pendingInput = this._pendingInput ? this._pendingInput + '\n' + fullInput : fullInput;
                    this.tui.printLive(`  ${this.tui.COLORS.DIM}[queued] "${fullInput.slice(0, 40)}..."${this.tui.COLORS.RESET}`, true);
                } else {
                    onInput(fullInput);
                }
            }, 200);
        });

        return this.rl;
    }

    getPending() {
        const p = this._pendingInput;
        this._pendingInput = null;
        return p;
    }

    prompt() {
        if (!this.max.isThinking) {
            const working = this.tui.activeTask;
            if (working) {
                process.stdout.write(`${this.tui.COLORS.BOLD}${this.tui.COLORS.GOLD}[WORKING: "${working.slice(0, 30)}${working.length > 30 ? '...' : ''}"]${this.tui.COLORS.RESET} YOU: `);
            } else {
                process.stdout.write('YOU: ');
            }
        }
    }
}

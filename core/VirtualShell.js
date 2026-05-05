import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * VirtualShell.js — A true, persistent stateful terminal.
 * Maintains a single, long-lived background process (bash or cmd) where commands are executed.
 * This preserves all environment variables, aliases, and working directory state perfectly
 * without manual parsing.
 */

export class VirtualShell extends EventEmitter {
    constructor() {
        super();
        this.isWin = process.platform === 'win32';
        this.proc = null;
        this.ready = false;
        this._queue = [];
        this._currentResolver = null;
        this._stdoutBuf = '';
        this._stderrBuf = '';
        this._delimiter = `__MAX_SHELL_DONE_${Date.now()}__`;
    }

    start() {
        if (this.proc) return;

        this.proc = spawn(
            this.isWin ? 'cmd.exe' : 'bash',
            [],
            { env: process.env, shell: true }
        );

        this.proc.stdout.on('data', (data) => {
            const str = data.toString();
            this._stdoutBuf += str;
            this.emit('data', str);
            this._checkDone();
        });

        this.proc.stderr.on('data', (data) => {
            const str = data.toString();
            this._stderrBuf += str;
            this.emit('data_err', str);
            this._checkDone();
        });

        this.proc.on('close', () => {
            this.ready = false;
            this.proc = null;
        });

        this.ready = true;
        // Suppress cmd.exe command echo on Windows
        if (this.isWin) this.proc.stdin.write('@echo off\r\n');
    }

    _stripCmdEcho(output, command) {
        if (!this.isWin) return output;
        // cmd.exe echoes the command + our wrapper lines — strip them
        const lines = output.split(/\r?\n/);
        const cmdFirst = command.trim().split(/\r?\n/)[0].trim().toLowerCase();
        return lines.filter(l => {
            const t = l.trim().toLowerCase();
            if (!t) return true; // keep blank lines (they're intentional output)
            if (t === cmdFirst) return false;
            if (t.startsWith('echo __exit_code_') || t.startsWith('echo __max_shell_done_')) return false;
            // Filter prompt echoes like "C:\Users\barry\Desktop\MAX>"
            if (/^[a-z]:[\\\/].*>/.test(t)) return false;
            return true;
        }).join('\n');
    }

    _checkDone() {
        if (!this._currentResolver) return;

        if (this._stdoutBuf.includes(this._delimiter)) {
            const parts = this._stdoutBuf.split(this._delimiter);
            const output = parts[0].trim();
            // The exit code is printed right before the delimiter in our run wrapper
            const match = output.match(/__EXIT_CODE_(\d+)__$/);
            let code = 0;
            let cleanOut = output;
            
            if (match) {
                code = parseInt(match[1], 10);
                cleanOut = output.replace(/__EXIT_CODE_\d+__$/, '').trim();
            }
            cleanOut = this._stripCmdEcho(cleanOut, this._currentCommand || '');

            this._stdoutBuf = parts[1] || ''; // keep whatever spilled over
            
            const stderr = this._stderrBuf.trim();
            this._stderrBuf = '';

            const resolve = this._currentResolver;
            this._currentResolver = null;
            
            resolve({
                success: code === 0,
                code: code,
                stdout: cleanOut,
                stderr: stderr
            });

            // Process next in queue
            this._processQueue();
        }
    }

    async run(command, timeoutMs = 120000) {
        if (!this.ready) this.start();

        return new Promise((resolve, reject) => {
            this._queue.push({ command, timeoutMs, resolve, reject });
            if (!this._currentResolver) {
                this._processQueue();
            }
        });
    }

    async _processQueue() {
        if (this._queue.length === 0 || this._currentResolver) return;

        const { command, timeoutMs, resolve } = this._queue.shift();
        this._currentResolver = resolve;
        this._currentCommand = command;
        this._stdoutBuf = '';
        this._stderrBuf = '';

        // Wrap the command to echo the exit code and the strict delimiter
        const wrappedCmd = this.isWin
            ? `${command}\r\necho __EXIT_CODE_%errorlevel%__\r\necho ${this._delimiter}\r\n`
            : `${command}\necho "__EXIT_CODE_$?__"\necho "${this._delimiter}"\n`;

        this.proc.stdin.write(wrappedCmd);

        if (timeoutMs) {
            setTimeout(() => {
                if (this._currentResolver === resolve) {
                    this._currentResolver = null;
                    
                    // To recover from timeout, we have to kill the shell and restart it
                    this.proc.kill();
                    this.proc = null;
                    this.start();

                    resolve({
                        success: false,
                        code: -1,
                        stdout: this._stdoutBuf,
                        stderr: this._stderrBuf,
                        error: `Timed out after ${timeoutMs}ms`
                    });
                    
                    this._processQueue();
                }
            }, timeoutMs);
        }
    }

    stop() {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
            this.ready = false;
        }
    }
}

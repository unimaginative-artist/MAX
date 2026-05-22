import fs   from 'fs';
import os   from 'os';
import path from 'path';
import { CommandPolicyEngine } from '../../../core/CommandPolicyEngine.js';

const policy = new CommandPolicyEngine();

describe('CommandPolicyEngine', () => {
    describe('allowlist', () => {
        it('allows node', () => {
            expect(policy.validate('node --version').allowed).toBe(true);
        });

        it('allows npm test', () => {
            expect(policy.validate('npm test').allowed).toBe(true);
        });

        it('allows git status', () => {
            expect(policy.validate('git status').allowed).toBe(true);
        });

        it('allows eslint', () => {
            expect(policy.validate('eslint src/').allowed).toBe(true);
        });

        it('blocks unknown base command', () => {
            const result = policy.validate('curl https://example.com');
            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/allowlist/i);
        });

        it('blocks unknown command with path prefix', () => {
            const result = policy.validate('malware.exe --run');
            expect(result.allowed).toBe(false);
        });

        it('strips Windows .exe/.cmd extensions when checking allowlist', () => {
            // node.exe should resolve to "node" → allowed
            expect(policy.validate('node.exe --version').allowed).toBe(true);
        });

        it('strips leading path so .\\node_modules\\.bin\\eslint is allowed', () => {
            expect(policy.validate('.\\node_modules\\.bin\\eslint src/').allowed).toBe(true);
        });
    });

    describe('blocked patterns', () => {
        it('blocks pipe (|)', () => {
            const result = policy.validate('node index.js | grep error');
            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/pipe/i);
        });

        it('blocks output redirect (>)', () => {
            const result = policy.validate('node index.js > out.txt');
            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/redirect/i);
        });

        it('blocks append redirect (>>)', () => {
            const result = policy.validate('node index.js >> log.txt');
            expect(result.allowed).toBe(false);
        });

        it('blocks rm -rf', () => {
            const result = policy.validate('node scripts/clean.js && rm -rf dist');
            expect(result.allowed).toBe(false);
        });

        it('blocks rmdir', () => {
            const result = policy.validate('node -e "require(\'rmdir\')"');
            // "rmdir" in the command string triggers the pattern
            expect(result.allowed).toBe(false);
        });

        it('blocks rd /s', () => {
            const result = policy.validate('rd /s /q dist');
            // rd is not allowlisted anyway, but verify the pattern check works too
            expect(result.allowed).toBe(false);
        });

        it('blocks curl -o file', () => {
            const result = policy.validate('curl -o out.bin https://x.com/y');
            expect(result.allowed).toBe(false);
        });

        it('blocks wget', () => {
            const result = policy.validate('wget https://x.com/y');
            expect(result.allowed).toBe(false);
        });

        it('blocks Invoke-Expression', () => {
            const result = policy.validate('powershell Invoke-Expression $cmd');
            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/invoke-expression/i);
        });

        it('blocks iex alias', () => {
            const result = policy.validate('powershell iex $script');
            expect(result.allowed).toBe(false);
        });

        it('blocks command chaining with ;', () => {
            const result = policy.validate('npm test; node badscript.js');
            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/chaining/i);
        });
    });

    describe('script existence check', () => {
        let tmpDir, scriptPath;

        beforeAll(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'max-policy-'));
            scriptPath = path.join(tmpDir, 'run.js');
            fs.writeFileSync(scriptPath, '// test script');
        });

        afterAll(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('allows node <script> when script exists', () => {
            const result = policy.validate(`node ${scriptPath}`, tmpDir);
            expect(result.allowed).toBe(true);
        });

        it('blocks node <script> when script does not exist', () => {
            const result = policy.validate('node missing_script.js', tmpDir);
            expect(result.allowed).toBe(false);
            expect(result.reason).toMatch(/does not exist/i);
        });

        it('allows node with no script arg (e.g. node --version)', () => {
            expect(policy.validate('node --version').allowed).toBe(true);
        });

        it('allows npm test without script existence check', () => {
            // npm is not an interpreter — no file check
            expect(policy.validate('npm test').allowed).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('blocks empty string', () => {
            expect(policy.validate('').allowed).toBe(false);
        });

        it('blocks null input', () => {
            expect(policy.validate(null).allowed).toBe(false);
        });

        it('blocks non-string input', () => {
            expect(policy.validate(42).allowed).toBe(false);
        });
    });
});


import { ShellTool } from './ShellTool.js';
import fs from 'fs/promises';
import path from 'path';

export const CodeRunnerTool = {
    name: 'coderunner',
    description: 'Execute code in multiple languages (Python, C, Go, Java, JS) using a temporary file pattern.',

    actions: {
        async run({ language, code, timeoutMs = 30000 }) {
            const lang = language.toLowerCase();
            const tempDir = path.join(process.cwd(), '.max', 'tmp');
            await fs.mkdir(tempDir, { recursive: true });

            let fileName, runCmd, compileCmd;

            switch (lang) {
                case 'python':
                case 'py':
                    fileName = `script_${Date.now()}.py`;
                    runCmd   = `python "${path.join(tempDir, fileName)}"`;
                    break;
                case 'node':
                case 'js':
                case 'javascript':
                    fileName = `script_${Date.now()}.js`;
                    runCmd   = `node "${path.join(tempDir, fileName)}"`;
                    break;
                case 'go':
                    fileName = `script_${Date.now()}.go`;
                    runCmd   = `go run "${path.join(tempDir, fileName)}"`;
                    break;
                case 'c':
                    fileName = `script_${Date.now()}.c`;
                    const outName = `script_${Date.now()}.exe`;
                    compileCmd = `gcc "${path.join(tempDir, fileName)}" -o "${path.join(tempDir, outName)}"`;
                    runCmd     = `"${path.join(tempDir, outName)}"`;
                    break;
                default:
                    return { success: false, error: `Unsupported language: ${language}` };
            }

            const filePath = path.join(tempDir, fileName);
            await fs.writeFile(filePath, code, 'utf8');

            try {
                if (compileCmd) {
                    const compRes = await ShellTool.actions.run({ command: compileCmd, timeoutMs });
                    if (!compRes.success) return { success: false, error: `Compilation failed: ${compRes.stderr || compRes.error}` };
                }

                const result = await ShellTool.actions.run({ command: runCmd, timeoutMs });
                
                // Cleanup
                await fs.unlink(filePath).catch(() => {});
                if (compileCmd) await fs.unlink(path.join(tempDir, fileName.replace('.c', '.exe'))).catch(() => {});

                return result;
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    }
};

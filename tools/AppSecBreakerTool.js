// ═══════════════════════════════════════════════════════════════════════════
// AppSecBreakerTool.js — MAX's Adversarial Security Engine
// 
// Proactively hunts for secrets, vulnerabilities, and logic flaws.
// Designed to prove vulnerabilities by generating reproduction exploits.
// ═══════════════════════════════════════════════════════════════════════════

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

export const AppSecBreakerTool = {
    name: 'breaker',
    description: 'Proactive security auditing, secret hunting, and exploit reproduction.',

    actions: {
        /**
         * Scans the project for hardcoded secrets, API keys, and credentials.
         */
        async scanSecrets({ dir = '.' }) {
            const patterns = [
                { name: 'Generic Secret', regex: /secret[_-]?key|api[_-]?key|password|auth[_-]?token/gi },
                { name: 'High Entropy String', regex: /[a-z0-9/+=]{40,}/gi },
                { name: 'Private Key', regex: /-----BEGIN RSA PRIVATE KEY-----/g },
                { name: 'Discord Webhook', regex: /https:\/\/discord\.com\/api\/webhooks\/[0-9]+\/[a-zA-Z0-9_-]+/g },
                { name: 'Environment Variable', regex: /process\.env\.[A-Z0-9_]+/g }
            ];

            const root = path.resolve(process.cwd(), dir);
            const findings = [];

            const scan = async (d) => {
                const entries = await fs.readdir(d, { withFileTypes: true });
                for (const e of entries) {
                    const full = path.join(d, e.name);
                    if (e.isDirectory()) {
                        if (['node_modules', '.git', 'dist', '.max'].includes(e.name)) continue;
                        await scan(full);
                    } else if (/\.(js|mjs|ts|json|env|md|txt|yml|yaml)$/.test(e.name)) {
                        const content = await fs.readFile(full, 'utf8');
                        const lines = content.split('\n');
                        
                        patterns.forEach(p => {
                            let match;
                            p.regex.lastIndex = 0;
                            while ((match = p.regex.exec(content)) !== null) {
                                const lineNo = content.slice(0, match.index).split('\n').length;
                                findings.push({
                                    file: path.relative(process.cwd(), full),
                                    line: lineNo,
                                    pattern: p.name,
                                    evidence: lines[lineNo - 1].trim().slice(0, 100)
                                });
                            }
                        });
                    }
                }
            };

            try {
                await scan(root);
                return { success: true, findings, count: findings.length };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        /**
         * Runs a dependency audit and returns structured vulnerability data.
         */
        async auditDeps() {
            try {
                const output = execSync('npm audit --json', { encoding: 'utf8', stdio: 'pipe' });
                const parsed = JSON.parse(output);
                return { 
                    success: true, 
                    vulnerabilities: parsed.vulnerabilities,
                    metadata: parsed.metadata
                };
            } catch (err) {
                try {
                    const parsed = JSON.parse(err.stdout);
                    return { success: true, vulnerabilities: parsed.vulnerabilities, metadata: parsed.metadata };
                } catch {
                    return { success: false, error: 'Failed to run npm audit' };
                }
            }
        },

        /**
         * Generates a Proof-of-Concept script to verify a potential vulnerability.
         * Takes an audit finding and writes a script that would trigger it.
         */
        async generateExploitRepro({ vulnerability, filePath }) {
            // This is a meta-action. In a real scenario, MAX would use the Brain 
            // to draft this. Here we provide the tool infrastructure.
            const reproPath = path.join(process.cwd(), 'temp-capabilities', `exploit_${Date.now()}.js`);
            
            const template = `
/**
 * AUTO-GENERATED EXPLOIT REPRODUCTION
 * Target: ${vulnerability}
 * File: ${filePath}
 */
import { AppSecBreakerTool } from '../tools/AppSecBreakerTool.js';

async function runRepro() {
    console.log("--- STARTING EXPLOIT REPRO ---");
    // Implementation would be injected here by the AgentLoop
}
runRepro();
`;
            await fs.mkdir(path.dirname(reproPath), { recursive: true });
            await fs.writeFile(reproPath, template);
            
            return { 
                success: true, 
                reproPath: path.relative(process.cwd(), reproPath),
                instruction: 'Execute this script using TOOL:coderunner:run to verify the vulnerability.'
            };
        }
    }
};

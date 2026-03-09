
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * TestGenerator — Autonomous unit test writer and runner.
 * Allows MAX to verify his own logic after self-evolution.
 */
export class TestGenerator {
    constructor(max) {
        this.max = max;
        this.testDir = path.join(process.cwd(), 'tests');
    }

    async initialize() {
        await fs.mkdir(this.testDir, { recursive: true });
    }

    /**
     * Tool Action: Generate a unit test for a specific file.
     */
    async generateTest({ targetFile, instruction = "Write a comprehensive unit test for this module." }) {
        if (!this.max.brain?._ready) return { success: false, error: "Brain not ready." };

        const fullPath = path.resolve(process.cwd(), targetFile);
        const content  = await fs.readFile(fullPath, 'utf8');
        const filename = path.basename(targetFile);
        const testName = filename.replace(/\.(js|mjs|cjs)$/, '.test.js');
        const testPath = path.join(this.testDir, testName);

        console.log(`[TestGenerator] 🧪 Generating test for: ${targetFile}`);

        const prompt = `You are an expert test engineer. Write a Jest unit test for the following source code.
FILE: ${targetFile}
CONTENT:
${content}

INSTRUCTION: ${instruction}

REQUIREMENTS:
1. Use ES Modules (import/export).
2. Mock dependencies if necessary.
3. Include at least 3-5 test cases covering edge cases.
4. Return ONLY the code for the test file. No explanation.`;

        try {
            const result = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.2 });
            let testCode = result.text;

            // Extract code block if LLM included one
            const match = testCode.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
            if (match) testCode = match[1];

            await fs.writeFile(testPath, testCode, 'utf8');
            return { success: true, testFile: testPath, code: testCode };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Tool Action: Run tests and return the result.
     */
    async runTests() {
        console.log(`[TestGenerator] 🏃 Running test suite...`);
        try {
            const { stdout, stderr } = await execAsync('npm test');
            return { success: true, output: stdout + stderr };
        } catch (err) {
            return { success: false, output: err.stdout + err.stderr, error: err.message };
        }
    }

    asTool() {
        return {
            name: 'lab',
            description: 'The testing lab. Use this to generate and run unit tests for your code.',
            actions: {
                generate: async (params) => await this.generateTest(params),
                run:      async () => await this.runTests()
            }
        };
    }
}

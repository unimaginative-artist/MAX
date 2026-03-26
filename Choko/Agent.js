// ═══════════════════════════════════════════════════════════════════════════
// Choko — A new agentic instance
// Simplified, focused, and autonomous.
// ═══════════════════════════════════════════════════════════════════════════

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import { Brain } from '../core/Brain.js';
import { DriveSystem } from '../core/DriveSystem.js';
import { Heartbeat } from '../core/Heartbeat.js';
import { AgentLoop } from '../core/AgentLoop.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { FileTools } from '../tools/FileTools.js';
import { ShellTool } from '../tools/ShellTool.js';
import { GoalEngine } from '../core/GoalEngine.js';
import { MaxMemory } from '../memory/MaxMemory.js';
import { OutcomeTracker } from '../core/OutcomeTracker.js';
import { UserProfile } from '../onboarding/UserProfile.js';
import { SkillLibrary } from '../core/SkillLibrary.js';
import { KnowledgeBase } from '../memory/KnowledgeBase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Choko {
    constructor(config = {}) {
        this.config = config;
        this.name = config.name || 'Choko';
        this._ready = false;

        // Shared or dedicated economics
        this.economics = config.economics;

        // Dedicated data directory for this agent
        this.dataDir = path.join(__dirname, '.max');
        console.log(`[${this.name}] 📂 Data directory: ${this.dataDir}`);
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Core systems — passing this to Brain so it can use economics
        this.brain = new Brain(this, config);
        this.drive = new DriveSystem(config.drive || {});
        this.memory = new MaxMemory({ 
            dbPath: path.join(this.dataDir, 'memory.db'),
            vectorPath: path.join(this.dataDir, 'vectors.json')
        });
        this.kb = new KnowledgeBase({ 
            dbPath: path.join(this.dataDir, 'knowledge.db') 
        });
        
        // Tools
        this.tools = new ToolRegistry();
        
        // Autonomous systems
        this.outcomes = new OutcomeTracker({ 
            storageDir: path.join(this.dataDir, 'outcomes') 
        });
        this.goals = new GoalEngine(this.brain, this.outcomes, this.memory, {
            storageDir: this.dataDir
        });
        this.profile = new UserProfile();
        this.skills = new SkillLibrary();
        
        this.agentLoop = new AgentLoop(this, config.agentLoop || {});
        this.heartbeat = new Heartbeat(this, { 
            intervalMs: config.heartbeatMs || 60000 
        });

        this.persona = '';
        this.hats = new Map(); // name -> content
        this.currentHat = 'Strawberry';
        this._context = [];
    }

    async initialize() {
        console.log(`[${this.name}] Initializing...`);

        // Load Hats
        const hatsDir = path.join(__dirname, 'personas');
        if (fs.existsSync(hatsDir)) {
            const files = fs.readdirSync(hatsDir).filter(f => f.endsWith('.md'));
            for (const file of files) {
                const name = file.replace('.md', '');
                const content = fs.readFileSync(path.join(hatsDir, file), 'utf8');
                this.hats.set(name, content);
            }
            console.log(`[${this.name}] 👒 Loaded ${this.hats.size} Scout Hats.`);
        }

        // Set base persona
        const basePersonaPath = path.join(__dirname, 'persona.md');
        if (fs.existsSync(basePersonaPath)) {
            this.persona = fs.readFileSync(basePersonaPath, 'utf8');
        }

        // Memory tiers
        await this.memory.initialize();
        await this.kb.initialize();
        
        // Profile
        this.profile.load();

        // Brain
        await this.brain.initialize();
        
        // Outcomes
        await this.outcomes.initialize();
        
        // Goals & Skills
        this.goals.initialize();
        await this.skills.initialize();

        // Register core tools
        this.tools.register(FileTools);
        this.tools.register(ShellTool);

        // Register agent-specific tools from ./tools directory
        await this._loadLocalTools();

        this.heartbeat.start();
        this._ready = true;
        console.log(`[${this.name}] Online and ready.`);
    }

    async _loadLocalTools() {
        const toolsDir = path.join(__dirname, 'tools');
        if (fs.existsSync(toolsDir)) {
            const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.js'));
            for (const file of files) {
                try {
                    const fullPath = path.join(toolsDir, file);
                    const module = await import(pathToFileURL(fullPath).href);
                    if (module.default) {
                        this.tools.register(module.default);
                        console.log(`[${this.name}] Registered local tool: ${file}`);
                    }
                } catch (err) {
                    console.error(`[${this.name}] Failed to load tool ${file}:`, err.message);
                }
            }
        }
    }

    async think(userMessage, options = {}) {
        if (!this._ready) throw new Error(`${this.name} not initialized`);

        // Get current hat content
        const hatContent = this.hats.get(this.currentHat) || '';
        
        const systemPrompt = (this.persona || `You are ${this.name}, an autonomous agentic assistant.`) + `
\n## CURRENT MODE: ${this.currentHat}
${hatContent}

Focus on being efficient, accurate, and helpful.
Use the tools provided to accomplish tasks.
${this.tools.buildManifest()}
${this.profile.buildContextBlock()}`;

        const result = await this.brain.think(userMessage, {
            systemPrompt,
            ...options
        });

        // Agentic loop: if response contains tool calls, execute and re-think
        let response = result.text;
        let toolTurns = 0;
        const maxToolTurns = 5;

        while (response.includes('TOOL:') && toolTurns < maxToolTurns) {
            toolTurns++;
            console.log(`[${this.name}] Tool turn ${toolTurns}...`);
            const processed = await this._processToolCalls(response);
            
            // Re-think with results
            const nextResult = await this.brain.think(`${userMessage}\n\nTool results:\n${processed}`, {
                systemPrompt,
                ...options
            });
            response = nextResult.text;
        }

        return response;
    }

    async _processToolCalls(text) {
        const lines = text.split('\n');
        const results = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('TOOL:')) {
                console.log(`[${this.name}] Calling: ${trimmed}`);
                const toolResult = await this.tools.executeLLMToolCall(trimmed);
                results.push(`[Tool result: ${JSON.stringify(toolResult)}]`);
            }
        }
        return results.join('\n');
    }

    async switchHat(name) {
        if (this.hats.has(name)) {
            this.currentHat = name;
            console.log(`[${this.name}] 👒 Switched hat to: ${name}`);
            await this.recordJournal(`Switched hat to ${name}`, 'Waku-waku!');
            return true;
        }
        return false;
    }

    async recordJournal(event, sentiment = 'Good!') {
        const journalPath = path.join(this.dataDir, 'journal.md');
        const date = new Date().toISOString().split('T')[0];
        const entry = `| ${date} | ${event} | ${sentiment} |\n`;
        
        try {
            fs.appendFileSync(journalPath, entry);
        } catch (err) {
            console.error(`[${this.name}] Failed to update journal:`, err.message);
        }
    }

    getStatus() {
        return {
            ready: this._ready,
            brain: this.brain.getStatus(),
            drive: this.drive.getStatus(),
            memory: this.memory.getStats(),
            goals: this.goals.getStatus()
        };
    }
}

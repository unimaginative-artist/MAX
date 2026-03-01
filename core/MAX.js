// ═══════════════════════════════════════════════════════════════════════════
// MAX.js — the agent
// Self-organizing, driven, curious, opinionated.
// Max Headroom energy. Does not sugarcoat.
// ═══════════════════════════════════════════════════════════════════════════

import { Brain }              from './Brain.js';
import { DriveSystem }        from './DriveSystem.js';
import { Heartbeat }          from './Heartbeat.js';
import { CuriosityEngine }    from './CuriosityEngine.js';
import { PersonaEngine }      from '../personas/PersonaEngine.js';
import { ToolRegistry }       from '../tools/ToolRegistry.js';
import { FileTools }          from '../tools/FileTools.js';
import { ShellTool }          from '../tools/ShellTool.js';
import { WebTool }            from '../tools/WebTool.js';
import { GitTool }            from '../tools/GitTool.js';
import { ApiTool }            from '../tools/ApiTool.js';
import { SwarmCoordinator }   from '../swarm/SwarmCoordinator.js';
import { DebateEngine }       from '../debate/DebateEngine.js';
import { MemoryStore }        from '../memory/MemoryStore.js';

export class MAX {
    constructor(config = {}) {
        this.config = config;
        this.name   = 'MAX';
        this._ready = false;

        // Core systems
        this.brain    = new Brain(config);
        this.drive    = new DriveSystem(config.drive);
        this.curiosity = new CuriosityEngine(config.curiosity);
        this.persona  = new PersonaEngine();
        this.memory   = new MemoryStore(config.memory);

        // Tools
        this.tools    = new ToolRegistry();

        // Higher systems — init after brain is ready
        this.swarm    = null;
        this.debate   = null;
        this.heartbeat = null;

        // Conversation context window
        this._context = [];
        this._contextLimit = 12;  // last N turns
    }

    async initialize() {
        console.log('\n' + '═'.repeat(60));
        console.log('  MAX — autonomous engineering agent');
        console.log('  Initializing...');
        console.log('═'.repeat(60));

        // Memory
        this.memory.initialize();

        // Brain
        await this.brain.initialize();
        if (!this.brain._ready) {
            console.error('\n[MAX] ❌ No LLM backend. Cannot operate without a brain.');
            console.error('  → Start Ollama: https://ollama.com');
            console.error('  → Or add GEMINI_API_KEY to config/api-keys.env\n');
            return;
        }

        // Tools
        this.tools.register(FileTools);
        this.tools.register(ShellTool);
        this.tools.register(WebTool);
        this.tools.register(GitTool);
        this.tools.register(ApiTool);

        // Higher systems
        this.swarm     = new SwarmCoordinator(this.brain, this.tools);
        this.debate    = new DebateEngine(this.brain);
        this.heartbeat = new Heartbeat(this);

        this._ready = true;

        const status = this.brain.getStatus();
        console.log(`\n[MAX] ✅ Online — ${status.backend} / ${status.model}`);
        console.log(`[MAX] 🧠 Persona: ${this.persona.getStatus().name}`);
        console.log(`[MAX] 🛠️  Tools: ${this.tools.list().map(t => t.name).join(', ')}`);
        console.log('[MAX] Ready.\n');

        // Start autonomous heartbeat if configured
        if (this.config.autoStart !== false) {
            this.heartbeat.start();
        }
    }

    // ─── Main think/respond loop ──────────────────────────────────────────
    async think(userMessage, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');

        // Auto-select persona based on message
        const selectedPersona = options.persona
            ? this.persona.switchTo(options.persona)
            : this.persona.selectForTask(userMessage);

        // Build conversation history
        this._context.push({ role: 'user', content: userMessage });
        if (this._context.length > this._contextLimit * 2) {
            this._context = this._context.slice(-this._contextLimit * 2);
        }

        // Build system prompt
        const systemPrompt = this.persona.buildSystemPrompt(selectedPersona)
            + this._buildStateContext()
            + (options.includeTools ? this.tools.buildManifest() : '');

        // Build full prompt with history
        const historyText = this._context
            .slice(-this._contextLimit)
            .map(m => `${m.role === 'user' ? 'USER' : 'MAX'}: ${m.content}`)
            .join('\n\n');

        const fullPrompt = historyText;

        // Think
        const response = await this.brain.think(fullPrompt, {
            systemPrompt,
            temperature: options.temperature ?? 0.7,
            maxTokens:   options.maxTokens   ?? 2048
        });

        // Check for tool calls in response
        const processedResponse = await this._processToolCalls(response);

        // Update context and memory
        this._context.push({ role: 'assistant', content: processedResponse });
        this.memory.addConversation('user', userMessage, selectedPersona.id);
        this.memory.addConversation('assistant', processedResponse, selectedPersona.id);

        // Drive reward
        this.drive.onTaskExecuted();

        return {
            response:  processedResponse,
            persona:   selectedPersona.id,
            drive:     this.drive.getStatus()
        };
    }

    // ─── Swarm mode: break into parallel subtasks ─────────────────────────
    async swarmThink(taskDescription, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');

        console.log(`[MAX] 🐝 Swarm mode: "${taskDescription}"`);

        // Decompose into subtasks
        const numWorkers = options.workers || this.swarm.config.maxWorkers;
        const subtasks   = await this.swarm.decompose(taskDescription, numWorkers);

        console.log(`[MAX] Breaking into ${subtasks.length} subtasks...`);
        subtasks.forEach(s => console.log(`  • ${s.id}: ${s.prompt?.slice(0, 70)}...`));

        // Run swarm
        const result = await this.swarm.run({
            name:     taskDescription,
            subtasks
        });

        this.drive.onGoalComplete(taskDescription);

        return result;
    }

    // ─── Debate a decision ────────────────────────────────────────────────
    async debateDecision(proposal) {
        if (!this._ready) throw new Error('MAX not initialized');
        return this.debate.debate(proposal);
    }

    // ─── Process tool calls embedded in LLM output ────────────────────────
    async _processToolCalls(text) {
        if (!text.includes('TOOL:')) return text;

        const lines  = text.split('\n');
        const result = [];

        for (const line of lines) {
            if (line.trim().startsWith('TOOL:')) {
                const toolResult = await this.tools.executeLLMToolCall(line.trim());
                if (toolResult) {
                    result.push(`[Tool result: ${JSON.stringify(toolResult)}]`);
                } else {
                    result.push(line);
                }
            } else {
                result.push(line);
            }
        }

        return result.join('\n');
    }

    // ─── Build state context for system prompt ────────────────────────────
    _buildStateContext() {
        const drive     = this.drive.getStatus();
        const curiosity = this.curiosity.getStatus();
        const memory    = this.memory.getStats();

        return `\n\n## Your current state
Tension: ${(drive.tension * 100).toFixed(0)}% | Satisfaction: ${(drive.satisfaction * 100).toFixed(0)}% | Goals completed: ${drive.goalsCompleted}
Curiosity queue: ${curiosity.queueDepth} | Topics explored: ${curiosity.topicsExplored}
Memory: ${memory.totalMemories} stored facts | ${memory.conversationTurns} conversation turns`;
    }

    // ─── Clear conversation context ───────────────────────────────────────
    clearContext() {
        this._context = [];
        console.log('[MAX] Context cleared.');
    }

    // ─── Full status snapshot ─────────────────────────────────────────────
    getStatus() {
        return {
            ready:      this._ready,
            brain:      this.brain.getStatus(),
            drive:      this.drive.getStatus(),
            curiosity:  this.curiosity.getStatus(),
            persona:    this.persona.getStatus(),
            memory:     this.memory.getStats(),
            swarm:      this.swarm?.getStatus(),
            heartbeat:  this.heartbeat?.getStatus()
        };
    }
}

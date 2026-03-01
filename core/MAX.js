// ═══════════════════════════════════════════════════════════════════════════
// MAX.js — the agent
// Self-organizing, driven, curious, opinionated.
// Max Headroom energy. Does not sugarcoat.
// ═══════════════════════════════════════════════════════════════════════════

import path                   from 'path';
import { fileURLToPath }      from 'url';
import { Brain }              from './Brain.js';
import { DriveSystem }        from './DriveSystem.js';
import { Heartbeat }          from './Heartbeat.js';
import { CuriosityEngine }    from './CuriosityEngine.js';
import { Scheduler }          from './Scheduler.js';
import { OutcomeTracker }     from './OutcomeTracker.js';
import { ReasoningChamber }   from './ReasoningChamber.js';
import { GoalEngine }         from './GoalEngine.js';
import { AgentLoop }          from './AgentLoop.js';
import { ToolCreator }        from './ToolCreator.js';
import { SelfCodeInspector }  from './SelfCodeInspector.js';
import { ReflectionEngine }   from './ReflectionEngine.js';
import { PersonaEngine }      from '../personas/PersonaEngine.js';
import { ToolRegistry }       from '../tools/ToolRegistry.js';
import { FileTools }          from '../tools/FileTools.js';
import { ShellTool }          from '../tools/ShellTool.js';
import { WebTool }            from '../tools/WebTool.js';
import { GitTool }            from '../tools/GitTool.js';
import { ApiTool }            from '../tools/ApiTool.js';
import { SwarmCoordinator }   from '../swarm/SwarmCoordinator.js';
import { DebateEngine }       from '../debate/DebateEngine.js';
import { MaxMemory }          from '../memory/MaxMemory.js';
import { KnowledgeBase }      from '../memory/KnowledgeBase.js';
import { UserProfile }        from '../onboarding/UserProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MAX {
    constructor(config = {}) {
        this.config = config;
        this.name   = 'MAX';
        this._ready = false;

        // Core systems
        this.brain     = new Brain(config);
        this.drive     = new DriveSystem(config.drive);
        this.curiosity = new CuriosityEngine(config.curiosity);
        this.persona   = new PersonaEngine();
        this.memory    = new MaxMemory(config.memory);
        this.kb        = new KnowledgeBase({ dbPath: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.max', 'knowledge.db') });
        this.profile   = new UserProfile();

        // Tools
        this.tools     = new ToolRegistry();

        // Higher systems — init after brain is ready
        this.swarm     = null;
        this.debate    = null;
        this.heartbeat = null;
        this.scheduler = null;

        // Autonomous systems
        this.outcomes     = null;
        this.reasoning    = null;
        this.goals        = null;
        this.agentLoop    = null;
        this.toolCreator  = null;
        this.selfInspector = null;
        this.reflection    = null;

        // Conversation context window
        this._context      = [];
        this._contextLimit = 12;
    }

    async initialize() {
        console.log('\n' + '═'.repeat(60));
        console.log('  MAX — autonomous engineering agent');
        console.log('  Initializing...');
        console.log('═'.repeat(60));

        // Memory (async — loads vectors + tries to init embedder)
        await this.memory.initialize();
        await this.kb.initialize();

        // User profile — load from .max/user.md and .max/tasks.md
        this.profile.load();
        if (this.profile.hasProfile) {
            console.log(`[MAX] 👤 Profile: ${this.profile.name}`);
        }

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
        this.heartbeat = new Heartbeat(this, { intervalMs: this.config.heartbeatMs || 5 * 60 * 1000 });
        this.scheduler = new Scheduler(this);

        // Scheduler routes insights to heartbeat events so one listener covers both
        this.scheduler.on('insight', (insight) => {
            this.heartbeat.emit('insight', insight);
        });

        // Autonomous systems
        const dataDir  = path.join(__dirname, '..', '.max');
        this.outcomes  = new OutcomeTracker({ storageDir: path.join(dataDir, 'outcomes') });
        await this.outcomes.initialize();

        this.reasoning = new ReasoningChamber(this.brain);

        this.goals     = new GoalEngine(this.brain, this.outcomes);
        this.goals.initialize();

        this.agentLoop = new AgentLoop(this, this.config.agentLoop);

        // Route AgentLoop events through the heartbeat so the launcher's one listener handles everything
        this.agentLoop.on('insight',        (i) => this.heartbeat.emit('insight', i));
        this.agentLoop.on('approvalNeeded', (a) => this.heartbeat.emit('approvalNeeded', a));

        // ToolCreator — MAX writes new tools at runtime
        this.toolCreator = new ToolCreator(this.brain, this.tools);
        await this.toolCreator.reloadSaved();  // reload any tools generated in past sessions

        // SelfCodeInspector — MAX inspects his own source and queues improvements
        this.selfInspector = new SelfCodeInspector(this.goals);

        // ReflectionEngine — fractal meta-brain, watches performance and improves over time
        this.reflection = new ReflectionEngine(this.brain, this.goals, this.outcomes);
        // Run first inspection in background — don't block boot
        setTimeout(() => {
            this.selfInspector.inspect().then(() => {
                const queued = this.selfInspector.queueGoals(2);
                if (queued.length > 0) {
                    console.log(`[MAX] 🔍 Self-inspection queued ${queued.length} improvement goal(s)`);
                }
            }).catch(() => {});
        }, 5000);

        this._ready = true;

        const status = this.brain.getStatus();
        console.log(`\n[MAX] ✅ Online — ${status.backend} / ${status.model}`);
        console.log(`[MAX] 🧠 Persona: ${this.persona.getStatus().name}`);
        console.log(`[MAX] 🛠️  Tools: ${this.tools.list().map(t => t.name).join(', ')}`);

        // Always start the autonomous systems — MAX is proactive by default
        this.scheduler.initialize();
        this.scheduler.start();
        this.heartbeat.start();

        console.log('[MAX] Ready.\n');
    }

    // ─── Main think/respond loop ──────────────────────────────────────────
    async think(userMessage, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');

        // Auto-select persona based on message content + internal drive state
        const selectedPersona = options.persona
            ? this.persona.switchTo(options.persona)
            : this.persona.selectForTask(userMessage, this.drive.getStatus());

        // Build conversation history
        this._context.push({ role: 'user', content: userMessage });
        if (this._context.length > this._contextLimit * 2) {
            this._context = this._context.slice(-this._contextLimit * 2);
        }

        // Refresh profile if user edited the files since last read
        this.profile.refresh();

        // Build system prompt — persona + state + user profile + workspace + self-model
        const systemPrompt = this.persona.buildSystemPrompt(selectedPersona)
            + this._buildStateContext()
            + this.profile.buildContextBlock()
            + this.memory.getContextString()
            + (this.reflection?.getSelfModelContext() || '')
            + (options.includeTools ? this.tools.buildManifest() : '');

        // Pull relevant episodic memories + KB chunks in parallel
        const [relevantMemories, kbChunks] = await Promise.all([
            this.memory.recall(userMessage, { topK: 4 }),
            this.kb.query(userMessage, { topK: 5, brain: this.brain })
        ]);

        const memoryContext = relevantMemories.length > 0
            ? '\n\n## Relevant from memory\n' + relevantMemories
                .map(m => `- ${m.content.slice(0, 200)}`)
                .join('\n')
            : '';

        const kbContext = this.kb.formatForPrompt(kbChunks, 3000);

        // Build full prompt with history
        const historyText = this._context
            .slice(-this._contextLimit)
            .map(m => `${m.role === 'user' ? 'USER' : 'MAX'}: ${m.content}`)
            .join('\n\n');

        // Think
        const response = await this.brain.think(historyText, {
            systemPrompt: systemPrompt + memoryContext + kbContext,
            temperature: options.temperature ?? 0.7,
            maxTokens:   options.maxTokens   ?? 2048
        });

        // Check for tool calls in response
        const processedResponse = await this._processToolCalls(response);

        // Update context and memory (MaxMemory also extracts workspace signals)
        this._context.push({ role: 'assistant', content: processedResponse });
        this.memory.addConversation('user',      userMessage,       selectedPersona.id);
        this.memory.addConversation('assistant', processedResponse, selectedPersona.id);

        // Pre-compaction flush — before context window fills, extract key facts to permanent storage
        // This prevents silent memory loss when old turns get truncated
        if (this._context.length >= this._contextLimit * 1.6) {
            this._flushMemories().catch(() => {});
        }

        // After responding, queue a follow-up curiosity task from this topic
        this._queueFollowUpCuriosity(userMessage);

        // Fire-and-forget reflection — scores this turn, runs deep analysis every N turns
        this.reflection?.reflectOnTurn(userMessage, processedResponse, {
            persona: selectedPersona.id,
            drive:   this.drive.getStatus()
        }).catch(() => {});

        // Drive reward
        this.drive.onTaskExecuted();

        return {
            response:  processedResponse,
            persona:   selectedPersona.id,
            drive:     this.drive.getStatus()
        };
    }

    // ─── After a user convo, MAX generates related things to explore ───────
    _queueFollowUpCuriosity(userMessage) {
        if (userMessage.length < 20) return;
        // Simple: queue an exploration prompt related to this conversation
        const topics = userMessage.match(/\b([A-Z][a-z]+|[a-z]{5,})\b/g)?.slice(0, 3) || [];
        if (topics.length > 0) {
            const topic = topics[Math.floor(Math.random() * topics.length)];
            this.curiosity.queueTask(
                `Follow-up: ${topic}`,
                `The user recently discussed "${userMessage.slice(0, 100)}".
Think deeper about the engineering implications. What are edge cases, gotchas, or related patterns worth knowing?`,
                0.4
            );
        }
    }

    // ─── Swarm mode: break into parallel subtasks ─────────────────────────
    async swarmThink(taskDescription, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');

        console.log(`[MAX] 🐝 Swarm mode: "${taskDescription}"`);

        const numWorkers = options.workers || this.swarm.config.maxWorkers;
        const subtasks   = await this.swarm.decompose(taskDescription, numWorkers);

        console.log(`[MAX] Breaking into ${subtasks.length} subtasks...`);
        subtasks.forEach(s => console.log(`  • ${s.id}: ${s.prompt?.slice(0, 70)}...`));

        const result = await this.swarm.run({ name: taskDescription, subtasks });

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
        const goals     = this.goals?.getStatus();
        const outcomes  = this.outcomes?.getStats();

        let state = `\n\n## Your current state
Tension: ${(drive.tension * 100).toFixed(0)}% | Satisfaction: ${(drive.satisfaction * 100).toFixed(0)}% | Goals completed: ${drive.goalsCompleted}
Curiosity queue: ${curiosity.queueDepth} | Topics explored: ${curiosity.topicsExplored}
Memory: ${memory.totalMemories} stored facts | ${memory.conversationTurns} conversation turns`;

        if (goals) {
            state += `\nActive goals: ${goals.active} | Completed: ${goals.completed}`;
        }
        if (outcomes && outcomes.total > 0) {
            const rate = outcomes.total > 0 ? ((outcomes.success / outcomes.total) * 100).toFixed(0) : 'n/a';
            state += ` | Action success rate: ${rate}%`;
        }
        return state;
    }

    // ─── Pre-compaction memory flush ──────────────────────────────────────
    // Called when context is 80% full. Silently extracts key facts into
    // permanent memory so they survive the upcoming context truncation.
    async _flushMemories() {
        if (!this.brain._ready) return;
        const recent = this._context.slice(-8)
            .map(m => `${m.role === 'user' ? 'USER' : 'MAX'}: ${m.content.slice(0, 300)}`)
            .join('\n\n');

        try {
            const facts = await this.brain.think(
                `From this conversation excerpt, extract 3-5 specific facts worth remembering long-term.
Focus on: decisions made, things learned, user preferences revealed, problems solved.
Return ONLY a JSON array of strings: ["fact1", "fact2", ...]

CONVERSATION:
${recent}`,
                { temperature: 0.2, maxTokens: 400, tier: 'fast' }
            );

            const match = facts.match(/\[[\s\S]*?\]/);
            if (!match) return;

            const extracted = JSON.parse(match[0]);
            for (const fact of extracted.slice(0, 5)) {
                if (typeof fact === 'string' && fact.length > 10) {
                    await this.memory.remember(fact, { source: 'compaction_flush' }, {
                        type: 'core_memory',
                        importance: 0.8
                    });
                }
            }
            console.log(`[MAX] 💾 Compaction flush: saved ${extracted.length} facts before context truncation`);
        } catch { /* non-fatal */ }
    }

    clearContext() {
        this._context = [];
        console.log('[MAX] Context cleared.');
    }

    getStatus() {
        return {
            ready:      this._ready,
            brain:      this.brain.getStatus(),
            drive:      this.drive.getStatus(),
            curiosity:  this.curiosity.getStatus(),
            persona:    this.persona.getStatus(),
            memory:     this.memory.getStats(),
            profile:    this.profile.getStats(),
            swarm:      this.swarm?.getStatus(),
            heartbeat:  this.heartbeat?.getStatus(),
            scheduler:  this.scheduler?.getStatus(),
            goals:        this.goals?.getStatus(),
            agentLoop:    this.agentLoop?.getStatus(),
            outcomes:     this.outcomes?.getStats(),
            reasoning:    this.reasoning?.getStats(),
            toolCreator:   this.toolCreator?.getStatus(),
            selfInspector: this.selfInspector?.getStatus(),
            reflection:    this.reflection?.getStatus(),
            kb:            this.kb?.getStatus()
        };
    }
}

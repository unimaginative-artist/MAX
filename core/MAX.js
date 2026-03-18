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
import { RoadmapEngine }      from './RoadmapEngine.js';
import { ToolCreator }        from './ToolCreator.js';
import { EvolutionArbiter }   from './EvolutionArbiter.js';
import { SelfCodeInspector }  from './SelfCodeInspector.js';
import { ReflectionEngine }   from './ReflectionEngine.js';
import { FrontierResearch }   from './FrontierResearch.js';
import { PersonaEngine }      from '../personas/PersonaEngine.js';
import { ToolRegistry }       from '../tools/ToolRegistry.js';
import { FileTools }          from '../tools/FileTools.js';
import { ShellTool, getRunningProcesses } from '../tools/ShellTool.js';
import { WebTool }            from '../tools/WebTool.js';
import { GitTool }            from '../tools/GitTool.js';
import { ApiTool }            from '../tools/ApiTool.js';
import { CodeRunnerTool }     from '../tools/CodeRunnerTool.js';
import { createVisionTool }   from '../tools/VisionTool.js';
import { createSelfEvolutionTool } from '../tools/SelfEvolutionTool.js';
import { DiscordTool, autoConnectDiscord } from '../tools/DiscordTool.js';
import { EmailTool,   autoConnectEmail   } from '../tools/EmailTool.js';
import { SwarmCoordinator }   from '../swarm/SwarmCoordinator.js';
import { DebateEngine }       from '../debate/DebateEngine.js';
import { MaxMemory }          from '../memory/MaxMemory.js';
import { KnowledgeBase }      from '../memory/KnowledgeBase.js';
import { UserProfile }        from '../onboarding/UserProfile.js';
import { CodeIndexer }        from '../memory/CodeIndexer.js';
import { RepoGraph }          from './RepoGraph.js';
import { DiagnosticsSystem }  from './Diagnostics.js';
import { Sentinel }           from './Sentinel.js';
import { WorldModel }         from './WorldModel.js';
import { ArtifactManager }    from './ArtifactManager.js';
import { TestGenerator }      from './TestGenerator.js';
import { SkillLibrary }       from './SkillLibrary.js';
import { SelfEditor }         from './SelfEditor.js';
import { Notifier }           from './Notifier.js';
import { SomaBridge }         from './SomaBridge.js';
import fs                     from 'fs';

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
        this.evolution    = null;
        this.goals        = null;
        this.agentLoop    = null;
        this.toolCreator  = null;
        this.selfInspector = null;
        this.reflection    = null;
        this.indexer       = new CodeIndexer(this);
        this.sentinel      = new Sentinel(this);
        this.graph         = new RepoGraph(this);
        this.diagnostics   = new DiagnosticsSystem(this);
        this.world         = new WorldModel(this);
        this.artifacts     = new ArtifactManager(this);
        this.lab           = new TestGenerator(this);
        this.skills        = new SkillLibrary();
        this.selfEditor    = new SelfEditor();
        this.notifier      = new Notifier();
        this.soma          = new SomaBridge();

        // Conversation context window
        this._context         = [];
        this._contextLimit    = 12;
        this._compressing     = false;
        this._sessionBriefing = null;
        this._chatBusy        = false;

        // System prompt cache — rebuilt only when persona or drive state changes
        this._promptCache     = { key: null, prompt: null };

        // Project context — detected once at startup from package.json / README
        this._projectContext  = null;
    }

    async initialize() {
        console.log('\n' + '═'.repeat(60));
        console.log('  MAX — autonomous engineering agent');
        console.log('  Initializing...');
        console.log('═'.repeat(60));

        // Memory (async — loads vectors + tries to init embedder)
        console.log('[MAX] 💾 Initializing memory tiers...');
        await this.memory.initialize();
        await this.kb.initialize();

        // User profile — load from .max/user.md and .max/tasks.md
        console.log('[MAX] 👤 Loading user profile...');
        this.profile.load();
        if (this.profile.hasProfile) {
            console.log(`[MAX] 👤 Profile loaded: ${this.profile.name}`);
        }

        // Brain
        console.log('[MAX] 🧠 Initializing brain backends...');
        await this.brain.initialize();
        if (!this.brain._ready) {
            console.error('\n[MAX] ❌ No LLM backend. Cannot operate without a brain.');
            console.error('  → Start Ollama: https://ollama.com');
            console.error('  → Or add GEMINI_API_KEY to config/api-keys.env\n');
            return;
        }

        // Tools
        console.log('[MAX] 🛠️  Registering tools...');
        this.tools.register(FileTools);
        this.tools.register(ShellTool);
        this.tools.register(WebTool);
        this.tools.register(GitTool);
        this.tools.register(ApiTool);
        this.tools.register(CodeRunnerTool);
        this.tools.register(DiscordTool);
        this.tools.register(EmailTool);
        this.tools.register(this.artifacts.asTool());
        this.tools.register(createVisionTool(this));
        this.tools.register(createSelfEvolutionTool(this));
        this.tools.register(this.lab.asTool());

        // ── SOMA tool proxy — GUI, screen, vision, audio via SOMA's arbiters ──
        // These proxy directly to SOMA's registered ToolRegistry over HTTP.
        // SOMA must be running at SOMA_URL. Falls back gracefully if offline.
        this.tools.register({
            name: 'soma_tools',
            description: `Proxy to SOMA's hardware + perception tool suite.
Available actions:
  screenshot      → capture the screen: TOOL:soma_tools:screenshot:{}
  vision_scan     → detect objects/text on screen: TOOL:soma_tools:vision_scan:{"source":"screen","threshold":0.7}
  computer_control → click, type, move mouse: TOOL:soma_tools:computer_control:{"actionType":"click","label":"Submit"}
                     actionType options: mouse_move | click | type | browser
                     click by label (from vision_scan) or by x,y coords
  visual_task     → autonomous see-and-click loop: TOOL:soma_tools:visual_task:{"instruction":"Click the login button"}
  audio_listen    → capture and transcribe audio via Whisper: TOOL:soma_tools:audio_listen:{}
  call_any        → call any SOMA tool by name: TOOL:soma_tools:call_any:{"tool":"tool_name","args":{}}

Requires SOMA running at SOMA_URL. Returns {success, result} or {success:false, error}.`,
            actions: {
                screenshot:       async (args) => this.soma.callTool('screenshot', args),
                vision_scan:      async (args) => this.soma.callTool('vision_scan', args),
                computer_control: async (args) => this.soma.callTool('computer_control', args),
                visual_task:      async (args) => this.soma.callTool('visual_task', args),
                audio_listen:     async (args) => this.soma.callTool('audio_listen', args),
                call_any:         async ({ tool, args = {} }) => this.soma.callTool(tool, args),
            }
        });

        // Wire integration callbacks → heartbeat insights
        console.log('[MAX] ♻️  Connecting integrations...');
        DiscordTool.onMessage = (msg) => {
            this.heartbeat.emit('insight', {
                source: 'discord',
                label:  `Discord — ${msg.author} in #${msg.channel}`,
                result: msg.content
            });
        };

        // Auto-respond loop: monitored channels → brain → reply back to Discord
        DiscordTool.onRespond = async (msg) => {
            try {
                const prompt = `You are MAX, an autonomous AI assistant responding in Discord.
Channel: #${msg.channel} | User: ${msg.author}
Message: ${msg.content}

Reply naturally and concisely. Plain text only — no markdown headers, no bullet spam.`;
                const response = await this.brain.think(prompt, { temperature: 0.8 });
                return response?.text?.trim() || null;
            } catch (err) {
                console.warn('[Discord] Auto-respond brain error:', err.message);
                return null;
            }
        };
        EmailTool.onMessage = (email) => {
            this.heartbeat.emit('insight', {
                source: 'email',
                label:  `Email from ${email.from}`,
                result: `Subject: ${email.subject}\nDate: ${email.date}`
            });
        };

        // Auto-connect integrations if credentials already saved
        autoConnectDiscord().catch(() => {});
        autoConnectEmail().catch(() => {});

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
        console.log('[MAX] ⚙️  Wiring autonomous systems...');
        const dataDir  = path.join(__dirname, '..', '.max');
        this.outcomes  = new OutcomeTracker({ storageDir: path.join(dataDir, 'outcomes') });
        await this.outcomes.initialize();
        await this.artifacts.init();
        await this.skills.initialize();
        await this.selfEditor.initialize();

        // SOMA bridge — try to connect to SOMA; gracefully offline if not running
        await this.soma.initialize();

        // Morning briefing scheduler — 8am daily
        // (wired to Scheduler after heartbeat is set up below)

        // Session continuity — restore conversation + brief MAX on where he left off
        const sessionFile = path.join(dataDir, 'session.json');
        if (fs.existsSync(sessionFile)) {
            try {
                const s        = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
                const hoursAgo = Math.round((Date.now() - new Date(s.timestamp)) / 3_600_000);
                if (hoursAgo < 168) {  // within a week
                    // Restore conversation turns into working context so MAX picks up mid-thread
                    if (Array.isArray(s.conversation) && s.conversation.length > 0) {
                        this._context = s.conversation.map(m => ({ role: m.role, content: m.content }));
                        console.log(`[MAX] 💬 Restored ${this._context.length} conversation turns from last session`);
                    }
                    this._sessionBriefing = { ...s, hoursAgo };
                    console.log(`[MAX] 📋 Last session ${hoursAgo}h ago — ${s.goals?.length || 0} goals in progress`);
                }
            } catch { /* fresh start */ }
        }

        // Project auto-detection — read package.json and/or README from cwd
        try {
            const cwd = process.cwd();
            const pkgPath  = path.join(cwd, 'package.json');
            const readmePath = [
                path.join(cwd, 'README.md'),
                path.join(cwd, 'readme.md'),
                path.join(cwd, 'README.txt')
            ].find(p => fs.existsSync(p));

            const parts = [];
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    parts.push(`Project: ${pkg.name || 'unknown'} v${pkg.version || '?'}`);
                    if (pkg.description) parts.push(`Description: ${pkg.description}`);
                    const deps = Object.keys(pkg.dependencies || {}).slice(0, 12).join(', ');
                    if (deps) parts.push(`Dependencies: ${deps}`);
                    const scripts = Object.keys(pkg.scripts || {}).join(', ');
                    if (scripts) parts.push(`Scripts: ${scripts}`);
                } catch { /* malformed package.json */ }
            }
            if (readmePath) {
                const readme = fs.readFileSync(readmePath, 'utf8').slice(0, 600).trim();
                if (readme) parts.push(`README:\n${readme}`);
            }
            if (parts.length > 0) {
                this._projectContext = parts.join('\n');
                console.log(`[MAX] 📁 Project detected: ${parts[0]}`);
            }
        } catch { /* non-fatal */ }

        this.reasoning = new ReasoningChamber(this.brain);
        this.evolution = new EvolutionArbiter({ swarm: this.swarm });
        await this.evolution.initialize();

        await this.world.initialize();

        // 🌍 Hook World Model into Outcome Tracker
        this.outcomes.on('outcome', (entry) => {
            const nextState = this.world.getCurrentState();
            this.world.recordTransition(entry.action, nextState, entry.reward, {
                latency: entry.duration,
                success: entry.success
            }).catch(() => {});
        });

        this.goals     = new GoalEngine(this.brain, this.outcomes, this.memory);
        this.goals.initialize();

        this.roadmap   = new RoadmapEngine(this);
        await this.roadmap.initialize();

        // ── Bootstrap goals — seed on first run or after goals are exhausted ──
        // Without this, AgentLoop waits for the probabilistic idle-cycle generation
        // which can take 10-30min to fire. Seeding gives MAX work from tick 1.
        if (this.goals.listActive().length === 0) {
            const bootstrapGoals = [
                {
                    title:       'Read tasks.md and identify next actionable item',
                    description: 'Read .max/tasks.md to find Barry\'s current priorities. For each unfinished task, check if it is specific enough to execute with tools. Queue the top actionable task as a new goal.',
                    type:        'task',
                    priority:    0.9,
                    source:      'auto'
                },
                {
                    title:       'Audit MAX codebase for TODO and FIXME comments',
                    description: 'Search core/, tools/, and memory/ directories for TODO/FIXME comments. Write a summary to .max/audit-todos.md listing file, line, and the comment text.',
                    type:        'improvement',
                    priority:    0.7,
                    source:      'auto'
                },
                {
                    title:       'Verify SOMA bridge and document available tools',
                    description: 'Check if SOMA is running at SOMA_URL by calling its /health endpoint. If online, list the available tools from /api/tools. Write findings to .max/soma-status.md.',
                    type:        'research',
                    priority:    0.65,
                    source:      'auto'
                }
            ];
            for (const goal of bootstrapGoals) this.goals.addGoal(goal);
            console.log(`[MAX] 🌱 Seeded ${bootstrapGoals.length} bootstrap goals`);
        }

        // Register goals as a tool so MAX can queue investigation plans from chat
        this.tools.register({
            name:        'goals',
            description: `Queue and manage autonomous investigation/task goals.
Actions:
  add         → queue a goal and start working on it: TOOL:goals:add:{"title":"Fix X","description":"...","type":"research|task|fix","priority":0.8,"verifyCommand":"node --check core/X.js"}
  list        → see active goals: TOOL:goals:list:{}
  status      → goal engine stats: TOOL:goals:status:{}
  inject_soma → inject a goal directly into SOMA's agentic loop: TOOL:goals:inject_soma:{"title":"Fix SOMA memory pressure","description":"...","priority":0.9}

USE THIS when the user asks you to investigate, figure out, or diagnose something that needs multi-step exploration rather than a direct answer.`,
            actions: {
                add: async ({ title, description = '', type = 'research', priority = 0.8, verifyCommand = null }) => {
                    const id = this.goals.addGoal({ title, description, type, priority, source: 'user', ...(verifyCommand ? { verifyCommand } : {}) });
                    // Trigger AgentLoop on next tick — non-blocking
                    setImmediate(() => this.agentLoop?.runCycle().catch(() => {}));
                    return { success: true, id, message: `Goal queued: "${title}" — starting investigation` };
                },
                list:   async () => ({ success: true, goals: this.goals.listActive().slice(0, 10).map(g => ({ id: g.id, title: g.title, status: g.status, priority: g.priority })) }),
                status: async () => ({ success: true, ...this.goals.getStatus() }),
                inject_soma: async ({ title, description = '', type = 'task', priority = 0.8 }) => {
                    if (!this.soma?.available) return { success: false, error: 'SOMA bridge not active' };
                    return this.soma.injectGoal({ title, description, type, priority });
                }
            }
        });

        // ── Scratchpad tool — per-task working memory ─────────────────────
        // MAX can jot down what he's tried, what failed, and what to do next.
        // Gets injected into re-thinks so he doesn't forget mid-task.
        const _scratchpad = new Map();
        this.tools.register({
            name:        'scratchpad',
            description: `Working memory for complex tasks — write notes about what you've tried and what you know.
Use this to avoid repeating failed approaches and to track progress across tool turns.
TOOL:scratchpad:write:{"key": "task-name", "content": "Tried X → failed because Y. Plan: try Z next."}
TOOL:scratchpad:read:{"key": "task-name"}
TOOL:scratchpad:clear:{"key": "task-name"}`,
            actions: {
                write: ({ key = 'default', content = '' }) => {
                    _scratchpad.set(key, content);
                    return { success: true, message: `Scratchpad "${key}" updated` };
                },
                read:  ({ key = 'default' }) => ({
                    success: true,
                    content: _scratchpad.get(key) || '(empty)',
                    key
                }),
                list:  () => ({
                    success: true,
                    keys: [..._scratchpad.keys()],
                    entries: Object.fromEntries(_scratchpad)
                }),
                clear: ({ key = 'default' }) => {
                    _scratchpad.delete(key);
                    return { success: true };
                }
            }
        });
        // Expose scratchpad on `this` so AgentLoop can inject active entries into context
        this._scratchpad = _scratchpad;

        // Register swarm as a tool — prevents MAX from hallucinating "node swarm.mjs"
        // The swarm is built-in: break a task into parallel subtasks and synthesize results.
        this.tools.register({
            name:        'swarm',
            description: `Run a task using MAX's built-in parallel swarm (decompose → parallel workers → synthesize).
IMPORTANT: The swarm is IN-PROCESS. Do NOT spawn "node swarm.mjs" or any shell process — that file does not exist.
Just call: TOOL:swarm:run:{"task": "Refactor the authentication module to use JWT"}`,
            actions: {
                run: async ({ task, workers }) => {
                    if (!task) return { success: false, error: 'task is required' };
                    try {
                        const result = await this.swarmThink(task, { workers });
                        return { success: true, synthesis: result.synthesis, subtasks: result.subtasks?.length };
                    } catch (err) {
                        return { success: false, error: err.message };
                    }
                }
            }
        });

        this.agentLoop = new AgentLoop(this, this.config.agentLoop);

        // Route AgentLoop events through the heartbeat so the launcher's one listener handles everything
        this.agentLoop.on('insight',        (i) => this.heartbeat.emit('insight', i));
        this.agentLoop.on('approvalNeeded', (a) => this.heartbeat.emit('approvalNeeded', a));

        // ToolCreator — MAX writes new tools at runtime
        console.log('[MAX] 🔧 Loading ToolCreator...');
        this.toolCreator = new ToolCreator(this.brain, this.tools);
        this.tools.register(this.toolCreator.asTool());
        await this.toolCreator.reloadSaved();  // reload any tools generated in past sessions

        // SelfCodeInspector — MAX inspects his own source and queues improvements
        this.selfInspector = new SelfCodeInspector(this.goals);

        this.reflection = new ReflectionEngine(this.brain, this.goals, this.outcomes, this.kb);

        // FrontierResearch — daily AI research loop → capability gap analysis → engineering tasks
        this.frontier = new FrontierResearch(this.brain, this.tools, this.goals, this.kb);

        this._ready = true;

        const status = this.brain.getStatus();
        console.log(`\n[MAX] ✅ Online — ${status.smart.backend} / ${status.smart.model}`);
        console.log(`[MAX] 🧠 Persona: ${this.persona.getStatus().name}`);
        console.log(`[MAX] 🛠️  Tools: ${this.tools.list().map(t => t.name).join(', ')}`);

        // Start background autonomous systems — non-blocking
        console.log('[MAX] 💓 Starting background Heartbeat and Scheduler...');
        this.scheduler.initialize();
        this.scheduler.start();
        this.heartbeat.start();

        // Wire Notifier — forward high-signal insights to Discord
        this.heartbeat.on('insight', insight => {
            this.notifier.onInsight(insight).catch(() => {});
        });

        // Morning briefing at 8am daily (only if notifier is enabled)
        if (this.notifier.enabled) {
            this.scheduler.addJob({
                id:      'morning_briefing',
                label:   'Morning briefing → Discord',
                every:   '24h',
                type:    'custom',
                handler: () => this.notifier.briefing(this)
            });
        }

        // Recurring diagnostics — catch issues introduced mid-session
        this.scheduler.addJob({
            id:      'diagnostics_hourly',
            label:   'Hourly system diagnostics scan',
            every:   '1h',
            type:    'custom',
            handler: () => this.diagnostics.runAll()
        });

        // Task outcome reflection — every 4h, analyze what worked and what didn't
        this.scheduler.addJob({
            id:      'reflect_task_outcomes',
            label:   'Reflect on recent task outcomes',
            every:   '4h',
            type:    'custom',
            handler: () => this.reflection?.reflectOnTaskOutcomes?.().catch(() => {})
        });

        // Dream consolidation — every 12h, distill lessons from outcomes into KB
        this.scheduler.addJob({
            id:      'dream_consolidation',
            label:   'Dream: consolidate lessons into knowledge base',
            every:   '12h',
            type:    'custom',
            handler: () => this.reflection?.dream(this.kb).catch(() => {})
        });

        // Frontier research — daily AI research cycle → gap analysis → engineering tasks
        this.scheduler.addJob({
            id:      'frontier_research',
            label:   'Frontier: crawl AI research, update capability map, generate tasks',
            every:   '24h',
            type:    'custom',
            handler: () => this.frontier?.runCycle().catch(err =>
                console.warn('[MAX] Frontier research cycle failed:', err.message)
            )
        });

        // Roadmap sync — daily parsing of plan.md/frontier_map.md
        this.scheduler.addJob({
            id:      'sync_roadmap',
            label:   'Roadmap: parse plans and inject strategic goals',
            every:   '24h',
            type:    'custom',
            handler: () => this.roadmap?.sync().catch(err =>
                console.warn('[MAX] Roadmap sync failed:', err.message)
            )
        });

        // ─── Truly non-blocking background tasks ───
        (async () => {
            console.log('[MAX] 🧵 Launching background worker thread...');
            // Wait a few seconds for main chat to be ready
            await new Promise(r => setTimeout(r, 2000));

            // Lab initialization
            await this.lab.initialize().catch(() => {});
            
            // Code indexing
            console.log('[MAX] 👁️  Starting background God\'s Eye indexing...');
            this.indexer.startIndexing().catch(() => {});

            // Sentinel — real-time file watcher
            console.log('[MAX] 🛡️  Starting background Sentinel daemon...');
            this.sentinel.start();
            this.sentinel.on('change', (change) => {
                this.heartbeat.emit('insight', {
                    source: 'sentinel',
                    label:  `👁️  Observed: ${change.file}`,
                    result: `Detected ${change.type}. Memory index updated.`
                });
            });
            this.sentinel.on('significantChange', (change) => {
                if (change.file === 'plan.md' || change.file === 'frontier_map.md') {
                    console.log(`[MAX] 🛡️  Roadmap update detected — syncing...`);
                    this.roadmap?.sync().catch(() => {});
                } else if (change.type === 'created' || change.type === 'modified') {
                    // Proactive Goal Injection
                    this.goals?.addGoal({
                        title:       `Audit and document: ${change.file}`,
                        description: `Sentinel detected a significant ${change.type} in ${change.file}. Audit the change for logic errors and update documentation if necessary.`,
                        type:        'improvement',
                        priority:    0.6,
                        source:      'sentinel'
                    });
                }
            });
            this.sentinel.on('insight', (i) => this.heartbeat.emit('insight', i));

            // First inspection
            console.log('[MAX] 🔍 Running initial self-inspection...');
            await this.selfInspector.inspect().catch(() => {});
            const queued = this.selfInspector.queueGoals(2);
            if (queued.length > 0) {
                console.log(`[MAX] 🔍 Self-inspection queued ${queued.length} improvement goal(s)`);
            }

            // Diagnostics audit — feeding the Goal Economy (Section 2)
            await new Promise(r => setTimeout(r, 5000));
            await this.diagnostics.runAll().catch(() => {});

            // ── Eager AgentLoop — don't wait for the first heartbeat tick ──────
            // Heartbeat interval is tension-based: 30s (100%) to 5min (0%).
            // On boot, tension = 0 → 5min wait before AgentLoop ever runs.
            // We have goals now (bootstrap + self-inspection), so fire immediately.
            if (this.goals?.getNext(this.drive) != null && this.agentLoop && !this._chatBusy) {
                console.log('[MAX] ⚡ Eager start — running first AgentLoop cycle now');
                this.agentLoop.runCycle().catch(err =>
                    console.error('[MAX] Eager AgentLoop error:', err.message)
                );
            }
        })().catch(err => console.error('[MAX] Background startup error:', err.message));

        console.log('[MAX] Ready.\n');
    }

    // ─── Main think/respond loop ──────────────────────────────────────────
    async think(userMessage, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');
        this._chatBusy = true;

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

        // Build system prompt — cache it and only rebuild when persona or drive state changes.
        // The tools manifest, profile, and self-model are expensive to build every turn.
        const driveStatus  = this.drive.getStatus();
        const promptCacheKey = `${selectedPersona.id}|${Math.round(driveStatus.tension * 10)}|${this._context.length}`;
        if (this._promptCache.key !== promptCacheKey) {
            this._promptCache.prompt = this.persona.buildSystemPrompt(selectedPersona)
                + this._buildStateContext()
                + this.profile.buildContextBlock()
                + this.memory.getContextString()
                + (this.reflection?.getSelfModelContext() || '')
                + this.tools.buildManifest();
            this._promptCache.key = promptCacheKey;
        }
        const systemPrompt = this._promptCache.prompt;

        // Pull episodic memories + KB chunks — skip KB for short conversational messages
        // (greetings, acks, one-word replies) since they don't benefit from semantic search
        const isConversational = userMessage.trim().length < 40 && !/\b(file|code|why|how|what|where|soma|goal|error|fix)\b/i.test(userMessage);
        const [relevantMemories, kbChunks] = await Promise.all([
            this.memory.recall(userMessage, { topK: 4 }),
            isConversational ? Promise.resolve([]) : this.kb.query(userMessage, { topK: 5, brain: this.brain })
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
            .map(m => {
                // If content is huge, it's already been pointer-ized by _processToolCalls
                return `${m.role === 'user' ? 'USER' : 'MAX'}: ${m.content}`;
            })
            .join('\n\n');

        // Confidence calibration — heuristic check, no LLM call, zero latency
        const conf = this._checkConfidence(userMessage);
        const finalSystemPrompt = conf.uncertain
            ? systemPrompt + `\n\n## Confidence: LOW on this query (${conf.reason})\nBe explicit about uncertainty. Use "I believe", "I'm not certain", "you should verify this". Never state uncertain facts confidently.`
            : systemPrompt;

        // Coding requests → DeepSeek (better at code than qwen3:8b)
        const isCodingTask = /\b(write|create|build|implement|code|function|class|script|fix|debug|refactor|edit|update|add|remove|rename)\b/i.test(userMessage)
            && /\b(file|code|function|class|method|module|component|api|route|test|script|bug|error|import|export|variable|const|let|async|await)\b/i.test(userMessage);
        const brainTier = options.tier ?? (isCodingTask ? 'code' : 'smart');

        // Think — cap tokens based on whether this looks like a code/analysis task.
        // Conversational turns don't need 8K token responses; capping reduces timeout risk.
        // Code-tier tasks get 8K: PLAN + multiple TOOL calls + reasoning can easily fill 4K.
        const needsLongReply = /\b(explain|analyse|analyze|investigate|compare|summarize|list all|implement|write|refactor|how does|why does)\b/i.test(userMessage)
            || userMessage.length > 120;
        const maxTok = options.maxTokens ?? (isCodingTask ? 8192 : needsLongReply ? 4096 : 1024);

        // SOMA bridge — use QuadBrain if SOMA is available (priority-0)
        // onToken streaming: only for local brain path — SOMA bridge doesn't support it
        const onToken = options.onToken ?? null;
        let wasStreamed = false;

        let result;
        if (this.soma?.available) {
            try {
                result = await this.soma.think(historyText, {
                    systemPrompt: finalSystemPrompt + memoryContext + kbContext,
                    temperature:  options.temperature ?? 0.7,
                    maxTokens:    maxTok,
                    timeout:      30_000
                });
            } catch {
                // SOMA failed — fall through to local brain
                result = null;
            }
        }
        if (!result) {
            // ── TOOL: lookahead filter ────────────────────────────────────────
            // Buffer tokens until we have enough to detect 'TOOL:'. Once seen,
            // stop forwarding to the caller — raw tool syntax must never reach the
            // terminal. Any buffered text before the sentinel is flushed first.
            const TOOL_SENTINEL = 'TOOL:';
            let lookaheadBuf = '';
            let toolSeen     = false;

            const filteredToken = onToken ? (token) => {
                if (toolSeen) return;
                lookaheadBuf += token;
                // Keep buffering until we have enough chars to detect the sentinel
                while (lookaheadBuf.length >= TOOL_SENTINEL.length) {
                    const idx = lookaheadBuf.indexOf(TOOL_SENTINEL);
                    if (idx === 0) {
                        // Sentinel at start — stop streaming immediately
                        toolSeen = true; lookaheadBuf = ''; return;
                    }
                    if (idx > 0) {
                        // Flush safe chars before sentinel, then stop
                        onToken(lookaheadBuf.slice(0, idx));
                        toolSeen = true; lookaheadBuf = ''; return;
                    }
                    // No sentinel found — flush all but the last (sentinel.length-1) chars
                    const safe = lookaheadBuf.length - (TOOL_SENTINEL.length - 1);
                    if (safe > 0) {
                        onToken(lookaheadBuf.slice(0, safe));
                        lookaheadBuf = lookaheadBuf.slice(safe);
                    }
                    break;
                }
            } : null;

            result = await this.brain.think(historyText, {
                systemPrompt: finalSystemPrompt + memoryContext + kbContext,
                temperature:  options.temperature ?? 0.7,
                maxTokens:    maxTok,
                tier:         brainTier,
                onToken:      filteredToken
            });

            // Flush any remaining lookahead that didn't accumulate enough chars for detection
            if (!toolSeen && lookaheadBuf && onToken) onToken(lookaheadBuf);

            // wasStreamed=true means the streamed output IS the clean final response
            // wasStreamed=false means tool calls were present — caller must print clean reply
            wasStreamed = !!(onToken && !toolSeen && !result.text.includes('TOOL:'));
        }

        let response = result.text;

        // ── Agentic loop: if response contains tool calls, execute and re-think ──
        let toolTurns = 0;
        const maxToolTurns = 6;  // enough for real multi-step work, not enough to spiral
        const turnResults  = [];
        const seenToolCalls   = new Set();  // dedup: never execute the exact same call twice
        let consecutiveFailures = 0;        // #5: track repeated failures for diagnosis forcing

        while (response.includes('TOOL:') && toolTurns < maxToolTurns) {
            // Extract all TOOL: lines in this response
            const toolLines = response.split('\n').filter(l => l.trim().startsWith('TOOL:'));

            // Loop detection:
            // - If ALL tool calls are repeated → definitely looping, break
            // - If any WRITE/DESTRUCTIVE call is repeated → break (never re-run side effects)
            const DESTRUCTIVE = /^TOOL:shell:(start|run|stop):|^TOOL:file:(write|replace|delete):/;
            const allSeen     = toolLines.every(l => seenToolCalls.has(l.trim()));
            const anyDestructiveRepeat = toolLines.some(l => DESTRUCTIVE.test(l.trim()) && seenToolCalls.has(l.trim()));
            if ((allSeen || anyDestructiveRepeat) && toolLines.length > 0) {
                console.warn('[MAX] Tool loop detected — breaking (allSeen=%s, destructiveRepeat=%s)', allSeen, anyDestructiveRepeat);
                break;
            }
            toolLines.forEach(l => seenToolCalls.add(l.trim()));

            toolTurns++;
            const processed = await this._processToolCalls(response);
            turnResults.push(processed);

            // ── #2: Failure detection — build a diagnostic hint for the re-think ──
            const hasFailed = /\[pre-flight ✗\]|\[replace ✗|\[write ✗|"success"\s*:\s*false|error.*failed|MODULE_NOT_FOUND|ENOENT|EACCES/i.test(processed);
            if (hasFailed) consecutiveFailures++;
            else consecutiveFailures = 0;

            // ── #5: Diagnosis forcing — after 2 consecutive failures, hard-redirect ──
            const diagnosisHint = consecutiveFailures >= 2
                ? `\n\n## ⚠️ STOP — You have failed ${consecutiveFailures} times in a row\n` +
                  `DO NOT retry the same action again.\n` +
                  `First: read the error message above carefully.\n` +
                  `Then: use file:list or file:grep to understand the actual state of the codebase.\n` +
                  `Then: form a NEW plan based on what you actually find — not what you assumed.`
                : hasFailed
                ? `\n\n## ⚠️ The last action failed\nBefore retrying, diagnose WHY it failed. Read the error carefully. Do not repeat the same call.`
                : ``;

            // Add this intermediate turn to context so the next "think" sees the results
            this._context.push({ role: 'assistant', content: processed });

            // Re-build history — cap each turn's content so one huge tool result
            // can't blow out the context on the next re-think
            const updatedHistory = this._context
                .slice(-this._contextLimit)
                .map(m => {
                    const label   = m.role === 'user' ? 'USER' : 'MAX';
                    const content = m.content.length > 4_000
                        ? m.content.slice(0, 4_000) + ' [...]'
                        : m.content;
                    return `${label}: ${content}`;
                })
                .join('\n\n');

            // ── #4: Inject active scratchpad entries into re-think ────────
            let scratchpadContext = '';
            if (this._scratchpad?.size > 0) {
                const entries = [...this._scratchpad.entries()]
                    .map(([k, v]) => `[${k}]\n${v}`)
                    .join('\n\n');
                scratchpadContext = `\n\n## Your working notes (scratchpad)\n${entries}`;
            }

            // Think again with the results + any failure/diagnosis hints
            const continuationHint = '\n\n## Tool results are now in context above\nContinue the task. Call more tools if needed, or write your final response if done.';
            result = await this.brain.think(updatedHistory, {
                systemPrompt: systemPrompt + memoryContext + kbContext + scratchpadContext + continuationHint + diagnosisHint,
                temperature: hasFailed ? 0.3 : 0.4,  // lower temp when diagnosing
                maxTokens:   8192
            });
            response = result.text;
        }

        // Strip tool plumbing — [Tool result: ...] and bare TOOL: lines are internal.
        let finalResponse = response
            .replace(/^\[Tool result:.*?\]\n?/gm, '')
            .replace(/^TOOL:[^\n]*\n?/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // If stripping left nothing (tool loop broke before a clean reply), re-think once
        // with the accumulated context so MAX always gives a natural language response.
        if (!finalResponse) {
            try {
                const recoveryHistory = this._context
                    .slice(-this._contextLimit)
                    .map(m => `${m.role === 'user' ? 'USER' : 'MAX'}: ${m.content.slice(0, 2000)}`)
                    .join('\n\n');
                const recovery = await this.brain.think(recoveryHistory, {
                    systemPrompt: systemPrompt + '\n\nIf you were in the middle of a task, CONTINUE IT NOW — do not describe what you were doing, just do the next step. If the task is complete, say so briefly.',
                    temperature:  0.5,
                    maxTokens:    512
                });
                finalResponse = recovery.text
                    .replace(/^\[Tool result:.*?\]\n?/gm, '')
                    .replace(/^TOOL:[^\n]*\n?/gm, '')
                    .trim() || 'On it.';
            } catch {
                finalResponse = 'On it.';
            }
        }

        // Update context and memory (MaxMemory also extracts workspace signals)
        this._context.push({ role: 'assistant', content: response }); // full text (including tool traces) goes to context so brain has full picture
        this.memory.addConversation('user',      userMessage,       selectedPersona.id);
        this.memory.addConversation('assistant', finalResponse, selectedPersona.id);

        // Rolling context compression — when history gets long, compress old turns into a
        // summary turn so the context window never silently loses information by hard truncation.
        this._maybeCompressContext();

        // Pre-compaction flush — extract key facts to permanent memory before truncation
        if (this._context.length >= this._contextLimit * 1.6) {
            this._flushMemories().catch(() => {});
        }

        // After responding, queue a follow-up curiosity task from this topic
        this._queueFollowUpCuriosity(userMessage);

        // Fire-and-forget reflection — scores this turn, runs deep analysis every N turns
        this.reflection?.reflectOnTurn(userMessage, finalResponse, {
            persona: selectedPersona.id,
            drive:   this.drive.getStatus()
        }).catch(() => {});

        // Drive reward
        this.drive.onTaskExecuted();

        // Record high-level outcome with telemetry
        this.outcomes?.record({
            agent:    'MAX',
            action:   'chat_turn',
            context:  { persona: selectedPersona.id, historyLength: this._context.length },
            result:   'completed_turn',
            success:  true,
            tokens:   result.metadata?.tokens || 0,
            duration: result.metadata?.latency || 0,
            metadata: result.metadata
        });

        this._chatBusy = false;

        return {
            response:    finalResponse,
            persona:     selectedPersona.id,
            drive:       this.drive.getStatus(),
            telemetry:   result.metadata,
            wasStreamed  // true = caller already received tokens via onToken, skip re-printing
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

    // ─── Direct communication ────────────────────────────────────────────
    say(text, details = null) {
        this.heartbeat.emit('message', { text, details });
    }

    // ─── Direct reasoning (Causal, Simulation, Security, etc.) ────────────
    async reason(query, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');
        return this.reasoning.reason(query, {
            world: this.world,
            userContext: this.profile.buildContextBlock()
        });
    }

    // ─── Process tool calls embedded in LLM output ────────────────────────
    async _processToolCalls(text) {
        if (!text.includes('TOOL:')) return text;

        // ── Print PLAN: block before tools run ──────────────────────────
        const planMatch = text.match(/^PLAN:\s*\n((?:\s*\d+\..+\n?)+)/m);
        if (planMatch) {
            process.stdout.write('\n  \x1b[36m📋 PLAN\x1b[0m\n');
            const planLines = planMatch[1].trim().split('\n');
            for (const pl of planLines) {
                process.stdout.write(`  \x1b[90m│\x1b[0m  ${pl.trim()}\n`);
            }
            process.stdout.write('\n');
        }

        // ── Multi-line-aware TOOL: extraction ───────────────────────────
        // Split line-by-line but accumulate continuation lines when JSON
        // params span multiple lines (brace depth > 0 after first line).
        // This handles file:write with large content that DeepSeek may
        // emit across multiple lines rather than as a single escaped string.
        const segments = [];  // { type: 'text'|'tool', content: string }
        const lines = text.split('\n');
        let i = 0;

        while (i < lines.length) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('TOOL:')) {
                // Accumulate until we have balanced braces (complete JSON)
                let accumulated = trimmed;
                let depth = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;

                // If params don't start with { it's likely a single-line non-JSON arg
                // (handled by executeLLMToolCall's fallback) — don't accumulate
                const hasJsonParams = /TOOL:[^:]+:[^:]+:\s*\{/.test(trimmed);

                while (hasJsonParams && depth > 0 && i + 1 < lines.length) {
                    i++;
                    accumulated += '\n' + lines[i];
                    depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
                }

                segments.push({ type: 'tool', content: accumulated });
            } else {
                segments.push({ type: 'text', content: lines[i] });
            }
            i++;
        }

        // ── Parallel execution for independent reads ─────────────────────
        // If ALL tool calls in this response are read-only, run them with
        // Promise.all for free parallelism (e.g. MAX reading 5 files before
        // deciding what to change). Writes execute sequentially — always.
        const READ_ONLY = new Set(['file:read', 'file:list', 'file:search', 'file:grep',
                                   'web:search', 'git:status', 'git:log', 'git:diff', 'git:branch']);
        const isReadOnly = (raw) => {
            const m = raw.match(/^TOOL:([^:]+):([^:]+):/);
            return m && READ_ONLY.has(`${m[1]}:${m[2]}`);
        };

        const toolSegs    = segments.filter(s => s.type === 'tool');
        const allReadOnly = toolSegs.length > 1 && toolSegs.every(s => isReadOnly(s.content));

        // ── Execute one tool segment, return formatted result string ──────
        const execSeg = async (seg) => {
            const trimmed = seg.content.trim();

            // ── Pre-flight: verify node scripts exist before running ────────
            // "node foo.mjs" on a missing file → immediately return an actionable error
            // instead of letting node throw MODULE_NOT_FOUND and triggering a retry spiral.
            const shellMatch = trimmed.match(/^TOOL:shell:(run|start):\{(.+)\}$/s);
            if (shellMatch) {
                try {
                    const sp = JSON.parse(`{${shellMatch[2]}}`);
                    const cmd = (sp.command || '').trim();
                    const nodeScript = cmd.match(/^node\s+["']?([^\s"']+\.(mjs|js|cjs))["']?/i);
                    if (nodeScript) {
                        const { default: fs } = await import('fs');
                        const scriptPath = nodeScript[1];
                        const fullPath = path.isAbsolute(scriptPath)
                            ? scriptPath
                            : path.join(process.cwd(), scriptPath);
                        if (!fs.existsSync(fullPath)) {
                            return `[pre-flight ✗] Cannot run "node ${scriptPath}" — the file does not exist at ${fullPath}. Use TOOL:file:list to see what files are available. Do NOT create a new file just to run it — check if there is an existing in-process API or tool instead.`;
                        }
                    }
                } catch { /* non-fatal — fall through to normal execution */ }
            }

            // Print notification for file mutations
            const fileWriteMatch = trimmed.match(/^TOOL:file:(write|replace):(\{[\s\S]+)/);
            if (fileWriteMatch) {
                try {
                    const params = JSON.parse(fileWriteMatch[2].trim());
                    const op     = fileWriteMatch[1];
                    const fp     = params.filePath || params.path || '?';
                    const label  = op === 'write' ? '✏️  write' : '✏️  replace';
                    process.stdout.write(`  \x1b[33m${label}\x1b[0m  \x1b[1m${fp}\x1b[0m\n`);
                } catch { /* non-fatal */ }
            }

            const toolResult = await this.tools.executeLLMToolCall(trimmed);
            if (!toolResult) return seg.content;

            let resultStr = typeof toolResult === 'string'
                ? toolResult
                : JSON.stringify(toolResult);

            // Context budget guard — cap at 8KB; artifact-ize larger results
            const CONTEXT_CAP  = 8_000;
            const isArtifactOp = trimmed.startsWith('TOOL:artifacts:');

            if (resultStr.length > CONTEXT_CAP) {
                if (isArtifactOp) {
                    resultStr = resultStr.slice(0, CONTEXT_CAP)
                        + `\n\n[...TRUNCATED — ${Math.round(resultStr.length / 1000)}KB total. `
                        + `Ask specific questions about sections rather than reading everything at once.]`;
                } else {
                    const name    = trimmed.split(':').slice(1, 3).join('.') || 'tool_output';
                    const pointer = this.artifacts.store(name, resultStr, 'tool_result');
                    resultStr = pointer;
                }
            }

            // ── Format result for readability ──────────────────────────────
            // Raw JSON is hard for the model to parse. Format by tool type:
            // - file:read   → show content directly with a header
            // - shell:run   → show stdout/stderr directly
            // - everything  → clean JSON fallback
            try {
                const parsed = typeof toolResult === 'object' ? toolResult : JSON.parse(resultStr);
                const toolMatch = trimmed.match(/^TOOL:([^:]+):([^:]+):/);
                const tName = toolMatch?.[1], tAction = toolMatch?.[2];

                if (tName === 'file' && tAction === 'read' && parsed.success && parsed.content != null) {
                    const lineInfo = parsed.startLine != null ? ` (lines ${parsed.startLine}–${parsed.endLine})` : ` (${parsed.totalLines} lines)`;
                    resultStr = `[file:read → ${parsed.path || ''}${lineInfo}]\n${parsed.content}\n[end file:read]`;
                } else if (tName === 'shell' && tAction === 'run' && parsed.stdout != null) {
                    const out = (parsed.stdout || '').trim();
                    const err = (parsed.stderr || '').trim();
                    resultStr = `[shell exit ${parsed.exitCode ?? 0}]${out ? '\n' + out : ''}${err ? '\n[stderr]\n' + err : ''}`;
                } else if (tName === 'file' && (tAction === 'write' || tAction === 'replace')) {
                    resultStr = parsed.success
                        ? `[${tAction} ✓ ${parsed.path || ''}]`
                        : `[${tAction} ✗ ${parsed.error || 'failed'}${parsed.hint ? ' — hint: ' + parsed.hint : ''}]`;
                } else if (tName === 'file' && tAction === 'grep' && Array.isArray(parsed.matches)) {
                    resultStr = parsed.matches.length === 0
                        ? '[grep: no matches]'
                        : `[grep: ${parsed.matches.length} match(es)]\n` + parsed.matches.map(m => `${m.file}:${m.line}: ${m.text}`).join('\n');
                }
            } catch { /* keep resultStr as-is on parse failure */ }

            return `[Tool result: ${resultStr}]`;
        };

        // ── Build result array ─────────────────────────────────────────────
        const result = [];

        if (allReadOnly) {
            // Kick all reads off in parallel, maintain original ordering in results
            const toolResults = await Promise.all(toolSegs.map(execSeg));
            let toolIdx = 0;
            for (const seg of segments) {
                result.push(seg.type === 'tool' ? toolResults[toolIdx++] : seg.content);
            }
        } else {
            // Sequential — writes and mixed batches
            for (const seg of segments) {
                result.push(seg.type === 'tool' ? await execSeg(seg) : seg.content);
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

        // Project context
        if (this._projectContext) {
            state += `\n\n## Current project\n${this._projectContext}`;
        }

        // Running background processes
        const procs = getRunningProcesses();
        if (procs.length > 0) {
            state += `\n\n## Background processes running\n`;
            for (const p of procs) {
                state += `  [${p.name}] pid ${p.pid}  ${p.command}\n`;
            }
            state += `Use TOOL:shell:stop:{"name":"<name>"} to kill, TOOL:shell:ps:{} to check status.`;
        }

        if (this._sessionBriefing) {
            const { hoursAgo, goals: sg, insights: si, conversation: sc } = this._sessionBriefing;
            state += `\n\n## Previous session (${hoursAgo}h ago)`;
            if (sg?.length > 0) {
                state += `\nIn-progress goals: ${sg.map(g => `"${g.title}"`).join(', ')}`;
            }
            if (si?.[0]) {
                state += `\nLast insight: ${si[0].result?.slice(0, 150)}`;
            }
            // Show the last few exchanges so MAX knows exactly what was being discussed
            if (sc?.length > 0) {
                state += `\n\nLast conversation:\n`;
                state += sc.slice(-4).map(m =>
                    `${m.role === 'user' ? 'Barry' : 'MAX'}: ${m.content.slice(0, 200)}`
                ).join('\n');
            }
            state += `\n\nYou are continuing this conversation. Acknowledge you remember where you left off — don't restart cold.`;
        }

        state += `\n\n## Agentic behavior

INVESTIGATION requests ("why isn't X working", "figure out Y", "what's going on with Z"):
→ Use TOOL:goals:add to queue a goal. The AgentLoop will investigate and report back.
Example: TOOL:goals:add:{"title":"Investigate SOMA agentic gaps","description":"Read SOMA codebase, identify gaps","type":"research","priority":0.9}

EXECUTION requests ("move this code", "edit this file", "fix X in file Y", "make this change"):
→ DO IT NOW with tools. Do not narrate each micro-step and wait for approval.
→ Read the file, make the change, verify it, then report COMPLETION in one response.
→ Never say "let me read X" and stop — if you need to read X, read it in the SAME response and keep going.
→ Only check back with the user when the task is DONE or you are genuinely blocked.
→ Always end with a clear completion signal: "Done. [what changed]. What do you want to do next?"
Example: "Done. Moved SomaAgenticExecutor init to line 233 in extended.js. It's now in PHASE A before the heap fills. What do you want to do next?"

SHELL requests ("run the tests", "start the server", "install X", "build it", "what's in this dir"):
→ Use TOOL:shell:run for commands that finish (tests, installs, builds, scripts)
→ Use TOOL:shell:start for long-running processes (servers, watchers, dev processes) — these run in the background and print output live
→ Use TOOL:shell:stop to kill a named background process
→ Use TOOL:shell:ps to see what's running
→ Commands print live to the terminal — the user sees output as it runs
→ You can run git, npm, python, node, any installed tool directly
→ IMPORTANT: This is Windows. Use PowerShell/cmd syntax ONLY. Never use Unix commands.
  ✗ WRONG: ls, find, grep, xargs, head, tail, cat, which, rm, cp, mv
  ✓ CORRECT: dir, Get-ChildItem, Select-String, Where-Object, Get-Content, node, npm, git, powershell -Command "..."
  ✓ Check if program exists: where git   (NOT which git)
  ✓ List files: TOOL:shell:run:{"command":"dir /B"}
  ✓ Find text:  TOOL:shell:run:{"command":"powershell -Command \"Get-ChildItem -Recurse | Select-String 'pattern'\""}
  ✓ Read file:  Use TOOL:file:read instead of shell for reading files

PLANNING (complex multi-step actions):
→ For ANY action involving 3+ steps, multiple files, or significant changes:
  1. First output a PLAN: block listing the steps (concise, numbered)
  2. Then execute the steps with tools
→ Format:
  PLAN:
  1. Read X to understand current structure
  2. Edit Y to add the new field
  3. Run tests to verify
→ The plan is shown to the user BEFORE tools run so they can interrupt if needed
→ Simple one-step actions (read one file, run one command) do NOT need a plan

GROUNDING — NEVER FABRICATE:
→ If a tool fails or returns an error, report the exact error. Do NOT invent what the output "should" look like.
→ If you cannot read a file, say "I couldn't read X". Never generate fake file contents.
→ If a command fails, say "command failed with: <error>". Never generate fake command output.
→ When uncertain about the state of the system, use a tool to check — do not guess.
→ "SOMA 1T", "SOMA has X running", etc. — never claim SOMA/system state without tool verification.`;


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
            const result = await this.brain.think(
                `From this conversation excerpt, extract 3-5 specific facts worth remembering long-term.
Focus on: decisions made, things learned, user preferences revealed, problems solved.
Return ONLY a JSON array of strings: ["fact1", "fact2", ...]

CONVERSATION:
${recent}`,
                { temperature: 0.2, maxTokens: 400, tier: 'fast' }
            );

            const facts = result.text;
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

    // ─── Confidence calibration ───────────────────────────────────────────
    // Fast heuristic + optional LLM check. Returns { uncertain, reason }.
    // Never throws — worst case returns { uncertain: false } so responses aren't blocked.
    _checkConfidence(query) {
        if (query.length < 20) return { uncertain: false };

        // Heuristic-only — no LLM call. Patterns that signal genuinely time-sensitive
        // or factual queries where MAX's training data may be stale or wrong.
        // Deliberately narrow so casual chat ("now", "current task") doesn't trigger.
        const uncertainPatterns = [
            /\b(what is the (current|latest|live) (price|rate|value|score|standing))\b/i,
            /\b(stock price|crypto price|btc price|eth price)\b/i,
            /\b(today'?s? (weather|news|score|game))\b/i,
            /\b(what happened (today|yesterday|this week))\b/i,
            /\b(who (won|is winning|leads|is ahead))\b/i,
            /\bbreaking news\b/i,
        ];

        const matched = uncertainPatterns.find(p => p.test(query));
        if (!matched) return { uncertain: false };

        return { uncertain: true, reason: 'real-time factual query — data may be stale' };
    }

    // ─── Rolling context compression ──────────────────────────────────────
    // Fire-and-forget: compresses oldest turns into a summary when context grows.
    // Keeps MAX's working memory fresh without silently dropping old context.
    _maybeCompressContext() {
        if (this._context.length <= this._contextLimit || this._compressing) return;
        this._compressing = true;
        this._compressContext()
            .catch(() => {})
            .finally(() => { this._compressing = false; });
    }

    async _compressContext() {
        if (!this.brain._ready) return;

        const keepRecent = Math.ceil(this._contextLimit * 0.6);  // keep newest 60%
        const toCompress = this._context.slice(0, -keepRecent);
        const toKeep     = this._context.slice(-keepRecent);

        if (toCompress.length < 4) return;  // not worth it

        const excerpt = toCompress
            .map(m => `${m.role === 'user' ? 'USER' : 'MAX'}: ${m.content.slice(0, 400)}`)
            .join('\n\n')
            .slice(0, 4000);

        const result = await this.brain.think(
            `Compress this conversation history into 2-3 sentences capturing all key decisions, facts, and context:\n\n${excerpt}`,
            { temperature: 0.1, maxTokens: 200, tier: 'fast' }
        );

        this._context = [
            { role: 'user', content: `[Conversation history (compressed): ${result.text}]` },
            ...toKeep
        ];
        console.log(`[MAX] 🗜️  Compressed ${toCompress.length} old context turns → summary`);
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
            kb:            this.kb?.getStatus(),
            roadmap:       this.roadmap?.getStatus(),
            skills:        this.skills?.getStatus(),
            soma:          this.soma?.getStatus(),
            notifier:      this.notifier?.getStatus()
        };
    }
}

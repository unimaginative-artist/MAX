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
import { CognitiveFilter }    from './CognitiveFilter.js';
import { GoalEngine }         from './GoalEngine.js';
import { AgentLoop }          from './AgentLoop.js';
import { VectorDaemon }       from './VectorDaemon.js';
import { RoadmapEngine }      from './RoadmapEngine.js';
import { ToolCreator }        from './ToolCreator.js';
import { EvolutionArbiter }   from './EvolutionArbiter.js';
import { SelfCodeInspector }  from './SelfCodeInspector.js';
import { ReflectionEngine }   from './ReflectionEngine.js';
import { PoseidonResearch }    from './PoseidonResearch.js';
import { DeepUserModel }      from './DeepUserModel.js';
import { LongitudinalSelf }   from './LongitudinalSelf.js';
import { DatasetCurator }     from './DatasetCurator.js';
import { PersonaEngine }      from '../personas/PersonaEngine.js';
import { MuseEngine }         from './MuseEngine.js';
import { ToolRegistry }       from '../tools/ToolRegistry.js';
import { FileTools }          from '../tools/FileTools.js';
import { ShellTool, getRunningProcesses } from '../tools/ShellTool.js';
import { WebTool }            from '../tools/WebTool.js';
import { GitTool }            from '../tools/GitTool.js';
import { ApiTool }            from '../tools/ApiTool.js';
import { CodeRunnerTool }     from '../tools/CodeRunnerTool.js';
import { createVisionTool }   from '../tools/VisionTool.js';
import { createSelfEvolutionTool } from '../tools/SelfEvolutionTool.js';
import { createSystemTool }    from '../tools/SystemTool.js';
import { DiscordTool, autoConnectDiscord } from '../tools/DiscordTool.js';
import { EmailTool,   autoConnectEmail   } from '../tools/EmailTool.js';
import { KnowledgeTool }      from '../tools/KnowledgeTool.js';
import { AppSecBreakerTool } from '../tools/AppSecBreakerTool.js';
import { VonStrataTool }      from '../tools/VonStrataTool.js';
import { SwarmCoordinator }   from '../swarm/SwarmCoordinator.js';
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
import { DebugLoop }             from './DebugLoop.js';
import { ResearchPipeline }      from './ResearchPipeline.js';
import { MCPRegistry }           from './MCPRegistry.js';
import { SelfImprovementEngine } from './SelfImprovementEngine.js';
import { SecurityCouncil }       from './SecurityCouncil.js';
import { OdysseyPlanner }     from './OdysseyPlanner.js';
import { HydraController }     from './HydraController.js';
import { OracleKernel }        from './OracleKernel.js';
import { SovereignLoop }       from './SovereignLoop.js';
import { DialecticModel }      from './DialecticModel.js';
import { UniversalIngestion }  from './UniversalIngestion.js';
import { EdgeWorkerOrchestrator } from './EdgeWorkerOrchestrator.js';
import { EconomicsEngine }    from './EconomicsEngine.js';
import { AgentManager }       from './AgentManager.js';
import { SwarmSync }          from './SwarmSync.js';
import { CIWatcher }          from './CIWatcher.js';
import { BrowserTool }        from '../tools/BrowserTool.js';
import { GameWorldTool }      from '../tools/GameWorldTool.js';
import { GameCodeTool }       from '../tools/GameCodeTool.js';
import { GameAssetFetcherTool } from '../tools/GameAssetFetcher.js';
import { SocialArbiter }         from './SocialArbiter.js';
import { SkillEvolutionArbiter }  from './SkillEvolutionArbiter.js';
import { SkillMutatorArbiter }    from './SkillMutatorArbiter.js';
import { ContextPagerArbiter }    from './ContextPagerArbiter.js';
import { WorkspaceEditArbiter } from './WorkspaceEditArbiter.js';
import { SemanticIndex }       from './SemanticIndex.js';
import { GroundingArbiter }     from './GroundingArbiter.js';
import { LSPArbiter }           from './LSPArbiter.js';
import { AutonomyPolicy }       from './AutonomyPolicy.js';
import { SecurityExpertisePack } from './SecurityExpertisePack.js';
import { stripLeakedPromptContext, stripStageDirections } from './TextSanitizer.js';
import fs                         from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SECURITY_ENGINEERING_DIRECTIVE = `

## Secure Engineering Baseline
Security is part of the definition of done for every site, app, API, tool, and integration.
- Threat-model the change before implementation: identify trust boundaries, attacker-controlled input, auth/authorization checks, data exposure, dependency risk, and abuse paths.
- Default to least privilege, explicit validation, safe output encoding, parameterized database access, secure cookie/session settings, CSRF protection where relevant, and secret-free source code.
- Never hardcode credentials, tokens, private keys, webhook secrets, or production URLs with embedded auth.
- Treat frontend work as security-sensitive too: avoid unsafe HTML injection, sanitize rendered user content, use safe link/file handling, and do not expose secrets in client bundles.
- When changing auth, payments, uploads, shell execution, file access, networking, crypto, personal data, admin features, or cross-origin behavior, include security verification in the final validation.
- If a user asks for a risky shortcut, explain the risk and choose the safer implementation path unless they explicitly accept the tradeoff.
`;

// Serializes chat turns so they process one at a time without blocking agent work
class ChatQueue {
    constructor() {
        this._queue   = [];
        this._running = false;
    }

    enqueue(fn) {
        return new Promise((resolve, reject) => {
            this._queue.push({ fn, resolve, reject });
            if (!this._running) this._drain();
        });
    }

    async _drain() {
        if (this._running) return;
        this._running = true;
        while (this._queue.length > 0) {
            const { fn, resolve, reject } = this._queue.shift();
            try { resolve(await fn()); }
            catch (err) { reject(err); }
        }
        this._running = false;
    }

    get size() { return this._queue.length; }
}

export class MAX {
    constructor(config = {}) {
        this.config = config;
        this.name   = 'MAX';
        this._ready = false;

        // Core systems
        this.brain      = new Brain(this, config);
        this.agentBrain = new Brain(this, config);  // dedicated lane for background agent work
        this.drive     = new DriveSystem(config.drive);
        this.curiosity = new CuriosityEngine(config.curiosity);
        this.persona   = new PersonaEngine();
        this.muse      = new MuseEngine();
        this.memory    = new MaxMemory(config.memory);
        this.kb        = new KnowledgeBase({ dbPath: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.max', 'knowledge.db') });
        this.profile   = new UserProfile();

        // Tools
        this.tools     = new ToolRegistry();

        // Higher systems — init after brain is ready
        this.swarm     = null;
        this.heartbeat = null;
        this.scheduler = null;

        // Autonomous systems
        this.outcomes     = null;
        this.reasoning    = null;
        this.cognitive    = new CognitiveFilter(this);
        this.evolution    = null;
        this.goals        = null;
        this.agentLoop    = null;
        this.poseidon     = new PoseidonResearch(this);
        this.graph        = new RepoGraph(this);
        this.toolCreator  = null;
        this.selfInspector = null;
        this.reflection    = null;
        this.indexer       = new CodeIndexer(this);
        this.sentinel      = new Sentinel(this);
        this.vector        = new VectorDaemon(this);
        this.diagnostics   = new DiagnosticsSystem(this);
        this.world         = new WorldModel(this);
        this.artifacts     = new ArtifactManager(this);
        this.lab           = new TestGenerator(this);
        this.skills        = new SkillLibrary();
        this.selfEditor    = new SelfEditor();
        this.notifier      = new Notifier();
        this.soma          = new SomaBridge();
        this.edge          = new EdgeWorkerOrchestrator(this);
        this.odyssey       = new OdysseyPlanner(this);
        this.economics     = new EconomicsEngine(config.economics);
        this.agentManager  = new AgentManager(this);
        this.hydra         = new HydraController(this);
        this.oracle        = new OracleKernel(this);
        this.ingestion     = new UniversalIngestion(this);
        this.dialectic     = new DialecticModel(this);
        this.sovereign     = new SovereignLoop(this);
        this.roadmap       = new RoadmapEngine(this);
        this.ci              = new CIWatcher(this);
        this.debugLoop       = new DebugLoop(this);
        this.research        = new ResearchPipeline(this);
        this.mcp             = new MCPRegistry(this);
        this.selfImprovement = new SelfImprovementEngine(this);
        this.security        = new SecurityCouncil(this);
        this.securityPack    = new SecurityExpertisePack();
        this.autonomy        = new AutonomyPolicy(config.autonomy);
        this.social          = new SocialArbiter(this);
        this.skillEvolution  = new SkillEvolutionArbiter(this);
        this.skillMutator    = new SkillMutatorArbiter(this);
        this.contextPager    = new ContextPagerArbiter(this);
        this.bridge          = null; // Deprecated: server/server.js owns the active IDE WebSocket/SSE bridge.
        this.workspaceEdits  = new WorkspaceEditArbiter(this);
        this.semanticIndex   = new SemanticIndex(this);
        this.grounding       = new GroundingArbiter(this);
        this.lsp             = new LSPArbiter(this);
        this.userModel       = new DeepUserModel(this);
        this.longitudinal    = new LongitudinalSelf(this);
        this.dataset         = new DatasetCurator(this);

        // State flags
        this.isThinking       = false;
        this._currentAbortController = null;
        this._lastError       = null; // { message, ts } — last caught error, exposed via /health
        this._ghostBuffers = new Map(); // unsaved editor content streamed from Maxwell IDE

        // Conversation context window
        this._context         = [];
        this._contextLimit    = 20;  // 10 turns (user+assistant pairs)
        this._compressing     = false;
        this._sessionBriefing = null;
        this._chatBusy        = false;
        this._chatQueue       = new ChatQueue();

        this._promptCache     = { key: null, prompt: null };
        this._responseCache   = new Map();  // cacheKey → { response, persona, drive, telemetry, ts }
        this._backgroundTimer = null;
        this._backgroundStarted = false;

        // ─── Phase 5: Explicit Context (Cursor-style) ───
        this.pinnedFiles      = new Set();

        // Project context — detected once at startup from package.json / README
        this._projectContext  = null;
    }

    pinFile(relPath) { this.pinnedFiles.add(relPath); }
    unpinFile(relPath) { this.pinnedFiles.delete(relPath); }
    clearPinned() { this.pinnedFiles.clear(); }

    abortChat() {
        if (this._currentAbortController) {
            this._currentAbortController.abort();
            this._currentAbortController = null;
        }
    }

    abortAgent() {
        return this.agentLoop?.interrupt?.() || false;
    }

    hasIdeClients() {
        return (this._ideClients?.size || 0) > 0;
    }

    _installAutonomyPolicy() {
        if (this._autonomyPolicyInstalled || !this.tools?.execute) return;
        this._autonomyPolicyInstalled = true;
        const originalExecute = this.tools.execute.bind(this.tools);
        this.tools.execute = async (toolName, action, params = {}) => {
            const decision = this.autonomy?.can(toolName, action, params, {
                mode: this.config.mode || this.config.runtimeMode || 'chat'
            });
            if (decision && !decision.allowed) {
                console.warn(`[AutonomyPolicy] Blocked ${toolName}.${action}: ${decision.reason}`);
                return {
                    success: false,
                    blocked: true,
                    policy: {
                        risk: decision.risk,
                        reason: decision.reason,
                        level: this.autonomy.level
                    },
                    error: `[AutonomyPolicy] ${decision.reason}`
                };
            }
            if (decision?.warning) {
                console.warn(`[AutonomyPolicy] High-risk ${toolName}.${action}: ${decision.reason}`);
            }
            return originalExecute(toolName, action, params);
        };
    }

    async initialize() {
        console.log('\n' + '━'.repeat(60));
        console.log('  MAX — autonomous engineering agent');
        console.log('  Initializing...');
        console.log('━'.repeat(60));

        // Memory (async — loads vectors + tries to init embedder)
        console.log('[MAX] 💾 Initializing memory tiers...');
        await this.memory.initialize();
        await this.kb.initialize();
        this.semanticIndex.initialize(); // non-blocking — scans after 10s delay

        // User profile — load from .max/user.md and .max/tasks.md
        console.log('[MAX] 👤 Loading user profile...');
        this.profile.load();
        if (this.profile.hasProfile) {
            console.log(`[MAX] 👤 Profile loaded: ${this.profile.name}`);
        }

        // Longitudinal systems — load from disk (non-blocking)
        this.userModel.load();
        this.longitudinal.load();
        this.dataset.load();

        // Brain (both lanes)
        console.log('[MAX] 🧠 Initializing brain backends...');
        await this.brain.initialize();
        await this.agentBrain.initialize();
        if (!this.brain._ready) {
            console.error('\n[MAX] ❌ No LLM backend. Cannot operate without a brain.');
            console.error('  → Start Ollama: https://ollama.com');
            console.error('  → Or add DEEPSEEK_API_KEY to config/api-keys.env\n');
            return;
        }

        // Tools
        console.log('[MAX] 🛠️ Registering tools...');
        this.tools.register(FileTools);
        this.tools.register(ShellTool);
        this.tools.register(WebTool);
        this.tools.register(GitTool);
        this.tools.register(ApiTool);
        this.tools.register(CodeRunnerTool);
        this.tools.register(createVisionTool(this.edge));
        this.tools.register(createSelfEvolutionTool(this));
        this.tools.register(createSystemTool(this));
        this.tools.register(DiscordTool);
        this.tools.register(EmailTool);
        this.tools.register(KnowledgeTool);
        this.tools.register(BrowserTool);
        this.tools.register(GameWorldTool);
        this.tools.register(GameCodeTool);
        this.tools.register(GameAssetFetcherTool);
        this.tools.register(AppSecBreakerTool);
        this.tools.register(VonStrataTool);
        this._installAutonomyPolicy();

        // Seal the SkillMutator primitive registry now that all tools are registered
        this.skillMutator.initializeRegistry();

        // Wire SecurityCouncil and WorkspaceEdits into file tools
        const fileTool = this.tools.get('file');
        if (fileTool) {
            const _self = this;
            const _origWrite   = fileTool.actions.write.bind(fileTool.actions);
            const _origReplace = fileTool.actions.replace.bind(fileTool.actions);
            const _origPatch   = fileTool.actions.patch.bind(fileTool.actions);

            fileTool.actions.write = async (params) => {
                // Security check first
                const review = await _self.security.review(params.content || '', { filePath: params.filePath, goal: 'file write' });
                if (!review.safe) return { success: false, error: `[SecurityCouncil] Write blocked (${review.severity}): ${review.issues[0]?.issue}` };
                
                // If IDE is connected, propose instead of write
                if (!params.__applyProposal && params.__source !== 'ui' && _self.hasIdeClients()) {
                    return _self.workspaceEdits.propose('write', params);
                }
                return _origWrite(params);
            };

            fileTool.actions.replace = async (params) => {
                const review = await _self.security.review(params.newText || '', { filePath: params.filePath, goal: 'file replace' });
                if (!review.safe) return { success: false, error: `[SecurityCouncil] Replace blocked (${review.severity}): ${review.issues[0]?.issue}` };
                
                if (!params.__applyProposal && params.__source !== 'ui' && _self.hasIdeClients()) {
                    return _self.workspaceEdits.propose('replace', params);
                }
                return _origReplace(params);
            };

            fileTool.actions.patch = async (params) => {
                const reviewTarget = _self._buildPatchSecurityReviewTarget(params);
                const review = await _self.security.review(reviewTarget, { filePath: params.filePath, goal: 'file patch' });
                if (!review.safe) return { success: false, error: `[SecurityCouncil] Patch blocked (${review.severity}): ${review.issues[0]?.issue}` };

                // If IDE is connected, propose instead of patch
                if (!params.__applyProposal && params.__source !== 'ui' && _self.hasIdeClients()) {
                    return _self.workspaceEdits.propose('patch', params);
                }
                return _origPatch(params);
            };
        }

        // Core systems (need brain ready)
        this.outcomes  = new OutcomeTracker({ storageDir: path.join(__dirname, '..', '.max') });
        this.reasoning = new ReasoningChamber(this.brain, this.memory, this.outcomes);
        this.goals     = new GoalEngine(this.agentBrain, this.outcomes, this.memory, {
            storageDir: path.join(__dirname, '..', '.max'),
            vector:     this.vector
        });
        
        // Agent loop
        this.agentLoop = new AgentLoop(this);

        // Evolution and self-coding
        this.evolution = new EvolutionArbiter(this.brain, this.memory, this.outcomes);
        this.evolution.swarm = this.swarm; // Link swarm for adversarial reviews
        this.evolution.max   = this;       // Link MAX so UserProxy can read user profile
        this.toolCreator = new ToolCreator(this.brain, this.tools, path.join(__dirname, '..', 'tools', 'generated'));
        this.selfInspector = new SelfCodeInspector(this.brain, this.memory);
        this.reflection = new ReflectionEngine(this.brain, this.goals, this.outcomes, this.kb, this);

        // Initialize long-horizon planner (loads persisted DAG maps from disk)
        await this.odyssey.initialize();

        this._ready = true;

        // Swarm and scheduler (final systems)
        this.swarm     = new SwarmCoordinator(this.brain, this.tools);
        this.heartbeat = new Heartbeat(this);
        this.scheduler = new Scheduler(this);

        // Background jobs and integrations are registered just before the
        // scheduler starts (in _scheduleBackgroundLoops), not here.
        // This keeps initialize() fast — the server comes online sooner.

        // Fix 5: detect project context from package.json + README
        try {
            const pkgPath    = path.join(process.cwd(), 'package.json');
            const readmePath = path.join(process.cwd(), 'README.md');
            let ctx = '';
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 20).join(', ');
                ctx += `\n## Project: ${pkg.name || 'unknown'} v${pkg.version || '?'}\n${pkg.description || ''}\nStack: ${deps}`;
            }
            if (fs.existsSync(readmePath)) {
                ctx += `\n\nREADME summary:\n${fs.readFileSync(readmePath, 'utf8').slice(0, 800)}`;
            }
            if (ctx) {
                this._projectContext = ctx;
                console.log(`[MAX] 📁 Project context loaded (${ctx.length} chars)`);
            }
        } catch { /* non-fatal */ }

        // Initialize goals (loads from disk)
        this.goals.initialize();

        // Initialize skill library (loads persisted skills from .max/skills.json)
        await this.skills.initialize();

        // Initialize SelfEditor staging/backup dirs
        await this.selfEditor.initialize().catch(() => {});

        // Connect to external MCP servers (non-blocking — failure doesn't stop boot)
        this.mcp.initialize().catch(err =>
            console.warn('[MAX] MCP initialization error:', err.message)
        );

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
                    // Immediately surface in chat so user knows work has started
                    this.say(`On it — queued: **${title}**`, 'Working in background...');
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

        // ── MCP management tool — connect/disconnect external MCP servers ──
        this.tools.register({
            name:        'mcp',
            description: `Manage external MCP server connections. Each connected server's tools are auto-registered and usable via TOOL:mcp_<name>:<tool>:{}.
Actions:
  status  → list connected servers and their tools: TOOL:mcp:status:{}
  connect → connect a new MCP server at runtime: TOOL:mcp:connect:{"name":"playwright","command":"npx","args":["@playwright/mcp@latest"]}
  disconnect → disconnect a server: TOOL:mcp:disconnect:{"name":"playwright"}`,
            actions: {
                status:     async ()      => this.mcp.getStatus(),
                connect:    async (cfg)   => this.mcp.connect(cfg),
                disconnect: async ({ name }) => ({ success: this.mcp.disconnect(name) })
            }
        });

        // ── Research tool — deep web research that accumulates into KB ────
        this.tools.register({
            name:        'research',
            description: `Deep web research pipeline: search → fetch multiple pages → extract facts → store in KB.
Actions:
  run   → full research run (stores in KB): TOOL:research:run:{"query":"latest transformer architectures","maxPages":4}
  quick → fast single-page lookup (no KB): TOOL:research:quick:{"query":"Node.js streams API"}`,
            actions: {
                run:   async ({ query, maxPages = 4, context = '' }) =>
                    this.research.research(query, { maxPages, storeInKB: true, context }),
                quick: async ({ query }) =>
                    this.research.quick(query)
            }
        });

        // ── DebugLoop tool — autonomous test→fix→verify cycle ────────────
        this.tools.register({
            name:        'debug',
            description: `Autonomous debug loop: run tests → diagnose → fix → re-run → iterate.
Actions:
  run    → start debug loop: TOOL:debug:run:{"testCommand":"npm test","maxIterations":5}
  status → check if a loop is running: TOOL:debug:status:{}`,
            actions: {
                run:    async ({ testCommand, maxIterations = 5, context = '' }) => {
                    const cmd = testCommand || this.ci?.testCommand || 'npm test';
                    return this.debugLoop.run(cmd, { maxIterations, goalContext: context });
                },
                status: async () => this.debugLoop.getStatus()
            }
        });

        // ── Self-improvement tool — propose and apply code edits to MAX himself ──
        this.tools.register({
            name:        'self_improve',
            description: `Propose and manage self-modification of MAX's own source code.
Actions:
  propose  → map a behavioral weakness to a code fix and queue for approval: TOOL:self_improve:propose:{"weakness":"MAX often gives verbose responses when concise would be better"}
  list     → show pending proposals: TOOL:self_improve:list:{}
  approve  → apply a proposal: TOOL:self_improve:approve:{"id":"abc12345"}
  deny     → discard a proposal: TOOL:self_improve:deny:{"id":"abc12345"}
  status   → improvement stats: TOOL:self_improve:status:{}`,
            actions: {
                propose: async ({ weakness, source = 'user' }) =>
                    this.selfImprovement.propose(weakness, { source }),
                list:    async () => ({ proposals: this.selfImprovement.list() }),
                approve: async ({ id }) => this.selfImprovement.approve(id),
                deny:    async ({ id }) => this.selfImprovement.deny(id),
                status:  async () => this.selfImprovement.getStatus()
            }
        });

        // ── Odyssey tool — grand strategy and long-horizon DAG planning ──
        this.tools.register({
            name: 'odyssey',
            description: `Manage grand, multi-step strategic projects using Directed Acyclic Graphs (DAG).
Actions:
  map    → break a massive goal into a DAG of milestones: TOOL:odyssey:map:{"title":"Project Name","description":"..."}
  next   → see the next executable milestones: TOOL:odyssey:next:{"projectId":"..."}
  finish → mark a milestone as reached: TOOL:odyssey:finish:{"projectId":"...","nodeId":"...","result":"..."}
  status → see the full strategic map: TOOL:odyssey:status:{"projectId":"..."}`,
            actions: {
                map:    async ({ title, description }) => ({ success: true, projectId: await this.odyssey.mapGrandGoal(title, description) }),
                next:   async ({ projectId }) => ({ success: true, next: this.odyssey.getNextNodes(projectId) }),
                finish: async ({ projectId, nodeId, result }) => {
                    await this.odyssey.completeNode(projectId, nodeId, result);
                    return { success: true, message: `Milestone ${nodeId} reached.` };
                },
                status: async ({ projectId }) => ({ success: true, map: this.odyssey.maps.get(projectId) })
            }
        });

        // ── Management tool — control child agents via AgentManager ──────
        this.tools.register({
            name: 'management',
            description: `Control and monitor child agents (like Choko).
Actions:
  boot        → start a child agent: TOOL:management:boot:{"name":"Choko"}
  list        → see online agents: TOOL:management:list:{}
  shutdown    → stop an agent: TOOL:management:shutdown:{"name":"Choko"}
  status      → overall swarm status: TOOL:management:status:{}
  inject_goal → assign a task to an agent: TOOL:management:inject_goal:{"name":"Choko", "goal":{"title":"Fix bug","description":"..."}}
  sync_personas → copy expert protocols to SOMA: TOOL:management:sync_personas:{}
  audit_choko   → check Choko's wishlist and evolve him: TOOL:management:audit_choko:{}`,
            actions: {
                boot:     async ({ name, config = {} }) => {
                    const agent = await this.agentManager.boot(name, config);
                    return { success: true, message: `Agent ${name} is online.` };
                },
                list:     async () => ({ success: true, agents: this.agentManager.list() }),
                shutdown: async ({ name }) => ({ success: await this.agentManager.shutdown(name) }),
                status:   async () => ({ success: true, ...this.agentManager.getStatus() }),
                inject_goal: async ({ name, goal }) => {
                    const id = await this.agentManager.injectGoal(name, goal);
                    return { success: true, id, message: `Goal injected into ${name}.` };
                },
                audit_choko: async () => {
                    console.log('[Management] 🧐 Auditing Choko\'s evolution wishlist...');
                    const wishlistPath = path.join(__dirname, '..', 'Choko', '.max', 'evolution_wishlist.md');
                    if (!fs.existsSync(wishlistPath)) return { success: false, error: 'Wishlist not found' };

                    const content = fs.readFileSync(wishlistPath, 'utf8');
                    const wishes = content.match(/- \[ \] \*\*(.+)\*\*: (.+)/g) || [];
                    
                    if (wishes.length === 0) return { success: true, message: 'Choko is happy! No new wishes found.' };

                    console.log(`[Management] 🎀 Found ${wishes.length} wishes. Queuing evolution goals...`);
                    for (const wish of wishes) {
                        const [, title, desc] = wish.match(/- \[ \] \*\*(.+)\*\*: (.+)/);
                        this.goals.addGoal({
                            title: `Evolve Choko: ${title}`,
                            description: `Choko requested an upgrade: ${desc}. Use self_evolution to implement this.`,
                            type: 'improvement',
                            priority: 0.75,
                            source: 'choko_wishlist'
                        });
                    }

                    return { success: true, message: `Queued ${wishes.length} evolution goal(s) for Choko.` };
                },
                sync_personas: async () => {
                    console.log('[Management] 🔄 Synchronizing expert personas with SOMA...');
                    const srcDir = path.join(__dirname, '..', 'personas', 'experts');
                    const dstDir = path.join('C:\\Users\\barry\\Desktop\\SOMA', 'agents_repo', 'plugins');
                    
                    if (!fs.existsSync(srcDir)) return { success: false, error: 'Source personas not found' };
                    if (!fs.existsSync(dstDir)) return { success: false, error: 'SOMA plugins directory not found' };

                    const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
                    let synced = 0;

                    for (const file of files) {
                        const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
                        const dstPath = path.join(dstDir, `expert_${file}`);
                        
                        // Add frontmatter if missing (SOMA loader requirement)
                        let finalContent = content;
                        if (!content.startsWith('---')) {
                            const name = file.replace('.md', '');
                            finalContent = `--(--\nname: ${name}\ndomain: SYSTEM\n---\n${content}`;
                        }

                        fs.writeFileSync(dstPath, finalContent);
                        synced++;
                    }

                    return { success: true, message: `Synced ${synced} expert(s) to SOMA.` };
                }
            }
        });

        // ── Paging tool — dynamic context management ────────────────────
        this.tools.register({
            name:        'paging',
            description: `Manage dynamic project context (virtual memory).
Actions:
  pin    → pin a specific file or hunk to always stay in context: TOOL:paging:pin:{"path":"core/MAX.js"}
  clear  → clear all pinned context: TOOL:paging:clear:{}
  status → see context pager stats: TOOL:paging:status:{}`,
            actions: {
                pin:    async ({ path: p }) => {
                    const content = fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
                    this.contextPager.pinHunk(p, content.slice(0, 3000));
                    return { success: true, message: `Pinned ${p} to context.` };
                },
                clear:  async () => {
                    this.contextPager.clearPins();
                    return { success: true, message: 'All pins cleared.' };
                },
                status: async () => ({ success: true, ...this.contextPager.getStatus() })
            }
        });

        // ── Grounding tool — autonomous truth-seeking ──────────────────
        this.tools.register({
            name:        'grounding',
            description: `Manually trigger the Autonomous Grounding Loop to verify a claim.
Actions:
  verify → verify a factual claim via research: TOOL:grounding:verify:{"claim":"The latest SOTA for latent world models is Dreamer-V3"}
  status → see grounding loop stats: TOOL:grounding:status:{}`,
            actions: {
                verify: async ({ claim }) => {
                    const result = await this.grounding.ground(claim);
                    return { success: !!result, result };
                },
                status: async () => ({ success: true, ...this.grounding.getStatus() })
            }
        });

        // ── Evolution tool — genetic program synthesis ──────────────────
        this.tools.register({
            name:        'evolution',
            description: `Manage genetic procedural optimization (Skill Mutation).
Actions:
  dream  → manually trigger an evolutionary dream epoch: TOOL:evolution:dream:{}
  status → see mutation metrics and compositions: TOOL:evolution:status:{}`,
            actions: {
                dream:  async () => {
                    console.log('[MAX] 🧬 Manual Evolutionary Epoch triggered...');
                    const variants = [];
                    for (const skill of this.skills._skills) {
                        const v = this.skillMutator.spawnVariant(skill);
                        if (v) variants.push(v);
                    }
                    return { success: true, variantsCreated: variants.length, message: `Epoch complete. ${variants.length} mutations generated.` };
                },
                status: async () => ({ success: true, ...this.skillMutator.getStatus() })
            }
        });

        // ── Swarm tool — distributed parallel orchestration ─────────────
        this.tools.register({
            name:        'swarm',
            description: `Execute complex tasks across a parallel swarm of agents.
Actions:
  run       → execute a multi-agent task: TOOL:swarm:run:{"name":"Task Name","subtasks":[{"id":"worker1","prompt":"..."},{"id":"worker2","prompt":"..."}]}
  decompose → break a goal into parallel subtasks: TOOL:swarm:decompose:{"task":"...","numWorkers":3}
  status    → see active swarm jobs: TOOL:swarm:status:{}`,
            actions: {
                run:       async (task) => this.swarm.run(task),
                decompose: async ({ task, numWorkers = 4 }) => {
                    const subtasks = await this.swarm.decompose(task, numWorkers);
                    return { success: true, subtasks };
                },
                status:    async () => ({ success: true, ...this.swarm.activeJobs.size > 0 ? { active: Array.from(this.swarm.activeJobs.values()) } : { message: 'Idle' } })
            }
        });

        // ── Graph tool — architectural intelligence ─────────────────────
        this.tools.register({
            name:        'graph',
            description: `Analyze project architecture and change impact.
Actions:
  impact → calculate the blast radius of a change: TOOL:graph:impact:{"path":"core/MAX.js"}
  risks  → see cycles and risky hubs: TOOL:graph:risks:{}
  rebuild → force a graph rebuild: TOOL:graph:rebuild:{}`,
            actions: {
                impact:  async ({ path }) => ({ success: true, impact: this.graph.getImpact(path) }),
                risks:   async () => ({ success: true, ...this.graph.getSummary().risks }),
                rebuild: async () => { await this.graph.rebuild(); return { success: true, summary: this.graph.getSummary() }; }
            }
        });

        // ── Skills tool — manage procedural memory ──────────────────────
        this.tools.register({
            name:        'skills',
            description: `Manage MAX's procedural memory (skills).
Actions:
  list    → see all learned skills: TOOL:skills:list:{}
  recall  → find a relevant skill for a goal: TOOL:skills:recall:{"goal":"... "}
  status  → see skill library stats: TOOL:skills:status:{}`,
            actions: {
                list:   async () => ({ success: true, skills: this.skills._skills.map(s => ({ name: s.name, summary: s.summary, used: s.usedCount })) }),
                recall: async ({ goal }) => {
                    const skill = await this.skills.recall(goal);
                    return { success: !!skill, skill };
                },
                status: async () => ({ success: true, ...this.skills.getStatus() })
            }
        });

        // ── Social tool — Honcho-style user profiling ────────────────────
        this.tools.register({
            name:        'social',
            description: `Manage social memory and user profiling (Honcho-style).
Actions:
  scan    → manually trigger a scan of recent conversation to update profile: TOOL:social:scan:{}
  status  → see SocialArbiter status: TOOL:social:status:{}
  profile → see the current user profile summary: TOOL:social:profile:{}`,
            actions: {
                scan:    async () => {
                    await this.social.scan();
                    return { success: true, message: 'Scan complete. Profile and tasks updated based on recent chat.' };
                },
                status:  async () => ({ success: true, ...this.social.getStatus() }),
                profile: async () => ({ success: true, profile: this.profile.getStats() })
            }
        });

        // ── Hydra tool — multi-MAX swarm orchestration ──────────────────
        this.tools.register({
            name: 'hydra',
            description: `Orchestrate a swarm of specialized MAX instances.
Actions:
  spawn    → create a specialized head: TOOL:hydra:spawn:{"role":"scout|grinder|shield"}
  audit    → verify a sandbox change: TOOL:hydra:audit:{"path":"file.js"}
  commit   → deploy verified change: TOOL:hydra:commit:{"path":"file.js"}
  optimize → trigger the Hephaestus Loop for autonomous self-optimization: TOOL:hydra:optimize:{}
  status   → see swarm health and active heads: TOOL:hydra:status:{}`,
            actions: {
                spawn:    async ({ role, config }) => ({ success: true, headId: await this.hydra.spawnHead(role, config) }),
                audit:    async ({ path, command }) => await this.hydra.auditChange(path, command),
                commit:   async ({ path }) => await this.hydra.commitChange(path),
                optimize: async () => await this.hydra.autoOptimize(),
                status:   async () => ({ success: true, ...this.hydra.getStatus() })
            }
        });

        // ── Boot status table ─────────────────────────────────────────────
        // Ensure SOMA probe has run before we print its status
        await this.soma.initialize().catch(() => {});
        const bs           = this.brain.getStatus();
        const brainDetail  = [bs.fast.ready ? `fast:${bs.fast.backend}` : null, bs.smart.ready ? `smart:${bs.smart.backend}` : null].filter(Boolean).join(' | ') || 'none';
        const economicsOk  = !this.economics?.isOverBudget();
        const budgetPct    = this.economics?.getBudgetStatus()?.pct ?? 0;

        // [label, ok, detail]  — SOMA is always informational, never a hard failure
        const checks = [
            ['Brain (chat)',     bs.fast.ready || bs.smart.ready, brainDetail],
            ['Brain (agent)',    bs.fast.ready || bs.smart.ready, brainDetail],
            ['SOMA',            null,  this.soma?.available ? 'online — QuadBrain active' : 'offline — using local brain'],
            ['Security Council', null, this.security?.enabled ? 'enabled' : 'disabled'],
            ['Autonomy',         true, `${this.autonomy.level}${this.autonomy.externalSend ? ' + external send' : ''}`],
            ['Daily budget',    economicsOk,  economicsOk ? `${budgetPct}% used` : 'OVER CAP — raise MAX_DAILY_BUDGET'],
            ['Knowledge base',  true,  'ready'],
            ['Skill library',   true,  'ready'],
            ['MCP registry',    true,  'ready'],
        ];
        console.log('\n' + '━'.repeat(60));
        console.log('[MAX] Boot status:');
        for (const [label, ok, detail] of checks) {
            const icon = ok === null ? '  –' : ok ? '  ✓' : '  ✗';
            console.log(`${icon}  ${label.padEnd(18)} ${detail}`);
        }
        console.log('━'.repeat(60) + '\n');

        this._scheduleBackgroundLoops();
    }

    _scheduleBackgroundLoops() {
        const configured = Number(process.env.MAX_BACKGROUND_START_DELAY_MS);
        const mode = this.config.mode || this.config.runtimeMode || 'chat';
        if (mode === 'api' && process.env.MAX_API_BACKGROUND !== 'true') {
            console.log('[MAX] API mode — background loops disabled by default (set MAX_API_BACKGROUND=true to enable)');
            return;
        }

        // Register all scheduled jobs now (deferred from initialize() for fast boot)
        this._registerScheduledJobs();

        const defaultDelay = mode === 'api' ? 30_000 : 3_000;
        const delayMs = Number.isFinite(configured) && configured >= 0 ? configured : defaultDelay;

        if (delayMs === 0) {
            this._startBackgroundLoops();
            return;
        }

        console.log(`[MAX] Background loops delayed ${Math.round(delayMs / 1000)}s so the API can come online first`);
        this._backgroundTimer = setTimeout(() => this._startBackgroundLoops(), delayMs);
        this._backgroundTimer.unref?.();
    }

    _registerScheduledJobs() {
        if (this._jobsRegistered) return;
        this._jobsRegistered = true;
        console.log('[MAX] 📅 Registering background jobs...');

        this.scheduler.addJob({ id: 'memory_prune', label: 'Prune weak memories', every: '1h', handler: () => this.memory._cleanup() });
        this.scheduler.addJob({ id: 'reflection', label: 'System self-reflection', every: '30m', handler: () => this.reflection.forceReflect() });
        this.scheduler.addJob({ id: 'roadmap_sync', label: 'Sync development roadmap', every: '4h', type: 'custom', handler: () => this.roadmap.sync().catch(err => console.warn('[MAX] Roadmap sync failed:', err.message)) });
        this.scheduler.addJob({ id: 'poseidon_research', label: 'Poseidon: AI research cycle', every: '24h', type: 'custom', handler: () => this.poseidon?.runCycle().catch(err => console.warn('[MAX] Poseidon cycle failed:', err.message)) });
        this.scheduler.addJob({ id: 'hephaestus_optimize', label: 'Hydra Swarm: Code Optimization', every: '12h', type: 'custom', handler: () => this.hydra.autoOptimize().catch(err => console.warn('[MAX] Hephaestus failed:', err.message)) });
        this.scheduler.addJob({ id: 'universal_ingestion', label: 'Ingestion: SOTA research harvester', every: '12h', handler: () => this.ingestion.pulse() });
        this.scheduler.addJob({ id: 'sentinel_scan', label: 'Sentinel: project health scan', every: '15m', type: 'custom', handler: () => this.agentLoop?._loops?.watch?.run({ title: 'Sentinel Scan' }, this, this.agentLoop) });
        this.scheduler.addJob({ id: 'diagnostics_audit', label: 'Diagnostics: architectural audit', every: '1h', type: 'custom', handler: () => this.diagnostics.runAll() });
        this.scheduler.addJob({ id: 'social_scan', label: 'Social: user profiling', every: '10m', type: 'custom', handler: () => this.social.scan() });
        this.scheduler.addJob({ id: 'skill_evolution', label: 'Evolution: codify winning paths', every: '6h', type: 'custom', handler: () => this.skillEvolution.analyzeWinningPaths() });
        this.scheduler.addJob({
            id: 'skill_mutation', label: 'Evolution: mutate tool chains', every: '12h', type: 'custom',
            handler: async () => {
                if (!this.skills?._skills?.length) return;
                const outcomes = this.outcomes?.query({ limit: 20, success: true }) ?? [];
                for (const skill of this.skills._skills) {
                    const variant = this.skillMutator.spawnVariant(skill);
                    if (!variant) continue;
                    const ctx = outcomes.find(o => o.context?.title?.toLowerCase().includes(skill.name.toLowerCase()))?.context ?? null;
                    this.skillMutator.queueForTest(variant, ctx);
                }
            }
        });
        this.scheduler.addJob({ id: 'variant_tests', label: 'Evolution: run variant tests', every: '3h', type: 'custom', handler: () => this.skillMutator.runNextTest() });
        this.scheduler.addJob({ id: 'choko_relay', label: 'Choko: pick up field reports', every: '15m', type: 'custom', handler: () => this._processChokoRelay().catch(err => console.warn('[MAX] Choko relay error:', err.message)) });
        this.scheduler.addJob({ id: 'choko_scout', label: 'Choko: dispatch scout mission', every: '4h', type: 'custom', handler: () => this._dispatchChokoMission().catch(() => {}) });
        this.scheduler.addJob({ id: 'soma_curiosity_sync', label: 'SOMA: sync curiosity goals', every: '30m', type: 'custom', handler: () => { if (this.soma?.available) this.soma.syncCuriosityGoals(this.goals).catch(() => {}); } });
        this.scheduler.addJob({ id: 'pr_review_loop', label: 'PR: poll open PRs for review comments', every: '30m', type: 'custom', handler: () => this._pollPRReviews().catch(() => {}) });
        this.scheduler.addJob({ id: 'longitudinal_snapshot', label: 'Identity: weekly self-snapshot', every: '24h', type: 'custom', handler: () => this.longitudinal.takeSnapshot().catch(() => {}) });
        this.scheduler.addJob({ id: 'user_model_session', label: 'User model: ingest session patterns', every: '1h', type: 'custom', handler: () => this.userModel.ingestSession(this._context.slice(-40)).catch(() => {}) });
        this.scheduler.addJob({ id: 'dataset_synthetic', label: 'Dataset: generate synthetic examples', every: '24h', type: 'custom', handler: async () => { const top = Object.entries(this.userModel.model?.topics||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]; if (top) await this.dataset.generateSynthetic(top, 3).catch(() => {}); } });

        if (this.ci.testCommand) {
            this.scheduler.addJob({ id: 'ci_watch', label: 'CI: Run test suite', every: '30m', type: 'custom', handler: () => this.ci.runChecks().catch(err => console.warn('[MAX] CI check error:', err.message)) });
            this.ci.on('fail', () => {
                if (!this.debugLoop._active) this.debugLoop.run(this.ci.testCommand, { label: 'CI' }).catch(() => {});
            });
            console.log(`[MAX] 🧪 CI Watcher armed: ${this.ci.testCommand}`);
        }

        // Boot Choko after scheduler is running so she has a job queue to fill
        setTimeout(() => this._bootChoko().catch(err => console.warn('[MAX] Choko boot failed:', err.message)), 3000);
    }

    _startBackgroundLoops() {
        if (this._backgroundStarted) return;
        this._backgroundStarted = true;
        this._backgroundTimer = null;

        // Wire MuseEngine — activates/deactivates with companion persona
        this.persona.on('persona_changed', ({ id }) => {
            if (id === 'companion') {
                this.muse.activate(this.heartbeat);
            } else {
                this.muse.deactivate();
            }
        });

        // Muse insight generation — fast LLM call every 4 turns in companion mode
        this.muse.on('needs_insight', async ({ messages }) => {
            this.muse.markInsightPending();
            try {
                const ctx = messages.slice(-8)
                    .map(m => {
                        const txt = typeof m.content === 'string' ? m.content : (m.text || m.content?.[0]?.text || '');
                        return `${m.role === 'user' ? 'User' : 'MAX'}: ${txt.slice(0, 300)}`;
                    })
                    .join('\n');
                const result = await this.brain.think(
                    `Conversation:\n${ctx}\n\nIn one specific sentence: what's the most interesting pattern, tension, or unexpected connection you notice here? Be concrete, not generic.`,
                    {
                        tier: 'fast',
                        maxTokens: 100,
                        systemPrompt: 'You notice patterns in conversations. Give one specific, concrete observation. No stage directions. No preamble.',
                    }
                );
                if (result?.text) this.muse.publishInsight(result.text);
            } catch (err) {
                console.error('[MuseEngine] insight generation failed:', err.message);
                this.muse.markInsightPending(); // reset so next turn can retry
            }
        });

        // ── SOMA signal bridge handlers ───────────────────────────────────
        // Forward SOMA's real-time signals into MAX's event/goal system
        if (this.soma) {
            // SOMA muse insights → companion mode if active
            this.soma.subscribe('muse_insight', (data) => {
                if (this.muse?.isActive() && data.body) this.muse.publishInsight(data.body);
            });
            // SOMA curiosity signals → inject as capped-priority goals
            this.soma.subscribe('curiosity', (data) => {
                if (data.title) {
                    this.goals?.addGoal({
                        title:       `[SOMA] ${data.title}`.slice(0, 120),
                        description: (data.body || '').slice(0, 400),
                        type:        'research',
                        source:      'soma_signal',
                        priority:    Math.min(0.55, data.priority || 0.4),
                    });
                }
            });
        }

        // Start heartbeat (drives AgentLoop + curiosity cycles)
        this.heartbeat.start();

        // Start scheduler (own setInterval — independent of heartbeat)
        this.scheduler.initialize();
        this.scheduler.start();

        // Start persistent background loops
        this.oracle.start();
        this.sovereign.start();

        // Fire-and-forget: workspace discovery and external integrations
        const apiMode = (this.config.mode || this.config.runtimeMode) === 'api';
        if (!apiMode || process.env.MAX_API_DISCOVERY === 'true') {
            this.indexer.startIndexing().catch(() => {});
            this.graph.rebuild().catch(() => {});
        }
        autoConnectDiscord(this).catch(() => {});
        autoConnectEmail(this).catch(() => {});

        // Eager start — run AgentLoop once if goals exist, after the UI has had time to connect.
        const mode = this.config.mode || this.config.runtimeMode || 'chat';
        const eagerStartDisabled = process.env.MAX_EAGER_START === 'false'
            || this.config.eagerStart === false
            || (mode === 'api' && process.env.MAX_EAGER_START !== 'true');
        const activeGoals = this.goals.listActive();
        if (!eagerStartDisabled && activeGoals.length > 0) {
            console.log('[MAX] ⚡ Eager start — running first AgentLoop cycle now');
            this.agentLoop.runCycle().catch((err) => {
                console.warn('[MAX] Eager AgentLoop failed:', err.message);
            });
        }
    }

    /**
     * Proactive direct message — used for notifications, status updates, or high-priority chatter.
     */
    say(text, details = '') {
        this.heartbeat.emit('message', { text, details, timestamp: new Date().toISOString() });
    }

    /**
     * Autonomous Agentic Loop — The "Reasoning Engine".
     * Calls think(), catches TOOL: calls, executes them, and feeds results back.
     * Continues until the goal is achieved or max iterations reached.
     */
    async executeAgenticThink(prompt, options = {}) {
        const maxIterations = options.maxIterations || 8;
        let iteration = 0;
        let currentPrompt = prompt;
        let fullHistory = []; // temporary local history for this task

        while (iteration < maxIterations) {
            iteration++;
            
            // We use the normal think method for the LLM call
            const result = await this.think(currentPrompt, {
                ...options,
                tier: options.tier || 'smart'
            });

            const response = result.response;
            fullHistory.push({ role: 'assistant', content: response });

            // Look for TOOL: calls
            const toolCallRegex = /TOOL:(\w+):(\w+):(\{[\s\S]*?\})/g;
            const toolCalls = [...response.matchAll(toolCallRegex)];

            if (toolCalls.length === 0) {
                // Task complete or no more tools needed
                return { 
                    response, 
                    success: true, 
                    iterations: iteration,
                    toolCallsMade: fullHistory.filter(h => h.role === 'tool').length
                };
            }

            // Execute tool calls and gather results
            let toolResults = [];
            for (const match of toolCalls) {
                const [fullMatch, tool, action, paramsStr] = match;
                let params = {};
                try { params = JSON.parse(paramsStr); } catch (e) { toolResults.push(`Error parsing params: ${e.message}`); continue; }

                // ─── Phase 5.5: Agentic Approval Gate ───
                if (this.agentLoop?.needsApproval(tool, action)) {
                    console.log(`  [MAX] 🛑 Approval required for: ${tool}.${action}`);
                    const approved = await this.agentLoop.requestApproval(tool, action, params, options.goal);
                    if (!approved) {
                        toolResults.push(`TOOL_ERROR:${tool}:${action}:User denied execution.`);
                        continue;
                    }
                }

                console.log(`  [MAX] 🛠️  Executing: ${tool}.${action}`);
                this.heartbeat?.emit('toolStart', { tool, action, params });
                
                try {
                    const toolResult = await this.tools.execute(tool, action, params);
                    const resultStr = JSON.stringify(toolResult);
                    toolResults.push(`TOOL_RESULT:${tool}:${action}:${resultStr}`);
                } catch (err) {
                    toolResults.push(`TOOL_ERROR:${tool}:${action}:${err.message}`);
                }
            }

            // Feed results back to the brain
            currentPrompt = `TOOL RESULTS:\n${toolResults.join('\n\n')}\n\nContinue implementation.`;
            fullHistory.push({ role: 'user', content: currentPrompt });
        }

        return { response: 'Max iterations reached without completion.', success: false };
    }

    // Public entry point — queues chat turns so they run serially while agent lanes run freely
    think(userMessage, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');
        return this._chatQueue.enqueue(() => this._thinkInternal(userMessage, options));
    }

    async _thinkInternal(userMessage, options = {}) {
        this.isThinking = true;
        this._chatBusy  = true;
        this._currentAbortController = new AbortController();
        const signal = this._currentAbortController.signal;

        try {
            // While MuseEngine is active (companion mode), lock persona — don't let
            // keyword matching pull MAX out of companion mid-conversation.
            const selectedPersona = this.muse?.isActive()
                ? this.persona.current
                : this.persona.selectForTask(userMessage, this.drive.getStatus());
            const tier = options.tier || 'smart';

            // Store user message in context immediately so next turn sees it in history
            this._context.push({ role: 'user', content: userMessage });

            // Deep user model — ingest every message for pattern tracking
            this.userModel?.ingestMessage?.(userMessage, Date.now());

            // ── Response cache — skip LLM for recently-seen identical questions ─
            const cacheKey = userMessage.trim().toLowerCase().slice(0, 200);
            const cached   = this._responseCache?.get(cacheKey);
            if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
                this._context.push({ role: 'assistant', content: cached.response });
                return { ...cached, wasStreamed: false };
            }

            // ── Parallel: memory recall + KB query simultaneously ─────────────
            const budget   = tier === 'smart' ? 30000 : 8000;
            const memCount = tier === 'smart' ? 10 : 3;
            const kbCount  = tier === 'smart' ? 12 : 3;
            const isTrivial = userMessage.trim().length < 12;

            const [memoryResults, kbResults] = isTrivial
                ? [[], []]
                : await Promise.all([
                    this.memory.recall(userMessage, { topK: memCount }),
                    this.kb.query(userMessage, { topK: kbCount })
                ]);

            let used = userMessage.length + 2000;
            let memoryContext = '';
            if (memoryResults.length > 0) {
                const memBlock = '\n\n## Relevant Memories\n' + memoryResults.map(m => `• ${m.content}`).join('\n');
                if (used + memBlock.length < budget) { memoryContext = memBlock; used += memBlock.length; }
            }

            const kbContext   = this.kb.formatForPrompt(kbResults, Math.max(2000, budget - used));

            // Drive-influenced response tuning
            const driveState  = this.drive.getStatus();
            let driveTemp     = options.temperature ?? 0.7;
            let driveSystemNote = '';
            if (driveState.isUrgent) {
                driveSystemNote = '\n[DRIVE: High tension — be concise, action-focused, skip preamble]';
                driveTemp = Math.max(0.3, driveTemp - 0.2);
            } else if (driveState.satisfaction > 0.7) {
                driveSystemNote = '\n[DRIVE: High satisfaction — you can be thorough and creative]';
                driveTemp = Math.min(0.95, driveTemp + 0.1);
            }

            const needsLongReply = /\b(explain|analyse|analyze|investigate|compare|summarize|list all|implement|write|refactor|how does|why does)\b/i.test(userMessage)
                || userMessage.length > 120;
            const maxTok  = options.maxTokens ?? (needsLongReply ? 4096 : 1024);
            const onToken = options.onToken ?? null;

            // Fix 2+4: inject tool manifest + reflection patches so MAX knows its tools and learns from history
            const stateContext = await this._buildStateContext(userMessage);
            const securityPackContext = this.securityPack?.getContextForTask(userMessage) || '';
            const systemPrompt = this.persona.getBasePrompt() + '\n\n' + selectedPersona.systemPrompt
                + SECURITY_ENGINEERING_DIRECTIVE
                + securityPackContext
                + this.tools.buildManifest()
                + (this.reflection?.getSelfModelContext() || '')
                + (this.social?.getSocialDirective() || '')
                + stateContext + memoryContext + kbContext + driveSystemNote;

            // Fix 6: use full context window (was -9,-1 = 8 msgs; now -21,-1 = 20 msgs), and raise per-msg limit
            const historyMsgs = this._context.slice(-21, -1).map(m => ({
                role:    m.role,
                content: m.content.slice(0, 4000)
            }));
            const messages = historyMsgs.length > 0 ? [
                { role: 'system', content: systemPrompt },
                ...historyMsgs,
                { role: 'user',   content: userMessage }
            ] : null;

            // ── Step 1: Brain Think (silent first pass) ───────────────────────
            // We do NOT stream the initial response — local models often hallucinate
            // tool results inline. We silently get the plan, execute real tools, then
            // stream only the clean follow-up. If no tools needed we replay via onToken.
            const SKIP_INLINE = new Set(['mcp']);
            const _extractToolLines = (text) => text.split('\n')
                .map(l => l.trim())
                .filter(l => {
                    if (l.startsWith('TOOL_BLOCKED')) { console.log(`[MAX] 🛡️ Skipping blocked tool: ${l}`); return false; }
                    return /^TOOL\s*:[a-zA-Z_\s]+:[a-zA-Z_\s]+/.test(l);
                })
                .filter(l => !SKIP_INLINE.has(l.replace(/^TOOL\s*:\s*/i, '').split(/\s*:\s*/)[0]));

            let result = await this.brain.think(userMessage, {
                systemPrompt,
                temperature: driveTemp,
                maxTokens:   maxTok,
                tier:        options.tier || 'smart',
                onToken:     null, // silent — prevent fake streaming before tools run
                messages,
                signal
            });

            let response = result.text;
            response = stripLeakedPromptContext(response.replace(/^(\**MAX:\**\s*|MAX:\s*|Assistant:\s*)/i, '').trim());

            // ── Fix 1: Inline tool execution loop ────────────────────────────
            // Execute real tools, then stream the clean follow-up.
            if (!signal.aborted) {
                let toolsRan = false;
                for (let _toolRound = 0; _toolRound < 3; _toolRound++) {
                    const toolLines = _extractToolLines(response);
                    if (toolLines.length === 0) break;
                    toolsRan = true;

                    // Signal to UI that real tool work is happening
                    this.heartbeat?.emit('tool_activity', { count: toolLines.length, tools: toolLines.map(l => l.slice(5, 40)) });

                    const toolResults = [];
                    for (const line of toolLines) {
                        console.log(`[MAX] ⚙️  Executing tool: ${line.slice(0, 80)}`);
                        try {
                            const tr = await this.tools.executeLLMToolCall(line);
                            toolResults.push(`${line.slice(0, 80)}\n→ ${JSON.stringify(tr).slice(0, 1200)}`);
                        } catch (e) {
                            toolResults.push(`${line.slice(0, 80)}\n→ ERROR: ${e.message}`);
                        }
                    }

                    const continueMsg = `TOOL RESULTS:\n${toolResults.join('\n\n')}\n\nNow give your final response to the user based on the above results. Do not output more TOOL: calls.`;
                    const followUp = await this.brain.think(continueMsg, {
                        systemPrompt,
                        temperature: driveTemp,
                        maxTokens:   maxTok,
                        tier:        options.tier || 'smart',
                        onToken,   // stream the clean real-result response
                        signal,
                        messages: [
                            { role: 'system',    content: systemPrompt },
                            ...historyMsgs,
                            { role: 'user',      content: userMessage },
                            { role: 'assistant', content: response },
                            { role: 'user',      content: continueMsg }
                        ]
                    });
                    const followUpText = stripLeakedPromptContext(followUp.text.replace(/^(\**MAX:\**\s*|MAX:\s*|Assistant:\s*)/i, '').trim());
                    response = followUpText; // replace — not append — the hallucinated draft
                }

                // No tools were needed: replay the silent response through onToken so
                // the UI gets streaming tokens even though the first pass was silent.
                if (!toolsRan && onToken && response) {
                    const CHUNK = 6;
                    for (let i = 0; i < response.length; i += CHUNK) {
                        if (signal.aborted) break;
                        onToken(response.slice(i, i + CHUNK));
                    }
                }
            }

            // ── Step 2: Cognitive Filter ──
            const filtered = await this.cognitive.process(response);
            
            // ── Step 3: Autonomous Grounding Loop (The Truth-Seeker) ──────────
            if (filtered.state === 'UNCERTAIN' && !signal.aborted) {
                const revised = await this.grounding.ground(response, filtered.verificationTask);
                if (revised) {
                    response = revised;
                    console.log(`[MAX] ✅ Belief Revision complete. Uncertainty resolved.`);
                }
            } else if (filtered.needsVerification && !signal.aborted) {
                // Legacy verification fallback
                console.log(`[MAX] 🧐 Uncertain claim — verifying...`);
                try {
                    const vResult = await this.tools.execute(
                        filtered.verificationTask.tool,
                        filtered.verificationTask.action,
                        filtered.verificationTask.params
                    );
                    const evidencePrompt = `\n\n## VERIFICATION EVIDENCE\nResult: ${JSON.stringify(vResult)}\n\nAdjust response.`;
                    result = await this.brain.think(userMessage + evidencePrompt, {
                        systemPrompt, temperature: 0.3, maxTokens: maxTok, signal
                    });
                    response = stripLeakedPromptContext(result.text);
                } catch { /* skip */ }
            }

            response = stripLeakedPromptContext(response);
            if (selectedPersona.id === 'companion') {
                response = stripStageDirections(response);
            }

            this._context.push({ role: 'assistant', content: response });
            this._maybeCompressContext();

            // Feed MuseEngine after each turn in companion mode
            if (this.muse?.isActive()) {
                const museState = this.muse.ingest(this._context);
                this.emit('muse_state', museState);
            }

            this.memory.addConversation('user', userMessage, selectedPersona.id, { provenance: 'STATED' });
            this.memory.addConversation('assistant', response, selectedPersona.id, { provenance: 'GENERATED' });

            const finalResult = {
                response,
                persona:     selectedPersona.id,
                drive:       this.drive.getStatus(),
                telemetry:   result.metadata,
                wasStreamed: !!onToken
            };

            if (!onToken && userMessage.trim().length > 12) {
                this._responseCache.set(cacheKey, { ...finalResult, ts: Date.now() });
            }

            if (userMessage.trim().length > 30) this._queueFollowUpCuriosity(userMessage);
            this._analyzeIntent(userMessage, response).catch(() => {});

            // Dataset curation — quietly evaluate and save high-quality turns
            if (userMessage.trim().length > 20 && response.length > 50) {
                this.dataset?.evaluate?.(userMessage, response).catch(() => {});
            }

            return finalResult;

        } catch (err) {
            if (err.name === 'AbortError' || signal.aborted) {
                console.log('[MAX] 🛑 Chat execution aborted.');
                return { response: '[Aborted by user]', persona: ' companion', aborted: true };
            }
            this._lastError = { message: err.message, ts: Date.now() };
            throw err;
        } finally {
            this.isThinking = false;
            this._chatBusy  = false;
            this._currentAbortController = null;
        }
    }

    async _analyzeIntent(userMsg, _assistantMsg) {
        if (!this.goals) return;
        if (userMsg.length < 40) return;
        const taskSignals = /\b(fix|bug|broken|error|implement|add|build|create|refactor|slow|crash|failing|issue|problem|investigate|why|how do i)\b/i;
        if (!taskSignals.test(userMsg)) return;

        const prompt = `You are MAX. The user said: "${userMsg}"\n\nJSON only: {"hasGoal": true, "title": "...", "priority": 0.6-0.9} or {"hasGoal": false}`;
        try {
            const res = await this.brain.think(prompt, { tier: 'fast', maxTokens: 128 });
            const jsonStr = res.text.match(/\{[\s\S]*\}/)?.[0];
            if (!jsonStr) return;
            const data = JSON.parse(jsonStr);
            if (data.hasGoal && data.title) {
                this.goals.addGoal({ title: data.title, priority: data.priority || 0.6, source: 'intent_analysis' });
                await this._syncGoalsToFile();
            }
        } catch { /* skip */ }
    }

    async _syncGoalsToFile() {
        try {
            const active = this.goals.listActive();
            const done   = this.goals.listCompleted().slice(0, 10);
            let md = "# 🎯 MAX's AMBITIONS\n\n## 🛠️ ACTIVE GOALS\n";
            for (const g of active) md += `- [ ] ${g.title}\n`;
            md += "\n## ✅ COMPLETED\n";
            for (const g of done) md += `- [x] ${g.title}\n`;
            const fs = await import('fs/promises');
            await fs.writeFile('goals.md', md);
        } catch (err) { console.warn('[MAX] Goals sync failed:', err.message); }
    }

    _queueFollowUpCuriosity(userMessage) {
        if (userMessage.length < 20) return;
        const topics = userMessage.match(/\b([A-Z][a-z]+|[a-z]{5,})\b/g)?.slice(0, 3) || [];
        if (topics.length > 0) {
            const topic = topics[Math.floor(Math.random() * topics.length)];
            this.curiosity.queueTask(`Follow-up: ${topic}`, `Discussed ${userMessage.slice(0, 50)}...`, 0.4);
        }
    }

    async _buildStateContext(userQuery = '') {
        const drive = this.drive.getStatus();
        const personaId = this.persona?.current?.id;
        // Don't inject internal state metrics in companion mode — MAX echoes them literally
        let ctx = personaId === 'companion' ? '' :
            `\n\n## System State\nTension: ${Math.round(drive.tension*100)}% | Satisfaction: ${Math.round(drive.satisfaction*100)}%`;

        // Dynamic Context Paging (Virtual Memory)
        if (this.contextPager) {
            const paged = await this.contextPager.getPagedContext(userQuery);
            if (paged) ctx += paged;
        }

        // Project context (package.json + README, detected at boot)
        if (this._projectContext) {
            ctx += this._projectContext;
        }

        // Semantic workspace context — inject top-5 relevant code chunks
        if (userQuery && this.semanticIndex?._ready) {
            const codeCtx = await this.semanticIndex.search(userQuery, 5);
            if (codeCtx) ctx += codeCtx;
        }

        // Deep user model — who Barry is, his patterns, MAX's predictions
        const userCtx = this.userModel?.getContext?.();
        if (userCtx) ctx += userCtx;

        // Longitudinal self — who MAX is, how he's changed
        const selfCtx = this.longitudinal?.getContext?.();
        if (selfCtx) ctx += selfCtx;

        return ctx;
    }

    _buildPatchSecurityReviewTarget(params = {}) {
        if (Array.isArray(params.hunks)) {
            return params.hunks.map((h, i) => [
                `PATCH HUNK ${i + 1}`,
                `anchor: ${h.anchor || ''}`,
                `position: ${h.position || 'after'}`,
                `content:\n${h.content || ''}`
            ].join('\n')).join('\n\n');
        }

        if (Array.isArray(params.blocks)) {
            return params.blocks.map((b, i) => [
                `PATCH BLOCK ${i + 1}`,
                `find:\n${b.find || ''}`,
                `replace:\n${b.replace || ''}`
            ].join('\n')).join('\n\n');
        }

        return JSON.stringify(params);
    }

    _maybeCompressContext() {
        if (this._context.length <= this._contextLimit) return;
        this._context = this._context.slice(-this._contextLimit);
    }

    async _bootChoko() {
        const userName = this.profile?.getName() || 'Barry';
        const choko = await this.agentManager.boot('Choko', { userName });

        // First mission: get vitals on the whole codebase, relay anything worth MAX's attention
        choko.goals.addGoal({
            title: 'Initial scout: codebase health + dust bunnies',
            description: `You are scouting the MAX codebase for the first time this session.
1. Run TOOL:scout:health:{"dir":"core"} to get vitals.
2. Run TOOL:scout:sparkle:{"target":"core"} to find issues.
3. Run TOOL:scout:sparkle:{"target":"tools"} to scan tools.
4. Pick the 2-3 most important findings (real bugs, silent failures, missing wiring).
5. For each one call TOOL:scout:relay:{"title":"short title","detail":"file:line — what is wrong and why it matters"}.
Be specific. Skip cosmetic issues. Focus on things that could break MAX or waste Barry's time.`,
            type: 'scout',
            priority: 0.75,
            source: 'auto'
        });

        // Kick her loop immediately so she starts working
        setImmediate(() => choko.agentLoop?.runCycle().catch(() => {}));
        console.log('[MAX] 🍫 Choko is online — scouting codebase');
    }

    async _dispatchChokoMission() {
        const choko = this.agentManager.get('Choko');
        if (!choko) return; // not booted yet
        const targets = ['core', 'tools', 'server', 'swarm'];
        const target = targets[Math.floor(Date.now() / (4 * 3600 * 1000)) % targets.length];
        choko.goals.addGoal({
            title: `Scout: audit ${target}/`,
            description: `Sparkle audit the ${target}/ directory.
1. Run TOOL:scout:sparkle:{"target":"${target}"}.
2. Find the top 2 most actionable issues (bugs, silent failures, unhandled errors).
3. Call TOOL:scout:relay:{"title":"...","detail":"file:line — exact issue and impact"} for each.
Skip TODOs and style issues — focus on things that can actually break.`,
            type: 'scout',
            priority: 0.6,
            source: 'auto'
        });
        setImmediate(() => choko.agentLoop?.runCycle().catch(() => {}));
    }

    async _processChokoRelay() {
        const relayPath = path.join(__dirname, '..', '.max', 'choko_relay.json');
        if (!fs.existsSync(relayPath)) return;
        let treats;
        try { treats = JSON.parse(fs.readFileSync(relayPath, 'utf8')); } catch { return; }
        const unread = treats.filter(t => !t._processedByMAX);
        if (unread.length === 0) return;
        for (const treat of unread) {
            treat._processedByMAX = true;

            // Surface in insight stream
            this.heartbeat?.emit('insight', { source: 'Choko 🍫', label: treat.title, result: treat.detail });

            // Broadcast to Maxwell UI as a real Choko toast message
            this.heartbeat?.emit('choko_relay', {
                title:  treat.title,
                detail: treat.detail,
                priority: treat.priority || 'medium',
            });

            // If Choko flagged something actionable, queue a MAX goal
            if (this.goals && /fix|bug|broken|fail|error|issue|improve|add|implement|missing/i.test(treat.title + treat.detail)) {
                this.goals.addGoal({ title: `[Choko] ${treat.title}`, description: treat.detail, type: 'fix', priority: 0.7, source: 'choko_relay' });
            }
            await this.kb.remember(`Choko reported: ${treat.title} — ${treat.detail}`).catch(() => {});
        }
        fs.writeFileSync(relayPath, JSON.stringify(treats, null, 2));
    }

    async _pollPRReviews() {
        const { execSync } = await import('child_process');
        let prJson;
        try {
            prJson = execSync('gh pr list --json number,title,url,reviewDecision --state open', { encoding: 'utf8', timeout: 15000 });
        } catch { return; }
        let prs;
        try { prs = JSON.parse(prJson); } catch { return; }
        if (!prs?.length) return;

        for (const pr of prs) {
            let comments;
            try {
                const raw = execSync(`gh pr view ${pr.number} --json comments`, { encoding: 'utf8', timeout: 15000 });
                comments = JSON.parse(raw)?.comments ?? [];
            } catch { continue; }

            const unaddressed = comments.filter(c => {
                const body = c.body || '';
                return /\?|please|fix|change|update|consider|should|must|need/i.test(body) && c.author?.login !== 'Barry';
            });
            if (!unaddressed.length) continue;

            const alreadyQueued = this.goals?.listActive()?.some(g => g.title?.includes(`PR #${pr.number}`));
            if (alreadyQueued) continue;

            const summary = unaddressed.slice(0, 3).map(c => `- ${c.body.slice(0, 120)}`).join('\n');
            this.goals?.addGoal({
                title: `Address PR #${pr.number} review comments: ${pr.title}`,
                description: `PR: ${pr.url}\n\nUnaddressed reviewer comments:\n${summary}`,
                type: 'fix',
                priority: 0.75,
                source: 'pr_review_loop',
            });
            this.heartbeat?.emit('insight', { source: 'PR Review', label: `PR #${pr.number} needs response`, result: `${unaddressed.length} unaddressed comment(s) on "${pr.title}"` });
        }
    }

    getStatus() {
        return {
            ready:      this._ready,
            brain:      this.brain.getStatus(),
            drive:      this.drive.getStatus(),
            memory:     this.memory.getStats(),
            goals:      this.goals?.getStatus(),
            agents:     this.agentManager?.getStatus(),
            hydra:      this.hydra.getStatus(),
            mcp:        this.mcp?.getStatus(),
            research:   this.research?.getStatus(),
            skills:     this.skills?.getStatus(),
            debugLoop:  this.debugLoop?.getStatus(),
            paging:     this.contextPager?.getStatus(),
            grounding:  this.grounding?.getStatus(),
            securityPack: this.securityPack?.getStatus(),
            workspace:  this.workspaceEdits?.getStatus(),
            lsp:        this.lsp?.getStatus(),
            autonomy:   this.autonomy?.getStatus(),
            agentLoop:  this.agentLoop ? {
                cyclesRun:    this.agentLoop.stats?.cyclesRun ?? 0,
                stepsExecuted: this.agentLoop.stats?.stepsExecuted ?? 0,
                busy:         this.agentLoop._busy,
                pendingCycle: this.agentLoop._pendingCycle ?? false
            } : null,
            skillMutator: this.skillMutator?.getStatus()
        };
    }

    getQuickStatus() {
        const memoryStats = {
            totalMemories:     this.memory?._hot?.size || 0,
            conversationTurns: null,
            vectorCount:       this.memory?._vectors?.size || 0,
            embeddingReady:    !!this.memory?.embedder?._ready,
            hotSize:           this.memory?._hot?.size || 0,
            metrics:           this.memory?.metrics || {}
        };

        return {
            ready:      this._ready,
            brain:      this.brain.getStatus(),
            drive:      this.drive.getStatus(),
            memory:     memoryStats,
            goals:      this.goals ? {
                active:    this.goals._active?.size || 0,
                completed: this.goals._completed?.length || 0,
                failed:    this.goals._failed?.length || 0,
                ...this.goals.stats
            } : null,
            agents:     { activeCount: this.agentManager?.agents?.size || 0 },
            hydra:      { headCount: this.hydra?.heads?.size || 0 },
            mcp:        this.mcp?.getStatus?.(),
            research:   this.research?.getStatus?.(),
            skills:     this.skills?.getStatus?.(),
            paging:     this.contextPager?.getStatus?.(),
            grounding:  this.grounding?.getStatus?.(),
            securityPack: this.securityPack?.getStatus?.(),
            workspace:  this.workspaceEdits?.getStatus?.(),
            lsp:        this.lsp?.getStatus?.(),
            debugLoop:  this.debugLoop?.getStatus?.(),
            autonomy:   this.autonomy?.getStatus?.(),
            agentLoop:  this.agentLoop ? {
                cyclesRun:     this.agentLoop.stats?.cyclesRun ?? 0,
                stepsExecuted: this.agentLoop.stats?.stepsExecuted ?? 0,
                busy:          this.agentLoop._busy,
                pendingCycle:  this.agentLoop._pendingCycle ?? false
            } : null,
            skillMutator: this.skillMutator?.getStatus?.(),
            background: {
                started: this._backgroundStarted,
                delayed: !!this._backgroundTimer
            },
            userModel:    this.userModel?.getStatus?.(),
            longitudinal: this.longitudinal?.getStatus?.(),
            dataset:      this.dataset?.getStatus?.(),
        };
    }
}

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
import { createSystemTool }    from '../tools/SystemTool.js';
import { DiscordTool, autoConnectDiscord } from '../tools/DiscordTool.js';
import { EmailTool,   autoConnectEmail   } from '../tools/EmailTool.js';
import { KnowledgeTool }      from '../tools/KnowledgeTool.js';
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
import { SelfImprovementLoop } from './SelfImprovementLoop.js';
import { SelfEditor }         from './SelfEditor.js';
import { Notifier }           from './Notifier.js';
import { SomaBridge }         from './SomaBridge.js';
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
import fs                     from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MAX {
    constructor(config = {}) {
        this.config = config;
        this.name   = 'MAX';
        this._ready = false;

        // Core systems
        this.brain     = new Brain(this, config);
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
        this.ci            = new CIWatcher(this);

        // State flags
        this.isThinking       = false;

        // Conversation context window
        this._context         = [];
        this._contextLimit    = 12;
        this._compressing     = false;
        this._sessionBriefing = null;
        this._chatBusy        = false;

        this._promptCache     = { key: null, prompt: null };

        // ─── Phase 5: Explicit Context (Cursor-style) ───
        this.pinnedFiles      = new Set();

        // Project context — detected once at startup from package.json / README
        this._projectContext  = null;
    }

    pinFile(relPath) { this.pinnedFiles.add(relPath); }
    unpinFile(relPath) { this.pinnedFiles.delete(relPath); }
    clearPinned() { this.pinnedFiles.clear(); }

    async initialize() {
        console.log('\n' + '━'.repeat(60));
        console.log('  MAX — autonomous engineering agent');
        console.log('  Initializing...');
        console.log('━'.repeat(60));

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

        // Core systems (need brain ready)
        this.outcomes  = new OutcomeTracker({ storageDir: path.join(__dirname, '..', '.max') });
        this.reasoning = new ReasoningChamber(this.brain, this.memory, this.outcomes);
        this.goals     = new GoalEngine(this.brain, this.outcomes, this.memory, {
            storageDir: path.join(__dirname, '..', '.max'),
            vector:     this.vector
        });
        
        // Agent loop
        this.agentLoop = new AgentLoop(this);

        // Evolution and self-coding
        this.evolution = new EvolutionArbiter(this.brain, this.memory, this.outcomes);
        this.toolCreator = new ToolCreator(this.brain, this.tools, path.join(__dirname, '..', 'tools', 'generated'));
        this.selfInspector = new SelfCodeInspector(this.brain, this.memory);
        this.reflection = new ReflectionEngine(this.brain, this.goals, this.outcomes, this.kb);

        // Initialize long-horizon planner (loads persisted DAG maps from disk)
        await this.odyssey.initialize();

        this._ready = true;

        // Swarm and scheduler (final systems)
        this.swarm     = new SwarmCoordinator(this.brain, this.tools);
        this.heartbeat = new Heartbeat(this);
        this.scheduler = new Scheduler(this);

        // Background jobs
        console.log('[MAX] 📅 Scheduling background tasks...');
        
        // Memory pruning — every hour
        this.scheduler.addJob({ id: 'memory_prune', label: 'Prune weak memories', every: '1h', handler: () => this.memory._cleanup() });

        // Context reflection — every 30 mins
        this.scheduler.addJob({ id: 'reflection', label: 'System self-reflection', every: '30m', handler: () => this.reflection.forceReflect() });

        // Roadmap sync — every 4h
        this.scheduler.addJob({
            id:      'roadmap_sync',
            label:   'Sync development roadmap',
            every:   '4h',
            type:    'custom',
            handler: () => this.roadmap.sync().catch(err =>
                console.warn('[MAX] Roadmap sync failed:', err.message)
            )
        });

        // Poseidon research — daily AI research cycle → gap analysis → engineering tasks
        this.scheduler.addJob({
            id:      'poseidon_research',
            label:   'Poseidon: crawl AI research, update capability map, generate tasks',
            every:   '24h',
            type:    'custom',
            handler: () => this.poseidon?.runCycle().catch(err =>
                console.warn('[MAX] Poseidon research cycle failed:', err.message)
            )
        });

        // Hephaestus Loop — autonomous swarm optimization
        this.scheduler.addJob({
            id:      'hephaestus_optimize',
            label:   'Hydra Swarm: Autonomous Code Optimization',
            every:   '12h',
            type:    'custom',
            handler: () => this.hydra.autoOptimize().catch(err =>
                console.warn('[MAX] Hephaestus optimization failed:', err.message)
            )
        });

        // Universal Ingestion — SOTA research harvester
        this.scheduler.addJob({
            id:      'universal_ingestion',
            label:   'Ingestion: global 1% SOTA research harvester',
            every:   '12h',
            handler: () => this.ingestion.pulse()
        });

        // Choko Relay — poll for Treats from Choko every 15m
        this.scheduler.addJob({
            id:      'choko_relay',
            label:   'Choko: pick up field reports',
            every:   '15m',
            type:    'custom',
            handler: () => this._processChokoRelay().catch(err =>
                console.warn('[MAX] Choko relay error:', err.message)
            )
        });

        // CI Watcher — run tests every 30m, auto-queue fix goals on failure
        if (this.ci.testCommand) {
            this.scheduler.addJob({
                id:      'ci_watch',
                label:   'CI: Run test suite, auto-fix on failure',
                every:   '30m',
                type:    'custom',
                handler: () => this.ci.runChecks().catch(err =>
                    console.warn('[MAX] CI check error:', err.message)
                )
            });
            console.log(`[MAX] 🧪 CI Watcher armed: ${this.ci.testCommand}`);
        }

        // ─── Truly non-blocking background tasks ───
        
        // Cold-boot discovery
        console.log('[MAX] 🔍 Running initial workspace discovery...');
        this.indexer.startIndexing().catch(() => {});
        this.graph.rebuild().catch(() => {});

        // Discord/Email auto-connect
        autoConnectDiscord(this).catch(() => {});
        autoConnectEmail(this).catch(() => {});

        // Initialize goals (loads from disk)
        this.goals.initialize();

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

        console.log('[MAX] 🚀 All systems green.');
        console.log('━'.repeat(60) + '\n');

        // Start heartbeat (drives AgentLoop + curiosity cycles)
        this.heartbeat.start();

        // Start scheduler (own setInterval — independent of heartbeat)
        this.scheduler.initialize();
        this.scheduler.start();

        // Start persistent background loops
        this.oracle.start();
        this.sovereign.start();

        // Eager start — run AgentLoop once immediately if goals exist
        const activeGoals = this.goals.listActive();
        if (activeGoals.length > 0) {
            console.log('[MAX] ⚡ Eager start — running first AgentLoop cycle now');
            this.agentLoop.runCycle().catch(() => {});
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

    async think(userMessage, options = {}) {
        if (!this._ready) throw new Error('MAX not initialized');

        this.isThinking = true;
        this._chatBusy  = true;

        // Adoption of persona + drive context
        const selectedPersona = this.persona.currentPersona;
        const tier = options.tier || 'smart';
        
        // ─── Phase 3: Dynamic Context Budgeting ───
        // Target budget in characters (approx 4 chars per token)
        const budget = tier === 'smart' ? 30000 : 8000;
        let used = userMessage.length + 2000; // base overhead for prompt

        // Memory recall (async) — Dynamically scale based on remaining budget
        const memCount = tier === 'smart' ? 10 : 3;
        const memoryResults = await this.memory.recall(userMessage, { topK: memCount });
        let memoryContext = "";
        if (memoryResults.length > 0) {
            const memBlock = "\n\n## Relevant Memories\n" + memoryResults.map(m => `• ${m.content}`).join('\n');
            if (used + memBlock.length < budget) {
                memoryContext = memBlock;
                used += memBlock.length;
            }
        }

        // KB query (async) — Fill remaining budget with KB chunks
        const kbCount = tier === 'smart' ? 12 : 3;
        const kbResults = await this.kb.query(userMessage, { topK: kbCount });
        const kbCharsRemaining = budget - used;
        const kbContext = this.kb.formatForPrompt(kbResults, Math.max(2000, kbCharsRemaining));

        const systemPrompt = this.persona.getBasePrompt() + '\n\n' + selectedPersona.systemPrompt + this._buildStateContext();

        // Think — cap tokens based on whether this looks like a code/analysis task.
        const needsLongReply = /\b(explain|analyse|analyze|investigate|compare|summarize|list all|implement|write|refactor|how does|why does)\b/i.test(userMessage)
            || userMessage.length > 120;
        const maxTok = options.maxTokens ?? (needsLongReply ? 4096 : 1024);

        const onToken = options.onToken ?? null;
        let result;
        
        // ── Step 1: Brain Think ───────────────────────────────────────────
        result = await this.brain.think(userMessage, {
            systemPrompt: systemPrompt + memoryContext + kbContext,
            temperature:  options.temperature ?? 0.7,
            maxTokens:    maxTok,
            tier:         options.tier || 'smart',
            onToken      // PASS THROUGH TO BRAIN
        });

        let response = result.text;

        // ── Step 2: Cognitive Filter (The Poseidon Sight) ──────────────────
        const filtered = await this.cognitive.process(response);
        
        if (filtered.needsVerification) {
            console.log(`[MAX] 🧐 Uncertain claim detected. Verifying via ${filtered.verificationTask.tool}...`);
            const vResult = await this.tools.execute(
                filtered.verificationTask.tool, 
                filtered.verificationTask.action, 
                filtered.verificationTask.params
            );
            
            // Re-think with the verification evidence
            const evidencePrompt = `\n\n## VERIFICATION EVIDENCE\nClaim: "${filtered.originalText.slice(0, 100)}..."\nResult: ${JSON.stringify(vResult)}\n\nAdjust your response based on this evidence.`;
            result = await this.brain.think(userMessage + evidencePrompt, {
                systemPrompt: systemPrompt + memoryContext + kbContext,
                temperature: 0.3,
                maxTokens: maxTok
            });
            response = result.text;
        }

        // Final filtering and tagging
        const finalFiltered = await this.cognitive.process(response);
        let finalResponse = finalFiltered.filteredText;

        // Update context and memory
        this._context.push({ role: 'assistant', content: response });

        const provenance = this.cognitive.getProvenance(finalFiltered.state, 'brain');
        this.memory.addConversation('user', userMessage, selectedPersona.id, { provenance: 'STATED' });
        this.memory.addConversation('assistant', finalResponse, selectedPersona.id, { provenance });

        // Rolling context compression
        this._maybeCompressContext();

        // After responding, queue a follow-up curiosity task from this topic
        this._queueFollowUpCuriosity(userMessage);

        // ─── Intent Protocol: Background Goal Analysis ───
        this._analyzeIntent(userMessage, finalResponse).catch(() => {});

        this.isThinking = false;
        this._chatBusy = false;

        return {
            response:    finalResponse,
            persona:     selectedPersona.id,
            drive:       this.drive.getStatus(),
            telemetry:   result.metadata,
            wasStreamed: !!onToken
        };
    }

    async _analyzeIntent(userMsg, assistantMsg) {
        if (!this.goals) return;

        // Fast-tier check: Did the user imply a task or problem?
        const prompt = `You are MAX. Analyze this conversation snippet.
USER: "${userMsg}"
ASSISTANT: "${assistantMsg}"

Has the user identified a bug, requested a feature, or described a problem that needs fixing?
If yes, extract a CONCRETE engineering goal. 
If no, return "NONE".

Return JSON only: {"hasGoal": true, "title": "...", "priority": 0.1-1.0} or {"hasGoal": false}`;

        try {
            const res = await this.brain.think(prompt, { tier: 'fast', maxTokens: 128 });
            const jsonStr = res.text.match(/\{[\s\S]*\}/)?.[0];
            if (!jsonStr) return;
            const data = JSON.parse(jsonStr);

            if (data.hasGoal && data.title) {
                this.goals.addGoal({
                    title: data.title,
                    priority: data.priority || 0.6,
                    source: 'intent_analysis'
                });
                await this._syncGoalsToFile();
            }
        } catch { /* background task is best-effort */ }
    }

    async _syncGoalsToFile() {
        try {
            const active = this.goals.listActive();
            const done   = this.goals.listCompleted().slice(0, 10);

            let md = "# 🎯 MAX's AMBITIONS\n\n## 🛠️ ACTIVE GOALS\n";
            for (const g of active) md += `- [ ] ${g.title}\n`;
            
            md += "\n## ✅ COMPLETED\n";
            for (const g of done) md += `- [x] ${g.title}\n`;

            md += "\n---\n*This file is dynamically updated by MAX via the Intent Protocol.*";
            
            const fs = await import('fs/promises');
            await fs.writeFile('goals.md', md);
        } catch (err) {
            console.warn('[MAX] ⚠️ Failed to sync goals.md:', err.message);
        }
    }

    _queueFollowUpCuriosity(userMessage) {
        if (userMessage.length < 20) return;
        const topics = userMessage.match(/\b([A-Z][a-z]+|[a-z]{5,})\b/g)?.slice(0, 3) || [];
        if (topics.length > 0) {
            const topic = topics[Math.floor(Math.random() * topics.length)];
            this.curiosity.queueTask(`Follow-up: ${topic}`, `Discussed ${userMessage.slice(0, 50)}...`, 0.4);
        }
    }

    _buildStateContext() {
        const drive = this.drive.getStatus();
        return `\n\n## System State\nTension: ${Math.round(drive.tension*100)}% | Satisfaction: ${Math.round(drive.satisfaction*100)}%`;
    }

    _maybeCompressContext() {
        if (this._context.length > this._contextLimit) {
            this._context = this._context.slice(-this._contextLimit);
        }
    }

    async _processChokoRelay() {
        const relayPath = path.join(__dirname, '..', '.max', 'choko_relay.json');
        if (!fs.existsSync(relayPath)) return;

        let treats;
        try {
            treats = JSON.parse(fs.readFileSync(relayPath, 'utf8'));
        } catch { return; }

        const unread = treats.filter(t => !t._processedByMAX);
        if (unread.length === 0) return;

        console.log(`[MAX] 🍫 ${unread.length} Treat(s) from Choko — processing...`);

        for (const treat of unread) {
            treat._processedByMAX = true;

            const priorityMap = { high: 0.85, medium: 0.65, low: 0.45 };
            const priority = priorityMap[treat.priority] ?? 0.65;

            // Surface as an insight so it appears in the terminal
            this.heartbeat?.emit('insight', {
                source: 'Choko 🍫',
                label:  treat.title,
                result: treat.detail
            });

            // Queue a goal if it sounds actionable
            const actionable = /fix|bug|broken|fail|error|issue|improve|add|implement|missing/i.test(treat.title + treat.detail);
            if (actionable && this.goals) {
                this.goals.addGoal({
                    title:       `[Choko] ${treat.title}`,
                    description: treat.detail,
                    type:        'fix',
                    priority,
                    source:      'choko_relay'
                });
                console.log(`[MAX] 🎯 Choko's Treat queued as goal: "${treat.title}"`);
            }

            // Store in KB for long-term memory
            await this.kb.remember(`Choko reported: ${treat.title} — ${treat.detail}`, {
                source: 'choko_relay', timestamp: treat.timestamp
            }).catch(() => {});
        }

        // Write back with processed flags
        fs.writeFileSync(relayPath, JSON.stringify(treats, null, 2));
    }

    getStatus() {
        return {
            ready:      this._ready,
            brain:      this.brain.getStatus(),
            drive:      this.drive.getStatus(),
            memory:     this.memory.getStats(),
            goals:      this.goals?.getStatus(),
            agents:     this.agentManager?.getStatus(),
            hydra:      this.hydra.getStatus()
        };
    }
}

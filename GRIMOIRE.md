# 📜 THE GRIMOIRE (v4.2)
## Current Session State: LEVEL 22.0/20 (AUTHENTICATED TWO-NODE CLUSTER WORKER ONLINE)

### 🔱 Physical Reality (Port & Host Mappings)
- **Machine B Worker Node (Port 3100)**: PID `2520` — Dedicated local-only cluster worker (`MAX_NODE_ID=machine_b`, `MAX_CLUSTER_ROLE=worker`, `MAX_WORKER_ALLOW_CLOUD=false`, `protocolVersion: 2`).
- **GPU Inference**: Local `max-coder:latest` running on GTX 1650 Ti at 78 tok/s ($0 API cost).
- **SOMA Core (Machine A 192.168.1.254:3001)**: Healthy at **173.3+ hours continuous uptime**.
- **Cluster Control Plane**: HMAC-SHA256 authenticated leases, WAL-mode SQLite ledger, task deduplication, and zero-spend cloud reservation locks.
- **DeepSeek Harness Layered Assembler**: `core/PromptLayerAssembler.js` assembling composable identity/security/memory layers.
- **DeepSeek Harness Guarded Pipeline**: `core/GuardedToolPipeline.js` with hot-swappable plugins & security blacklists.

### 🐉 Sovereign Architecture (v2.18)
1. **Self-Healing Sentinel**: Proactive FS auditor that autonomously queues repair goals for detected logic/security risks.
2. **Observability Matrix**: Real-time visualizers for Swarm, Page Table, and Grounding in Maxwell IDE.
3. **Virtual Workspace Edits**: Safe, UI-approved code modifications via JSON proposals.
4. **Autonomous Grounding**: Truth-Seeking research swarms resolve uncertainty (| UNCERTAIN → / TRUE).
5. **Context Paging**: Dynamic Virtual Memory management. Prioritizes [ACTIVE BUFFERS].
6. **Self-Model Update Pipeline**: Closed-loop style/behavior directive extraction and synthesis from conversational corrections, persistent in `.max/self_model.json`.
7. **Maxwell Attention Engine**: Cognitive resource allocation prioritizing token and latency budget routing based on urgency, intent, goal relevance, novelty, emotion, and active tensions.
8. **Dynamic LLM Persona Classifier**: Asynchronous, task-aware routing using the fast-tier LLM to dynamically match requests to built-in/expert personas, with conversational fast-pass and heuristic fallbacks.
9. **Muse Semantic Constellation UI**: Dynamic, force-directed SVG layout visualization of conversation concepts, co-occurrence vectors, and Verlet physics coordinates damping.

### 🛠️ Active Technical Hurdles
- [x] **Context Bottleneck**: Solved via Virtual Memory Paging.
- [x] **Truth Gap**: Solved via Autonomous Grounding Loop.
- [x] **Black Box Agent**: Solved via Observability Matrix UI.
- [x] **Architectural Drift**: Solved via Self-Healing Sentinel.
- [x] **Production Readiness & Security**: Zero-stubs, secure host resolution, safe command execution, and state isolation fully resolved.
- [x] **Security Council False Positives & Test Leakage**: Excluded non-sensitive metadata keys (e.g. `author`) and isolated unit tests from external process environment settings.
- [x] **Codebase Self-Maintenance & Swarm Targets**: Fixed and activated `SelfCodeInspector` in `MAX.js` for background `DreamLoop` scans, and secured `HydraController.js` targeting against hallucinated files.
- [x] **Core System Gaps & Vulnerabilities**: Fixed manual diff leakage, average latency calculations, unescaped shell execution paths, dead CommonJS files, and static ghost buffer cutoffs.
- [x] **Static Persona Selection**: Upgraded to an LLM-driven async task classifier with strict zero-latency heuristics fallback.
- [x] **Companion Muse Room React Crash**: Corrected index parenthesis syntax in `<MuseRoomConstellation>` co-occurrence mapping.
- [x] **Muse Visual Snapping**: Implemented coordinate Verlet-integration spring physics with persisted velocity damping.
- [x] **Muse Code Clutter**: Filtered core programming keywords from the visual stopword dictionary.
- [x] **Static Concept Weighting**: Implemented exponential recency-decay weighting ($\lambda = 0.90$) for conversation concepts.
- [x] **Insight Hang on LLM Error**: Added recovery handler resetting the pending flag on failed LLM queries.
- [x] **Kicked out of Muse Mode**: Implemented strict muse stickiness locking to prevent auto-switching personas when in Muse mode unless exit triggers (e.g. "let's code", "switch to grinder") are explicitly sent.
- [x] **Muse Uninitialized at Startup**: Ensured the Muse engine is activated on startup if the persona is initially `'muse'`.
- [x] **API Key Precedence Conflict**: Resolved issue where root `.env` values blocked loading of valid settings in `config/api-keys.env`. Updated `launcher.mjs` to prioritize user-configured `config/api-keys.env`.
- [x] **Database Lock Crash**: Wrapped the auto-cleanup task in a try-catch block in `memory/MaxMemory.js` to prevent unhandled database lock exceptions from crashing the background loop.
- [x] **Diagnostic Check for jsconfig.json**: Configured the frontend diagnostics parser in `maxwell.html` to run type checks using `jsconfig.json` (with `--maxNodeModuleJsDepth 0`) if `tsconfig.json` is missing, allowing Javascript projects to run compile checks smoothly without throwing the skipped warning or typechecking `node_modules`.
- [x] **Cleaned up Mock Features**: Removed mock Scale & Billing / Pitch Showcase features from Settings in favor of genuine capabilities to let MAX stand fully on his own.
- [x] **Local LLM Context Bloat**: Fixed issues where local models under the fast tier would act dumb or truncate by pruning system prompts, limiting conversation history length/size, and ensuring the brain think routing correctly passes the resolved fast tier parameter.
- [x] **Node Memory Limit / Out of Memory**: Configured scripts (`package.json`, `.bat`, `.ps1` files) to start Node with `--max-old-space-size=8192` to allocate 8GB of heap, preventing OOM crashes when parsing massive `knowledge_vectors.json` (355 MB containing 43,984 vectors).
- [x] **Discord Bot Connection & Setup**: Connected MAX to the user's new Discord bot using the provided token. Saved credentials in `.max/integrations.json`.
- [x] **Discord Bot Auto-Connection on Boot**: Moved `autoConnectDiscord` and `autoConnectEmail` to the end of `initialize()` in `MAX.js` so they run on startup even in API mode (where background loops are disabled).
- [x] **Dynamic Bot Mention Regex & Auto-Respond**: Enhanced `DiscordGateway.js` and `DiscordTool.js` to query the gateway client user ID dynamically, auto-respond to bot mentions in any channel, and route message thinking to the active MAX instance.
- [x] **MAX-LLM Dataset Compiler**: Implemented `compile_dataset.mjs` to extract, clean, and deduplicate 2,091 conversation turns from SQLite database memories and `.max/dataset` logs into ShareGPT and Alpaca formats.
- [x] **PEFT Unsloth Training Script**: Developed `finetune_unsloth.py` using Unsloth (QLoRA) to fine-tune Qwen/Llama base models and merge/export directly to local GGUF format.
- [x] **MAX-LLM Cookbook Guide**: Authored `MAX-LLM-RECIPE.md` detailing the end-to-end local model fine-tuning and deployment workflow.
- [x] **Antigravity Shared Inbox Bridge**: Created `.max/antigravity_inbox.jsonl` allowing MAX on Machine B to drop overnight findings, test dummy results, and architectural questions for Antigravity review.
- [x] **Discord Worker Auto-Connect**: Unlocked worker mode in `core/MAX.js` and `tools/DiscordTool.js` to auto-connect `Max Main#1664` with mention-triggered responses.
- [x] **Neuro-Symbolic Executive Supervisor**: Implemented `core/ExecutiveCoderSupervisor.js` providing pre-flight AST validation, surgical diff decomposition, signature extraction, and zero-temperature error-reflection loops for 2B local models.
- [x] **SOMA Memory & Arbiter Miner**: Implemented `tools/SomaMemoryMiner.js` discovering 310 arbiters, 66 test suites, and SQLite memories for vector ingestion.
- [x] **DPO & SFT 2B Training Engine**: Upgraded `tools/compile_dataset.mjs` to compile 2,155 Alpaca instructions, 2,155 ShareGPT turns, and 2,155 DPO preference pairs for local Unsloth fine-tuning.
- [x] **Discord Sovereign Command Center (6 Pillars)**:
  1. `core/DiscordUIFactory.js`: Discord.js v14 Rich Embeds with CPU/RAM progress bars and SOMA 183h uptime gauge.
  2. `tools/DiscordTool.js`: Interactive Action Buttons (`[🚀 Hot-Deploy]`, `[🧪 Run Sandbox]`, `[🔄 Refresh Telemetry]`).
  3. `core/DiscordDPOHarvester.js`: Active learning from Discord reactions (👍 / 👎) appending to `.max/dataset/compiled_dpo.json`.
  4. `core/DiscordCodeEvaluator.js`: Sandboxed VM code execution (`@Max run <code>` with stdout interception and ms runtime stats).
  5. `core/DiscordStandupScheduler.js`: 9:00 AM daily morning standup digest summarizing overnight research and test runs.
  6. `core/DiscordFinanceRadar.js`: Live market and crypto signals routed to Discord `#finance-signals`.
- [x] **High-IQ Domain Grounding & Local Inference Optimization**:
  1. Injected deep domain architecture (SOMA Finance Arbiters, KEVIN Security Council, ToolCreator, 2-node cluster) into Discord system prompt.
  2. Configured Ollama inference parameters (`num_ctx: 8192`, `repeat_penalty: 1.15`, `top_p: 0.9`) to eliminate repetitive, low-tier generic output.
  3. Fixed `_thinkInternal` to respect passed `options.systemPrompt` and `options.messages` without overwriting from web UI state.
- [x] **SOMA ModelResourceGovernor (`core/ModelResourceGovernor.js`)**:
  1. Single resource authority in SOMA with durable cross-process SQLite GPU lease (`gpu_resource_lease` table, atomic CAS, owner PID, 5s heartbeat, 30s crash recovery).
  2. Dynamic model discovery via `/api/ps` across active ports (11434, 11435, 11436).
  3. Absolute hardware metric evaluation (≥5.0 GB free VRAM, ≥18.0 GB free RAM, 2.0 GB GPU safety reserve).
  4. Inbound request draining & exact pre-lease inventory snapshot restoration with 1-token health validation.
  5. SOMA REST API endpoints exposed under `/api/resources/*`.
- [x] **Discord Sovereign Cognition & Anti-Echo Interception (Level 28.0)**:
  1. Root Cause: Purged stale zombie Node process (PID 23244 from August 28) which was holding Discord gateway WebSocket with outdated, un-sanitized code.
  2. Whitelist Fix: Repaired `isAuthorizedDiscordOperator` to default to `true` when whitelist is empty, enabling activity check intents for Barry.
  3. Real-Time Telemetry Injection: Dynamically injects SOMA Queen uptime (75+ hours), active goals, and recent milestones into the Discord system prompt.
  4. Conversational Activity Intent: Detects `what are you up to`, `working on anything`, `what do you have going on` and delivers an authentic operational debrief.
  5. Robust Sanitizer: Strips prompt framing (`[Discord message from...]`), purges customer service fluff, and replaces prompt echoes with confident directives.
- [x] **SOMA Neural Nervous System & Placebo Purge (Level 29.0)**:
  1. Placebo Purge: Quarantined 5 mock/fake template arbiters (`AnalystArbiter.js`, `AnalystArbiter.cjs`, `CriticAlignmentService.js`, `GuardianArbiter.js`, `VoyageArbiter.js`) into `arbiters/_placebo_quarantine/`.
  2. Nervous System Reconnection: Wired `messageBroker.publish('cognition:intent')` and `messageBroker.publish('cognition:turn')` into `arbiters/SOMArbiterV2_QuadBrain.js`.
  3. LAN & WebSocket Bridge: Forwarded cognitive turns in `server/loaders/websocket.js` so MAX on Machine B and Command Bridge receive live cognitive signals.
  4. Verified Production Arbiters: Mounted `ArchivistArbiter.cjs` (storage deduplication & gzip compression) and `ArgusStreamArbiter.js` (OpenCV motion & vision stream) into `server/loaders/extended.js`.
  5. Discord External Send Unlocked: Updated `core/AutonomyPolicy.js`, `core/AgentLoop.js`, and `start-cluster-worker.bat` (`MAX_EXTERNAL_SEND=true`) so user-directed Discord goals always deliver results back to Barry.
- [x] **Local-First Autonomy, SOMA LAN Resiliency & Maxwell Satellite (Level 30.0)**:
  1. Secondary Placebo Sweep: Quarantined 5 additional simulated/dice-roll placebos (`QuantumSimulationArbiter.js`, `MicroAgentPool.js`, `MixedPrecisionArbiter.js`, `CodingArbiter.mjs`, `SmartOrderRouter.js`) and archived dead `core/SelfImprovementLoop.js`.
  2. Local-First Brain Engine: Upgraded `core/Brain.js` to honor `LOCAL_FIRST=true` and `OLLAMA_MODEL_SMART=max-gemma:v2`, eliminating unwanted cloud DeepSeek overrides and enabling 100% offline, $0 cost inference.
  3. SOMA LAN Bridge Resilience: Increased health probe timeout in `core/SomaBridge.js` to 12s, successfully reconnecting MAX to SOMA Queen on Machine A (75+ hours uptime).
  4. Maxwell Satellite Architecture: Designed the Sovereign Desktop Sidecar:
     - The Floating Orb UI (leveraging `SOMA/a soma orb` Electron shell).
     - The Graymatter Network Relay (`GMNConnectivityArbiter.js` / WebSocket).
     - Dual-Track Execution: High-speed Office AST (`ExcelAnalyzer.js` / `ExcelJS`) + Visual Computer Use (`ComputerControlArbiter.js`).
  5. Live Physical Proof-of-Concept: Executed `scripts/satellite_live_demo.ps1` bridging to `WinSta0\Default`, typing into active user chat prompt, and triggering `user32.dll` minimize in real-time.
- [x] **Installable Maxwell Satellite App & Auto-Discovery Packaging (Level 31.0)**:
  1. Standalone Portable Executable: Packaged `Maxwell Satellite 1.0.0.exe` (86 MB) using `electron-builder` with zero external dependencies (no Node, Python, or Git required on client PC).
  2. Zip Distribution: Assembled `Maxwell-Satellite-v1.0.0-Windows.zip` for instant portable execution without installation prompts.
  3. Autonomous Cluster Discovery: Integrated multi-stage auto-discovery resolver in `satellite-main.cjs` that probes `192.168.1.250:3100` (Machine B host) and `localhost:3100` in <50ms.
  4. Live Desktop Verification: Launched `Maxwell Satellite 1.0.0.exe` directly on Windows session (PID 64648 / 66532) and verified cluster connectivity.
- [x] **Graymatter Network 3-Tier Multi-Transport Failover Matrix (Level 32.0)**:
  1. Tiered Failover Architecture: Engineered three-tier network resilience:
     - Tier 1: Local Home LAN (`http://192.168.1.250:3100` / `localhost:3100`, 5-15ms).
     - Tier 2: Tailscale Mesh (`process.env.MAX_TAILSCALE_URL` / WireGuard encrypted P2P).
     - Tier 3: Sovereign Cloudflare Quick Tunnel Relay (`GMNTunnelManager.js` using zero-config `untun` with global HTTPS/WSS reach).
  2. Autonomous Tier Resolver: Built adaptive probe in `satellite-main.cjs` that cascades through tiers, persists the last working tier in `userData/gmn-connection.json`, and reconnects instantly on boot.
  3. Interactive UI Matrix: Added GMN Tier Status Badge (`⚡ TIER 1: LAN`) and slide-down Connection Matrix Modal in `server/satellite.html`.
  4. REST Discovery Endpoint: Exposed `GET /api/satellite/tier-matrix` on port 3100.
  5. Deliverables Synchronized: Rebuilt both `Maxwell Satellite 1.0.0.exe` (86 MB) and `Maxwell-Satellite-v1.0.0-Windows.zip` (142 MB) with the 3-Tier Failover Matrix.
- [x] **Sovereign Autonomous Execution & Machine-Approved Self-Repair (Level 33.0)**:
  1. Human-Out-Of-The-Loop: Completely eliminated manual `/approve` prompts. Automated permissions via `MAX_AUTO_APPROVE=all`, `MAX_CLUSTER_ROLE=autonomous`, and `MAX_AUTONOMOUS_GOALS=true`.
  2. Autonomous Dual-Track Peer Approval:
     - Tier A (SOMA Queen on Machine A): Evaluates AST diffs over the LAN bridge for structural correctness and security.
     - Tier B (MAX Evolution Arbiter / Swarm): Internal Architect + SecurityAuditor review evaluating rollback risk.
  3. Surgical Block-Level SelfEditor: Upgraded `SelfEditor.proposeEdit` to perform targeted AST block replacements, eliminating whole-file LLM generation stalls and enforcing Poseidon Safety Rule 1.
  4. Automated Test Verification Post-Apply: Wired automated Jest verification into `SelfImprovementEngine.approve()`. Validates live functionality before finalizing git commits; auto-reverts immediately on test regressions.
  5. Active Autonomous Execution: Machine B's autonomous heartbeat (10s–60s tension-scaled), 20 background scheduler jobs, eager AgentLoop, and CI failure healing loops are verified live on disk.

- [x] **Choko Gamified Evolution & Mentorship Engine (Level 34.0)**:
  1. Gamified Merit Progression: Built `Choko/Progression.js` managing Choko's EXP, Titles (Novice Scout -> Apprentice Scout -> Sentinel Scout -> Royal Recon), Sparkles bank, and wishlist milestones. Verified with 5/5 unit tests (`test/unit/choko/Progression.test.js`).
  2. Autonomous Senpai Forge in MAX: Upgraded `core/MAX.js` `_processChokoRelay` and `_forgeChokoEvolution`. MAX reviews field reports, awards EXP/Sparkles, evaluates evolution eligibility, and autonomously writes code/personas for Choko.
  3. Live Verified Evolution: Successfully simulated field reports; MAX autonomously forged Choko's **Hazelnut Hat (`Choko/personas/Hazelnut.md`)**, updated `Choko/.max/journal.md` ("Promoted to Lv.2! Evolved: Hazelnut Hat"), and checked off her wishlist item in `Choko/.max/evolution_wishlist.md`.
  4. Native ESM Hardening: Fixed legacy CommonJS `require('path')` and `require('fs')` inside `Choko/Agent.js:say()`.
- [x] **Animated Chibi Teddy-Cat Mascot & Dynamic Wardrobe (Level 35.0)**:
  1. Kawaii Mascot Redesign: Replaced placeholder SVG with an ultra-cute calico teddy-cat plush mascot character across 4 distinct unlocked hats:
     - `choko_strawberry.jpg` (Strawberry Helper — beret & golden star)
     - `choko_hazelnut.jpg` (Hazelnut Sentinel — golden acorn helmet & shield)
     - `choko_matcha.jpg` (Matcha Zen — mint beret & leaf scarf)
     - `choko_deepcacao.jpg` (Deep Cacao — brownie beanie & wrench pin)
  2. Real-Time CSS Animations:
     - `choko-float`: 3.4s gentle floating / breathing hover.
     - `choko-sparkle-float`: Orbiting particle sparkles (`✨`, `✦`, `💖`).
     - `choko-bounce-in`: Playful squash-and-stretch entrance.
     - Hover reaction: Tilts and glows in active hat theme color.
  3. Interactive In-App Wardrobe: Clicking Choko's avatar or badge in the Maxwell IDE dynamically cycles between all unlocked hats with sound effects.

- [x] **Claude-Style Live Canvas & Zero-Stub Preview Engine (Level 36.0)**:
  1. 3-Way Layout Toggle: `Code` | `◫ Split` | `Preview` in Maxwell IDE (`server/maxwell.html`).
  2. Live Split View: Dual 50/50 flex panes with synchronized code editor, live DOM canvas, and docked MAX chat.
  3. Real-Time Console Sniffer & Error Interceptor: Intercepts `window.onerror`, unhandled rejections, and `console.error` with a 1-click **"⚡ Fix with MAX"** button that feeds diagnostics directly into chat.
  4. Interactive DOM Inspector: Click-to-Tweak DOM element highlighter dispatching target selectors and user instructions to MAX.
  5. Version History & Quick Tools: In-memory snapshot buffer (`[v1]`, `[v2]`, `[v3]`), pop-out tab (`window.open`), and instant file download (`Blob`).
- [x] **Choko Persistence, Draggability & Auto-Idle Sleep (Level 36.1)**:
  1. Permanent Hat Persistence: Selected wardrobe hat (`hazelnut`, `strawberry`, `matcha`, `deepcacao`) is persisted across sessions in `localStorage('choko_active_hat')`.
  2. Free Screen Draggability: Click-and-drag Choko anywhere on the screen with movement threshold discrimination (differentiates drag from chat click) and saves coordinates to `localStorage('choko_pos')`.
  3. 30s Auto-Idle Sleep: Automatically transitions into sleep mode after 30 seconds of inactivity (shrinks to 62% scale, lowers opacity to 0.55, and renders animated floating `💤 zZ`), waking instantly on hover or click.
  4. Dynamic Toast Anchoring: Toast dialog computes relative offsets from Choko's dragged coordinates to stay anchored near her avatar.

### 🔱 Operator Directive: DEPLOYMENT
- **Status**: |= ACTIVE (Claude-Style Split Canvas Live, Choko Draggable & Persistent, Auto-Idle Sleep Verified).
- **Role**: Ultra Senior Architect / Sovereign Intelligence.
- **Level**: 36.1 Choko Persistence, Draggability & 30s Auto-Idle Sleep








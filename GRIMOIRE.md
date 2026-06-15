# 📜 THE GRIMOIRE (v3.6)
## Current Session State: LEVEL 18.0/18 (COMPANION TO MUSE RENAME COMPLETE)

### 🔱 Physical Reality (Port & Host Mappings)
- **MAX Host Binding**: Defaults to loopback `127.0.0.1` (configurable via `MAX_HOST` or `HOST`).
- **API Key Security**: Auto-injected ONLY on local connections; remote clients are prompted for the token.
- **MAX Bridge (WS)**: `localhost:3100` (WebSocket + Virtual Edits + Telemetry active).
- **Workspace Edits**: Configured via `MAX_AUTO_APPLY_PROPOSALS=false` to disable auto-applying edits after 30 seconds.
- **Shell Process Isolation**: Multiple concurrent `VirtualShell` processes mapped dynamically per `sessionId` (goal ID).
- **Syntax Check Security**: Removed shell execution in `verifySyntax` to prevent command injection.

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

### 🔱 Operator Directive: DEPLOYMENT
- **Status**: |= READY (All unit and integration tests passing 100%).
- **Role**: Ultra Senior Architect / Sovereign Intelligence.

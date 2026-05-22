# SOMA Development Plan
*Maintained by MAX — updated automatically each research cycle*

---

## Current Architecture (v2.5)

### Perception Layer
- **Daemons:** RepoWatcher, Health, Optimization, Discovery
- **Sentinel:** Autonomous Code-Smell Monitor (15m cycle)
- **God's Eye:** Semantic codebase indexer

### Arbitration Layer
- **QuadBrain:** LLM routing (Gemini 2.0 → DeepSeek V4 → Ollama gemma3:4b)
- **EngineeringSwarmArbiter:** research/plan/debate/synthesis
- **GoalPlannerArbiter:** goal decomposition

### Cognitive Layer
- **CognitiveFilter:** Enforces Ternary Belief States (/ TRUE, \ FALSE, | UNCERTAIN)
- **Kaizen Loop:** Autonomous Knowledge Hardening from uncertainty
- **ReflectionEngine:** Self-model scoring + pattern recognition
- **LongHorizonPlanner (Odyssey):** Milestone-based DAG planning

### Execution Layer (MAX)
- **Hydra v0.5 (Agent Trees):** Parallel sandboxing via Git Worktrees
- **AgentLoop:** Wave-based dependency resolution
- **ToolRegistry:** Integrated SOMA + MAX toolsets
- **GoalEngine:** Priority-scored autonomous goal queue

### Memory Layer
- **MnemonicArbiter:** SQLite/Vector/Redis hybrid (3-Tier)
- **KnowledgeBase:** Permanent research ingestion (Curiosity Pipeline)
- **MaxMemory:** High-speed episodic vector storage

---

## Required ASI Capabilities

- [x] Autonomous research (EdgeWorker)
- [x] Long horizon planning (Odyssey)
- [x] Skill learning and reuse (SkillLibrary)
- [x] Persistent world models (Mental Simulation)
- [x] Reflective reasoning (ReflectionEngine)
- [x] Self-improvement loops (EngineeringSwarm)
- [x] Ternary belief states (Barry Protocol)

---

## Implementation Roadmap

### Phase 1 — Stabilize (DONE)
- [x] Daemon ecosystem with watchdog
- [x] MAX external agency (COS layer)
- [x] AgentLoop tool execution
- [x] Resolve duplicate configurations (Jest/Env)
- [x] Port 3100 Cleanup

### Phase 2 — Memory & Planning (DONE)
- [x] Wire SOMA ToolRegistry to existing arbiters
- [x] Long horizon planning connected to execution (Odyssey)
- [x] Skill library persistence across restarts
- [x] World model basic implementation

### Phase 3 — Autonomous Research & Trees (DONE)
- [x] Daily frontier research loop
- [x] Research → capability gap analysis
- [x] Parallel Sandboxing (Hydra Agent Trees v0.5)
- [x] SOMA evolves from global AI research

### Phase 4 — Self-Improvement & IDE UI (DONE)
- [x] Closed loop: reflect → propose → apply → verify
- [x] Kaizen Uncertainty Loop
- [x] IDE Bridge (WebSocket/Bidirectional Streaming)
- [x] LSP-Native Sync (Editor Buffers + Context Paging)
- [x] Sovereign UI (Observability Matrix + Split-Pane Matrix)

---

## Future Milestones
- **Context Pager Optimization**: Support 1M+ hunks via hierarchical indexing.
- **AOL 2027**: 
  - Lightweight, universal chat window based on the AOL tribute.
  - Optimized for 2027 SOTA (sub-50ms latency, e2ee).
  - Cross-device auto-connect via MaxwellBridge.
- **Recursive Swarm Specialization**: Create "Bug Hunter" and "Doc Writer" permanent workers.

# SOMA Development Plan
*Maintained by MAX — updated automatically each research cycle*

---

## Current Architecture

### Perception Layer
- Daemons: RepoWatcher, Health, Optimization, Discovery
- Sentinel: file-change watcher
- God's Eye: codebase indexer

### Arbitration Layer
- QuadBrain: LLM routing (Gemini → DeepSeek → Ollama)
- EngineeringSwarmArbiter: research/plan/debate/synthesis
- GoalPlannerArbiter: goal decomposition

### Cognitive Layer
- CognitiveLoop: internal thought generation
- ReflectionEngine: per-turn scoring, deep reflect every 10 turns
- LongHorizonPlanner: multi-step planning

### Execution Layer (MAX)
- AgentLoop: parallel wave dependency resolution
- ToolRegistry: file, shell, web, git, brain tools
- GoalEngine: priority-scored goal queue

### Memory Layer
- MnemonicArbiter: long-term semantic memory
- KnowledgeBase: chunked ingestion + vector search
- MaxMemory: episodic + working memory

---

## Required ASI Capabilities

- [ ] Autonomous research
- [ ] Long horizon planning
- [ ] Skill learning and reuse
- [ ] Persistent world models
- [ ] Reflective reasoning
- [ ] Self-improvement loops
- [ ] Ternary belief states (Barry's idea — \=false, |=uncertain, /=true)

---

## Capability Gaps
*MAX fills this section automatically*

| Capability | SOMA Status | MAX Status |
|---|---|---|
| Long horizon planning | weak | partial |
| Skill memory | missing | partial (SkillLibrary) |
| Reflective reasoning | missing | partial (ReflectionEngine) |
| Attention allocation | unstable | missing |
| World model | missing | missing |
| Autonomous research | missing | missing |
| Ternary cognition | missing | missing |

---

## Implementation Roadmap

### Phase 1 — Stabilize (current)
- [x] Daemon ecosystem with watchdog
- [x] MAX external agency (COS layer)
- [x] AgentLoop tool execution
- [ ] SOMA ToolRegistry wiring (LongHorizonPlanner → arbiters)
- [ ] Discord bot connection

### Phase 2 — Memory & Planning
- [ ] Wire SOMA ToolRegistry to existing arbiters
- [ ] Long horizon planning connected to execution
- [ ] Skill library persistence across restarts
- [ ] World model basic implementation

### Phase 3 — Autonomous Research
- [ ] Daily frontier research loop
- [ ] Research → capability gap analysis
- [ ] Auto-generated engineering tasks
- [ ] SOMA evolves from global AI research

### Phase 4 — Self-Improvement
- [ ] Closed loop: reflect → propose → apply → verify
- [ ] Ternary belief state in SOMA cognition
- [ ] MAX as SOMA arbiter (direct MessageBroker integration)
- [ ] Multi-MAX swarm with specialized personas

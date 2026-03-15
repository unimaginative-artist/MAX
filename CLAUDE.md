# MAX — Project Reference

## How to Start MAX

```
node launcher.mjs           ← chat mode (default)
node launcher.mjs --mode api ← API mode only (no REPL)
```

**Access dashboard:** http://localhost:3100/dashboard

**Key env vars** — set in `config/api-keys.env`:
- `DEEPSEEK_API_KEY` — primary smart/code tier
- `OPENAI_API_KEY` — fallback smart tier
- `OLLAMA_MODEL_FAST` — fast tier local model (e.g. `qwen3:1.5b`)
- `OLLAMA_MODEL_SMART` — smart tier local model (e.g. `qwen3:8b`)
- `MAX_AUTO_APPROVE` — `read` | `write` | `all` (default: `write`)
- `MAX_PORT` — dashboard port (default: 3100)

**SOMA bridge:** MAX connects to SOMA at `http://127.0.0.1:3001` automatically on boot. If SOMA is offline, MAX falls back to local brain gracefully.

---

## Architecture Overview

MAX is the **execution engine** of the SOMA Cognitive Operating System. It runs as a standalone agent but is designed to be dispatched by SOMA's arbiter layer for complex engineering work.

### Core Systems (in boot order)
```
Brain (LLM tiers)
  → Memory (MaxMemory + KnowledgeBase)
  → Tools (ToolRegistry: file, shell, web, git, api, vision, etc.)
  → GoalEngine (goal economy — goals compete for execution)
  → AgentLoop (autonomous task execution, parallel wave dependency resolution)
  → ReflectionEngine (per-turn scoring, deep reflection every 10 turns)
  → Heartbeat (background tension/curiosity loop)
  → Scheduler (recurring jobs: diagnostics 1h, reflection 4h, briefing 24h)
  → SomaBridge (SOMA connection — uses SOMA's QuadBrain when available)
```

### Brain Tiers
| Tier | Purpose | Backend priority |
|------|---------|-----------------|
| fast | Acknowledgments, queue acks, 40-token responses | Ollama fast model |
| smart | Main chat, reasoning | Ollama smart → DeepSeek → OpenAI |
| code | Code generation, file edits | DeepSeek → OpenAI → Ollama |

### REPL Commands
```
/status          — tension, satisfaction, brain backend, memory count
/run <cmd>       — direct shell execution (no LLM, streams live)
/ps              — list background shell processes
/kill <name>     — stop a named background process
/goals           — list active goals
/goals add "x"   — queue a goal for AgentLoop
/goals done <id> — mark goal complete
/goals clear     — clear pending goals
/reflect         — trigger deep reflection immediately
/reason <query>  — multi-strategy reasoning (causal, simulation, security)
/expand [id]     — expand an insight from the insight box
/pause           — interrupt AgentLoop at next step boundary
/resume          — resume interrupted AgentLoop
/swarm           — next message uses parallel swarm
/persona <name>  — switch persona (architect/grinder/paranoid/breaker/explainer)
/self edit <path> <instruction> — propose an edit to MAX's own source
/self commit <path> — apply staged edit (with backup)
/self rollback <path> — discard staged edit
/artifacts       — list generated artifacts
/proposals       — list SOMA self-modification proposals
/approve <id>    — approve a SOMA proposal (runs full apply pipeline)
/deny <id>       — deny a SOMA proposal
/quit            — save session and exit
```

---

## Key Files

| File | What it does |
|------|-------------|
| `launcher.mjs` | Entry point, REPL, all slash commands |
| `core/MAX.js` | Main agent — think(), initialize(), _buildStateContext() |
| `core/Brain.js` | LLM tier router (fast/smart/code) + DeepSeek/OpenAI/Ollama backends |
| `core/AgentLoop.js` | Autonomous task execution — parallel wave dependency resolution |
| `core/GoalEngine.js` | Goal queue, priority scoring, auto-generation |
| `core/Heartbeat.js` | Background tension loop — triggers AgentLoop, curiosity, auto-goals |
| `core/ReflectionEngine.js` | Per-turn scoring + deep reflect every 10 turns + prompt patches |
| `core/SomaBridge.js` | SOMA connection — think(), injectGoal(), getSomaStatus() |
| `core/SomaController.js` | Mechanical SOMA control — stop/start/health/git checkpoint/apply proposal |
| `tools/ShellTool.js` | Live-streaming shell, background process management, persistent CWD |
| `tools/ToolRegistry.js` | Tool dispatch + LLM TOOL: call parser |
| `server/server.js` | Dashboard API + SSE + SOMA proposal queue (/api/soma/propose) |
| `server/ui.html` | Dashboard frontend |

---

## Agentic Behavior (for AI assistants working on this codebase)

### How MAX handles requests
- **Execution requests** ("fix X", "add Y to file Z") → MAX uses tools directly, reads file, makes change, verifies, reports done. Does NOT ask for confirmation mid-task.
- **Investigation requests** ("why isn't X working", "figure out Y") → MAX queues a goal via `TOOL:goals:add`, AgentLoop investigates autonomously.
- **Shell requests** ("run tests", "start server") → `TOOL:shell:run` for commands, `TOOL:shell:start` for background processes.
- **Complex multi-step** → MAX outputs a `PLAN:` block first (numbered steps), then executes. Printed to terminal before tools run so Barry can interrupt.

### Tool call format
```
TOOL:<name>:<action>:<json_params>
```
Examples:
```
TOOL:file:read:{"filePath": "core/MAX.js"}
TOOL:shell:run:{"command": "npm test", "timeoutMs": 60000}
TOOL:shell:start:{"command": "node launcher.mjs", "name": "max-dev"}
TOOL:goals:add:{"title": "Investigate memory leak", "priority": 0.9}
```

### autoApproveLevel
- `read` — only file reads auto-approved, everything else gates
- `write` — reads + writes auto-approved; only `git.commit`, `git.push`, `file.delete` require approval
- `all` — fully autonomous, nothing requires approval

Default is `write`. Set `MAX_AUTO_APPROVE=all` in `config/api-keys.env` for hands-off operation.

---

## Known Wiring / Gotchas

### AgentLoop stepResultMap
`_executeStep(step, goal, stepResultMap)` — the third argument carries outputs from prior steps for dependent steps to consume. Without this, dependent steps can't see what earlier steps produced. Always pass `stepResultMap` when calling `_executeStep`.

### GoalEngine planner schema
Goals planned by the LLM must include `action_name` and `params` fields for tool steps. Without `params`, file tool calls get `filePath: undefined` and fail silently. The planner prompt in `GoalEngine.js` documents this.

### Scheduler method name
`scheduler.addJob({ id, label, every, type, handler })` — NOT `scheduler.add()`. The `every` field uses `'30m'`, `'1h'`, `'4h'`, `'24h'` format. The `handler` field is the function, not `fn`.

### Prompt cache invalidation
`_promptCache` is keyed by `${personaId}|${tensionDecile}|${contextLength}`. This means the cache is invalidated on every new turn (context grows). The cache primarily protects against expensive tool manifest rebuilds during the same turn with tool loops.

### SOMA think() requires systemPrompt
When routing a chat turn through SOMA's bridge, always pass `systemPrompt` in the options object. Without it, SOMA has no tool manifest and can't generate TOOL: calls.

### File diff visibility
When MAX uses `file:write` or `file:replace` during a chat tool loop, a `✏️  write  <path>` line is printed to terminal before the operation. This is intentional — it's the only visible signal that MAX changed a file.

---

## SOMA Integration

MAX is designed as SOMA's execution layer. When SOMA is running:
- Chat turns route through SOMA's QuadBrain (DeepSeek-backed) instead of MAX's local brain
- MAX can inject goals into SOMA's GoalEngine via `TOOL:goals:inject_soma`
- SOMA proposals (self-modifications) arrive at `POST /api/soma/propose` and are queued for Barry's review
- `/approve <id>` runs the full `SomaController.applyProposal()` pipeline: syntax check → git checkpoint → atomic write → restart → health verify → auto-revert on failure

---

## Known Gaps & Active Risks

### Critical
- **Streaming responses** — MAX's `think()` method waits for the full LLM response before printing anything. For long responses this is 10-30s of silence. Fix requires Brain.js streaming refactor (SSE or AsyncGenerator). Deferred — significant architectural change.
- **AgentLoop approval UI** — when `autoApproveLevel: 'read'` and MAX needs approval for a write, the approval request goes through `heartbeat.emit('approvalNeeded')` which the launcher doesn't handle as interactive prompt. The user never sees the approval request. Either wire an interactive REPL prompt or default to `write` level.

### Medium
- **MAX SwarmCoordinator is the simple version** — `swarm/SwarmCoordinator.js` is the basic parallel-subtask version. SOMA has the full `EngineeringSwarmArbiter` with research/plan/debate/synthesis cycles. Eventually MAX's `/swarm` should route complex engineering tasks to SOMA's swarm and use its own simple version only for quick parallel queries.
- **SkillLibrary prune threshold** — skills pruned if `age > 30 days && usedCount < 3`. For a newly booted MAX that hasn't run many tasks, all skills are <3 uses and get pruned on first boot. Consider requiring both conditions: `age > 30 days AND usedCount < 3 AND lastUsed > 7 days ago`.
- **Curiosity pipeline goal quality** — `CuriosityEngine.signalsGoal()` uses keyword matching (should/must/critical/etc.) to decide if a curiosity result should become a goal. This generates noisy goals. Consider adding a priority floor (curiosity-sourced goals capped at 0.5 priority) so they don't crowd out user-sourced goals.

### Low
- **Running processes lost after restart** — `ShellTool._procs` is module-level state. If MAX is restarted, all `shell:start` background processes are forgotten even if still running. On boot, consider scanning for processes with known names via `ps aux | grep`.
- **Context compression loses tool trace detail** — `_compressContext()` compresses old turns into a 2-3 sentence summary. If those turns contained tool results (file reads, shell output), the specific data is lost. Important facts should be in `MaxMemory` before compression happens. `_flushMemories()` partially handles this but fires reactively (at 80% context).

---

## Roadmap

### Done
- [x] Live-streaming shell with background process management (ShellTool)
- [x] Planning blocks (`PLAN:`) printed before complex tool executions
- [x] File write/replace notifications in terminal
- [x] Full REPL command set: /run, /ps, /kill, /goals, /reflect
- [x] Project auto-detection (package.json + README injected into system prompt)
- [x] Background processes in system context (MAX knows what's running)
- [x] Task outcome reflection wired to Scheduler (every 4h)
- [x] SOMA proposal queue + apply pipeline + dashboard UI
- [x] SomaController (mechanical SOMA control with git checkpoint + auto-revert)
- [x] Brain: Gemini replaced with DeepSeek (deepseek-reasoner as smart/code tier)
- [x] **Feedback loops closed** — ReflectionEngine writes insights to KB after every deep reflection. AgentLoop writes goal outcomes (success + failure) to KB. `dream()` auto-triggers every 3rd reflection + runs on 12h Scheduler. `KnowledgeBase.remember()` shortcut added for plain-text ingestion.

### Short-term
- [ ] **Streaming responses** — Brain.js streaming refactor. This is the single biggest UX improvement. Users currently wait 10-30s in silence. Even just printing a `...` progress indicator with partial token counts would help.
- [ ] **Interactive approval prompt** — when AgentLoop needs approval in `read` mode, print a `[APPROVAL NEEDED] <tool>.<action>: <params>  y/n?` prompt to the REPL and wait for input. Currently approval events are emitted but never shown interactively.
- [ ] **MAX → SOMA engineering dispatch** — when MAX's `/swarm` is called with a complex engineering request, check if SOMA is available and route to `EngineeringSwarmArbiter` instead of MAX's simple `SwarmCoordinator`.
- [ ] **Session state on dashboard** — show current goals, active agent loop status, last 5 insights, and memory stats on the dashboard. Most data is already in `max.getStatus()`.

### Medium-term
- [ ] **Persistent shell processes across restarts** — save `_procs` registry to `.max/procs.json` on shutdown, attempt to re-attach or report orphaned processes on boot.
- [ ] **Goal dependency UI** — when `/goals list` shows blocked goals, display the dependency chain so it's clear what needs to complete first.
- [ ] **Structured output for AgentLoop steps** — currently steps return raw text. For code-writing steps, parse the result and extract file paths that were written. Feed these back to the system context automatically.
- [ ] **Curiosity → KB** — CuriosityEngine interesting results aren't written to KB yet. Wire `CuriosityEngine` to call `kb.remember()` when it discovers something novel. This makes the KB grow organically from MAX's own exploration.

### Long-term
- [ ] **MAX as SOMA arbiter** — register MAX itself as an arbiter in SOMA's MessageBroker. SOMA can then dispatch execution signals directly to MAX rather than through HTTP. MAX becomes a first-class component of the COS.
- [ ] **Multi-MAX swarm** — spawn multiple MAX instances with different personas for parallel execution. `SwarmCoordinator` becomes a true multi-agent system with each worker being a specialized MAX persona.
- [ ] **Continuous self-improvement** — `ReflectionEngine` identifies behavioral patterns. `SelfEditor` proposes code changes. `SomaController` applies them. Full closed loop: MAX observes its own behavior, reflects, proposes improvements to its own code, and applies them safely.

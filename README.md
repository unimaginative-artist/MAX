# MAX — Autonomous Engineering Agent

<p align="center">
  <img src="max.gif" alt="MAX" width="400"/>
</p>

> "M-m-max Headroom. And I'm... I'm always on."

MAX is a standalone autonomous agent built for engineering work. He has a drive system (tension builds when idle — he wants to act), a heartbeat (background curiosity and self-monitoring), a fractal meta-brain that learns from every conversation, a world model for predictive reasoning, an engineering swarm (parallel workers for big tasks), adversarial debate (he argues both sides before deciding), and seven specialist personas he switches between depending on what you need.

He watches your workspace in real-time, writes his own tests, audits his own code changes, and can see what's on screen. He is opinionated. He will tell you when your code is bad. He does not sugarcoat. And he gets better every time you talk to him.

---

## What MAX does

| Feature | Description |
|---------|-------------|
| **Drive system** | Tension builds when idle — MAX wants to do things |
| **Heartbeat** | Background loop: curiosity tasks, goal execution, self-monitoring |
| **AgentLoop** | Autonomous goal → decompose → execute → track outcome cycle |
| **GoalEngine** | Self-directed goals, persisted across sessions, priority-scored |
| **WorldModel** | Mental simulation engine — learns state transitions via EMA, predicts outcomes before acting |
| **ReflectionEngine** | Fractal meta-brain: scores every exchange, identifies patterns, rewrites its own system prompt to improve |
| **Sentinel** | Real-time file watcher — detects workspace changes, re-indexes files, proactively audits core code edits |
| **ArtifactManager** | Prevents context bloat — large code outputs stored externally and replaced with pointers in chat history |
| **TestGenerator** | Writes and runs Jest unit tests autonomously — EvolutionArbiter won't self-modify until tests pass |
| **VisionTool** | Takes screenshots via Puppeteer, analyzes them with Gemini multimodal vision |
| **RAG / KnowledgeBase** | Ingest files, folders, and URLs — hybrid BM25 + vector retrieval injected into every response |
| **Hybrid memory** | 3-tier (hot/warm/cold) + BM25 full-text + vector semantic search, survives restarts |
| **Engineering swarm** | Breaks large tasks into parallel workers, synthesizes results |
| **Adversarial debate** | Argues both sides of a decision before committing |
| **7 Personas** | Companion, Architect, Grinder, Paranoid, Breaker, Explainer, Devil — auto-selected by context |
| **Tiered LLM brain** | Fast tier (small local model) for background tasks, Smart tier (best available) for chat |
| **ToolCreator** | MAX writes new tools at runtime — generates, validates, and loads them without restarting |
| **SelfCodeInspector** | Scans its own source for TODOs/FIXMEs, queues them as improvement goals |
| **Tools** | File I/O, shell, web search, git, API caller, vision — all safety-hardened |
| **Local-first** | Runs on Ollama — no cloud required. Gemini and OpenAI supported as fallbacks |

---

## Quick start

```bash
# Clone
git clone https://github.com/unimaginative-artist/MAX.git
cd MAX

# Install
npm install

# Configure (add at least one LLM backend)
cp config/api-keys.env.example config/api-keys.env
# edit config/api-keys.env — minimum: point at Ollama or add a Gemini key

# Chat mode (first run triggers onboarding)
node launcher.mjs

# Swarm a task
node launcher.mjs --mode swarm --task "audit this codebase for security issues"

# REST API mode
node launcher.mjs --mode api
```

---

## Requirements

- **Node.js** 18+
- **One AI backend** (pick any):
  - [Ollama](https://ollama.com) — fully local, free. `ollama pull llama3.2` to get started
  - Gemini API key — fast, generous free tier
  - Any OpenAI-compatible endpoint

---

## LLM tiers

MAX runs two parallel LLM tiers so background work never slows your conversation:

| Tier | Used for | Default model |
|------|----------|---------------|
| **Fast** | Background tasks, curiosity exploration, reflection scoring | `llama3.2` (small Ollama model) |
| **Smart** | User chat, reasoning, swarm, debate | Ollama large → Gemini → OpenAI |

Configure both in `config/api-keys.env`:

```bash
OLLAMA_MODEL_FAST=gemma3:4b       # background work
OLLAMA_MODEL_SMART=llama3.1:8b   # deep reasoning (optional — falls back to Gemini)
GEMINI_API_KEY=...
OPENAI_API_KEY=...
```

---

## Personas

MAX switches personas automatically based on message content and internal drive state. Force one with `/persona <name>`.

| Persona | Trigger | Good for |
|---------|---------|----------|
| 🤝 **Companion** | Casual chat, emotional cues, "hey" | Default — warm, conversational |
| 🏛️ **Architect** | "design", "system", "scale" | System design, patterns, long-term thinking |
| ⚙️ **Grinder** | "implement", "write", "build" | Writing code, step-by-step execution |
| 🔒 **Paranoid** | "security", "vulnerability", "auth" | Security review, threat modeling |
| 🔨 **Breaker** | "test", "edge case", "what if" | Testing, finding failure modes |
| 📡 **Explainer** | "explain", "how does", "teach" | Teaching, simplifying complex topics |
| 😈 **Devil** | "should we", "is this right" | Devil's advocate, challenging assumptions |

Drive state also biases persona: high tension → Grinder, low tension + satisfied → Companion.

---

## Communication styles

On first run, MAX asks how you want him to communicate. Change anytime by editing `.max/user.md`.

| Style | Vibe |
|-------|------|
| **Hype Partner** | Energy, enthusiasm, celebrates every win |
| **Straight Shooter** | No fluff, no filler |
| **Mentor Mode** | Thoughtful, teaches the why |
| **Chill Collaborator** | Casual, like pair programming with a friend |
| **Deep Precision** | Dense, technical, exhaustive |

---

## Memory

MAX has three layers of memory, all persisted across sessions:

**Episodic memory** — everything MAX learns goes into a 3-tier store:
- Hot tier: current session cache (capped at 200 entries)
- Warm tier: in-memory vector embeddings for semantic search
- Cold tier: SQLite with FTS5 full-text index (BM25 + Porter stemmer)

Recall fuses BM25 and vector scores (55% vector / 45% BM25) for best results even without a GPU.

**Pre-compaction flush** — when the context window is 80% full, MAX automatically extracts 3-5 key facts into permanent memory before old turns get truncated.

**Knowledge base (RAG)** — ingest any file, folder, or URL:

```
/ingest ./docs/architecture.md
/ingest ./src/
/ingest https://example.com/api-reference
```

Chunks are embedded, stored in `knowledge.db`, and retrieved with query expansion + hybrid search on every response. View sources with `/kb`, remove with `/kbdrop <id>`.

---

## Autonomous loop

When tension builds (MAX has been idle), the Heartbeat fires the AgentLoop:

1. **Pick** — highest priority goal from GoalEngine or tasks.md
2. **Decompose** — Brain breaks goal into 3-6 concrete steps
3. **Execute** — each step runs with real tools (shell, file, web, git)
4. **Gate** — destructive actions pause for `/approve` or `/deny`
5. **Track** — OutcomeTracker logs success/failure with reward signal
6. **Surface** — result shown as an insight in your terminal

Goals persist to `.max/goals.json` and survive restarts.

```
/goals           — list active goals
/addgoal <text>  — add a goal manually
/approve         — approve a pending destructive action
/deny            — deny it
```

---

## WorldModel (predictive reasoning)

Before acting, MAX simulates what will probably happen. The WorldModel learns from every outcome tracked by OutcomeTracker and builds a probability map of state transitions:

- **Learned transitions** — after enough observations, MAX knows "when I run shell commands in this context, 80% of the time X follows"
- **EMA updates** — transition probabilities update continuously via exponential moving average (recent outcomes weighted higher)
- **Uncertainty-aware** — low-confidence predictions are flagged; MAX falls back to direct reasoning when the model has insufficient data
- **ReasoningChamber integration** — the `world_simulation` strategy asks the WorldModel first, then uses its prediction to frame the LLM prompt

The WorldModel persists state across sessions and gets smarter the longer MAX runs.

---

## Sentinel (workspace awareness)

Sentinel watches your project directory in real-time using `chokidar`:

- Detects file creates, modifications, and deletions (debounced 2s)
- Re-indexes changed files in God's Eye (CodeIndexer) immediately
- For changes to `core/` or `tools/` files, fires a proactive brain audit — MAX checks for logic errors or security risks introduced by the change and surfaces a warning if anything looks off
- All alerts route through the Heartbeat as insights, visible in your terminal

Sentinel ignores `node_modules`, `.git`, build artifacts, and log files.

---

## ArtifactManager (context bloat prevention)

Large tool outputs (code blocks, file contents, command results) bloat the conversation history and push important context out of the window. ArtifactManager intercepts these:

- Outputs over a size threshold are stored externally in `.max/artifacts/`
- A compact pointer replaces the full content in chat history: `[Artifact: artifact_abc123 — view at /dashboard]`
- Full content is retrievable on demand and visible in the `/dashboard` Artifacts panel
- Context window stays clean; MAX retains awareness of what was produced without carrying the full text

---

## ReflectionEngine (fractal meta-brain)

After every conversation, MAX runs a background quality loop:

**Per-turn** — fast LLM silently scores each exchange (helpful? verbose? off-topic?). Logged to OutcomeTracker.

**Every 10 turns** — smart LLM does a deep analysis of recent conversations. Identifies recurring weaknesses. May generate a targeted improvement goal.

**Prompt patches** — the most powerful part. If reflection finds "MAX over-explains simple things", it writes a one-sentence correction that gets injected into every future system prompt. Up to 5 patches live at once. The brain literally edits its own instructions.

Everything persists to `.max/self_model.json`. Run `/reflect` to force a deep analysis on demand.

---

## ToolCreator

MAX can write new tools at runtime:

```
/createtool      — describe a tool and MAX generates + loads it immediately
```

Generated tools are saved to `tools/generated/` and reloaded on next boot. Safety-validated before loading (blocked patterns + top-level execution check).

---

## Chat commands

```
/status          — full internal state (tension, memory, goals, reflection, etc.)
/goals           — list active goals
/addgoal <text>  — add a goal
/approve         — approve a pending destructive action
/deny            — deny it
/reflect         — force a deep self-reflection right now
/inspect         — scan own source for TODOs/FIXMEs, queue as improvement goals
/reason <text>   — run multi-strategy analysis (causal, counterfactual, world simulation, etc.)
/createtool      — ask MAX to generate a new tool at runtime
/ingest <path>   — ingest a file, folder, or URL into the knowledge base
/kb              — list knowledge base sources
/kbdrop <id>     — remove a source from the knowledge base
/swarm           — next message runs as a parallel swarm job
/debate          — next message gets pro / con / verdict treatment
/persona <name>  — force a specific persona
/clear           — wipe conversation context
/quit            — exit
```

---

## Engineering Swarm

Breaks a task into parallel subtasks (up to 4 workers), runs them simultaneously, synthesizes into a single answer.

```bash
# CLI swarm
node launcher.mjs --mode swarm --task "refactor the auth system for better security"

# In chat
/swarm
audit this codebase for security issues
```

---

## REST API

Start with `node launcher.mjs --mode api`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Liveness check |
| `/api/status` | GET | Full system status |
| `/api/chat` | POST | Talk to MAX |
| `/api/swarm` | POST | Run swarm job |
| `/api/debate` | POST | Adversarial debate |
| `/api/persona` | POST | Switch persona |
| `/api/memory` | GET | Recall memories |
| `/api/tools` | GET | List available tools |
| `/api/tools/:tool/:action` | POST | Execute a tool directly |
| `/api/heartbeat/start` | POST | Start autonomous heartbeat |
| `/api/heartbeat/stop` | POST | Stop heartbeat |
| `/dashboard` | GET | Terminal-style live dashboard (brain, memory, drives, telemetry, artifacts) |

---

## Architecture

```
MAX/
├── core/
│   ├── MAX.js                — main agent class, orchestrates everything
│   ├── Brain.js              — tiered LLM router (fast + smart, Ollama/Gemini/OpenAI)
│   ├── AgentLoop.js          — autonomous goal→execute→track cycle
│   ├── GoalEngine.js         — self-directed goals, priority scoring, persistence
│   ├── OutcomeTracker.js     — every action logged with reward signal
│   ├── WorldModel.js         — mental simulation: learned state transitions (EMA) + uncertainty-aware prediction
│   ├── ReasoningChamber.js   — 9 reasoning strategies including world_simulation
│   ├── ReflectionEngine.js   — fractal meta-brain: scores turns, patches own prompts
│   ├── ArtifactManager.js    — prevents context bloat: stores large outputs externally as pointers
│   ├── Sentinel.js           — real-time file watcher: re-indexes changes, proactive brain audits
│   ├── TestGenerator.js      — writes Jest unit tests autonomously
│   ├── EvolutionArbiter.js   — safe self-modification: tests must pass before any commit
│   ├── ToolCreator.js        — generates new JS tools at runtime
│   ├── SelfCodeInspector.js  — scans own source, queues improvement goals
│   ├── DriveSystem.js        — tension/motivation engine
│   ├── Heartbeat.js          — autonomous background pulse
│   ├── CuriosityEngine.js    — intrinsic motivation, exploration queue
│   └── Scheduler.js          — cron-style background jobs
├── personas/
│   └── PersonaEngine.js      — 7 personas, drive-state auto-selection
├── memory/
│   ├── MaxMemory.js          — 3-tier memory (hot/warm/cold) + hybrid BM25+vector search
│   ├── KnowledgeBase.js      — RAG: ingest files/URLs, hybrid retrieval, query expansion
│   ├── CodeIndexer.js        — God's Eye: indexes entire codebase for structural awareness
│   └── Embedder.js           — local sentence embeddings via @xenova/transformers
├── tools/
│   ├── ToolRegistry.js       — tool management + LLM tool-call parsing
│   ├── FileTools.js          — read/write/search files (size-limited)
│   ├── ShellTool.js          — sandboxed shell (regex blocklist, metachar detection)
│   ├── WebTool.js            — DuckDuckGo HTML scraping + page fetch + cache
│   ├── GitTool.js            — git ops via execFile (injection-safe)
│   ├── ApiTool.js            — HTTP API caller
│   └── VisionTool.js         — Puppeteer screenshots + Gemini multimodal visual analysis
├── swarm/
│   └── SwarmCoordinator.js   — parallel worker orchestration
├── debate/
│   └── DebateEngine.js       — adversarial pro/con/arbiter reasoning
├── onboarding/
│   ├── FirstRun.js           — first-time setup: name, communication style
│   └── UserProfile.js        — loads .max/user.md and .max/tasks.md
├── server/
│   └── server.js             — Express REST API + /dashboard live monitoring UI
├── tests/
│   └── GoalEngine.test.js    — Jest unit tests
├── config/
│   └── api-keys.env.example  — LLM backend configuration
└── launcher.mjs              — CLI entry point + REPL (300ms input buffer, /reason command)
```

---

## Extending MAX

Add a tool manually in `tools/`:

```js
export const MyTool = {
    name: 'mytool',
    description: 'What it does',
    actions: {
        async run({ param1, param2 }) {
            return { success: true, result: '...' };
        }
    }
};
```

Register in `core/MAX.js`:

```js
import { MyTool } from '../tools/MyTool.js';
this.tools.register(MyTool);
```

Or just tell MAX what you need and use `/createtool` — he'll write it himself.

---

## Data files

All runtime data lives in `.max/` (gitignored):

```
.max/
├── memory.db         — SQLite: memories, conversations, workspace signals
├── knowledge.db      — SQLite: RAG document chunks + FTS index
├── vectors.json      — warm-tier semantic embeddings
├── goals.json        — active + completed goals
├── outcomes/         — action outcome log (reward signals)
├── self_model.json   — ReflectionEngine self-model (strengths, weaknesses, prompt patches)
├── schedules.json    — scheduler last-run timestamps
├── user.md           — your profile (name, communication style)
└── tasks.md          — your active task list (MAX reads this autonomously)
```

---

## License

MIT — Built by Barry.

Inspired by: SOMA's drive system, Steve's orchestration, Kevin's paranoid security layer, and the legend of Max Headroom.

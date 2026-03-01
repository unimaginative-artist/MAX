# MAX — Autonomous Engineering Agent

<p align="center">
  <img src="max.gif" alt="MAX" width="400"/>
</p>

> "M-m-max Headroom. And I'm... I'm always on."

MAX is a standalone autonomous agent built for engineering work. He has drive (tension builds when idle — he wants to act), a heartbeat (background curiosity and self-monitoring), an engineering swarm (parallel workers for big tasks), adversarial debate (he argues both sides before deciding), and six specialist personas he switches between depending on what you need.

He is opinionated. He will tell you when your code is bad. He does not sugarcoat.

---

## What MAX does

| Feature | Description |
|---------|-------------|
| **Drive system** | Tension builds when idle — MAX wants to do things |
| **Heartbeat** | Background loop: curiosity tasks, self-monitoring |
| **Engineering swarm** | Breaks large tasks into parallel workers, synthesizes results |
| **Adversarial debate** | Argues both sides of a decision before committing |
| **6 Personas** | Architect, Grinder, Paranoid, Breaker, Explainer, Devil |
| **Tools** | File I/O, shell, web search, git, API caller, persistent memory |
| **Memory** | SQLite-backed — remembers across sessions |
| **Local-first** | Runs on Ollama — no cloud required |

---

## Quick start

```bash
# Clone
git clone https://github.com/your-username/max-agent.git
cd max-agent

# Install
npm install

# Configure (add at least one LLM backend)
cp config/api-keys.env.example config/api-keys.env
# edit config/api-keys.env

# Chat mode
node launcher.mjs

# Swarm a task
node launcher.mjs --mode swarm --task "audit this codebase for security issues"

# REST API mode
node launcher.mjs --mode api
```

---

## Requirements

- **Node.js** 18+
- **One AI backend**:
  - [Ollama](https://ollama.com) + `ollama pull llama3.2` — fully local, free
  - Gemini API key — fast, generous free tier
  - Any OpenAI-compatible endpoint

---

## Chat commands

```
/status     — show MAX's internal state (tension, curiosity, memory, etc.)
/swarm      — next message runs as a parallel swarm job
/debate     — next message gets debated (pro vs con vs arbiter)
/persona    — switch persona: architect / grinder / paranoid / breaker / explainer / devil
/clear      — wipe conversation context
/quit       — exit
```

---

## Personas

MAX switches personas automatically based on what you're asking. You can also force one with `/persona <name>` or `--persona <name>`.

| Persona | Good for |
|---------|----------|
| 🏛️ **Architect** | System design, patterns, long-term thinking |
| ⚙️ **Grinder** | Implementation, writing code, step-by-step |
| 🔒 **Paranoid** | Security review, threat modeling, vulnerabilities |
| 🔨 **Breaker** | Testing, edge cases, finding failure modes |
| 📡 **Explainer** | Teaching, simplifying complex topics |
| 😈 **Devil** | Devil's advocate, challenging assumptions |

---

## Engineering Swarm

The swarm breaks a task into parallel subtasks (up to 4 workers by default), runs them simultaneously, then synthesizes into a single answer.

```bash
# CLI swarm
node launcher.mjs --mode swarm --task "refactor the auth system for better security"

# API swarm
curl -X POST http://localhost:3100/api/swarm \
  -H "Content-Type: application/json" \
  -d '{"task": "analyze this codebase and produce a migration plan to TypeScript", "workers": 4}'
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

---

## Architecture

```
MAX/
├── core/
│   ├── MAX.js              — main agent class
│   ├── Brain.js            — LLM abstraction (Ollama / Gemini / OpenAI)
│   ├── DriveSystem.js      — tension/motivation engine
│   ├── Heartbeat.js        — autonomous background pulse
│   └── CuriosityEngine.js  — intrinsic motivation, exploration tasks
├── personas/
│   └── PersonaEngine.js    — 6 personas, auto-selection
├── tools/
│   ├── ToolRegistry.js
│   ├── FileTools.js        — read / write / search files
│   ├── ShellTool.js        — sandboxed shell execution
│   ├── WebTool.js          — DuckDuckGo search + page fetch
│   ├── GitTool.js          — git operations
│   └── ApiTool.js          — HTTP API caller
├── swarm/
│   └── SwarmCoordinator.js — parallel worker orchestration
├── debate/
│   └── DebateEngine.js     — adversarial reasoning
├── memory/
│   └── MemoryStore.js      — SQLite persistent memory
├── server/
│   └── server.js           — Express REST API
├── config/
│   └── api-keys.env.example
└── launcher.mjs            — CLI entry point
```

---

## Memory

MAX remembers things across sessions. Memory is stored in `.max/memory.db` (SQLite).

```js
// MAX stores automatically. You can also query directly via API:
GET /api/memory?type=curiosity&limit=20
GET /api/memory/search?q=authentication
GET /api/memory/conversation?limit=20
```

---

## Extending MAX

Add a new tool in `tools/`:

```js
export const MyTool = {
    name: 'mytool',
    description: 'What it does',
    actions: {
        async myAction({ param1, param2 }) {
            // do something
            return { success: true, result: '...' };
        }
    }
};
```

Register it in `core/MAX.js`:

```js
import { MyTool } from '../tools/MyTool.js';
// ...
this.tools.register(MyTool);
```

---

## License

MIT — Built by Barry.

Inspired by: SOMA's drive system, Steve's orchestration, Kevin's paranoid security layer, and the legend of Max Headroom.

# Maxwell Upgrade Roadmap
*Goal: Bring MAX to the same tier as Cursor, Devin, and Warp*

---

## Phase 1 — Quick Wins
*High impact, low effort. Ship these first.*

### ✅ 1. Terminal Error Explanation (Warp)
When any shell command exits non-zero, MAX auto-explains the error inline in the terminal panel.
- **Hook**: `ShellTool.js` → `setErrorExplainHandler` callback on failed runs
- **Brain**: fast tier, ~150 tokens, streams explanation
- **UI**: `maxwell.html` → `error_explain` WS message → styled `term-explain` block

### ✅ 2. @mention Context Injection (Cursor)
Type `@` in the chat input to inject file content, symbols, or web results as context.
- **Trigger**: `@` in chat input → picker dropdown (files from tree)
- **Resolve**: before send, read mentioned files via `/api/files/read` and prepend as context
- **Supported**: `@filename` (file content), future: `@symbol`, `@web`

### ✅ 3. Test-Driven Iteration Loop (Devin)
After BuildLoop writes code, auto-detect the test command, run it, feed failures back as the next step. Loop until green or 3 retries.
- **Where**: `core/loops/BuildLoop.js` → new `_runTestLoop()` phase after `_execute`
- **Detect**: reads `package.json` scripts for `test`, falls back to `npm test`
- **Loop**: up to `MAX_TEST_RETRIES=3` iterations

---

## Phase 2 — Core Intelligence
*Closes the Cursor gap.*

### 4. Semantic Repo Index
Embed every file using Ollama's `nomic-embed-text` model. Store in SQLite. Query at chat time to inject the top-5 most relevant file chunks into context automatically.
- **New file**: `core/SemanticIndex.js`
- **Trigger**: Sentinel watches file changes → re-embed on save
- **Query**: `SemanticIndex.search(query, topK=5)` called in `MAX._buildStateContext()`
- **Storage**: extend `soma-memory.db` with an `embeddings` table

### 5. Inline Diff UI in Maxwell
When MAX proposes file changes, hold them as pending diffs instead of writing immediately. Render in Maxwell with accept/reject per file.
- **Server**: `pending_diffs` map in `server.js`, new `diff_proposed` WS event
- **BuildLoop**: emit diff instead of write when `MAXWELL_DIFF_MODE=true`
- **UI**: Monaco diff editor component in maxwell.html, accept/reject buttons
- **Note**: `edit_proposed` / `edit_applied` WS events already exist — extend this pattern

---

## Phase 3 — Full Parity
*Closes the Devin gap.*

### 6. Browser Tool
Playwright wrapper that lets MAX navigate, click, read page content, and take screenshots.
- **New file**: `tools/BrowserTool.js`
- **Actions**: `navigate`, `click`, `type`, `extract_text`, `screenshot`
- **Register**: `tools/ToolRegistry.js`
- **Install**: `npm install playwright`

### 7. Sub-200ms Tab Completions
- Client: 150ms debounce before requesting
- Server: LRU cache keyed by `file:cursorOffset:prefix` — skip identical requests
- Speculative: pre-fetch when user pauses typing for 100ms
- Model: `qwen3:1.5b` (already configured) — keep this on fast tier only

### 8. Git Worktree Isolation per Task
Each AgentLoop goal runs in a dedicated `git worktree` at `.max/worktrees/<goal-id>/`.
- No risk to workspace during autonomous runs
- On success: merge back; on failure: discard
- **Where**: `core/AgentLoop.js` → `_setupWorktree()` / `_teardownWorktree()`
- **~150 lines**, mostly git commands

---

## Progress Tracker

| Feature | Status | Files Changed |
|---------|--------|---------------|
| Terminal error explanation | ✅ Done | ShellTool.js, server.js, maxwell.html |
| @mention context injection | ✅ Done | maxwell.html, server.js |
| Test-driven loop | ✅ Done | BuildLoop.js |
| Semantic repo index | ✅ Done | core/SemanticIndex.js, MAX.js, Sentinel.js |
| Inline diff UI | ✅ Done | Already built — file writes auto-route through WorkspaceEditArbiter when Maxwell is open |
| Browser tool | ✅ Done | tools/BrowserTool.js, core/MAX.js |
| Sub-200ms completions | ✅ Done | maxwell.html, server.js |
| Worktree isolation | ✅ Done | core/AgentLoop.js |

---

## Build Order
```
Week 1:  Terminal errors + @mention + test loop   ← MAX feels alive immediately
Week 2:  Semantic index + inline diff UI          ← closes the Cursor gap
Week 3:  Browser tool + worktree isolation        ← closes the Devin gap
Week 4:  Completion caching + polish              ← feels sub-200ms
```

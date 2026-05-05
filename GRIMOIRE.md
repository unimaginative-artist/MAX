# 📜 THE GRIMOIRE (v2.2)
## Current Session State: LEVEL 8.0/11 (STABILIZED CORE)

### 🔱 Physical Reality (Port Mappings)
- **SOMA Backend**: `localhost:3001` (Core Server & Dashboard API).
- **MAX Bridge**: `localhost:3100` (Agent Mind & Telemetry).
- **Local Engine**: `localhost:11434` (Ollama Auto-Pilot Managed).

### 💎 Sovereign Architecture (Updated)
1. **Ollama Auto-Pilot**: `launcher.mjs` now spawns `ollama serve` if not detected on boot.
2. **Circuit Breaker**: `Brain.js` fast-tier disables Ollama after 1 failure to prevent CPU spikes.
3. **Heartbeat Throttling**: 15s-120s pulse intervals for lower local resource usage.
4. **Pink-Contrast UI**: MAX labeled in `\x1b[38;5;213m` (Pink) for better visibility.
5. **Physical Prototypes**: Whale Website deployed to `C:\Users\barry\Desktop\WhaleWebsite`.

### 🛠️ Active Technical Hurdles
- [x] **PC Heat Spikes**: Resolved via heartbeat throttling and Ollama connection circuit breaker.
- [x] **Terminal UI Crashes**: Fixed `BOLD`/`DIM` undefined properties in `InputBridge.mjs`.
- [x] **Jest Confict**: Removed duplicate `jest.config.js` for clean test runs.

### 🔱 Operator Directive: UI FORGE
- **Status**: |= STANDBY (User developing Warp-style IDE frontend).
- **Role**: Sovereign Architect / Backend Support.

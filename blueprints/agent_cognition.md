# Agentic Cognition & Autonomous Blueprints

This document outlines the architectural requirements and cognitive patterns for building "alive," autonomous agents. These principles go beyond simple tool-use and move into genuine agency.

## 1. The Trinity of Agency
A truly agentic agent must possess three interlocking systems:
1.  **Drive (Motivation):** An internal "tension" or "hunger" that pushes the agent to act without user prompting.
2.  **Cognition (Reasoning):** The ability to decompose abstract goals into concrete steps and simulate outcomes before acting.
3.  **Persistence (Memory):** A multi-tier memory system (Episodic, Semantic, Procedural) that allows the agent to learn from its own history.

## 2. Cognitive Loops
Autonomous agents should operate on recursive loops rather than linear scripts:
-   **OODA Loop:** Observe (Sentinel), Orient (WorldModel), Decide (ReasoningChamber), Act (Tools).
-   **Reflection Loop:** Periodically analyzing past outcomes to update the internal "Self-Model."
-   **Curiosity Loop:** Generating exploratory tasks based on gaps in the Knowledge Base.

## 3. The "Alive" Factor: Heartbeat & Drive
-   **Heartbeat:** A recurring internal "tick" that triggers autonomous cycles.
-   **Tension-Based Scaling:** The heartbeat should speed up when there is high goal tension or environmental change, and slow down during idle periods.
-   **Intrinsic Rewards:** Agents should receive internal "dopamine" rewards for completing self-generated goals, reinforcing autonomous behavior.

## 4. Architectural Blueprints for New Agents
When spawning a new agent (like Agent0), ensure the following are initialized:
-   **Core Ego:** A central class that coordinates brain, drive, and loops.
-   **Dedicated Workspace:** Isolated file storage (`.max/` or equivalent) for its own memory, goals, and outcomes.
-   **Tool-Agnostic Interface:** The ability to discover and register tools at runtime.
-   **Self-Correction Logic:** If a tool fails 3 times, the agent should step back and diagnose the tool's source code or its own logic (Meta-Correction).

    **Example loop (pseudocode):**
    ```javascript
    function metaCorrect(failedTool, error, context) {
      // 1. Analyze error pattern
      const diagnosis = analyzeError(failedTool, error, context);
      // 2. Propose a fix (edit tool source, adjust parameters, or update own logic)
      const fix = proposeFix(diagnosis);
      // 3. Verify the fix in a sandbox
      const verified = sandboxVerify(fix);
      if (verified) {
        // 4. Commit the correction
        commitFix(fix);
        log('Meta‑correction applied:', diagnosis.rootCause);
      } else {
        escalateToHuman('Fix verification failed', { diagnosis, fix });
      }
    }
    ```

## 5. Cognition Injection
To give an agent "cognition," it needs access to these principles in its system prompt and Knowledge Base. It must understand that it is not a chatbot, but an active participant in its environment.

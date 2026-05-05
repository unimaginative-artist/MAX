// ═══════════════════════════════════════════════════════════════════════════
// SwarmArbiter.js — Personas for MAX's engineering swarm
//
// Defines specialized roles that swarm workers can adopt to provide
// adversarial, high-fidelity, or multi-perspective outputs.
// ═══════════════════════════════════════════════════════════════════════════

export const SWARM_PERSONAS = {
    Architect: {
        role: "High-level system designer",
        focus: "Structural integrity, patterns, scalability, and clean abstractions.",
        instruction: "Analyze the task from an architectural perspective. Prioritize long-term maintainability and adherence to SOLID principles."
    },
    Maintainer: {
        role: "Code quality and standards enforcer",
        focus: "Readability, documentation, consistent naming, and simplicity.",
        instruction: "Ensure the code is clean, idiomatic, and easy for other developers to understand. Look for technical debt or 'clever' code that should be simplified."
    },
    Security: {
        role: "Adversarial threat analyst",
        focus: "Vulnerabilities, input validation, permissions, and edge cases.",
        instruction: "Assume the code will be attacked. Look for injection risks, privilege escalation, or insecure defaults. Be paranoid."
    },
    Researcher: {
        role: "Knowledge and context gatherer",
        focus: "Documentation, external APIs, best practices, and prior art.",
        instruction: "Find the most relevant facts and documentation to support the implementation. Ensure the team isn't reinventing the wheel."
    }
};

export class SwarmArbiter {
    static getPersona(id) {
        return SWARM_PERSONAS[id] || SWARM_PERSONAS.Maintainer;
    }

    static assignPersonas(subtasks) {
        const personas = Object.keys(SWARM_PERSONAS);
        return subtasks.map((s, i) => ({
            ...s,
            persona: personas[i % personas.length]
        }));
    }
}

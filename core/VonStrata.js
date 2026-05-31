import { performance } from 'perf_hooks';

// Wrap any promise with a timeout
function withTimeout(promise, ms, label = 'operation') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timer);
    });
}

// Simple deterministic hash function for signatures
function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h >>> 0;
}

// ============================================================
// PAYLOAD
// ============================================================
export class Payload {
    constructor(data, context = {}) {
        this.data = data;
        this.context = context;
    }
}

// ============================================================
// PRIMITIVE TRANSFORM REGISTRY (BUILD-TIME AUDIT)
// ============================================================
export class TransformRegistry {
    static _registry = new Map();
    static _sealed = false;

    static register(name, fn) {
        if (this._sealed) {
            throw new Error("Registry is sealed");
        }
        // JS audit: verify fn is a simple callable
        if (typeof fn !== 'function') {
            throw new ValueError("Registered primitive must be a function");
        }
        this._registry.set(name, fn);
        return fn;
    }

    static seal() {
        this._sealed = true;
    }

    static get(name) {
        return this._registry.get(name);
    }

    static all() {
        return new Map(this._registry);
    }
}

// ============================================================
// BOOTSTRAP PRIMITIVES (AUDITED ONCE)
// ============================================================
TransformRegistry.register("normalize", (payload) => {
    return new Payload(String(payload.data), payload.context);
});

TransformRegistry.register("partition", (payload) => {
    if (Array.isArray(payload.data)) {
        return payload.data.map(x => new Payload(x, payload.context));
    }
    return payload;
});

TransformRegistry.register("hash", (payload) => {
    const str = typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data);
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return new Payload(h >>> 0, payload.context);
});

TransformRegistry.register("emit", (payload) => {
    return payload;
});

TransformRegistry.register("upper", (payload) => {
    if (typeof payload.data === 'string') {
        return new Payload(payload.data.toUpperCase(), payload.context);
    }
    return payload;
});

TransformRegistry.register("double", (payload) => {
    if (typeof payload.data === 'number') {
        return new Payload(payload.data * 2, payload.context);
    }
    return payload;
});

TransformRegistry.seal();

// ============================================================
// STRATUM CELL
// ============================================================
export class StratumCell {
    constructor(primitiveName, maxTimeSec = 1.0) {
        if (!TransformRegistry.all().has(primitiveName)) {
            throw new Error(`Unknown primitive: ${primitiveName}`);
        }
        this.primitiveName = primitiveName;
        this.maxTimeSec = maxTimeSec;
        this.signature = hashString(primitiveName);
    }

    get transform() {
        return TransformRegistry.get(this.primitiveName);
    }

    async execute(payload) {
        try {
            return await withTimeout(
                Promise.resolve(this.transform(payload)),
                this.maxTimeSec * 1000,
                `primitive:${this.primitiveName}`
            );
        } catch (err) {
            return null;
        }
    }

    getSignature() {
        return this.signature;
    }
}

// ============================================================
// COMPOSITION CELL
// ============================================================
export class CompositionCell {
    constructor(primitiveNames, maxTimeSec = 1.0) {
        for (const name of primitiveNames) {
            if (!TransformRegistry.all().has(name)) {
                throw new Error(`Unknown primitive: ${name}`);
            }
        }
        this.chain = Object.freeze([...primitiveNames]);
        this.maxTimeSec = maxTimeSec;
        this.signature = hashString(this.chain.join("->"));
    }

    async execute(payload) {
        try {
            let current = payload;
            return await withTimeout(
                (async () => {
                    for (const primName of this.chain) {
                        const fn = TransformRegistry.get(primName);
                        current = fn(current);
                        if (current === null || current === undefined) {
                            return null;
                        }
                    }
                    return current;
                })(),
                this.maxTimeSec * 1000,
                `chain:${this.chain.join("->")}`
            );
        } catch (err) {
            return null;
        }
    }

    getSignature() {
        return this.signature;
    }
}

// ============================================================
// STRUCTURAL MUTATION
// ============================================================
export class StructuralMutation {
    static extend(chain, primitiveName) {
        return new CompositionCell([...chain.chain, primitiveName], chain.maxTimeSec);
    }

    static splice(chainA, chainB) {
        return new CompositionCell([...chainA.chain, ...chainB.chain], chainA.maxTimeSec);
    }

    static truncate(chain, keep = null) {
        if (keep === null) {
            keep = Math.floor(Math.random() * chain.chain.length) + 1;
        }
        return new CompositionCell(chain.chain.slice(0, keep), chain.maxTimeSec);
    }

    static swap(chain, idx, newPrimitive) {
        const newChain = [...chain.chain];
        newChain[idx] = newPrimitive;
        return new CompositionCell(newChain, chain.maxTimeSec);
    }
}

// ============================================================
// ENVIRONMENT
// ============================================================
export class Environment {
    constructor(maxCompositions = 50) {
        this.compositions = new Set();
        for (const name of TransformRegistry.all().keys()) {
            this.compositions.add(new CompositionCell([name]));
        }
        this.maxCompositions = maxCompositions;

        this.metrics = new Map();
        this.executionCosts = new Map();
        this.outputDiversity = new Map();
        this.lineage = new Map();
        this.compositionMap = new Map();

        for (const comp of this.compositions) {
            this.compositionMap.set(comp.signature, comp);
        }
    }

    async inject(composition, payload) {
        const start = performance.now();
        const result = await composition.execute(payload);
        const execTime = (performance.now() - start) / 1000;

        let contextKey = 'default';
        if (payload.context) {
            if (typeof payload.context === 'string') {
                contextKey = payload.context;
            } else if (payload.context.label) {
                contextKey = payload.context.label;
            } else if (typeof payload.context === 'object') {
                contextKey = JSON.stringify(payload.context);
            }
        }

        if (!this.metrics.has(contextKey)) {
            this.metrics.set(contextKey, new Map());
        }
        const contextMap = this.metrics.get(contextKey);

        const sig = composition.signature;
        if (!this.compositionMap.has(sig)) {
            this.compositionMap.set(sig, composition);
        }

        if (result === null || result === undefined) {
            const currentScore = contextMap.get(sig) || 0;
            contextMap.set(sig, currentScore - 2.0);
        } else {
            this.score(composition, contextKey, result, execTime);
        }

        return result;
    }

    score(composition, contextKey, output, execTime) {
        const sig = composition.signature;
        const base = this.utility(output);

        if (!this.executionCosts.has(sig)) {
            this.executionCosts.set(sig, []);
        }
        this.executionCosts.get(sig).push(execTime);
        const costPenalty = Math.min(execTime / 0.05, 2.0);

        if (!this.outputDiversity.has(sig)) {
            this.outputDiversity.set(sig, new Set());
        }
        const divSet = this.outputDiversity.get(sig);

        let outputStr = '';
        if (output instanceof Payload) {
            outputStr = String(output.data);
        } else if (Array.isArray(output)) {
            outputStr = JSON.stringify(output.map(p => p.data));
        } else {
            outputStr = String(output);
        }
        const h = hashString(outputStr);
        divSet.add(h);

        const diversityBonus = divSet.size * 0.01;
        const score = (base / Math.max(costPenalty, 0.1)) + diversityBonus;

        const contextMap = this.metrics.get(contextKey);
        const currentScore = contextMap.get(sig) || 0;
        contextMap.set(sig, currentScore + score);
    }

    utility(output) {
        if (output === null || output === undefined) {
            return -1.0;
        }
        if (output instanceof Payload) {
            return 1.0;
        }
        if (Array.isArray(output)) {
            return output.length * 0.5;
        }
        return 0.5;
    }

    spawnVariant(base) {
        if (this.compositions.size >= this.maxCompositions) {
            this._cullWeakest();
        }

        const mutationTypes = ["extend", "splice", "truncate", "swap"];
        const mutationType = mutationTypes[Math.floor(Math.random() * mutationTypes.length)];

        try {
            let variant = null;
            const primKeys = Array.from(TransformRegistry.all().keys());

            if (mutationType === "extend") {
                const prim = primKeys[Math.floor(Math.random() * primKeys.length)];
                variant = StructuralMutation.extend(base, prim);
            } else if (mutationType === "splice") {
                const compArray = Array.from(this.compositions);
                const candidates = compArray.filter(c => c.signature !== base.signature);
                if (candidates.length > 0) {
                    const partner = candidates[Math.floor(Math.random() * candidates.length)];
                    variant = StructuralMutation.splice(base, partner);
                }
            } else if (mutationType === "truncate") {
                if (base.chain.length > 1) {
                    variant = StructuralMutation.truncate(base);
                } else {
                    return null;
                }
            } else if (mutationType === "swap") {
                if (base.chain.length > 0) {
                    const idx = Math.floor(Math.random() * base.chain.length);
                    const prim = primKeys[Math.floor(Math.random() * primKeys.length)];
                    variant = StructuralMutation.swap(base, idx, prim);
                } else {
                    return null;
                }
            }

            if (variant) {
                this.compositions.add(variant);
                this.compositionMap.set(variant.signature, variant);

                if (!this.lineage.has(variant.signature)) {
                    this.lineage.set(variant.signature, new Set());
                }
                this.lineage.get(variant.signature).add(base.signature);
                return variant;
            }
            return null;
        } catch (err) {
            return null;
        }
    }

    _cullWeakest() {
        const scores = new Map();
        for (const comp of this.compositions) {
            let totalScore = 0;
            for (const context of this.metrics.keys()) {
                const contextMap = this.metrics.get(context);
                totalScore += contextMap.get(comp.signature) || 0;
            }
            scores.set(comp.signature, totalScore);
        }

        let weakestSig = null;
        let lowestScore = Infinity;
        for (const [sig, score] of scores.entries()) {
            if (score < lowestScore) {
                lowestScore = score;
                weakestSig = sig;
            }
        }

        if (weakestSig !== null) {
            const weakestObj = this.compositionMap.get(weakestSig);
            if (weakestObj) {
                this.kill(weakestObj);
            }
        }
    }

    kill(composition) {
        const sig = composition.signature;
        this.compositions.delete(composition);
        this.compositionMap.delete(sig);
        this.executionCosts.delete(sig);
        this.outputDiversity.delete(sig);
        this.lineage.delete(sig);
        for (const context of this.metrics.keys()) {
            this.metrics.get(context).delete(sig);
        }
    }
}

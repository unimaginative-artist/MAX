
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

/**
 * WorldModel — The mental simulation engine for MAX.
 * Predicts future states and quantifies uncertainty before acting.
 */
export class WorldModel extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max = max;
        this.config = {
            maxLookAhead: 5,
            minConfidenceToAct: 0.6,
            learningRate: 0.1,
            storagePath: path.join(process.cwd(), '.max', 'world_model.json'),
            ...config
        };

        // transitionModel: Map of (stateKey|action) -> { observations, nextStates, avgReward, avgLatency }
        this.transitionModel = new Map();
        this.stateHistory    = [];
        this.stats = {
            simulationsRun: 0,
            predictionsCorrect: 0,
            predictionsTested: 0,
            avgError: 0
        };
    }

    async initialize() {
        await this.load();
        console.log(`[WorldModel] 🌍 Mental simulation engine ready. ${this.transitionModel.size} states modeled.`);
    }

    /**
     * Capture the current system state as a serializable object.
     */
    getCurrentState() {
        const status = this.max.getStatus();
        return {
            tension:      status.drive.tension,
            satisfaction: status.drive.satisfaction,
            goalCount:    status.goals?.active || 0,
            successRate:  status.outcomes?.success / (status.outcomes?.total || 1),
            persona:      status.persona.id
        };
    }

    /**
     * Observe a real transition and update the model.
     */
    async recordTransition(action, nextState, reward, telemetry = {}) {
        const priorState = this.stateHistory[this.stateHistory.length - 1]?.state || this.getCurrentState();
        
        const key = this._getTransitionKey(priorState, action);
        if (!this.transitionModel.has(key)) {
            this.transitionModel.set(key, { observations: 0, nextStates: new Map(), avgReward: 0, avgLatency: 0 });
        }

        const model = this.transitionModel.get(key);
        model.observations++;

        const nextStateKey = JSON.stringify(this._normalize(nextState));
        const count = (model.nextStates.get(nextStateKey) || 0) + 1;
        model.nextStates.set(nextStateKey, count);

        // Update learned dynamics (EMA)
        const lr = this.config.learningRate;
        model.avgReward  = model.avgReward  + lr * (reward - model.avgReward);
        if (telemetry.latency) {
            model.avgLatency = model.avgLatency + lr * (telemetry.latency - model.avgLatency);
        }

        this.stateHistory.push({ state: nextState, action, timestamp: Date.now() });
        if (this.stateHistory.length > 1000) this.stateHistory.shift();

        await this.save();
    }

    /**
     * Simulate the outcome of an action without executing it.
     */
    simulate(state, action) {
        this.stats.simulationsRun++;
        const key = this._getTransitionKey(state, action);
        
        if (!this.transitionModel.has(key)) {
            return { nextState: state, reward: 0, confidence: 0, latency: 500 };
        }

        const model = this.transitionModel.get(key);
        
        // Find most probable next state
        let bestStateKey = null;
        let maxCount = 0;
        for (const [sK, count] of model.nextStates.entries()) {
            if (count > maxCount) {
                maxCount = count;
                bestStateKey = sK;
            }
        }

        const confidence = Math.min(0.95, (model.observations / 5) * (maxCount / model.observations));

        return {
            nextState:  bestStateKey ? JSON.parse(bestStateKey) : state,
            reward:     model.avgReward,
            latency:    model.avgLatency,
            confidence
        };
    }

    _getTransitionKey(state, action) {
        return `${JSON.stringify(this._normalize(state))}|${action}`;
    }

    _normalize(state) {
        // Round floats to prevent key explosion
        return {
            tension:      Math.round((state.tension || 0) * 10) / 10,
            satisfaction: Math.round((state.satisfaction || 0) * 10) / 10,
            goalCount:    state.goalCount || 0,
            persona:      state.persona || 'grinder'
        };
    }

    async save() {
        try {
            const data = {
                transitions: Array.from(this.transitionModel.entries()).map(([k, v]) => [k, { 
                    ...v, 
                    nextStates: Array.from(v.nextStates.entries()) 
                }]),
                stats: this.stats
            };
            await fs.writeFile(this.config.storagePath, JSON.stringify(data, null, 2));
        } catch {}
    }

    async load() {
        try {
            const raw = await fs.readFile(this.config.storagePath, 'utf8');
            const data = JSON.parse(raw);
            this.transitionModel = new Map(data.transitions.map(([k, v]) => [k, {
                ...v,
                nextStates: new Map(v.nextStates)
            }]));
            this.stats = data.stats || this.stats;
        } catch {}
    }
}

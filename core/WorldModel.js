
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

/**
 * WorldModel — The mental simulation engine for MAX.
 * Predicts future states and quantifies uncertainty before acting.
 * Upgraded with SOMA-spec look-ahead planning and scenario simulation.
 */
export class WorldModel extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max = max;
        this.config = {
            maxLookAhead:       config.maxLookAhead       || 5,
            minConfidenceToAct: config.minConfidenceToAct || 0.6,
            learningRate:       config.learningRate       || 0.1,
            uncertaintyPenalty: config.uncertaintyPenalty || 0.2,
            storagePath:        config.storagePath        || path.join(process.cwd(), '.max', 'world_model.json'),
            ...config
        };

        // transitionModel: Map of (stateKey|action) -> { observations, nextStates: Map, avgReward, avgLatency }
        this.transitionModel = new Map();
        
        // rewardModel: Map of stateKey -> { count, totalReward, avgReward }
        this.rewardModel = new Map();

        // planCache: Cache simulated plans for performance
        this.planCache = new Map();

        this.stateHistory = [];
        this.stats = {
            simulationsRun: 0,
            predictionsCorrect: 0,
            predictionsTested: 0,
            avgError: 0,
            plansGenerated: 0
        };

        console.log('🌍 [WorldModel] Mental simulation engine initialized');
    }

    async initialize() {
        await this.load();
        console.log(`[WorldModel] ✅ Engine ready. ${this.transitionModel.size} transitions modeled.`);
    }

    /**
     * Capture the current system state as a serializable object.
     */
    getCurrentState() {
        const status = this.max.getStatus();
        const drive  = status.drive || { tension: 0, satisfaction: 0 };
        return {
            tension:      drive.tension,
            satisfaction: drive.satisfaction,
            goalCount:    status.goals?.active || 0,
            successRate:  status.outcomes?.success / (status.outcomes?.total || 1),
            persona:      status.persona?.id || 'engineer',
            isThinking:   this.max.isThinking
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

        const nextStateKey = this._getStateKey(nextState);
        const count = (model.nextStates.get(nextStateKey) || 0) + 1;
        model.nextStates.set(nextStateKey, count);

        // Update learned dynamics (EMA)
        const lr = this.config.learningRate;
        model.avgReward  = model.avgReward  + lr * (reward - model.avgReward);
        if (telemetry.latency) {
            model.avgLatency = model.avgLatency + lr * (telemetry.latency - model.avgLatency);
        }

        // Update reward model
        this._updateRewardModel(nextStateKey, reward);

        // Validate any existing predictions
        this._validatePrediction(priorState, action, nextState);

        this.stateHistory.push({ state: nextState, action, timestamp: Date.now() });
        if (this.stateHistory.length > 1000) this.stateHistory.shift();

        // Clear plan cache when the world changes
        this.planCache.clear();

        await this.save();
    }

    /**
     * Simulate the outcome of an action without executing it.
     */
    simulate(state, action) {
        this.stats.simulationsRun++;
        const key = this._getTransitionKey(state, action);
        
        if (!this.transitionModel.has(key)) {
            return { 
                nextState: state, 
                reward: 0, 
                confidence: 0.1, 
                latency: 500 
            };
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

        // Confidence calculation: observation count + distribution purity
        const confidence = Math.min(0.95, (model.observations / 10) * (maxCount / model.observations));

        return {
            nextState:  bestStateKey ? JSON.parse(bestStateKey) : state,
            reward:     model.avgReward,
            latency:    model.avgLatency,
            confidence
        };
    }

    /**
     * Plan ahead multiple steps using tree search
     */
    planAhead(currentState, possibleActions, depth = 3) {
        depth = Math.min(depth, this.config.maxLookAhead);
        this.stats.plansGenerated++;

        const cacheKey = `${this._getStateKey(currentState)}_${depth}`;
        if (this.planCache.has(cacheKey)) return this.planCache.get(cacheKey);

        const bestPlan = this._searchPlanTree(currentState, possibleActions, depth, 0);
        this.planCache.set(cacheKey, bestPlan);

        return bestPlan;
    }

    /**
     * Recursive tree search for best plan
     */
    _searchPlanTree(state, possibleActions, maxDepth, currentDepth, pathSoFar = []) {
        if (currentDepth >= maxDepth) {
            return { actions: pathSoFar, totalReward: 0, confidence: 1.0 };
        }

        let bestPlan = null;
        let bestValue = -Infinity;

        for (const action of possibleActions) {
            const { nextState, reward, confidence } = this.simulate(state, action);

            // Penalize uncertainty (SOMA Protocol)
            const adjustedReward = reward - (1 - confidence) * this.config.uncertaintyPenalty;

            const futurePlan = this._searchPlanTree(nextState, possibleActions, maxDepth, currentDepth + 1, [...pathSoFar, action]);

            // Discount future rewards (temporal decay)
            const discountFactor = 0.9;
            const totalValue = adjustedReward + discountFactor * futurePlan.totalReward;

            if (totalValue > bestValue) {
                bestValue = totalValue;
                bestPlan = {
                    actions: [...pathSoFar, action],
                    nextState,
                    totalReward: totalValue,
                    confidence: confidence * futurePlan.confidence
                };
            }
        }

        return bestPlan || { actions: pathSoFar, totalReward: 0, confidence: 0 };
    }

    /**
     * Recommend the best next action based on mental simulation
     */
    recommendAction(currentState, possibleActions) {
        const plan = this.planAhead(currentState, possibleActions, 3);

        if (plan.actions.length === 0 || plan.confidence < this.config.minConfidenceToAct) {
            return {
                action: null,
                confidence: plan.confidence,
                reasoning: plan.confidence < this.config.minConfidenceToAct 
                    ? `Simulated uncertainty too high (${(plan.confidence * 100).toFixed(1)}%)`
                    : 'No rewarding paths found in mental simulation'
            };
        }

        return {
            action: plan.actions[0],
            expectedReward: plan.totalReward,
            confidence: plan.confidence,
            reasoning: `Look-ahead simulation (depth 3) favors path: ${plan.actions.join(' -> ')}`
        };
    }

    /**
     * Generate "What If" scenarios for the ReasoningChamber
     */
    generateWhatIfScenarios(currentState, scenarios) {
        return scenarios.map(scenario => {
            const { actions, description } = scenario;
            let state = currentState;
            let totalReward = 0;
            let minConfidence = 1.0;
            const trajectory = [state];

            for (const action of actions) {
                const sim = this.simulate(state, action);
                state = sim.nextState;
                totalReward += sim.reward;
                minConfidence = Math.min(minConfidence, sim.confidence);
                trajectory.push(state);
            }

            return {
                description: description || actions.join(' -> '),
                finalState: state,
                totalReward,
                confidence: minConfidence,
                trajectory
            };
        });
    }

    _updateRewardModel(stateKey, reward) {
        if (!this.rewardModel.has(stateKey)) {
            this.rewardModel.set(stateKey, { count: 0, totalReward: 0, avgReward: 0 });
        }
        const model = this.rewardModel.get(stateKey);
        model.count++;
        model.totalReward += reward;
        model.avgReward = model.totalReward / model.count;
    }

    _validatePrediction(priorState, action, actualNextState) {
        const prediction = this.simulate(priorState, action);
        if (prediction.confidence > 0.3) {
            this.stats.predictionsTested++;
            const predictedKey = this._getStateKey(prediction.nextState);
            const actualKey    = this._getStateKey(actualNextState);
            
            if (predictedKey === actualKey) {
                this.stats.predictionsCorrect++;
            }
            
            const error = predictedKey === actualKey ? 0 : 1;
            this.stats.avgError = this.stats.avgError + this.config.learningRate * (error - this.stats.avgError);
        }
    }

    _getStateKey(state) {
        return JSON.stringify(this._normalize(state));
    }

    _getTransitionKey(state, action) {
        return `${this._getStateKey(state)}|${action}`;
    }

    _normalize(state) {
        return {
            tension:      Math.round((state.tension || 0) * 10) / 10,
            satisfaction: Math.round((state.satisfaction || 0) * 10) / 10,
            goalCount:    state.goalCount || 0,
            persona:      state.persona || 'engineer',
            isThinking:   !!state.isThinking
        };
    }

    async save() {
        try {
            const data = {
                transitions: Array.from(this.transitionModel.entries()).map(([k, v]) => [k, { 
                    ...v, 
                    nextStates: Array.from(v.nextStates.entries()) 
                }]),
                rewards: Array.from(this.rewardModel.entries()),
                stats:   this.stats,
                savedAt: new Date().toISOString()
            };
            await fs.writeFile(this.config.storagePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[WorldModel] ❌ Save failed:', err.message);
        }
    }

    async load() {
        try {
            const raw = await fs.readFile(this.config.storagePath, 'utf8');
            const data = JSON.parse(raw);
            this.transitionModel = new Map(data.transitions.map(([k, v]) => [k, {
                ...v,
                nextStates: new Map(v.nextStates)
            }]));
            this.rewardModel = new Map(data.rewards || []);
            this.stats = data.stats || this.stats;
        } catch (err) {
            // New file or corrupted
        }
    }

    getCurrentAccuracy() {
        if (this.stats.predictionsTested === 0) return 0;
        return (this.stats.predictionsCorrect / this.stats.predictionsTested) * 100;
    }
}

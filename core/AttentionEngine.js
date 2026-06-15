/**
 * MAXWELL ATTENTION ENGINE v0.1
 *
 * Attention = resource permission.
 * It decides how much cognitive effort Maxwell should spend.
 */

export const ATTENTION_VERSION = '0.1.0';

export const ATTENTION_PRIORITY = {
  IGNORE: 'IGNORE',
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

export const ATTENTION_COST = {
  REFLEX: 'REFLEX',       // cheapest
  LOCAL: 'LOCAL',         // local LLM / local reasoning
  MEMORY: 'MEMORY',       // retrieval + local
  BRIDGE: 'BRIDGE',       // escalate
  INTERRUPT: 'INTERRUPT', // alert / pin / force focus
};

export class AttentionEngine {
  constructor(config = {}) {
    this.config = {
      debug: false,
      activeGoals: [],
      currentProject: null,
      userMood: null,
      ...config,
    };

    this.weights = {
      urgency: 0.30,
      intent: 0.22,
      goal: 0.20,
      novelty: 0.13,
      emotion: 0.10,
      tension: 0.05,
    };

    this.recentTopics = [];
    this.tensions = new Map();
  }

  evaluate(message, context = {}) {
    const normalized = this._normalize(message);

    const signals = {
      urgency: this._scoreUrgency(normalized),
      intent: this._scoreIntent(normalized),
      goal: this._scoreGoalRelevance(normalized, context),
      novelty: this._scoreNovelty(normalized),
      emotion: this._scoreEmotion(normalized),
      tension: this._scoreTension(normalized, context),
    };

    const score = this._weightedScore(signals);
    const priority = this._priority(score);
    const allowedCost = this._allowedCost(score, signals);
    const memoryAction = this._memoryAction(score, signals);

    const result = {
      version: ATTENTION_VERSION,
      score,
      priority,
      allowedCost,
      memoryAction,
      interruptible: score >= 0.9,
      reasons: this._reasons(signals),
      signals,
      timestamp: Date.now(),
    };

    this._rememberTopic(normalized);

    if (this.config.debug) {
      console.log('[ATTENTION]', result);
    }

    return result;
  }

  addTension(id, data = {}) {
    this.tensions.set(id, {
      id,
      level: data.level ?? 0.5,
      topic: data.topic ?? '',
      goal: data.goal ?? '',
      status: data.status ?? 'open',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      decayRate: data.decayRate ?? 0.03,
      ...data,
    });
  }

  resolveTension(id) {
    const tension = this.tensions.get(id);
    if (!tension) return false;

    tension.status = 'resolved';
    tension.level = 0;
    tension.updatedAt = Date.now();
    this.tensions.set(id, tension);
    return true;
  }

  decayTensions() {
    for (const [id, tension] of this.tensions.entries()) {
      if (tension.status !== 'open') continue;

      tension.level = Math.max(0, tension.level - tension.decayRate);
      tension.updatedAt = Date.now();

      if (tension.level <= 0.05) {
        this.tensions.delete(id);
      } else {
        this.tensions.set(id, tension);
      }
    }
  }

  // ─────────────────────────────────────────────

  _normalize(message) {
    return String(message || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  _scoreUrgency(msg) {
    let score = 0;

    if (/\b(urgent|asap|right now|immediately|emergency|critical|broken|crashing|failed|failure)\b/i.test(msg)) {
      score += 0.75;
    }

    if (/\b(help|stuck|blocked|can't|cannot|won't work|doesn't work)\b/i.test(msg)) {
      score += 0.35;
    }

    if (/[!]{2,}/.test(msg)) {
      score += 0.15;
    }

    return this._clamp(score);
  }

  _scoreIntent(msg) {
    if (msg.length < 3) return 0.1;

    if (/\b(build|fix|debug|design|create|implement|refactor|analyze|explain|compare|plan)\b/i.test(msg)) {
      return 0.85;
    }

    if (/\b(open|show|find|search|save|remember|send|start)\b/i.test(msg)) {
      return 0.75;
    }

    if (/\?$/.test(msg)) {
      return 0.6;
    }

    if (/^(ok|lol|haha|nice|thanks|cool|yep|nope)$/i.test(msg)) {
      return 0.2;
    }

    return 0.45;
  }

  _scoreGoalRelevance(msg, context) {
    const goals = [
      ...(this.config.activeGoals || []),
      ...(context.activeGoals || []),
    ];

    if (context.currentProject) goals.push(context.currentProject);
    if (this.config.currentProject) goals.push(this.config.currentProject);

    if (!goals.length) return 0.25;

    let best = 0;

    for (const goal of goals) {
      const words = String(goal).toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const hits = words.filter(w => msg.includes(w)).length;
      const score = words.length ? hits / words.length : 0;
      best = Math.max(best, score);
    }

    return this._clamp(best);
  }

  _scoreNovelty(msg) {
    if (!this.recentTopics.length) return 0.6;

    const msgWords = new Set(msg.split(/\W+/).filter(w => w.length > 3));
    if (!msgWords.size) return 0.2;

    let maxOverlap = 0;

    for (const topic of this.recentTopics) {
      const topicWords = new Set(topic.split(/\W+/).filter(w => w.length > 3));
      const overlap = [...msgWords].filter(w => topicWords.has(w)).length;
      maxOverlap = Math.max(maxOverlap, overlap / msgWords.size);
    }

    return this._clamp(1 - maxOverlap);
  }

  _scoreEmotion(msg) {
    if (/\b(stressed|worried|scared|angry|frustrated|overwhelmed|tired|exhausted|confused)\b/i.test(msg)) {
      return 0.85;
    }

    if (/\b(excited|happy|proud|love|amazing|beautiful|awesome)\b/i.test(msg)) {
      return 0.55;
    }

    return 0.2;
  }

  _scoreTension(msg, context) {
    let best = 0;

    for (const tension of this.tensions.values()) {
      if (tension.status !== 'open') continue;

      const topic = `${tension.topic} ${tension.goal}`.toLowerCase();
      const words = topic.split(/\W+/).filter(w => w.length > 3);

      if (!words.length) {
        best = Math.max(best, tension.level);
        continue;
      }

      const hits = words.filter(w => msg.includes(w)).length;
      if (hits > 0) {
        best = Math.max(best, tension.level * (hits / words.length));
      }
    }

    return this._clamp(best);
  }

  _weightedScore(signals) {
    const score =
      signals.urgency * this.weights.urgency +
      signals.intent * this.weights.intent +
      signals.goal * this.weights.goal +
      signals.novelty * this.weights.novelty +
      signals.emotion * this.weights.emotion +
      signals.tension * this.weights.tension;

    return Number(this._clamp(score).toFixed(3));
  }

  _priority(score) {
    if (score >= 0.9) return ATTENTION_PRIORITY.CRITICAL;
    if (score >= 0.72) return ATTENTION_PRIORITY.HIGH;
    if (score >= 0.45) return ATTENTION_PRIORITY.NORMAL;
    if (score >= 0.25) return ATTENTION_PRIORITY.LOW;
    return ATTENTION_PRIORITY.IGNORE;
  }

  _allowedCost(score, signals) {
    if (score >= 0.9) return ATTENTION_COST.INTERRUPT;
    if (score >= 0.72) return ATTENTION_COST.BRIDGE;
    if (signals.goal > 0.6 || signals.tension > 0.5) return ATTENTION_COST.MEMORY;
    if (score >= 0.45) return ATTENTION_COST.LOCAL;
    return ATTENTION_COST.REFLEX;
  }

  _memoryAction(score, signals) {
    if (score >= 0.85 || signals.tension > 0.75) return 'PIN';
    if (score >= 0.65 || signals.goal > 0.65) return 'SUMMARIZE';
    if (score >= 0.45) return 'KEEP';
    return 'DISCARD';
  }

  _reasons(signals) {
    const reasons = [];

    if (signals.urgency > 0.6) reasons.push('urgent');
    if (signals.intent > 0.7) reasons.push('clear_intent');
    if (signals.goal > 0.6) reasons.push('goal_relevant');
    if (signals.novelty > 0.7) reasons.push('novel');
    if (signals.emotion > 0.6) reasons.push('emotionally_weighted');
    if (signals.tension > 0.5) reasons.push('unresolved_tension');

    return reasons;
  }

  _rememberTopic(msg) {
    this.recentTopics.push(msg);
    if (this.recentTopics.length > 20) {
      this.recentTopics.shift();
    }
  }

  _clamp(n) {
    return Math.min(1, Math.max(0, Number(n) || 0));
  }
}

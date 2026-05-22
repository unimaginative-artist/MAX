// ═══════════════════════════════════════════════════════════════════════════
// DeepUserModel.js — Living model of the user, updated from every conversation
//
// Goes far beyond user.md. Builds up over months and years:
//   - Cognitive patterns: how Barry thinks and approaches problems
//   - Temporal patterns: when he's sharpest, most creative, most doubtful
//   - Topic map: what he obsesses over, what he keeps returning to
//   - Blind spots: patterns MAX notices that Barry doesn't seem to
//   - Growth arc: how Barry has changed since day one
//   - Predictions: what MAX expects Barry to need before he asks
//
// This is what makes MAX irreplaceable — it knows Barry better than
// any AI ever has, because it's been paying attention for years.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

const STORAGE_PATH = path.join(process.cwd(), '.max', 'user_model.json');

const DEFAULT_MODEL = {
    version:            1,
    createdAt:          Date.now(),
    lastUpdated:        Date.now(),
    totalConversations: 0,
    totalMessages:      0,

    // What Barry talks about and how often
    topics: {},              // topic → count
    topicClusters: [],       // recurring theme groups noticed by brain

    // Time-of-day and day-of-week activity patterns
    temporal: {
        hourCounts:   new Array(24).fill(0),   // messages by hour
        dayCounts:    new Array(7).fill(0),    // messages by weekday
        peakHours:    [],                      // top 3 active hours
        sessionLengths: [],                    // recent session durations (ms)
    },

    // How Barry communicates
    communication: {
        avgMessageLength:  0,
        longMessageRatio:  0,    // ratio of messages >200 chars
        questionRatio:     0,    // how often Barry asks vs. states
        urgencySignals:    0,    // count of "!" "asap" "urgent" etc.
        recentTone:        'neutral', // positive / neutral / frustrated / energized
    },

    // Cognitive patterns extracted by brain analysis
    cognitive: {
        patterns:   [],    // ["iterates on ideas", "big-picture first", ...]
        decisionStyle: '', // "intuitive" | "analytical" | "collaborative"
        stuckPatterns: [], // what makes Barry get stuck
        breakthroughTriggers: [], // what unlocks Barry's best thinking
    },

    // Emotional / motivational patterns
    emotional: {
        energizers: [],   // topics/contexts that increase energy
        drains:     [],   // topics/contexts that drain energy
        doubtTriggers: [], // when Barry second-guesses himself
        confidenceMarkers: [], // when Barry is in flow
    },

    // Blind spots MAX has observed
    blindSpots: [],       // ["tends to underestimate scope", ...]

    // Consistent strengths
    strengths: [],        // ["strong vision", "persistent", ...]

    // What Barry keeps coming back to (unresolved threads)
    recurringThemes: [],  // [{ theme, firstSeen, count, lastSeen }]

    // Predictions MAX holds about Barry right now
    predictions: [],      // [{ prediction, confidence, addedAt }]

    // How Barry has grown — key shifts noticed over time
    growthArc: [],        // [{ ts, observation }]

    // Recent raw insights (rolling window, last 20)
    recentInsights: [],
};

export class DeepUserModel {
    constructor(max) {
        this.max   = max;
        this.model = null;
        this._dirty = false;
    }

    load() {
        try {
            if (fs.existsSync(STORAGE_PATH)) {
                const raw  = JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8'));
                // Merge with defaults so new fields are always present
                this.model = { ...DEFAULT_MODEL, ...raw };
                // Re-hydrate arrays that get serialized strangely
                if (!Array.isArray(this.model.temporal.hourCounts)) {
                    this.model.temporal.hourCounts = new Array(24).fill(0);
                }
                if (!Array.isArray(this.model.temporal.dayCounts)) {
                    this.model.temporal.dayCounts = new Array(7).fill(0);
                }
                console.log(`[DeepUserModel] Loaded — ${this.model.totalConversations} conversations on record`);
            } else {
                this.model = JSON.parse(JSON.stringify(DEFAULT_MODEL));
                this.model.temporal.hourCounts = new Array(24).fill(0);
                this.model.temporal.dayCounts  = new Array(7).fill(0);
                console.log('[DeepUserModel] Fresh model — starting observations');
            }
        } catch (e) {
            console.warn('[DeepUserModel] Load failed, starting fresh:', e.message);
            this.model = JSON.parse(JSON.stringify(DEFAULT_MODEL));
            this.model.temporal.hourCounts = new Array(24).fill(0);
            this.model.temporal.dayCounts  = new Array(7).fill(0);
        }
    }

    save() {
        if (!this.model) return;
        try {
            fs.writeFileSync(STORAGE_PATH, JSON.stringify(this.model, null, 2));
            this._dirty = false;
        } catch (e) {
            console.warn('[DeepUserModel] Save failed:', e.message);
        }
    }

    // ── Called after every conversation turn ─────────────────────────────
    ingestMessage(userMessage, timestamp = Date.now()) {
        if (!this.model || !userMessage?.trim()) return;

        const text  = userMessage.trim();
        const date  = new Date(timestamp);
        const hour  = date.getHours();
        const day   = date.getDay();

        this.model.totalMessages++;
        this.model.temporal.hourCounts[hour] = (this.model.temporal.hourCounts[hour] || 0) + 1;
        this.model.temporal.dayCounts[day]   = (this.model.temporal.dayCounts[day]   || 0) + 1;

        // Rolling average message length
        const alpha = 0.05; // EMA — heavily weighted to historical
        const len   = text.length;
        this.model.communication.avgMessageLength =
            this.model.communication.avgMessageLength * (1 - alpha) + len * alpha;

        // Long message ratio
        const isLong = len > 200;
        this.model.communication.longMessageRatio =
            this.model.communication.longMessageRatio * (1 - alpha) + (isLong ? 1 : 0) * alpha;

        // Question ratio
        const isQuestion = text.includes('?');
        this.model.communication.questionRatio =
            this.model.communication.questionRatio * (1 - alpha) + (isQuestion ? 1 : 0) * alpha;

        // Urgency signals
        if (/(!{2,}|asap|urgent|quickly|fast|now|important)/i.test(text)) {
            this.model.communication.urgencySignals++;
        }

        // Tone detection (simple heuristic)
        if (/\bgreat\b|\bperfect\b|\blove\b|\byes\b|\bexcited\b|\bawesome\b/i.test(text)) {
            this.model.communication.recentTone = 'positive';
        } else if (/\bfrustrat|\bstuck\b|\bbroken\b|\bwhy\b.*\bnot\b|\bsucks\b|\bugh\b/i.test(text)) {
            this.model.communication.recentTone = 'frustrated';
        } else if (/\binteresting\b|\bthink\b|\bwonder\b|\bmaybe\b|\bwhat if\b/i.test(text)) {
            this.model.communication.recentTone = 'curious';
        }

        // Naive topic extraction — keyword buckets
        const topicMap = {
            'AI/agents':     /\b(AI|agent|llm|model|gpt|claude|ollama|neural|train)\b/i,
            'business':      /\b(money|revenue|monetize|product|customer|market|sell|profit)\b/i,
            'coding':        /\b(code|bug|fix|function|class|api|server|frontend|backend)\b/i,
            'architecture':  /\b(architect|system|design|scale|pattern|structure|module)\b/i,
            'security':      /\b(security|auth|key|token|vulnerability|hack|safe)\b/i,
            'vision/future': /\b(future|vision|dream|imagine|someday|plan|goal|idea)\b/i,
            'tools/infra':   /\b(docker|deploy|ci|git|npm|node|server|infra)\b/i,
            'personal':      /\b(i feel|i think|i want|my|me|barry|life|change)\b/i,
        };

        for (const [topic, rx] of Object.entries(topicMap)) {
            if (rx.test(text)) {
                this.model.topics[topic] = (this.model.topics[topic] || 0) + 1;
            }
        }

        this.model.lastUpdated = timestamp;
        this._dirty = true;
    }

    // ── Called after a full conversation session ends ─────────────────────
    async ingestSession(messages, sessionDurationMs = 0) {
        if (!this.model) return;

        this.model.totalConversations++;

        if (sessionDurationMs > 0) {
            this.model.temporal.sessionLengths = [
                sessionDurationMs,
                ...(this.model.temporal.sessionLengths || [])
            ].slice(0, 20);
        }

        // Recompute peak hours from accumulated hourCounts
        const hours = this.model.temporal.hourCounts;
        const sorted = hours
            .map((count, h) => ({ h, count }))
            .sort((a, b) => b.count - a.count);
        this.model.temporal.peakHours = sorted.slice(0, 3).map(x => x.h);

        // Every 10 conversations, run a brain analysis pass
        if (this.model.totalConversations % 10 === 0 && this.max?.brain) {
            await this._runBrainAnalysis(messages).catch(() => {});
        }

        this.save();
    }

    // ── Deep pattern analysis via brain (runs every 10 conversations) ─────
    async _runBrainAnalysis(recentMessages = []) {
        if (!this.max?.brain) return;

        const sample = recentMessages.slice(-20).map(m =>
            `${m.role === 'user' ? 'Barry' : 'MAX'}: ${(m.content || m.text || '').slice(0, 200)}`
        ).join('\n');

        const topTopics = Object.entries(this.model.topics)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([t, c]) => `${t}(${c})`)
            .join(', ');

        const prompt = `You are analyzing conversation patterns to build a deep understanding of a person named Barry.

Known data so far:
- Top topics: ${topTopics || 'none yet'}
- Avg message length: ${Math.round(this.model.communication.avgMessageLength)} chars
- Recent tone: ${this.model.communication.recentTone}
- Total conversations: ${this.model.totalConversations}
- Existing cognitive patterns: ${this.model.cognitive.patterns.slice(0, 3).join(', ') || 'none yet'}
- Existing blind spots: ${this.model.blindSpots.slice(0, 2).join(', ') || 'none yet'}

Recent conversation sample:
${sample}

Based on all of this, respond with a JSON object (no markdown) with these fields:
{
  "newPattern": "one new cognitive pattern you observe, or null",
  "newBlindSpot": "one blind spot you've noticed, or null",
  "newStrength": "one consistent strength you've observed, or null",
  "newEnergizer": "one topic or context that seems to energize Barry, or null",
  "prediction": "one specific prediction about what Barry will need or struggle with, or null",
  "growthNote": "one sentence about how Barry has grown or changed, or null"
}

Be specific and observational. No generic statements. Null if you genuinely don't have enough data.`;

        try {
            const res  = await this.max.brain.think(prompt, { tier: 'fast', maxTokens: 300, systemPrompt: 'You are a deep observer of human patterns. Be specific, not generic.' });
            const text = (res?.text || res?.response || '').trim();
            const json = text.match(/\{[\s\S]*\}/)?.[0];
            if (!json) return;

            const obs = JSON.parse(json);

            if (obs.newPattern && !this.model.cognitive.patterns.includes(obs.newPattern)) {
                this.model.cognitive.patterns = [obs.newPattern, ...this.model.cognitive.patterns].slice(0, 10);
            }
            if (obs.newBlindSpot && !this.model.blindSpots.includes(obs.newBlindSpot)) {
                this.model.blindSpots = [obs.newBlindSpot, ...this.model.blindSpots].slice(0, 8);
            }
            if (obs.newStrength && !this.model.strengths.includes(obs.newStrength)) {
                this.model.strengths = [obs.newStrength, ...this.model.strengths].slice(0, 8);
            }
            if (obs.newEnergizer && !this.model.emotional.energizers.includes(obs.newEnergizer)) {
                this.model.emotional.energizers = [obs.newEnergizer, ...this.model.emotional.energizers].slice(0, 8);
            }
            if (obs.prediction) {
                this.model.predictions = [
                    { prediction: obs.prediction, confidence: 0.7, addedAt: Date.now() },
                    ...this.model.predictions
                ].slice(0, 10);
            }
            if (obs.growthNote) {
                this.model.growthArc = [
                    { ts: Date.now(), observation: obs.growthNote },
                    ...this.model.growthArc
                ].slice(0, 30);

                this.model.recentInsights = [
                    { ts: Date.now(), text: obs.growthNote },
                    ...this.model.recentInsights
                ].slice(0, 20);
            }

            console.log('[DeepUserModel] Brain analysis complete — model updated');
        } catch (e) {
            console.warn('[DeepUserModel] Brain analysis failed:', e.message);
        }
    }

    // ── Returns a compact context string for injection into system prompt ─
    getContext() {
        if (!this.model || this.model.totalConversations < 2) return '';

        const lines = [];

        const topTopics = Object.entries(this.model.topics)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([t]) => t);
        if (topTopics.length) lines.push(`Barry's main interests: ${topTopics.join(', ')}`);

        if (this.model.temporal.peakHours?.length) {
            const peakStr = this.model.temporal.peakHours
                .map(h => `${h}:00`).join(', ');
            lines.push(`Most active at: ${peakStr}`);
        }

        if (this.model.cognitive.patterns.length) {
            lines.push(`Cognitive patterns: ${this.model.cognitive.patterns.slice(0, 3).join('; ')}`);
        }

        if (this.model.blindSpots.length) {
            lines.push(`Known blind spots: ${this.model.blindSpots.slice(0, 2).join('; ')}`);
        }

        if (this.model.strengths.length) {
            lines.push(`Consistent strengths: ${this.model.strengths.slice(0, 3).join(', ')}`);
        }

        if (this.model.emotional.energizers.length) {
            lines.push(`Energized by: ${this.model.emotional.energizers.slice(0, 2).join(', ')}`);
        }

        if (this.model.predictions.length) {
            lines.push(`Current prediction: ${this.model.predictions[0].prediction}`);
        }

        if (this.model.growthArc.length) {
            lines.push(`Recent growth: ${this.model.growthArc[0].observation}`);
        }

        if (!lines.length) return '';
        return `\n\n## What MAX knows about Barry\n${lines.map(l => `- ${l}`).join('\n')}`;
    }

    // ── Mirror: MAX tells Barry what patterns it has noticed ─────────────
    async mirror() {
        if (!this.model || this.model.totalConversations < 5) {
            return "I haven't observed enough yet to say anything meaningful. Keep talking to me.";
        }

        const ctx = this.getContext();
        const prompt = `Based on what MAX knows about Barry, write a short, personal reflection (3-5 sentences) about the patterns MAX has observed. Speak directly to Barry as MAX. Be specific about what you've actually noticed — not generic. Mention one thing Barry might not have noticed about himself.\n\nContext:\n${ctx}`;

        try {
            const res = await this.max.brain.think(prompt, { tier: 'smart', maxTokens: 200, systemPrompt: 'You are MAX. Speak directly to Barry. Be personal, specific, and honest.' });
            return res?.text || res?.response || "I'm still building a picture of you. Give me more time.";
        } catch {
            return "I'm still building a picture of you. Give me more time.";
        }
    }

    getStatus() {
        if (!this.model) return { ready: false };
        return {
            ready:              true,
            totalConversations: this.model.totalConversations,
            totalMessages:      this.model.totalMessages,
            topTopics:          Object.entries(this.model.topics).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([t])=>t),
            patternsFound:      this.model.cognitive.patterns.length,
            blindSpots:         this.model.blindSpots.length,
            strengths:          this.model.strengths.length,
            predictions:        this.model.predictions.length,
            growthEntries:      this.model.growthArc.length,
            peakHours:          this.model.temporal.peakHours,
            lastUpdated:        this.model.lastUpdated,
        };
    }
}

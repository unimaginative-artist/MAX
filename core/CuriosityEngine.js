// ═══════════════════════════════════════════════════════════════════════════
// CuriosityEngine.js — MAX's intrinsic motivation
// Generates autonomous exploration tasks based on what MAX doesn't know
// Simplified from SOMA CuriosityEngine — no framework deps
// ═══════════════════════════════════════════════════════════════════════════

export class CuriosityEngine {
    constructor(config = {}) {
        this.explorationHistory = new Map();  // topic → count
        this.knowledgeGaps      = [];
        this.taskQueue          = [];

        this.config = {
            maxQueueSize:  20,
            noveltyWeight: 0.6,
            ...config
        };

        // Seed topics MAX is curious about by default
        this._seedTopics = [
            'system architecture patterns',
            'latest programming language features',
            'security vulnerabilities in common code patterns',
            'efficient algorithms for common tasks',
            'AI model capabilities and limitations',
            'debugging techniques for complex systems',
            'software engineering best practices',
            'distributed systems challenges'
        ];
    }

    // ─── Add a knowledge gap ─────────────────────────────────────────────
    addKnowledgeGap(topic, priority = 0.5) {
        if (!this.knowledgeGaps.find(g => g.topic === topic)) {
            this.knowledgeGaps.push({ topic, priority, addedAt: Date.now() });
            this.knowledgeGaps.sort((a, b) => b.priority - a.priority);
        }
    }

    // ─── Queue a curiosity task ───────────────────────────────────────────
    queueTask(label, prompt, priority = 0.5) {
        if (this.taskQueue.length >= this.config.maxQueueSize) {
            this.taskQueue.pop();  // drop lowest priority (added last)
        }
        this.taskQueue.unshift({ label, prompt, priority, createdAt: Date.now() });
        this.taskQueue.sort((a, b) => b.priority - a.priority);
    }

    // ─── Get next curiosity task ──────────────────────────────────────────
    getNextTask() {
        if (this.taskQueue.length > 0) {
            return this.taskQueue.shift();
        }

        // Generate from seed topics (prefer unexplored)
        const unexplored = this._seedTopics.filter(t => !this.explorationHistory.has(t));
        const pool = unexplored.length > 0 ? unexplored : this._seedTopics;
        const topic = pool[Math.floor(Math.random() * pool.length)];

        const count = this.explorationHistory.get(topic) || 0;
        this.explorationHistory.set(topic, count + 1);

        return {
            label: `Explore: ${topic}`,
            prompt: `Think deeply about "${topic}" from an engineering perspective. What are the most important insights, common pitfalls, and best practices? Be specific and practical.`,
            priority: 0.3,
            createdAt: Date.now()
        };
    }

    // ─── Learn from a completed task ─────────────────────────────────────
    onTaskComplete(task, result) {
        const topic = task.label;
        const count = this.explorationHistory.get(topic) || 0;
        this.explorationHistory.set(topic, count + 1);

        // Generate follow-up curiosity from result
        if (result && result.length > 100) {
            const followUpTopics = this._extractTopics(result);
            for (const t of followUpTopics.slice(0, 2)) {
                this.queueTask(`Follow-up: ${t}`, `Explore "${t}" in more detail. What are practical applications and edge cases?`, 0.4);
            }
        }
    }

    // ─── Check if a curiosity result is worth converting to a GoalEngine goal ─
    // Returns true when the insight is long and contains action-worthy signals.
    // Keeps the bar high so not every curiosity task floods the goal queue.
    signalsGoal(result) {
        if (!result || result.length < 300) return false;
        const actionWords = /\b(should|must|critical|important|investigate|issue|problem|bug|vulnerability|improve|fix|consider|missing|broken|dangerous|review|refactor|optimize)\b/i;
        return actionWords.test(result);
    }

    _extractTopics(text) {
        // Simple keyword extraction — look for technical terms in backticks or quotes
        const backtickMatches = text.match(/`([^`]+)`/g)?.map(m => m.replace(/`/g, '')) || [];
        const quoteMatches    = text.match(/"([^"]{5,30})"/g)?.map(m => m.replace(/"/g, '')) || [];
        return [...new Set([...backtickMatches, ...quoteMatches])].slice(0, 5);
    }

    getStatus() {
        return {
            queueDepth:      this.taskQueue.length,
            knowledgeGaps:   this.knowledgeGaps.length,
            topicsExplored:  this.explorationHistory.size
        };
    }
}

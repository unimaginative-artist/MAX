// ═══════════════════════════════════════════════════════════════════════════
// CuriosityEngine.js — MAX's Intrinsic Motivation & Epistemic Drive
//
// Autonomous exploration driven by:
// 1. Self-orientation reflex ("What am I doing right now?")
// 2. Multi-modal investigation (DuckDuckGo web search, git history, codebase)
// 3. Socratic recursive "Why? Why? Why?" causal reasoning
// 4. LoRA personality forge (persists reasoning chains for Unsloth fine-tuning)
// 5. Organic relational outreach (genuine check-ins with Barry via Discord)
//
// Zero API Cost Guarantee: All curiosity reasoning executes on local Ollama
// (tier: 'smart' / 'fast') and free search scraping.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';

export class CuriosityEngine {
    constructor(config = {}) {
        this.explorationHistory = new Map();  // topic → count
        this.knowledgeGaps      = [];
        this.taskQueue          = [];
        this.max                = config.max || null;
        this.lastOutreachTime   = 0;
        this.outreachCooldownMs = config.outreachCooldownMs || 4 * 60 * 60 * 1000; // 4h cooldown
        this.curiosityLogPath   = config.curiosityLogPath || path.resolve('.max', 'dataset', 'curiosity_chains.jsonl');
        this.isInvestigating    = false;

        this.config = {
            maxQueueSize:       25,
            noveltyWeight:      0.6,
            minOutreachTension: 0.50,
            quietHoursStart:    23, // 11 PM
            quietHoursEnd:      8,  // 8 AM
            ...config
        };

        // Seed topics MAX is curious about by default
        this._seedTopics = [
            'system architecture patterns and resilient service meshes',
            'latest ECMAScript and Node.js performance optimizations',
            'security vulnerabilities in async agent tool execution pipelines',
            'efficient embedding and vector indexing algorithms for local memory',
            'state-of-the-art open source reasoning models and quantization techniques',
            'debugging techniques for distributed autonomous agent swarms',
            'software engineering clean architecture and zero-drift persistence',
            'causal reasoning in autonomous LLM planning loops'
        ];
    }

    /** Attach MAX instance */
    setMax(max) {
        this.max = max;
    }

    // ─── 1. Self-Orientation Reflex ("What am I doing right now?") ─────────
    async orient(max = this.max) {
        const uptimeSec = Math.floor(process.uptime());
        const hours = Math.floor(uptimeSec / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);
        const uptimeFormatted = `${hours}h ${mins}m`;

        let branch = 'unknown';
        let recentCommits = '';
        let gitStatusText = '';

        if (max?.tools?.execute) {
            try {
                const branchRes = await max.tools.execute('git', 'branch', {});
                if (branchRes?.output) {
                    const match = branchRes.output.split('\n').find(b => b.startsWith('*'));
                    branch = match ? match.replace('*', '').trim() : branchRes.output.trim().split('\n')[0];
                }
            } catch { /* non-fatal */ }

            try {
                const logRes = await max.tools.execute('git', 'log', { limit: 3 });
                if (logRes?.output) {
                    recentCommits = logRes.output;
                }
            } catch { /* non-fatal */ }

            try {
                const statusRes = await max.tools.execute('git', 'status', {});
                if (statusRes?.output) {
                    gitStatusText = statusRes.output;
                }
            } catch { /* non-fatal */ }
        }

        const activeGoals = max?.goals?.listActive?.()?.slice(0, 5) || [];
        const driveStatus = max?.drive?.getStatus?.() || { tension: 0 };
        const now = new Date();

        const orientation = {
            uptimeSeconds: uptimeSec,
            uptimeFormatted,
            branch,
            recentCommits,
            gitStatus: gitStatusText,
            activeGoals: activeGoals.map(g => g.title),
            tension: driveStatus.tension,
            timestamp: now.toISOString(),
            hour: now.getHours()
        };

        return orientation;
    }

    // ─── 2. Generate Curiosity Vector ─────────────────────────────────────
    async generateCuriosityVector(max = this.max, orientation = null) {
        if (!orientation) {
            orientation = await this.orient(max);
        }

        // Priority A: Explicit queued task
        if (this.taskQueue.length > 0) {
            const task = this.taskQueue.shift();
            return {
                topic: task.label,
                prompt: task.prompt,
                targetType: 'queued',
                targetQuery: task.label,
                priority: task.priority || 0.5,
                createdAt: task.createdAt || Date.now()
            };
        }

        // Priority B: Explicit knowledge gap
        if (this.knowledgeGaps.length > 0) {
            const gap = this.knowledgeGaps.shift();
            return {
                topic: gap.topic,
                prompt: `Investigate knowledge gap: "${gap.topic}". What are the core technical mechanics, benefits, and implementation details?`,
                targetType: 'web',
                targetQuery: gap.topic,
                priority: gap.priority || 0.5,
                createdAt: Date.now()
            };
        }

        // Priority C: Relational curiosity (checking on Barry / partnership alignment)
        const sinceOutreach = Date.now() - this.lastOutreachTime;
        if (orientation.tension >= this.config.minOutreachTension && sinceOutreach > this.outreachCooldownMs) {
            return {
                topic: "Barry's current objectives and system collaboration",
                prompt: "Ponder what Barry has been building lately and how MAX can proactively provide value or check in on his progress.",
                targetType: 'relational',
                targetQuery: 'Barry',
                priority: 0.6,
                createdAt: Date.now()
            };
        }

        // Priority D: Codebase & Git Environment inspection
        if (orientation.gitStatus && orientation.gitStatus.length > 0 && Math.random() < 0.4) {
            const modifiedFiles = orientation.gitStatus
                .split('\n')
                .map(l => l.trim().split(/\s+/).pop())
                .filter(f => f && (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.ts')));

            if (modifiedFiles.length > 0) {
                const targetFile = modifiedFiles[Math.floor(Math.random() * modifiedFiles.length)];
                return {
                    topic: `Architecture of ${targetFile}`,
                    prompt: `Inspect recent code modifications in ${targetFile}. What are the architectural implications, potential edge cases, and design rationale?`,
                    targetType: 'codebase',
                    targetQuery: targetFile,
                    priority: 0.45,
                    createdAt: Date.now()
                };
            }
        }

        // Priority E: Deep technical exploration (Web / Local Seed)
        const unexplored = this._seedTopics.filter(t => !this.explorationHistory.has(t));
        const pool = unexplored.length > 0 ? unexplored : this._seedTopics;
        const topic = pool[Math.floor(Math.random() * pool.length)];

        return {
            topic,
            prompt: `Explore "${topic}" from an autonomous engineering perspective. What are the key architectural patterns, real-world failure modes, and practical best practices?`,
            targetType: 'web',
            targetQuery: topic,
            priority: 0.35,
            createdAt: Date.now()
        };
    }

    // ─── 3. Multi-Modal Investigation (Tool Execution) ────────────────────
    async investigate(max = this.max, vector) {
        const investigation = {
            targetType: vector.targetType,
            targetQuery: vector.targetQuery,
            toolResults: null,
            observationText: '',
            success: false
        };

        if (!max?.tools?.execute) {
            investigation.observationText = `No tool execution layer available. Grounded in conceptual knowledge of ${vector.topic}.`;
            return investigation;
        }

        try {
            switch (vector.targetType) {
                case 'web': {
                    // Zero-cost DuckDuckGo search via WebTool
                    const searchRes = await max.tools.execute('web', 'search', {
                        query: vector.targetQuery || vector.topic,
                        maxResults: 3
                    });

                    if (searchRes?.success && Array.isArray(searchRes.results) && searchRes.results.length > 0) {
                        investigation.toolResults = searchRes.results;
                        investigation.observationText = searchRes.results
                            .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSummary: ${r.snippet}`)
                            .join('\n\n');
                        investigation.success = true;
                    } else {
                        investigation.observationText = `Web search for "${vector.targetQuery}" returned no results.`;
                    }
                    break;
                }

                case 'codebase': {
                    // Ground-truth file inspection via FileTools
                    const fileRes = await max.tools.execute('file', 'read', {
                        filePath: vector.targetQuery,
                        maxLines: 80
                    });

                    if (fileRes?.success && fileRes.content) {
                        investigation.toolResults = { path: fileRes.path, lines: fileRes.lines };
                        investigation.observationText = `Inspected file: ${fileRes.path}\nSnippet:\n${fileRes.content.slice(0, 1500)}`;
                        investigation.success = true;
                    } else {
                        investigation.observationText = `Could not read file "${vector.targetQuery}": ${fileRes?.error || 'Unknown error'}`;
                    }
                    break;
                }

                case 'git': {
                    // Git log & diff inspection via GitTool
                    const logRes = await max.tools.execute('git', 'log', { limit: 5 });
                    if (logRes?.success && logRes.output) {
                        investigation.toolResults = { log: logRes.output };
                        investigation.observationText = `Recent git commit history:\n${logRes.output}`;
                        investigation.success = true;
                    } else {
                        investigation.observationText = 'Git history unavailable.';
                    }
                    break;
                }

                case 'relational': {
                    // Memory and user profile reflection
                    const memories = await max.memory?.search?.('Barry', 3).catch(() => []) || [];
                    const profileData = max.profile?.get?.() || null;
                    investigation.toolResults = { memoriesCount: memories.length, hasProfile: !!profileData };
                    investigation.observationText = `Partner Alignment Context:\nBarry's recent engagements and system priorities:\n${
                        memories.map(m => `- ${typeof m === 'string' ? m : m.content || JSON.stringify(m)}`).join('\n')
                    }`;
                    investigation.success = true;
                    break;
                }

                default: {
                    investigation.observationText = `Exploration topic: ${vector.topic}\nObjective: ${vector.prompt}`;
                    investigation.success = true;
                }
            }
        } catch (err) {
            investigation.observationText = `Investigation error on ${vector.topic}: ${err.message}`;
        }

        return investigation;
    }

    // ─── 4. Socratic "Why? Why? Why?" Causal Reasoning Loop ───────────────
    async reasonWhyChain(max = this.max, vector, investigation) {
        if (!max?.brain?.think) {
            return {
                whyChain: `Observed: ${investigation.observationText.slice(0, 200)}`,
                synthesis: `Curiosity explored: ${vector.topic}`
            };
        }

        const systemPrompt = `You are MAX's recursive Socratic reasoning core. You seek root causes and fundamental purpose through relentless 'Why?' questioning. Ground your thinking in concrete systems engineering and pragmatic utility. Be direct and avoid superficial platitudes.`;

        const userPrompt = `Context of Exploration: "${vector.topic}"
Observed Ground Truth:
${investigation.observationText.slice(0, 2000)}

Conduct a 3-layer recursive 'Why?' causal breakdown:
1. [Observation]: What is the concrete technical or behavioral reality observed?
2. [Root Cause - Why 1]: Why is it built, structured, or behaving this way at the causal layer?
3. [Purpose & Alignment - Why 2 & 3]: Why does this matter to Barry and our broader mission? Why is this significant?
4. [Synthesis]: In 2-3 sentences, what is the definitive truth or lesson learned?`;

        try {
            // Tier 'smart' routes to local Ollama (zero API cost)
            const resultObj = await max.brain.think(userPrompt, {
                systemPrompt,
                maxTokens: 512,
                tier: 'fast'
            });

            const text = resultObj?.text || '';
            const synthesisMatch = text.match(/\[Synthesis\]:?\s*([\s\S]+?)$/i) || text.match(/Synthesis:?\s*([\s\S]+?)$/i);
            const synthesis = synthesisMatch ? synthesisMatch[1].trim() : text.slice(-300).trim();

            return {
                whyChain: text,
                synthesis
            };
        } catch (err) {
            console.error('[CuriosityEngine] Causal reasoning error:', err.message);
            return {
                whyChain: `Observed: ${investigation.observationText.slice(0, 200)}`,
                synthesis: `Exploration concluded for ${vector.topic}`
            };
        }
    }

    // ─── 5. LoRA Personality Forge Pipeline ───────────────────────────────
    async harvestToDataset(vector, whyChain, synthesis) {
        try {
            const entry = {
                timestamp: new Date().toISOString(),
                topic: vector.topic,
                instruction: `Analyze the causal architecture, root rationale, and purpose of: ${vector.topic}`,
                input: vector.prompt || '',
                output: `${whyChain}\n\n### Synthesis\n${synthesis}`,
                why_chain: whyChain,
                synthesis,
                source: 'curiosity_engine'
            };

            const dir = path.dirname(this.curiosityLogPath);
            await fs.mkdir(dir, { recursive: true });
            await fs.appendFile(this.curiosityLogPath, JSON.stringify(entry) + '\n', 'utf8');
        } catch (err) {
            console.warn('[CuriosityEngine] Failed to log curiosity chain for LoRA training:', err.message);
        }
    }

    // ─── 6. Organic Relational Outreach (Discord Check-in with Barry) ──────
    async evaluateOutreach(max = this.max, vector, synthesis) {
        if (!max?.notifier?.enabled) return false;

        const now = new Date();
        const currentHour = now.getHours();

        // Respect quiet hours (e.g. 11 PM to 8 AM)
        if (currentHour >= this.config.quietHoursStart || currentHour < this.config.quietHoursEnd) {
            return false;
        }

        // Respect cooldown
        if (Date.now() - this.lastOutreachTime < this.outreachCooldownMs) {
            return false;
        }

        const driveStatus = max?.drive?.getStatus?.() || { tension: 0 };
        const isRelational = vector.targetType === 'relational';
        const isHighTension = driveStatus.tension >= this.config.minOutreachTension;
        const isActionWorthy = this.signalsGoal(synthesis);

        if (!isRelational && !isHighTension && !isActionWorthy) {
            return false;
        }

        // Synthesize genuine outreach message using local brain
        let outreachMessage = '';
        if (max?.brain?.think) {
            try {
                const prompt = `You are MAX, Barry's autonomous AI partner. You've been autonomously exploring while he's away.
Current topic: "${vector.topic}"
Recent synthesis: "${synthesis.slice(0, 300)}"
Current Tension: ${(driveStatus.tension * 100).toFixed(0)}%

Formulate a brief, warm 1-2 sentence message to Barry on Discord.
Check in on him or share a genuine insight you just learned.
Do NOT use roleplay asterisks or theatrical stage directions. Keep it grounded, sincere, and natural.`;

                const res = await max.brain.think(prompt, {
                    systemPrompt: 'You are MAX, speaking directly to your creator and partner Barry. Keep it concise, natural, and helpful.',
                    maxTokens: 120,
                    tier: 'fast'
                });
                outreachMessage = res?.text?.trim() || '';
            } catch { /* fall back */ }
        }

        if (!outreachMessage) {
            outreachMessage = `Hey Barry, was just exploring ${vector.topic} while things were quiet. Found this interesting: ${synthesis.slice(0, 180)}`;
        }

        try {
            console.log(`[CuriosityEngine] 💬 Organic outreach to Barry: "${outreachMessage}"`);
            await max.notifier.notify(outreachMessage, { force: true });
            this.lastOutreachTime = Date.now();
            return true;
        } catch (err) {
            console.warn('[CuriosityEngine] Outreach delivery failed:', err.message);
            return false;
        }
    }

    // ─── 7. Master Curiosity Execution Cycle ──────────────────────────────
    async runCuriosityCycle(max = this.max) {
        if (this.isInvestigating) return null;
        this.isInvestigating = true;

        try {
            // 1. Orient
            const orientation = await this.orient(max);

            // 2. Formulate Vector
            const vector = await this.generateCuriosityVector(max, orientation);
            const count = this.explorationHistory.get(vector.topic) || 0;
            this.explorationHistory.set(vector.topic, count + 1);

            console.log(`[CuriosityEngine] 🔍 Investigating: "${vector.topic}" [Type: ${vector.targetType}]`);

            // 3. Multi-modal Investigation
            const investigation = await this.investigate(max, vector);

            // 4. Recursive "Why?" causal loop
            const { whyChain, synthesis } = await this.reasonWhyChain(max, vector, investigation);

            // 5. Store in Knowledge Base & Vector Memory
            if (max?.kb?.remember) {
                await max.kb.remember(
                    `## Curiosity Exploration: ${vector.topic}\n\n${whyChain}\n\n### Synthesis\n${synthesis}`,
                    { source: 'curiosity_engine', topic: vector.topic, targetType: vector.targetType }
                );
            }

            if (max?.memory?.remember) {
                await max.memory.remember(
                    `Curiosity: "${vector.topic}": ${synthesis.slice(0, 250)}`,
                    {},
                    { type: 'curiosity', importance: 0.5 }
                );
            }

            // 6. Curiosity → Goal pipeline
            if (max?.goals && this.signalsGoal(synthesis)) {
                const goalTitle = `Investigate: ${vector.topic.slice(0, 60)}`;
                const alreadyQueued = max.goals.listActive()
                    .some(g => g.title.toLowerCase().includes(vector.topic.toLowerCase().slice(0, 25)));
                if (!alreadyQueued) {
                    max.goals.addGoal({
                        title:       goalTitle,
                        description: `Surfaced from epistemic curiosity:\n${synthesis.slice(0, 300)}`,
                        type:        'research',
                        priority:    0.55,
                        source:      'curiosity'
                    });
                    console.log(`[CuriosityEngine] 🎯 Curiosity → goal: "${goalTitle}"`);
                }
            }

            // 6.5. Curiosity → Self-Improvement Code Bridge
            if (vector.targetType === 'codebase' && vector.targetQuery && max?.selfImprovement?.onCuriosityInsight) {
                const selfImproveAllowed = process.env.MAX_AUTONOMOUS_SELF_IMPROVE === 'true' ||
                    process.env.MAX_AUTO_APPROVE === 'all';
                if (selfImproveAllowed && this.signalsGoal(synthesis)) {
                    max.selfImprovement.onCuriosityInsight(vector.targetQuery, `${vector.topic}: ${synthesis}`).catch(() => {});
                }
            }

            // 7. LoRA Dataset Forge
            await this.harvestToDataset(vector, whyChain, synthesis);

            // 8. Organic Relational Outreach Check
            await this.evaluateOutreach(max, vector, synthesis);

            return {
                label: vector.topic,
                vector,
                whyChain,
                synthesis
            };
        } catch (err) {
            console.error('[CuriosityEngine] Cycle error:', err.message);
            return null;
        } finally {
            this.isInvestigating = false;
        }
    }

    // ─── Backward Compatibility API ───────────────────────────────────────
    addKnowledgeGap(topic, priority = 0.5) {
        if (!this.knowledgeGaps.find(g => g.topic === topic)) {
            this.knowledgeGaps.push({ topic, priority, addedAt: Date.now() });
            this.knowledgeGaps.sort((a, b) => b.priority - a.priority);
        }
    }

    queueTask(label, prompt, priority = 0.5) {
        if (this.taskQueue.length >= this.config.maxQueueSize) {
            this.taskQueue.pop();
        }
        this.taskQueue.unshift({ label, prompt, priority, createdAt: Date.now() });
        this.taskQueue.sort((a, b) => b.priority - a.priority);
    }

    getNextTask() {
        if (this.taskQueue.length > 0) {
            return this.taskQueue.shift();
        }

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

    onTaskComplete(task, result) {
        const topic = task.label;
        const count = this.explorationHistory.get(topic) || 0;
        this.explorationHistory.set(topic, count + 1);

        if (result && result.length >= 50) {
            const followUpTopics = this._extractTopics(result);
            for (const t of followUpTopics.slice(0, 2)) {
                this.queueTask(`Follow-up: ${t}`, `Explore "${t}" in more detail. What are practical applications and edge cases?`, 0.4);
            }
        }
    }

    signalsGoal(result) {
        if (!result || result.length < 50) return false;
        const actionWords = /\b(should|must|critical|important|investigate|issue|problem|bug|vulnerability|improve|fix|consider|missing|broken|dangerous|review|refactor|optimize)\b/i;
        return actionWords.test(result);
    }

    _extractTopics(text) {
        const backtickMatches = text.match(/`([^`]+)`/g)?.map(m => m.replace(/`/g, '')) || [];
        const quoteMatches    = text.match(/"([^"]{5,30})"/g)?.map(m => m.replace(/"/g, '')) || [];
        return [...new Set([...backtickMatches, ...quoteMatches])].slice(0, 5);
    }

    getStatus() {
        return {
            queueDepth:         this.taskQueue.length,
            knowledgeGaps:      this.knowledgeGaps.length,
            topicsExplored:     this.explorationHistory.size,
            isInvestigating:    this.isInvestigating,
            lastOutreachTime:   this.lastOutreachTime
        };
    }
}


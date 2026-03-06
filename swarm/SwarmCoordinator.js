// ═══════════════════════════════════════════════════════════════════════════
// SwarmCoordinator.js — MAX's engineering swarm
// Breaks large tasks into parallel work units, runs them concurrently,
// aggregates results. Think: parallel code review, multi-file generation,
// simultaneous research + implementation.
// ═══════════════════════════════════════════════════════════════════════════

import { EventEmitter } from 'events';

export class SwarmCoordinator extends EventEmitter {
    constructor(brain, toolRegistry, config = {}) {
        super();
        this.brain    = brain;
        this.tools    = toolRegistry;
        this.config   = {
            maxWorkers:   config.maxWorkers   || 4,
            workerTimeout: config.workerTimeout || 120000,  // 2 min per worker
            ...config
        };

        this.activeJobs  = new Map();  // jobId → job
        this.jobHistory  = [];
        this._jobCounter = 0;
    }

    // ─── Run a swarm job ──────────────────────────────────────────────────
    // task: { name, description, subtasks: [{ id, prompt, tools?: [] }] }
    async run(task) {
        const jobId  = `swarm_${++this._jobCounter}_${Date.now()}`;
        const job    = {
            id:        jobId,
            name:      task.name,
            startedAt: Date.now(),
            status:    'running',
            subtasks:  task.subtasks.map(s => ({ ...s, status: 'pending', result: null })),
            results:   [],
            scratchpad: {} // ─── SHARED BLACKBOARD: Agents can write/read here ───
        };

        this.activeJobs.set(jobId, job);
        this.emit('job:start', { jobId, name: task.name, subtasks: task.subtasks.length });

        console.log(`\n[Swarm] 🐝 Job "${task.name}" — ${task.subtasks.length} subtasks, max ${this.config.maxWorkers} parallel`);

        try {
            // ─── Phase 1: Exploration & Execution ───
            const batches = this._chunk(task.subtasks, this.config.maxWorkers);

            for (const batch of batches) {
                const batchResults = await Promise.allSettled(
                    batch.map(subtask => this._runSubtask(job, subtask))
                );

                for (const r of batchResults) {
                    if (r.status === 'fulfilled') {
                        job.results.push(r.value);
                        // Update scratchpad with specific worker discoveries if present
                        if (r.value.discoveries) {
                            Object.assign(job.scratchpad, r.value.discoveries);
                        }
                    } else {
                        job.results.push({ error: r.reason?.message || 'subtask failed' });
                    }
                }
            }

            // ─── Phase 2: Adversarial Validation (Peer Review) ───
            const validation = await this._validate(job);
            if (validation.hasContradictions) {
                console.warn(`[Swarm] ⚠️  Contradictions found in swarm output. Resolving...`);
                job.scratchpad.contradictions = validation.notes;
            }

            // ─── Phase 3: Coherent Synthesis ───
            const synthesis = await this._synthesize(job);
            job.synthesis = synthesis;
            job.status    = 'complete';
            job.endedAt   = Date.now();

            this.emit('job:complete', { jobId, synthesis });
            this.jobHistory.push({ ...job });
            this.activeJobs.delete(jobId);

            return { jobId, name: task.name, results: job.results, synthesis };

        } catch (err) {
            job.status = 'failed';
            job.error  = err.message;
            this.activeJobs.delete(jobId);
            throw err;
        }
    }

    async _runSubtask(job, subtask) {
        subtask.status = 'running';
        subtask.startedAt = Date.now();

        console.log(`  [Swarm] ▶ ${subtask.id}: ${subtask.prompt?.slice(0, 60)}...`);
        this.emit('subtask:start', { jobId: job.id, subtaskId: subtask.id });

        try {
            // Execute any tool calls first
            const toolResults = {};
            if (subtask.tools?.length) {
                for (const toolCall of subtask.tools) {
                    const { tool, action, params } = toolCall;
                    toolResults[`${tool}.${action}`] = await this.tools.execute(tool, action, params);
                }
            }

            // Build context from tool results + SHARED SCRATCHPAD
            let context = '';
            if (Object.keys(toolResults).length > 0) {
                context += '\n\nLocal tool results:\n' + Object.entries(toolResults)
                    .map(([k, v]) => `${k}:\n${JSON.stringify(v, null, 2)}`)
                    .join('\n\n');
            }

            if (Object.keys(job.scratchpad).length > 0) {
                context += '\n\nShared swarm discoveries:\n' + JSON.stringify(job.scratchpad, null, 2);
            }

            // Run the brain on this subtask
            const resultObj = await this.brain.think(
                subtask.prompt + context,
                {
                    systemPrompt: `You are a specialized worker in MAX's engineering swarm.
Job: "${job.name}"
Your subtask: ${subtask.id}
Focus ONLY on your assigned subtask. 
If you find something critical other workers should know, include a JSON block: DISCOVERY: {"key": "value"}`,
                    temperature: 0.5,
                    maxTokens: 1024
                }
            );

            const result = resultObj.text;
            
            // Extract discoveries for the scratchpad
            const discoveryMatch = result.match(/DISCOVERY:\s*(\{.*\})/);
            const discoveries    = discoveryMatch ? JSON.parse(discoveryMatch[1]) : null;

            subtask.status = 'complete';
            subtask.result = result;
            subtask.endedAt = Date.now();

            console.log(`  [Swarm] ✅ ${subtask.id} done (${subtask.endedAt - subtask.startedAt}ms)`);
            this.emit('subtask:complete', { jobId: job.id, subtaskId: subtask.id });

            return { id: subtask.id, result, toolResults, discoveries };

        } catch (err) {
            subtask.status = 'failed';
            subtask.error  = err.message;
            console.error(`  [Swarm] ❌ ${subtask.id} failed: ${err.message}`);
            this.emit('subtask:error', { jobId: job.id, subtaskId: subtask.id, error: err.message });
            return { id: subtask.id, error: err.message };
        }
    }

    async _synthesize(job) {
        if (job.results.length === 0) return 'No results to synthesize.';

        const resultText = job.results
            .map((r, i) => `## ${job.subtasks[i]?.id || `Task ${i+1}`}\n${r.result || r.error || JSON.stringify(r)}`)
            .join('\n\n');

        const synthesisResult = await this.brain.think(
            `You coordinated a swarm of agents on the task: "${job.name}"\n\nShared discoveries: ${JSON.stringify(job.scratchpad)}\n\nEach worker's output:\n\n${resultText}\n\nSynthesize these into a single, coherent final answer. Eliminate redundancy. Resolve any contradictions mentioned in discoveries.`,
            {
                systemPrompt: 'You are MAX synthesizing swarm worker outputs. Be concise and actionable.',
                temperature:  0.3,
                maxTokens:    2048
            }
        );

        return synthesisResult.text;
    }

    // ─── Phase 2: Adversarial Peer Review ───
    async _validate(job) {
        if (job.results.length < 2) return { hasContradictions: false };

        const summary = job.results
            .map((r, i) => `[Worker ${job.subtasks[i]?.id}]: ${r.result?.slice(0, 300)}...`)
            .join('\n\n');

        const prompt = `Review these parallel engineering outputs for the job: "${job.name}".
Are there any contradictions, conflicting data, or logical gaps between what the different workers reported?

OUTPUTS:
${summary}

Return ONLY a JSON object:
{
  "hasContradictions": boolean,
  "notes": "brief description of conflicts or 'none'",
  "severity": 0.0 to 1.0
}`;

        try {
            const result = await this.brain.think(prompt, { temperature: 0.1, tier: 'smart' });
            const match  = result.text.match(/\{[\s\S]*\}/);
            return match ? JSON.parse(match[0]) : { hasContradictions: false };
        } catch {
            return { hasContradictions: false };
        }
    }

    _chunk(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
    }

    // ─── Quick helper: decompose a task into subtasks via brain ───────────
    async decompose(taskDescription, numWorkers = this.config.maxWorkers) {
        const prompt = `Break this engineering task into ${numWorkers} parallel subtasks that can run simultaneously:

TASK: ${taskDescription}

Return a JSON array of subtask objects:
[
  { "id": "subtask_1", "prompt": "specific thing this worker should do" },
  { "id": "subtask_2", "prompt": "..." }
]

Return ONLY the JSON array. No explanation.`;

        const result = await this.brain.think(prompt, { temperature: 0.3, maxTokens: 1024 });
        const raw    = result.text;

        try {
            const jsonMatch = raw.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('No JSON array found');
            return JSON.parse(jsonMatch[0]);
        } catch {
            // Fallback: single task
            return [{ id: 'subtask_1', prompt: taskDescription }];
        }
    }

    getStatus() {
        return {
            activeJobs:   this.activeJobs.size,
            completedJobs: this.jobHistory.length,
            config:        this.config
        };
    }
}

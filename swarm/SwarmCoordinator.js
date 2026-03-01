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
            results:   []
        };

        this.activeJobs.set(jobId, job);
        this.emit('job:start', { jobId, name: task.name, subtasks: task.subtasks.length });

        console.log(`\n[Swarm] 🐝 Job "${task.name}" — ${task.subtasks.length} subtasks, max ${this.config.maxWorkers} parallel`);

        try {
            // Run subtasks in batches of maxWorkers
            const batches = this._chunk(task.subtasks, this.config.maxWorkers);

            for (const batch of batches) {
                const batchResults = await Promise.allSettled(
                    batch.map(subtask => this._runSubtask(job, subtask))
                );

                for (const r of batchResults) {
                    if (r.status === 'fulfilled') {
                        job.results.push(r.value);
                    } else {
                        job.results.push({ error: r.reason?.message || 'subtask failed' });
                    }
                }
            }

            // Synthesize results
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

            // Build context from tool results
            let context = '';
            if (Object.keys(toolResults).length > 0) {
                context = '\n\nTool results:\n' + Object.entries(toolResults)
                    .map(([k, v]) => `${k}:\n${JSON.stringify(v, null, 2)}`)
                    .join('\n\n');
            }

            // Run the brain on this subtask
            const resultObj = await this.brain.think(
                subtask.prompt + context,
                {
                    systemPrompt: `You are a specialized worker in MAX's engineering swarm.
Job: "${job.name}"
Your subtask: ${subtask.id}
Focus ONLY on your assigned subtask. Be precise and concrete.`,
                    temperature: 0.5,
                    maxTokens: 1024
                }
            );

            const result = resultObj.text;
            subtask.status = 'complete';
            subtask.result = result;
            subtask.endedAt = Date.now();

            console.log(`  [Swarm] ✅ ${subtask.id} done (${subtask.endedAt - subtask.startedAt}ms)`);
            this.emit('subtask:complete', { jobId: job.id, subtaskId: subtask.id });

            return { id: subtask.id, result, toolResults };

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
            `You coordinated a swarm of agents on the task: "${job.name}"\n\nEach worker's output:\n\n${resultText}\n\nSynthesize these into a single, coherent final answer. Be concrete. Eliminate redundancy.`,
            {
                systemPrompt: 'You are MAX synthesizing swarm worker outputs. Be concise and actionable.',
                temperature:  0.3,
                maxTokens:    2048
            }
        );

        return synthesisResult.text;
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

// ═══════════════════════════════════════════════════════════════════════════
// KnowledgeTool — MAX interacts with his own KnowledgeBase
//
// Allows MAX to autonomously ingest new documents, search his long-term
// memory, and list available knowledge sources.
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

export const KnowledgeTool = (max) => ({
    name: 'knowledge',
    description: `Access and update your long-term Knowledge Base (RAG).
Use this to ingest new blueprints, research, or documentation to expand your cognition.
Available actions:
  ingest → add a file, directory, or text: TOOL:knowledge:ingest:{"source":"./blueprints/agent_cognition.md","name":"AgentCognition"}
  query  → semantic search for specific facts: TOOL:knowledge:query:{"question":"How do I build a heartbeat?"}
  list   → see what you already know: TOOL:knowledge:list:{}`,

    actions: {
        ingest: async ({ source, name = null, metadata = {} }) => {
            if (!max.kb) return { success: false, error: 'KnowledgeBase not available' };
            try {
                // Resolve relative paths against process.cwd()
                const resolved = path.isAbsolute(source) ? source : path.join(process.cwd(), source);
                const result = await max.kb.ingest(resolved, { name, metadata });
                return { success: true, result };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        query: async ({ question, topK = 5 }) => {
            if (!max.kb) return { success: false, error: 'KnowledgeBase not available' };
            try {
                const results = await max.kb.query(question, { topK, brain: max.brain });
                return { success: true, results: results.map(r => ({
                    source: r.source_name,
                    content: r.content,
                    score: r.score
                })) };
            } catch (err) {
                return { success: false, error: err.message };
            }
        },

        list: async () => {
            if (!max.kb) return { success: false, error: 'KnowledgeBase not available' };
            try {
                const sources = max.kb.listSources();
                return { success: true, sources };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
    }
});

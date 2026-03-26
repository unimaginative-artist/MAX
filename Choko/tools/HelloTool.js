// ═══════════════════════════════════════════════════════════════════════════
// HelloTool — A simple example tool for Agent0
// ═══════════════════════════════════════════════════════════════════════════

export default {
    name: 'hello',
    description: 'A simple greeting tool. TOOL:hello:greet:{"name":"Barry"}',
    actions: {
        greet: async ({ name = 'there' }) => {
            return {
                success: true,
                message: `Hello, ${name}! I am Agent0.`
            };
        },
        time: async () => {
            return {
                success: true,
                time: new Date().toLocaleTimeString()
            };
        }
    }
};

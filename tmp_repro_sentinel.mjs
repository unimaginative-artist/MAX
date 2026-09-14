// Reproduce the Sentinel 'Broken Imports/Syntax: agents.js: undefined' smell
import { SentinelLoop } from './core/loops/SentinelLoop.js';

async function main() {
  // Fake MAX whose shell tool behaves like the REAL AutonomyPolicy wrapper
  // on a path that resolves to a non-existent script (what actually happened).
  const fakeMax = {
    tools: {
      execute: async (tool, action, params) => {
        if (tool === 'shell' && action === 'run') {
          // Exact shape observed from the live shell tool when it blocks a missing script:
          return {
            success: false,
            blocked: true,
            policy: { risk: 'high', reason: 'Script does not exist: server/loaders/agents.js' },
            error: '[AutonomyPolicy] Shell policy blocked command: Script does not exist: server/loaders/agents.js'
            // NOTE: no .stderr field at all  <-- this is the trap
          };
        }
        return { success: true };
      }
    },
    goals: { listActive: () => [] }
  };

  const loop = new SentinelLoop();
  const res = await loop._checkSyntax('server/loaders/agents.js', fakeMax);
  console.log('_checkSyntax result:', res);
  console.log('  success:', res.success);
  console.log('  error  :', res.error);
  console.log('  --> goal description would be: "Sentinel found a smell in server/loaders/agents.js: ' + res.error + '"');
  console.log(res.error === undefined ? '\n❌ REPRODUCED: error is undefined -> "details: undefined" smell\n' : '\n✅ error is populated\n');
}

main();

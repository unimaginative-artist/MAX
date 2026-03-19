import { MAX } from './core/MAX.js';

async function test() {
  console.log('[TEST] Starting MAX with OutputOrchestrator...');
  
  const max = new MAX({
    heartbeatMs: 10000,
    agentLoop: { enabled: false }
  });
  
  await max.initialize();
  
  console.log('[TEST] MAX ready. Triggering insight bursts...');
  
  // Simulate multiple insight sources
  // 1. Discord message (normal priority)
  max.heartbeat.emit('insight', {
    source: 'discord',
    label: 'Message from Barry',
    result: 'Testing orchestrator',
    priority: 'normal'
  });
  
  // 2. Same message again (should be deduplicated)
  max.heartbeat.emit('insight', {
    source: 'discord',
    label: 'Message from Barry',
    result: 'Testing orchestrator',
    priority: 'normal'
  });
  
  // 3. Critical sentinel alert
  max.heartbeat.emit('insight', {
    source: 'sentinel',
    label: 'CRITICAL: File corruption',
    result: 'core/MAX.js modified unexpectedly',
    priority: 'critical'
  });
  
  // 4. High priority scheduler event
  max.heartbeat.emit('insight', {
    source: 'scheduler',
    label: 'Morning briefing ready',
    result: 'Daily report generated',
    priority: 'high'
  });
  
  // 5. Another normal priority
  max.heartbeat.emit('insight', {
    source: 'email',
    label: 'New email',
    result: 'Subject: Test',
    priority: 'normal'
  });
  
  console.log('[TEST] 5 insights emitted. Waiting for flush...');
  
  // Wait for orchestrator to flush
  await new Promise(r => setTimeout(r, 6000));
  
  console.log('[TEST] Done. Check console for orchestrator logs.');
  process.exit(0);
}

test().catch(err => {
  console.error('[TEST] Error:', err);
  process.exit(1);
});
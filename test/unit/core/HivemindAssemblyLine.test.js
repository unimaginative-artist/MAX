// ═══════════════════════════════════════════════════════════════════════════
// HivemindAssemblyLine.test.js — Unit Tests for 24/7 SOMA AGI Forge Loop
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HivemindAssemblyLine } from '../../../core/HivemindAssemblyLine.js';

describe('HivemindAssemblyLine Subsystem', () => {

    it('should initialize with emerging AGI concepts', () => {
        const mockMax = { brain: { think: async () => ({ text: 'Mock Blueprint' }) } };
        const assembly = new HivemindAssemblyLine(mockMax);

        assert.ok(assembly.emergingConcepts.length >= 5, 'Has AGI concepts loaded');
        assert.ok(assembly.emergingConcepts.some(c => c.name.includes('MCTS')), 'Contains MCTS planning concept');
    });

    it('should execute an assembly cycle and emit capability payload to SOMA Queen', async () => {
        let publishedTopic = null;
        let publishedPayload = null;

        const mockMax = {
            brain: {
                think: async () => ({ text: '1. Build Arbiter\n2. Run Test\n3. Hot-Mount to SOMA' })
            },
            somaBridge: {
                available: true,
                publish: (topic, data) => {
                    publishedTopic = topic;
                    publishedPayload = data;
                    return true;
                }
            },
            memory: {
                add: async () => {}
            }
        };

        const assembly = new HivemindAssemblyLine(mockMax);
        await assembly.runAssemblyCycle();

        assert.equal(publishedTopic, 'agi:assembly:capability_forged');
        assert.ok(publishedPayload !== null, 'Payload was emitted');
        assert.equal(publishedPayload.status, 'VERIFIED_IN_SANDBOX');
        assert.equal(publishedPayload.source, 'MAX_MACHINE_B');
    });
});

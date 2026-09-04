// ═══════════════════════════════════════════════════════════════════════════
// DeepSeekHarnessPipeline.test.js — Unit Tests for DeepSeek Harness Architectures
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PromptLayerAssembler } from '../../../core/PromptLayerAssembler.js';
import { GuardedToolPipeline } from '../../../core/GuardedToolPipeline.js';

describe('DeepSeek Harness Pipeline Subsystems', () => {

    describe('PromptLayerAssembler', () => {
        it('should assemble default layers with identity and security directives', () => {
            const assembler = new PromptLayerAssembler();
            const prompt = assembler.assemble({ task: 'Build a unit test suite' });

            assert.ok(prompt.includes('You are MAX'), 'Prompt contains MAX identity');
            assert.ok(prompt.includes('SURGICAL EDITS'), 'Prompt contains surgical edit rule');
            assert.ok(prompt.includes('Build a unit test suite'), 'Prompt includes task directive');
        });

        it('should inject vector memories when provided', () => {
            const assembler = new PromptLayerAssembler();
            const prompt = assembler.assemble({
                memories: ['Fact 1: SOMA is on port 3001', 'Fact 2: MAX is on port 3100']
            });

            assert.ok(prompt.includes('[RECALLED VECTOR MEMORY]'), 'Prompt has memory section');
            assert.ok(prompt.includes('Fact 1: SOMA is on port 3001'), 'Prompt includes recalled vector');
        });

        it('should support adding and removing custom layers dynamically', () => {
            const assembler = new PromptLayerAssembler();
            assembler.setLayer('custom_protocol', () => '=== CUSTOM PROTOCOL ACTIVE ===');
            let prompt = assembler.assemble();
            assert.ok(prompt.includes('=== CUSTOM PROTOCOL ACTIVE ==='), 'Custom layer rendered');

            assembler.removeLayer('custom_protocol');
            prompt = assembler.assemble();
            assert.ok(!prompt.includes('=== CUSTOM PROTOCOL ACTIVE ==='), 'Custom layer removed');
        });
    });

    describe('GuardedToolPipeline', () => {
        it('should mount a plugin and execute actions', async () => {
            const pipeline = new GuardedToolPipeline();
            
            pipeline.mountPlugin('calculator', {
                actions: {
                    add: async ({ a, b }) => a + b
                }
            });

            const res = await pipeline.executeGuarded({
                tool: 'calculator',
                action: 'add',
                params: { a: 10, b: 25 }
            });

            assert.equal(res.success, true);
            assert.equal(res.result, 35);
        });

        it('should block dangerous destructive shell commands', async () => {
            const pipeline = new GuardedToolPipeline();

            const res = await pipeline.executeGuarded({
                tool: 'shell',
                action: 'run',
                params: { command: 'rm -rf /' }
            });

            assert.equal(res.success, false);
            assert.equal(res.blocked, true);
            assert.ok(res.error.includes('blocked by security guard'));
        });

        it('should unmount plugins cleanly with reversible effects', async () => {
            const pipeline = new GuardedToolPipeline();
            const unmount = pipeline.mountPlugin('temp_tool', {
                actions: { ping: async () => 'pong' }
            });

            let res = await pipeline.executeGuarded({ tool: 'temp_tool', action: 'ping' });
            assert.equal(res.success, true);
            assert.equal(res.result, 'pong');

            // Unmount
            unmount();

            res = await pipeline.executeGuarded({ tool: 'temp_tool', action: 'ping' });
            assert.equal(res.success, false);
            assert.ok(res.error.includes('No handler registered'));
        });
    });
});

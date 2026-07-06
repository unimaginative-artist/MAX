import { AutonomyPolicy } from '../../../core/AutonomyPolicy.js';

describe('AutonomyPolicy', () => {
    describe('read actions', () => {
        it('allows file.read at every level except off', () => {
            for (const level of ['observe', 'suggest', 'act', 'self_edit']) {
                const p = new AutonomyPolicy({ level });
                expect(p.can('file', 'read', {}).allowed).toBe(true);
            }
        });

        it('blocks all agent actions when level is off', () => {
            const p = new AutonomyPolicy({ level: 'off' });
            expect(p.can('file', 'read', {}, { source: 'agent' }).allowed).toBe(false);
        });

        it('allows ui-sourced actions even when level is off', () => {
            const p = new AutonomyPolicy({ level: 'off' });
            expect(p.can('file', 'read', { __source: 'ui' }).allowed).toBe(true);
        });
    });

    describe('write actions', () => {
        it('blocks file.write at observe level', () => {
            const p = new AutonomyPolicy({ level: 'observe' });
            expect(p.can('file', 'write', { filePath: 'src/foo.js' }).allowed).toBe(false);
        });

        it('allows file.write at act level', () => {
            const p = new AutonomyPolicy({ level: 'act' });
            expect(p.can('file', 'write', { filePath: 'src/foo.js' }).allowed).toBe(true);
        });
    });

    describe('external send', () => {
        it('blocks discord.send when externalSend is false', () => {
            const p = new AutonomyPolicy({ level: 'act', externalSend: false });
            expect(p.can('discord', 'send', {}).allowed).toBe(false);
        });

        it('allows discord.send when externalSend is true', () => {
            const p = new AutonomyPolicy({ level: 'act', externalSend: true });
            expect(p.can('discord', 'send', {}).allowed).toBe(true);
        });
    });

    describe('stats tracking', () => {
        it('increments checked, allowed, blocked counters correctly', () => {
            const p = new AutonomyPolicy({ level: 'observe' });
            p.can('file', 'read', {});
            p.can('file', 'write', { filePath: 'x.js' });
            expect(p.stats.checked).toBe(2);
            expect(p.stats.allowed).toBe(1);
            expect(p.stats.blocked).toBe(1);
        });

        it('records lastDecision with tool/action/allowed/ts', () => {
            const p = new AutonomyPolicy({ level: 'act' });
            p.can('shell', 'run', { command: 'ls' });
            expect(p.stats.lastDecision.tool).toBe('shell');
            expect(p.stats.lastDecision.action).toBe('run');
            expect(typeof p.stats.lastDecision.ts).toBe('number');
        });
    });
});

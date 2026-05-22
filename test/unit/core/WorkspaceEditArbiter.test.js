import { jest } from '@jest/globals';
import { WorkspaceEditArbiter } from '../../../core/WorkspaceEditArbiter.js';

function makeArbiter({ autoApplyMs = 20 } = {}) {
    const mockTools = { execute: jest.fn(async () => ({ success: true, content: 'written' })) };
    const mockMax   = { tools: mockTools };
    const arbiter   = new WorkspaceEditArbiter(mockMax, { autoApplyMs });
    return { arbiter, mockMax, mockTools };
}

describe('WorkspaceEditArbiter', () => {
    describe('propose()', () => {
        it('returns success:true with an editId string', async () => {
            const { arbiter } = makeArbiter();
            const result = await arbiter.propose('write', { filePath: 'src/foo.js', content: 'x' });
            expect(result.success).toBe(true);
            expect(typeof result.editId).toBe('string');
            expect(result.editId.startsWith('edit_')).toBe(true);
        });

        it('adds proposal to pendingEdits', async () => {
            const { arbiter } = makeArbiter();
            const { editId } = await arbiter.propose('write', { filePath: 'a.js' });
            expect(arbiter.pendingEdits.has(editId)).toBe(true);
            expect(arbiter.pendingEdits.get(editId).path).toBe('a.js');
        });

        it('emits editProposed event with proposal shape', async () => {
            const { arbiter } = makeArbiter();
            const events = [];
            arbiter.on('editProposed', e => events.push(e));
            await arbiter.propose('replace', { filePath: 'b.js', oldText: 'x', newText: 'y' });
            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('replace');
            expect(events[0].path).toBe('b.js');
        });

        it('auto-applies via tools.execute after timeout when no IDE response', async () => {
            const { arbiter, mockTools } = makeArbiter({ autoApplyMs: 20 });
            const { editId } = await arbiter.propose('write', { filePath: 'c.js' });
            await new Promise(r => setTimeout(r, 60));
            expect(mockTools.execute).toHaveBeenCalledWith('file', 'write', expect.objectContaining({ __applyProposal: true }));
            expect(arbiter.pendingEdits.has(editId)).toBe(false);
        });

        it('does NOT auto-apply if accepted before timeout', async () => {
            const { arbiter, mockTools } = makeArbiter({ autoApplyMs: 50 });
            const { editId } = await arbiter.propose('write', { filePath: 'd.js' });
            await arbiter.accept(editId);
            await new Promise(r => setTimeout(r, 100));
            // execute called exactly once (from accept), not twice
            expect(mockTools.execute).toHaveBeenCalledTimes(1);
        });
    });

    describe('accept()', () => {
        it('calls tools.execute with the proposal params', async () => {
            const { arbiter, mockTools } = makeArbiter();
            const { editId } = await arbiter.propose('write', { filePath: 'e.js', content: 'hello' });
            clearTimeout(arbiter._pendingTimers.get(editId)); // stop auto-apply for this test
            const result = await arbiter.accept(editId);
            expect(result.success).toBe(true);
            expect(mockTools.execute).toHaveBeenCalledWith(
                'file', 'write',
                expect.objectContaining({ filePath: 'e.js', __applyProposal: true })
            );
        });

        it('removes edit from pendingEdits after accept', async () => {
            const { arbiter } = makeArbiter();
            const { editId } = await arbiter.propose('write', { filePath: 'f.js' });
            await arbiter.accept(editId);
            expect(arbiter.pendingEdits.has(editId)).toBe(false);
        });

        it('emits editApplied event', async () => {
            const { arbiter } = makeArbiter();
            const events = [];
            arbiter.on('editApplied', e => events.push(e));
            const { editId } = await arbiter.propose('write', { filePath: 'g.js' });
            await arbiter.accept(editId);
            expect(events[0].id).toBe(editId);
        });

        it('returns error when editId not found', async () => {
            const { arbiter } = makeArbiter();
            const result = await arbiter.accept('nonexistent_id');
            expect(result.success).toBe(false);
            expect(result.error).toMatch(/not found/i);
        });
    });

    describe('reject()', () => {
        it('removes edit from pendingEdits', async () => {
            const { arbiter } = makeArbiter();
            const { editId } = await arbiter.propose('write', { filePath: 'h.js' });
            arbiter.reject(editId);
            expect(arbiter.pendingEdits.has(editId)).toBe(false);
        });

        it('emits editRejected event', async () => {
            const { arbiter } = makeArbiter();
            const events = [];
            arbiter.on('editRejected', e => events.push(e));
            const { editId } = await arbiter.propose('write', { filePath: 'i.js' });
            arbiter.reject(editId);
            expect(events[0].id).toBe(editId);
        });

        it('returns success:false for unknown editId', async () => {
            const { arbiter } = makeArbiter();
            const result = arbiter.reject('unknown');
            expect(result.success).toBe(false);
        });

        it('does NOT trigger auto-apply after reject', async () => {
            const { arbiter, mockTools } = makeArbiter({ autoApplyMs: 30 });
            const { editId } = await arbiter.propose('write', { filePath: 'j.js' });
            arbiter.reject(editId);
            await new Promise(r => setTimeout(r, 80));
            expect(mockTools.execute).not.toHaveBeenCalled();
        });
    });

    describe('getStatus()', () => {
        it('reflects current pending count', async () => {
            const { arbiter } = makeArbiter();
            await arbiter.propose('write', { filePath: 'k.js' });
            await arbiter.propose('write', { filePath: 'l.js' });
            expect(arbiter.getStatus().pendingCount).toBe(2);
        });

        it('includes active proposal list', async () => {
            const { arbiter } = makeArbiter();
            await arbiter.propose('replace', { filePath: 'm.js' });
            const status = arbiter.getStatus();
            expect(status.activeProposals).toHaveLength(1);
            expect(status.activeProposals[0].path).toBe('m.js');
            expect(status.activeProposals[0].type).toBe('replace');
        });
    });
});

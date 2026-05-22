import { EventEmitter } from 'events';
import path from 'path';

/**
 * WorkspaceEditArbiter.js — Manages proposed code changes for the IDE.
 * 
 * Instead of writing directly to disk, MAX can emit a "Proposed Edit".
 * These are sent to the Maxwell IDE for UI-based approval.
 */
export class WorkspaceEditArbiter extends EventEmitter {
    constructor(max, config = {}) {
        super();
        this.max = max;
        this._autoApplyMs   = config.autoApplyMs ?? 30_000;
        this.pendingEdits   = new Map(); // editId -> editDetails
        this._pendingTimers = new Map(); // editId -> timer
    }

    /**
     * Intercepts a file tool call and converts it to a virtual edit proposal.
     */
    async propose(type, params) {
        const editId   = `edit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const filePath = params.filePath || params.path;

        const proposal = {
            id: editId,
            type, // 'write' | 'replace' | 'patch'
            path: filePath,
            params,
            timestamp: Date.now()
        };

        this.pendingEdits.set(editId, proposal);
        console.log(`[WorkspaceEdit] 🚀 Proposed ${type} for ${filePath} (${editId})`);
        this.emit('editProposed', proposal);

        // If IDE doesn't accept within 30s, apply directly so the edit isn't lost.
        const timer = setTimeout(async () => {
            if (!this.pendingEdits.has(editId)) return; // already accepted/rejected
            console.log(`[WorkspaceEdit] ⏱️  No IDE response for ${filePath} — applying directly.`);
            this.pendingEdits.delete(editId);
            try {
                const result = await this.max.tools.execute('file', type, { ...params, __applyProposal: true });
                this.emit('editApplied', { id: editId, result });
            } catch (err) {
                this.emit('editFailed', { id: editId, error: err.message });
            }
        }, this._autoApplyMs);
        timer.unref?.();
        this._pendingTimers.set(editId, timer);

        return {
            success: true,
            editId,
            message: `Edit proposed to IDE for ${filePath}. Awaiting UI approval (auto-applies in 30s if no response).`
        };
    }

    /**
     * Called when the user clicks "Accept" in the Maxwell IDE.
     */
    async accept(editId) {
        const proposal = this.pendingEdits.get(editId);
        if (!proposal) return { success: false, error: 'Proposal not found' };

        console.log(`[WorkspaceEdit] ✅ Edit accepted: ${proposal.path}`);
        clearTimeout(this._pendingTimers.get(editId));
        this._pendingTimers.delete(editId);

        try {
            const result = await this.max.tools.execute('file', proposal.type, {
                ...proposal.params,
                __applyProposal: true,
                __source: 'workspace_edit'
            });

            if (result?.success === false) {
                return result;
            }

            this.pendingEdits.delete(editId);
            this.emit('editApplied', { id: editId, result });

            return result;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Called when the user clicks "Reject" in the Maxwell IDE.
     */
    reject(editId) {
        if (this.pendingEdits.has(editId)) {
            clearTimeout(this._pendingTimers.get(editId));
            this._pendingTimers.delete(editId);
            this.pendingEdits.delete(editId);
            this.emit('editRejected', { id: editId });
            return { success: true };
        }
        return { success: false, error: 'Proposal not found' };
    }

    getStatus() {
        return {
            pendingCount: this.pendingEdits.size,
            activeProposals: Array.from(this.pendingEdits.values()).map(p => ({ id: p.id, path: p.path, type: p.type }))
        };
    }
}

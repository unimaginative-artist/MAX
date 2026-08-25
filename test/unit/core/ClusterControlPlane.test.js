import fs from 'fs';
import os from 'os';
import path from 'path';
import { ClusterControlPlane } from '../../../core/ClusterControlPlane.js';

describe('ClusterControlPlane shared coordination', () => {
    let dir, first, second;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'max-control-plane-'));
        const dbPath = path.join(dir, 'control.db');
        first = new ClusterControlPlane({ nodeId: 'prime-a', dbPath });
        second = new ClusterControlPlane({ nodeId: 'prime-b', dbPath });
    });
    afterEach(() => {
        first.close(); second.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    test('elects one coordinator and atomically shares budget reservations', () => {
        expect(first.acquireLeadership()).toBe(true);
        expect(second.acquireLeadership()).toBe(false);
        const day = '2026-08-25';
        const reservation = first.reserveBudget(day, 0.20, 0.25);
        expect(reservation).toBeTruthy();
        expect(second.reserveBudget(day, 0.10, 0.25)).toBeNull();
        first.settleBudget(reservation, day, 0.10);
        expect(second.reserveBudget(day, 0.14, 0.25)).toBeTruthy();
    });
});

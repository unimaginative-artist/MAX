import { jest } from '@jest/globals';
import os from 'os';
import path from 'path';
import { Scheduler } from '../../../core/Scheduler.js';

describe('Scheduler', () => {
    it('does not start the same job again while it is already in flight', async () => {
        let releaseJob;
        const handler = jest.fn(() => new Promise(resolve => {
            releaseJob = resolve;
        }));

        const scheduler = new Scheduler({});
        scheduler._statePath = path.join(os.tmpdir(), `max-test-schedules-${Date.now()}.json`);
        scheduler.addJob({
            id: 'slow-job',
            label: 'Slow job',
            every: '1m',
            handler
        });
        scheduler._lastRun['slow-job'] = Date.now() - 61_000;

        await scheduler._tick();
        scheduler._lastRun['slow-job'] = Date.now() - 61_000;
        await scheduler._tick();

        expect(handler).toHaveBeenCalledTimes(1);

        releaseJob();
        await Promise.resolve();
    });
});

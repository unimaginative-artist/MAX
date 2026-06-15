import { jest } from '@jest/globals';
import { Heartbeat } from '../../../core/Heartbeat.js';

function makeHeartbeat(overrides = {}) {
    const max = {
        drive: {
            getStatus: jest.fn(() => ({ tension: 0 })),
            onIdleTick: jest.fn()
        },
        goals: {
            getNext: jest.fn(() => null)
        },
        config: {},
        ...overrides
    };
    return { heartbeat: new Heartbeat(max, { minIntervalMs: 1000, maxIntervalMs: 1000 }), max };
}

describe('Heartbeat', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('stops cleanly and clears the scheduled tick', () => {
        const { heartbeat } = makeHeartbeat();
        const stopped = jest.fn();
        heartbeat.on('stopped', stopped);

        heartbeat.start();
        expect(heartbeat.getStatus().running).toBe(true);

        heartbeat.stop();

        expect(heartbeat.getStatus().running).toBe(false);
        expect(heartbeat.config.enabled).toBe(false);
        expect(stopped).toHaveBeenCalledTimes(1);
    });

    it('does not run a tick after stop', () => {
        const runCycle = jest.spyOn(Heartbeat.prototype, '_runCycle').mockResolvedValue(false);
        try {
            const { heartbeat } = makeHeartbeat();

            heartbeat.start();
            heartbeat.stop();
            jest.advanceTimersByTime(1000);

            expect(runCycle).not.toHaveBeenCalled();
        } finally {
            runCycle.mockRestore();
        }
    });
});

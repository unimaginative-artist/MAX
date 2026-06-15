import { OutcomeTracker } from '../../../core/OutcomeTracker.js';

describe('OutcomeTracker Unit Tests', () => {
    let tracker;

    beforeEach(() => {
        tracker = new OutcomeTracker();
    });

    describe('Record outcome metrics', () => {
        it('should calculate avgLatency correctly when some outcomes lack duration', () => {
            tracker.record({ agent: 'AgentA', action: 'ActionA', success: true });
            expect(tracker.stats.avgLatency).toBe(0);
            expect(tracker.stats.latencyCount).toBe(0);

            tracker.record({ agent: 'AgentA', action: 'ActionA', success: true, duration: 100 });
            expect(tracker.stats.avgLatency).toBe(100);
            expect(tracker.stats.latencyCount).toBe(1);

            tracker.record({ agent: 'AgentA', action: 'ActionA', success: true });
            expect(tracker.stats.avgLatency).toBe(100); // Should remain 100, not get diluted

            tracker.record({ agent: 'AgentA', action: 'ActionA', success: true, duration: 200 });
            expect(tracker.stats.avgLatency).toBe(150); // Average of 100 and 200
            expect(tracker.stats.latencyCount).toBe(2);
        });
    });
});

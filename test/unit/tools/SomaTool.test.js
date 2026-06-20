import { SomaTool } from '../../../tools/SomaTool.js';

describe('SomaTool', () => {
    it('exposes the external SOMA lifecycle actions', () => {
        expect(SomaTool.name).toBe('soma');
        expect(Object.keys(SomaTool.actions).sort()).toEqual([
            'restart',
            'start',
            'status',
            'stop',
        ]);
    });

    it('documents every lifecycle action for the model tool manifest', () => {
        expect(Object.keys(SomaTool.actionDocs).sort()).toEqual(
            Object.keys(SomaTool.actions).sort()
        );
    });
});

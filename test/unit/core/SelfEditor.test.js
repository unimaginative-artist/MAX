import { SelfEditor } from '../../../core/SelfEditor.js';
import { jest } from '@jest/globals';

describe('SelfEditor Unit Tests', () => {
    let editor;

    beforeEach(() => {
        editor = new SelfEditor();
    });

    describe('manual diff generator', () => {
        it('should generate clean unified-diff hunks with 3 context lines', async () => {
            const originalCode = [
                'line 1',
                'line 2',
                'line 3',
                'line 4',
                'line 5',
                'line 6',
                'line 7',
                'line 8',
                'line 9',
                'line 10'
            ].join('\n');

            const modifiedCode = [
                'line 1',
                'line 2',
                'line 3',
                'line 4',
                'line 5 changed',
                'line 6',
                'line 7',
                'line 8',
                'line 9',
                'line 10'
            ].join('\n');

            // Mock readSource
            jest.spyOn(editor, 'readSource').mockResolvedValue({ code: originalCode });
            editor._staged.set('test_file.js', { newCode: modifiedCode });

            const result = await editor.diff('test_file.js');

            expect(result.changes).toBe(1);
            expect(result.diff).toContain('@@ -2,7 +2,7 @@');
            expect(result.diff).toContain('- line 5');
            expect(result.diff).toContain('+ line 5 changed');
            
            // Check context bounds (context lines = 3, so index 4 changed, context includes lines 2, 3, 4 and 6, 7, 8. Lines 1 and 9, 10 should not be in context!)
            expect(result.diff).not.toContain('line 1');
            expect(result.diff).not.toContain('line 9');
            expect(result.diff).not.toContain('line 10');
        });
    });
});

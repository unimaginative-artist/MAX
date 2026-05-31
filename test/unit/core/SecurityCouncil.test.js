import { SecurityCouncil } from '../../../core/SecurityCouncil.js';

function makeCouncil(config = {}) {
    return new SecurityCouncil({ agentBrain: { _ready: false } }, { enabled: true, ...config });
}

describe('SecurityCouncil', () => {
    const originalEnv = process.env.MAX_SECURITY_COUNCIL;

    afterEach(() => {
        if (originalEnv === undefined) delete process.env.MAX_SECURITY_COUNCIL;
        else process.env.MAX_SECURITY_COUNCIL = originalEnv;
    });

    it('is enabled by default', () => {
        delete process.env.MAX_SECURITY_COUNCIL;
        const council = new SecurityCouncil({ agentBrain: { _ready: false } });
        expect(council.getStatus().enabled).toBe(true);
    });

    it('can be disabled explicitly with MAX_SECURITY_COUNCIL=false', () => {
        process.env.MAX_SECURITY_COUNCIL = 'false';
        const council = new SecurityCouncil({ agentBrain: { _ready: false } });
        expect(council.getStatus().enabled).toBe(false);
    });

    it('blocks hardcoded secrets as critical findings', async () => {
        const council = makeCouncil();
        const result = await council.review('const apiKey = "sk-1234567890abcdefghijklmnop";', {
            filePath: 'src/config.js'
        });

        expect(result.safe).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.severity).toBe('critical');
        expect(result.issues[0].issue).toMatch(/API key|secret|credential/i);
    });

    it('blocks high-severity unsafe rendering by default', async () => {
        const council = makeCouncil();
        const result = await council.review('element.innerHTML = userInput;', {
            filePath: 'src/view.js'
        });

        expect(result.safe).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.severity).toBe('high');
    });

    it('allows clean code and updates clean stats', async () => {
        const council = makeCouncil();
        const result = await council.review('const text = String(input ?? "");\nelement.textContent = text;', {
            filePath: 'src/view.js'
        });

        expect(result.safe).toBe(true);
        expect(result.severity).toBe('none');
        expect(council.getStatus().clean).toBe(1);
    });
});

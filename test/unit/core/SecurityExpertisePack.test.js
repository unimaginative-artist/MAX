import { SecurityExpertisePack } from '../../../core/SecurityExpertisePack.js';

describe('SecurityExpertisePack', () => {
    it('does not inject security context for unrelated casual chat', () => {
        const pack = new SecurityExpertisePack();
        expect(pack.getContextForTask('what do you think about the weather')).toBe('');
    });

    it('injects baseline doctrine for generic app builds', () => {
        const pack = new SecurityExpertisePack();
        const context = pack.getContextForTask('build a small todo app');

        expect(context).toContain('Security Expertise Pack');
        expect(context).toContain('MAX Security Doctrine');
        expect(context).toContain('Secure Build Checklist');
    });

    it('selects auth and API guidance for login endpoint work', () => {
        const pack = new SecurityExpertisePack();
        const context = pack.getContextForTask('implement login auth API endpoints with sessions');

        expect(context).toContain('Auth Security Checklist');
        expect(context).toContain('API Security Checklist');
        expect(context).toContain('Skill: Audit Auth Flow');
        expect(context).toContain('Skill: Audit API Endpoints');
    });

    it('selects frontend XSS guidance for rendered HTML work', () => {
        const pack = new SecurityExpertisePack();
        const context = pack.getContextForTask('build a React markdown renderer for user comments');

        expect(context).toContain('Frontend XSS Checklist');
        expect(context).toContain('Skill: Audit Frontend XSS');
    });

    it('reports status with available security surfaces', () => {
        const pack = new SecurityExpertisePack();
        const status = pack.getStatus();

        expect(status.loaded).toBe(true);
        expect(status.surfaces).toContain('auth');
        expect(status.surfaces).toContain('api');
        expect(status.surfaces).toContain('agent-tools');
    });
});

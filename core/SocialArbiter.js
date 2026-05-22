import fs from 'fs';
import { existsSync } from 'fs';
import path from 'path';

/**
 * SocialArbiter.js — The "Honcho" layer for MAX.
 * 
 * Actively monitors chat turns to extract:
 * 1. User Bio (skills, tech stack, role, name)
 * 2. Real-time Tasks (implicit goals mentioned in chat)
 * 3. Preferences (UI/UX, coding style, communication)
 * 4. Relationship Model (Formality, humor, nicknames, formality level)
 * 
 * Updates .max/user.md and .max/tasks.md automatically.
 */
export class SocialArbiter {
    constructor(max) {
        this.max = max;
        this.lastProcessedTurn = 0;
        this.userFile = path.join(process.cwd(), '.max', 'user.md');
        this.taskFile = path.join(process.cwd(), '.max', 'tasks.md');
        this.isProcessing = false;
        this.socialContextFile = path.join(process.cwd(), '.max', 'social_context.json');
        this.socialContext = {
            formality: 'neutral',
            directness: 'direct',
            humorPref: 'neutral',
            tone: 'neutral'
        };
        this._load();
    }

    _load() {
        try {
            if (existsSync(this.socialContextFile)) {
                const data = JSON.parse(fs.readFileSync(this.socialContextFile, 'utf8'));
                this.socialContext = { ...this.socialContext, ...data };
            }
        } catch (err) { 
            console.error('[SocialArbiter] Load error:', err.message);
        }
    }

    _save() {
        try {
            const dir = path.dirname(this.socialContextFile);
            if (!existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.socialContextFile, JSON.stringify(this.socialContext, null, 2));
        } catch (err) {
            console.error('[SocialArbiter] Save error:', err.message);
        }
    }

    /**
     * Called by Heartbeat or after a chat turn to scan for updates.
     */
    async scan() {
        if (this.isProcessing) return;
        const context = this.max._context;
        if (context.length <= this.lastProcessedTurn) return;

        this.isProcessing = true;
        try {
            const newTurns = context.slice(this.lastProcessedTurn);
            this.lastProcessedTurn = context.length;

            const conversationText = newTurns.map(t => `${t.role.toUpperCase()}: ${t.content}`).join('\n\n');
            
            // 1. Extract Facts & Preferences
            await this._extractSocialFacts(conversationText);
            
            // 2. Extract Implicit Tasks
            await this._extractImplicitTasks(conversationText);

            // 3. Update Social Style
            await this._updateSocialStyle(conversationText);

            this._save();

        } catch (err) {
            console.error('[SocialArbiter] Error during scan:', err.message);
        } finally {
            this.isProcessing = false;
        }
    }

    async _extractSocialFacts(text) {
        if (text.length < 50) return;

        const currentProfile = this.max.profile?._user || 'No profile yet.';
        
        const prompt = `You are the Social Memory layer for MAX.
Analyze the following conversation segment and extract NEW or UPDATED information about the user.

USER PROFILE (CURRENT):
${currentProfile}

CONVERSATION:
${text}

Look for:
- User's name, role, or company.
- Technical skills or tech stack they are using.
- Personal preferences (e.g., "I hate Tailwind", "I prefer async/await over promises").
- Recurring pain points or personal context (e.g., "I'm working from a cafe today").

Output ONLY a list of specific, concise bullet points for updates. 
If nothing new is found, output "NONE".
Format:
- [FACT] User is a Senior React Dev.
- [PREF] User dislikes excessive comments.
- [BIO] User's name is Barry.
- [LIFE] User is working from a cafe today.`;

        const res = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.2 });
        const facts = res.text.split('\n').filter(f => f.startsWith('- ['));

        if (facts.length > 0) {
            console.log(`[SocialArbiter] 🧠 Extracted ${facts.length} social facts.`);
            for (const fact of facts) {
                this.max.profile.addNote(fact.replace(/- \[[A-Z]+\] /, ''));
            }
        }
    }

    async _updateSocialStyle(text) {
        const prompt = `Analyze the user's communication style in this conversation.
        
CONVERSATION:
${text}

Determine:
1. Formality (formal, casual, friendly, professional)
2. Directness (direct, narrative, brief, thorough)
3. Tone (humorous, serious, impatient, curious)

Output ONLY a JSON object:
{ "formality": "...", "directness": "...", "tone": "..." }`;

        const res = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.1 });
        const match = res.text.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                const style = JSON.parse(match[0]);
                this.socialContext = { ...this.socialContext, ...style };
                // Also store as a note if it's a significant shift
                this.max.profile.addNote(`Social Style: User is ${style.formality} and ${style.directness} with a ${style.tone} tone.`);
            } catch (e) { console.warn('[SocialArbiter] Style parse failed:', e.message); }
        }
    }

    /**
     * Injects the Social Persona into the system prompt.
     */
    getSocialDirective() {
        const { formality, directness, tone } = this.socialContext;
        return `\n\n## Social Context (Learned from Interaction)\n- User Style: ${formality}, ${directness}, ${tone}.\n- Adaptive Directive: Align your tone with the user. If they are brief, be brief. If they use humor, lean into it. Always respect their technical preferences.`;
    }

    async _extractImplicitTasks(text) {
        // Look for things the user says they "need to do" or "should do"
        const prompt = `Analyze this conversation for implicit tasks the user mentioned they need to do.
        
CONVERSATION:
${text}

Output ONLY a JSON array of strings (the tasks). If none, output "[]".
Example: ["Update the README", "Fix the login bug"]`;

        const res = await this.max.brain.think(prompt, { tier: 'fast', temperature: 0.1 });
        const match = res.text.match(/\[.*\]/s);
        if (match) {
            try {
                const tasks = JSON.parse(match[0]);
                if (Array.isArray(tasks) && tasks.length > 0) {
                    console.log(`[SocialArbiter] 📋 Found ${tasks.length} implicit tasks.`);
                    for (const task of tasks) {
                        // Check if task already exists roughly
                        const active = this.max.profile.getActiveTasks();
                        if (!active.some(a => a.toLowerCase().includes(task.toLowerCase()))) {
                            this.max.profile.addTask(task, 'Implicit Tasks');
                        }
                    }
                }
            } catch (e) { console.warn('[SocialArbiter] Task parse failed:', e.message); }
        }
    }

    getStatus() {
        return {
            lastProcessedTurn: this.lastProcessedTurn,
            userFileExists: existsSync(this.userFile),
            taskFileExists: existsSync(this.taskFile)
        };
    }
}

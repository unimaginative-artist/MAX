// DiscordGateway.js — bridges Discord messages to MAX's goal engine

import { GoalEngine } from './GoalEngine.js';
import { DiscordTool } from '../tools/DiscordTool.js';

const BOT_MENTION = /<@!?1482791716821012510>/; // MAX's Discord ID
const COMMAND_PATTERNS = {
  list: /list\s+(all\s+)?(files|js|projects?)?/i,
  scan: /scan\s+(for\s+)?(TODO|FIXME|bugs?)/i,
  status: /status\s+(of\s+)?(soma|max|system)/i,
  test: /test\s+(the\s+)?(agent|loop|gateway)/i,
};

export class DiscordGateway {
  constructor(agentLoop) {
    this.agentLoop = agentLoop;
    this.goalEngine = agentLoop.goalEngine;
    this.discord = new DiscordTool();
    this.connected = false;
  }

  async start() {
    console.log('[DiscordGateway] Starting...');
    // Connect to Discord using the same token as the DiscordTool
    const { success, error } = await this.discord.setup({});
    if (!success) {
      console.error('[DiscordGateway] Failed to connect:', error);
      return;
    }
    this.connected = true;
    // Enable monitoring on 'general' channel
    await this.discord.monitor({ channelName: 'general', enable: true });
    console.log('[DiscordGateway] Monitoring #general for commands');
    // Start listening loop
    this.listenLoop();
  }

  async listenLoop() {
    while (this.connected) {
      try {
        const { success, messages } = await this.discord.read({ channelName: 'general', limit: 5 });
        if (success && messages?.length) {
          for (const msg of messages) {
            // Avoid processing our own messages
            if (msg.author === 'MAX') continue;
            if (BOT_MENTION.test(msg.content)) {
              await this.processCommand(msg);
            }
          }
        }
      } catch (err) {
        console.error('[DiscordGateway] Listen error:', err.message);
      }
      // Poll every 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  async processCommand(msg) {
    const content = msg.content.replace(BOT_MENTION, '').trim();
    console.log(`[DiscordGateway] Command from ${msg.author}: ${content}`);

    let goal = null;
    if (COMMAND_PATTERNS.list.test(content)) {
      goal = {
        title: `List files (from Discord)`, 
        description: `User requested: ${content}`,
        type: 'task',
        priority: 0.8,
        steps: [
          { step: 1, action: 'shell:run', params: { command: 'dir /B' } }
        ],
        verifyCommand: 'echo list complete'
      };
    } else if (COMMAND_PATTERNS.scan.test(content)) {
      goal = {
        title: `Scan for TODOs (from Discord)`,
        description: `User requested: ${content}`,
        type: 'research',
        priority: 0.7,
        steps: [
          { step: 1, action: 'file:grep', params: { dir: '.', pattern: 'TODO|FIXME', filePattern: '.js' } }
        ],
        verifyCommand: 'echo scan complete'
      };
    } else if (COMMAND_PATTERNS.status.test(content)) {
      goal = {
        title: `System status (from Discord)`,
        description: `User requested: ${content}`,
        type: 'research',
        priority: 0.9,
        steps: [
          { step: 1, action: 'shell:run', params: { command: 'node -v' } },
          { step: 2, action: 'shell:run', params: { command: 'npm list --depth=0' } },
          { step: 3, action: 'file:read', params: { filePath: 'core/AgentLoop.js', startLine: 1, endLine: 10 } }
        ],
        verifyCommand: 'echo status complete'
      };
    } else {
      // Fallback generic goal
      goal = {
        title: `Generic task: ${content.substring(0, 30)}`,
        description: `User said: ${content}`,
        type: 'task',
        priority: 0.5,
        steps: [
          { step: 1, action: 'shell:run', params: { command: `echo "Received: ${content}"` } }
        ],
        verifyCommand: 'echo generic done'
      };
    }

    goal.source = 'discord';
    goal.channelId = 'general';
    goal.messageId = msg.id;
    goal.author = msg.author;

    const goalId = await this.goalEngine.queueGoal(goal);
    console.log(`[DiscordGateway] Goal queued: ${goalId}`);
    // Acknowledge receipt
    await this.discord.reply({
      messageId: msg.id,
      channelName: 'general',
      message: `✅ Goal created: "${goal.title}". I'll start working on it now.`
    });
  }

  async stop() {
    this.connected = false;
    await this.discord.monitor({ channelName: 'general', enable: false });
    console.log('[DiscordGateway] Stopped.');
  }
}

import { Client, GatewayIntentBits, Events } from 'discord.js';
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { getConfig } from '../config.js';
import { board } from '../state.js';

// ---------------------------------------------------------------- Telegram

let telegramGeneration = 0;

async function runTelegram(token: string, generation: number) {
  let offset = 0;
  console.log('[telegram] long-polling started');
  while (generation === telegramGeneration) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${offset}`,
        { signal: AbortSignal.timeout(45000) },
      );
      const data: any = await res.json();
      if (!data.ok) {
        if (data.error_code === 401) {
          console.error('[telegram] invalid bot token, stopping');
          return;
        }
        throw new Error(data.description ?? 'getUpdates failed');
      }
      for (const update of data.result ?? []) {
        offset = update.update_id + 1;
        const text = update.message?.text ?? update.channel_post?.text;
        if (text && generation === telegramGeneration) {
          console.log('[telegram] message:', text);
          board.showMessage(text);
        }
      }
    } catch (err) {
      if (generation !== telegramGeneration) return;
      console.error('[telegram]', (err as Error).message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ---------------------------------------------------------------- Discord

let discordClient: Client | null = null;

async function startDiscord(token: string, channelId: string) {
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });
  discordClient.on(Events.MessageCreate, (msg) => {
    if (msg.author.bot) return;
    if (channelId && msg.channelId !== channelId) return;
    const text = msg.cleanContent || msg.content;
    if (text) {
      console.log('[discord] message:', text);
      board.showMessage(text);
    }
  });
  discordClient.once(Events.ClientReady, (c) =>
    console.log(`[discord] connected as ${c.user.tag}`),
  );
  try {
    await discordClient.login(token);
  } catch (err) {
    console.error('[discord] login failed:', (err as Error).message);
  }
}

// ---------------------------------------------------------------- Slack

let slackClient: SocketModeClient | null = null;

async function startSlack(appToken: string) {
  slackClient = new SocketModeClient({ appToken });
  slackClient.on('message', async ({ event, ack }: any) => {
    await ack();
    if (event?.bot_id || event?.subtype) return;
    if (event?.text) {
      console.log('[slack] message:', event.text);
      board.showMessage(event.text);
    }
  });
  try {
    await slackClient.start();
    console.log('[slack] socket mode connected');
  } catch (err) {
    console.error('[slack] connection failed:', (err as Error).message);
  }
}

// ---------------------------------------------------------------- Lifecycle

/** Stop everything and start whatever the current config enables. */
export async function applyMessageConfig(): Promise<void> {
  telegramGeneration++;
  if (discordClient) {
    void discordClient.destroy();
    discordClient = null;
  }
  if (slackClient) {
    void slackClient.disconnect().catch(() => {});
    slackClient = null;
  }

  const { messages } = getConfig();
  if (messages.telegram.enabled && messages.telegram.botToken) {
    void runTelegram(messages.telegram.botToken, telegramGeneration);
  }
  if (messages.discord.enabled && messages.discord.botToken) {
    void startDiscord(messages.discord.botToken, messages.discord.channelId);
  }
  if (messages.slack.enabled && messages.slack.appToken) {
    void startSlack(messages.slack.appToken);
  }
}

// ---------------------------------------------------------------- Tests

export async function testTelegram(token: string): Promise<string> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(10000),
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(data.description ?? 'Invalid token');
  return `Connected as @${data.result.username}`;
}

export async function testDiscord(token: string, channelId: string): Promise<string> {
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('Invalid bot token');
  const me: any = await res.json();
  if (channelId) {
    const ch = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!ch.ok) throw new Error(`Token OK (${me.username}) but channel ${channelId} is not accessible`);
  }
  return `Connected as ${me.username}`;
}

export async function testSlack(botToken: string, appToken: string): Promise<string> {
  const auth: any = await new WebClient(botToken).auth.test();
  if (!auth.ok) throw new Error('Invalid bot token');
  const res = await fetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${appToken}` },
    signal: AbortSignal.timeout(10000),
  });
  const conn: any = await res.json();
  if (!conn.ok) throw new Error(`Bot token OK but app token failed: ${conn.error}`);
  return `Connected to ${auth.team} as ${auth.user}`;
}

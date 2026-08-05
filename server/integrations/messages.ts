/**
 * Credential validation for the message integrations.
 *
 * There are deliberately no long-lived connections here. Inbound messages
 * arrive by webhook (see server/hooks.ts), because a hosted board cannot run a
 * Telegram poll loop, a Discord gateway client and a Slack socket per user.
 * These helpers only check that what a user pasted actually works, so the
 * settings UI can say so before saving.
 */

export interface TelegramIdentity {
  botId: string;
  username: string;
}

export async function verifyTelegramToken(token: string): Promise<TelegramIdentity> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(data.description ?? 'Invalid bot token');
  return { botId: String(data.result.id), username: data.result.username };
}

/** Point a bot at our per-board webhook URL. Replaces getUpdates polling. */
export async function setTelegramWebhook(
  token: string,
  url: string,
  secret: string,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ['message', 'channel_post'],
      drop_pending_updates: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json();
  if (!data.ok) throw new Error(data.description ?? 'setWebhook failed');
}

/** Hand the bot back to whoever wants to poll it. */
export async function clearTelegramWebhook(token: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

export interface DiscordIdentity {
  applicationId: string;
  username: string;
}

export async function verifyDiscordToken(token: string): Promise<DiscordIdentity> {
  const res = await fetch('https://discord.com/api/v10/applications/@me', {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('Invalid bot token');
  const app: any = await res.json();
  return { applicationId: String(app.id), username: app.name ?? 'bot' };
}

/**
 * Register the /board slash command for the user's app. The Discord developer
 * portal has no command builder, so doing it here saves them a curl.
 */
export async function registerBoardCommand(token: string, applicationId: string): Promise<void> {
  const res = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        name: 'board',
        description: 'Put a message on your Solaris board for 60 seconds',
        options: [
          { name: 'text', description: 'What the board should say', type: 3, required: true },
        ],
      },
    ]),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Could not register the /board command (${res.status})`);
  }
}

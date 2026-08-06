import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { one, query } from './db.js';
import { safeEqual } from './crypto.js';
import { setOverride } from './boardService.js';
import { byIp, rateLimit } from './rateLimit.js';
import {
  getByPathId,
  markEvent,
  readSecrets,
  type IntegrationRow,
  type Kind,
  type Secrets,
} from './integrations/store.js';

/**
 * Inbound messages arrive here as webhooks rather than over held connections.
 * That is what makes the hosted version possible at all: one process cannot
 * run a Telegram poll loop, a Discord gateway client and a Slack socket per
 * user. It also means these handlers must be fast and idempotent, because all
 * three providers retry.
 */

const MAX_MESSAGE_CHARS = 500;

/** Raw body, needed because every provider signs the exact bytes. */
function rawBody(req: Request): Buffer {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
}

function parseJson(req: Request): any {
  try {
    return JSON.parse(rawBody(req).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Record that we have seen this provider event. Returns false if it is a
 * duplicate, which happens constantly: Slack retries at 0s/1min/5min and a
 * cold start can easily miss the first attempt.
 */
async function firstTime(integrationId: string, eventId: string): Promise<boolean> {
  try {
    const row = await one<{ id: string }>(
      `insert into webhook_events (integration_id, provider_event_id)
            values ($1, $2)
       on conflict (integration_id, provider_event_id) do nothing
         returning id`,
      [integrationId, eventId],
    );
    return !!row;
  } catch (err) {
    console.error('[hooks] dedupe failed:', (err as Error).message);
    return true; // fail open: showing a message twice beats dropping it
  }
}

async function show(row: IntegrationRow, text: string): Promise<void> {
  const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!trimmed) return;
  await setOverride(row.board_id, trimmed);
  await markEvent(row.id);
}

type Handler = (req: Request, res: Response, row: IntegrationRow) => Promise<void>;

/** Lookup, then hand off. Every provider is routed by its own opaque path id. */
function withIntegration(kind: Kind, handler: Handler) {
  return async (req: Request, res: Response) => {
    const row = await getByPathId(kind, req.params.pathId);
    // Same answer for "no such hook" and "disabled": nothing to learn here.
    if (!row || !row.enabled) return void res.status(404).json({ error: 'Not found' });
    try {
      await handler(req, res, row);
    } catch (err) {
      console.error(`[hooks:${kind}]`, (err as Error).message);
      if (!res.headersSent) res.status(500).json({ error: 'Handler failed' });
    }
  };
}

// --------------------------------------------------------------- Telegram

const telegram: Handler = async (req, res, row) => {
  const secrets = readSecrets<'telegram'>(row) as Secrets['telegram'] | null;
  const provided = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
  if (!secrets || !safeEqual(provided, secrets.webhookSecret)) {
    return void res.status(401).json({ error: 'Bad secret token' });
  }

  const update = parseJson(req);
  const updateId = update?.update_id;
  if (updateId === undefined) return void res.status(200).json({ ok: true });

  // Answer before doing work: Telegram redelivers on a slow response.
  res.status(200).json({ ok: true });

  if (!(await firstTime(row.id, `tg:${updateId}`))) return;
  const text: string | undefined = update.message?.text ?? update.channel_post?.text;
  if (text) {
    console.log(`[telegram] message received (${text.length} chars)`);
    await show(row, text);
  }
};

// ------------------------------------------------------------------ Slack

const SLACK_MAX_SKEW_SECONDS = 300;

const slack: Handler = async (req, res, row) => {
  const secrets = readSecrets<'slack'>(row) as Secrets['slack'] | null;
  const timestamp = String(req.headers['x-slack-request-timestamp'] ?? '');
  const signature = String(req.headers['x-slack-signature'] ?? '');
  if (!secrets || !timestamp || !signature) {
    return void res.status(401).json({ error: 'Unsigned request' });
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SLACK_MAX_SKEW_SECONDS) {
    return void res.status(401).json({ error: 'Stale timestamp' });
  }

  const expected =
    'v0=' +
    crypto
      .createHmac('sha256', secrets.signingSecret)
      .update(`v0:${timestamp}:${rawBody(req).toString('utf8')}`)
      .digest('hex');
  if (!safeEqual(expected, signature)) {
    return void res.status(401).json({ error: 'Bad signature' });
  }

  const body = parseJson(req);

  // Slack signs the verification handshake too, so answer it only after the
  // signature checks out.
  if (body?.type === 'url_verification') {
    return void res.status(200).json({ challenge: body.challenge });
  }

  // The 3-second budget is the whole reason this acks first.
  res.status(200).end();

  const event = body?.event;
  if (!event || event.bot_id || event.subtype) return;
  if (row.channel_filter && event.channel !== row.channel_filter) return;
  const eventId = body.event_id ?? `${event.channel}:${event.ts}`;
  if (!(await firstTime(row.id, `slack:${eventId}`))) return;
  if (event.text) {
    console.log(`[slack] message received (${String(event.text).length} chars)`);
    await show(row, String(event.text));
  }
};

// ---------------------------------------------------------------- Discord

const discord: Handler = async (req, res, row) => {
  const secrets = readSecrets<'discord'>(row) as Secrets['discord'] | null;
  const signature = String(req.headers['x-signature-ed25519'] ?? '');
  const timestamp = String(req.headers['x-signature-timestamp'] ?? '');
  if (!secrets || !signature || !timestamp) {
    return void res.status(401).json({ error: 'Unsigned request' });
  }

  // Ed25519 via node's own crypto, so no discord library is needed.
  let valid = false;
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'), // Ed25519 SPKI prefix
        Buffer.from(secrets.publicKey, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    valid = crypto.verify(
      null,
      Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody(req)]),
      publicKey,
      Buffer.from(signature, 'hex'),
    );
  } catch {
    valid = false;
  }
  // Discord refuses to save an endpoint that 2xx's a bad signature.
  if (!valid) return void res.status(401).json({ error: 'Bad signature' });

  const body = parseJson(req);

  if (body?.type === 1) return void res.status(200).json({ type: 1 }); // PING -> PONG

  if (body?.type === 2) {
    const text = body.data?.options?.find((o: any) => o.name === 'text')?.value;
    // Ephemeral reply (flag 64) so the channel stays clean.
    res.status(200).json({
      type: 4,
      data: { content: 'On your board for the next 60 seconds.', flags: 64 },
    });
    if (!(await firstTime(row.id, `discord:${body.id}`))) return;
    if (text) {
      console.log(`[discord] /board received (${String(text).length} chars)`);
      await show(row, String(text));
    }
    return;
  }

  res.status(200).json({ type: 1 });
};

// ------------------------------------------------------------------ mount

export function mountHooks(app: Express) {
  // Keyed by IP: an unauthenticated endpoint has nothing better to key on.
  const limit = rateLimit({ name: 'hooks', limit: 120, windowMs: 60_000, key: byIp });
  app.post('/hooks/telegram/:pathId', limit, withIntegration('telegram', telegram));
  app.post('/hooks/slack/:pathId', limit, withIntegration('slack', slack));
  app.post('/hooks/discord/:pathId', limit, withIntegration('discord', discord));

  /**
   * Dev-only escape hatch so the message path can be exercised without a
   * tunnel. Registered conditionally rather than guarded inside the handler,
   * so it cannot exist at all in production.
   */
  if (process.env.NODE_ENV !== 'production') {
    app.post('/hooks/dev/:pathId', async (req, res) => {
      const row = await getByPathId('telegram', req.params.pathId);
      if (!row) return void res.status(404).json({ error: 'Not found' });
      const text = parseJson(req)?.text;
      if (!text) return void res.status(400).json({ error: 'Send {"text": "..."}' });
      await setOverride(row.board_id, String(text));
      res.json({ ok: true, note: 'dev only, signature skipped' });
    });
  }
}

export { query };

import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { randomId } from '../crypto.js';
import { requireBoard } from '../auth.js';
import { byUser, rateLimit } from '../rateLimit.js';
import {
  clearTelegramWebhook,
  registerBoardCommand,
  setTelegramWebhook,
  verifyDiscordToken,
  verifyTelegramToken,
} from './messages.js';
import {
  ensure,
  publicView,
  readSecrets,
  remove,
  setStatus,
  webhookUrl,
  writeSecrets,
  KINDS,
  type Kind,
  type Secrets,
} from './store.js';

const Telegram = z.object({
  kind: z.literal('telegram'),
  botToken: z.string().trim().min(20).max(200).optional(),
});

const Slack = z.object({
  kind: z.literal('slack'),
  signingSecret: z.string().trim().min(16).max(200).optional(),
  channelId: z.string().trim().max(40).optional(),
});

const Discord = z.object({
  kind: z.literal('discord'),
  publicKey: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, 'Public key should be 64 hex characters')
    .optional(),
  botToken: z.string().trim().min(20).max(200).optional(),
});

const Body = z.discriminatedUnion('kind', [Telegram, Slack, Discord]);

/** Keep whatever is already stored when a field is left blank on re-save. */
function merged<T extends object>(existing: T | null, incoming: Partial<T>): T {
  const out: any = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out as T;
}

export function mountIntegrationRoutes(app: Express) {
  const limit = rateLimit({ name: 'integrations', limit: 20, windowMs: 60_000, key: byUser });

  app.put(
    '/api/board/integrations/:kind',
    limit,
    requireBoard,
    async (req: Request, res: Response) => {
      const kind = req.params.kind as Kind;
      if (!KINDS.includes(kind)) return res.status(404).json({ error: 'Unknown integration' });

      const parsed = Body.safeParse({ ...(req.body ?? {}), kind });
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: parsed.error.issues[0]?.message ?? 'Invalid details' });
      }

      const row = await ensure(req.board!.id, kind);
      const url = webhookUrl(kind, row.webhook_path_id!);

      try {
        if (kind === 'telegram') {
          const prev = readSecrets<'telegram'>(row) as Secrets['telegram'] | null;
          const next = merged(prev, parsed.data as any) as Secrets['telegram'];
          if (!next.botToken) return res.status(400).json({ error: 'Bot token required' });
          // Reuse the existing secret so re-saving doesn't invalidate the hook.
          next.webhookSecret = prev?.webhookSecret ?? randomId(24);

          // Check the token before claiming success, so a typo reads as a typo.
          const who = await verifyTelegramToken(next.botToken);
          await setTelegramWebhook(next.botToken, url, next.webhookSecret);
          await writeSecrets(row, next, {
            enabled: true,
            externalId: who.botId,
            status: 'ok',
            statusDetail: `Connected as @${who.username}`,
          });
          return res.json({ ok: true, detail: `Connected as @${who.username}`, webhookUrl: url });
        }

        if (kind === 'slack') {
          const prev = readSecrets<'slack'>(row) as Secrets['slack'] | null;
          const next = merged(prev, parsed.data as any) as Secrets['slack'];
          if (!next.signingSecret) {
            return res.status(400).json({ error: 'Signing secret required' });
          }
          // Nothing to verify against until Slack calls us, so this stays
          // "pending" until the first real event arrives.
          await writeSecrets(row, next, {
            enabled: true,
            channelFilter: (parsed.data as any).channelId || null,
            status: 'pending',
            statusDetail: 'Paste the request URL into Slack, then post a message',
          });
          return res.json({ ok: true, detail: 'Saved', webhookUrl: url });
        }

        // discord
        const prev = readSecrets<'discord'>(row) as Secrets['discord'] | null;
        const next = merged(prev, parsed.data as any) as Secrets['discord'];
        if (!next.publicKey || !next.botToken) {
          return res.status(400).json({ error: 'Public key and bot token are both required' });
        }
        const app_ = await verifyDiscordToken(next.botToken);
        await registerBoardCommand(next.botToken, app_.applicationId);
        await writeSecrets(row, next, {
          enabled: true,
          externalId: app_.applicationId,
          status: 'ok',
          statusDetail: `/board registered for ${app_.username}`,
        });
        return res.json({
          ok: true,
          detail: `/board registered for ${app_.username}`,
          webhookUrl: url,
        });
      } catch (err) {
        const message = (err as Error).message;
        await setStatus(row.id, 'error', message);
        return res.status(400).json({ error: message, webhookUrl: url });
      }
    },
  );

  app.delete(
    '/api/board/integrations/:kind',
    limit,
    requireBoard,
    async (req: Request, res: Response) => {
      const kind = req.params.kind as Kind;
      if (!KINDS.includes(kind)) return res.status(404).json({ error: 'Unknown integration' });

      const row = await remove(req.board!.id, kind);
      // Hand the Telegram bot back so polling works for whoever wants it.
      if (row && kind === 'telegram') {
        const secrets = readSecrets<'telegram'>(row) as Secrets['telegram'] | null;
        if (secrets?.botToken) await clearTelegramWebhook(secrets.botToken);
      }
      res.json({ ok: true });
    },
  );

  app.get('/api/board/integrations', requireBoard, async (req: Request, res: Response) => {
    const { listForBoard } = await import('./store.js');
    const rows = await listForBoard(req.board!.id);
    res.json({ integrations: rows.map(publicView) });
  });
}

import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { one, query } from './db.js';

const KINDS = ['source', 'feature', 'bug', 'other'] as const;

const Body = z.object({
  kind: z.enum(KINDS),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4000),
  replyTo: z.string().trim().email().max(200).optional().or(z.literal('')),
});

const PER_DAY = 3;

/** Header injection guard: newlines in a header field let you forge headers. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

const LABEL: Record<(typeof KINDS)[number], string> = {
  source: 'New data source',
  feature: 'Feature request',
  bug: 'Something is broken',
  other: 'Other',
};

async function sendViaPostmark(fields: {
  kind: string;
  subject: string;
  body: string;
  replyTo?: string;
  email: string;
}): Promise<void> {
  const token = process.env.POSTMARK_TOKEN;
  const from = process.env.POSTMARK_FROM;
  const to = process.env.SUPPORT_TO;
  if (!token || !from || !to) {
    throw new Error('Email is not configured on this server');
  }

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify({
      From: from,
      To: to,
      // Only ever in ReplyTo, never From or Subject, and stripped of newlines.
      ReplyTo: fields.replyTo ? oneLine(fields.replyTo) : oneLine(fields.email),
      Subject: oneLine(`[Solaris] ${LABEL[fields.kind as never] ?? fields.kind}: ${fields.subject}`),
      TextBody: [
        `From: ${fields.email}`,
        fields.replyTo ? `Reply to: ${fields.replyTo}` : null,
        `Type: ${LABEL[fields.kind as never] ?? fields.kind}`,
        '',
        fields.body,
      ]
        .filter(Boolean)
        .join('\n'),
      MessageStream: 'outbound',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail: any = await res.json().catch(() => ({}));
    throw new Error(detail.Message ?? `Postmark returned ${res.status}`);
  }
}

export function mountSupport(app: Express) {
  app.post('/api/support', async (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in' });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' });
    }

    // Counted in the database, not in memory: the real budget here is a finite
    // monthly email quota, and a limit that resets on restart is not a limit.
    const used = await one<{ n: number }>(
      `select count(*)::int as n from support_requests
        where user_id = $1 and created_at > now() - interval '1 day'`,
      [req.user.id],
    );
    if ((used?.n ?? 0) >= PER_DAY) {
      return res
        .status(429)
        .json({ error: `That is ${PER_DAY} messages today. Please continue tomorrow.` });
    }

    const { kind, subject, body, replyTo } = parsed.data;
    const row = await one<{ id: string }>(
      `insert into support_requests (user_id, kind, subject, body, reply_to)
            values ($1, $2, $3, $4, $5)
         returning id`,
      [req.user.id, kind, subject, body, replyTo || null],
    );

    // Stored first, mailed second: the request is never lost just because
    // email is unconfigured or Postmark is having a bad day.
    try {
      await sendViaPostmark({ kind, subject, body, replyTo, email: req.user.email });
      await query('update support_requests set delivered_at = now() where id = $1', [row!.id]);
      res.json({ ok: true, detail: 'Thanks. Your message is on its way.' });
    } catch (err) {
      const message = (err as Error).message;
      await query('update support_requests set delivery_error = $2 where id = $1', [
        row!.id,
        message,
      ]);
      console.error('[support] delivery failed:', message);
      res.json({
        ok: true,
        detail: 'Thanks. Your message was saved and will be read.',
      });
    }
  });
}

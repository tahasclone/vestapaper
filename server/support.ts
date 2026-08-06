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

interface Mail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
}

/**
 * Resend or Postmark, whichever is configured. Resend wins when both are, on
 * the grounds that a larger free allowance is the only thing separating them
 * for a form like this.
 *
 * Resend's default sender (onboarding@resend.dev) may only email the address
 * the Resend account was created with, which is exactly what a support form
 * pointed at your own inbox needs — so no domain verification is required
 * until you want a branded From address.
 */
function mailer(): { name: string; send: (m: Mail) => Promise<void> } | null {
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    return {
      name: 'resend',
      send: async (m) => {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: m.from,
            to: [m.to],
            reply_to: m.replyTo,
            subject: m.subject,
            text: m.text,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const detail: any = await res.json().catch(() => ({}));
          throw new Error(detail.message ?? detail.error ?? `Resend returned ${res.status}`);
        }
      },
    };
  }

  const postmarkToken = process.env.POSTMARK_TOKEN;
  if (postmarkToken) {
    return {
      name: 'postmark',
      send: async (m) => {
        const res = await fetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Postmark-Server-Token': postmarkToken,
          },
          body: JSON.stringify({
            From: m.from,
            To: m.to,
            ReplyTo: m.replyTo,
            Subject: m.subject,
            TextBody: m.text,
            MessageStream: 'outbound',
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const detail: any = await res.json().catch(() => ({}));
          throw new Error(detail.Message ?? `Postmark returned ${res.status}`);
        }
      },
    };
  }

  return null;
}

export function mailerName(): string | null {
  return mailer()?.name ?? null;
}

async function sendSupportEmail(fields: {
  kind: string;
  subject: string;
  body: string;
  replyTo?: string;
  email: string;
}): Promise<void> {
  const provider = mailer();
  const to = process.env.SUPPORT_TO;
  // Resend's sandbox sender works with no domain setup at all.
  const from =
    process.env.MAIL_FROM ??
    process.env.POSTMARK_FROM ??
    (provider?.name === 'resend' ? 'Solaris Wallpaper <onboarding@resend.dev>' : undefined);

  if (!provider) throw new Error('No email provider configured');
  if (!to) throw new Error('SUPPORT_TO is not set');
  if (!from) throw new Error('MAIL_FROM is not set');

  const label = LABEL[fields.kind as never] ?? fields.kind;
  await provider.send({
    from,
    to,
    // User-supplied text only ever lands in ReplyTo, and only after newlines
    // are flattened, so it cannot forge additional headers.
    replyTo: oneLine(fields.replyTo || fields.email),
    subject: oneLine(`[Solaris] ${label}: ${fields.subject}`),
    text: [
      `From: ${fields.email}`,
      fields.replyTo ? `Reply to: ${fields.replyTo}` : null,
      `Type: ${label}`,
      '',
      fields.body,
    ]
      .filter(Boolean)
      .join('\n'),
  });
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
      await sendSupportEmail({ kind, subject, body, replyTo, email: req.user.email });
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

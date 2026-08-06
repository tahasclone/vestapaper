/** Exercises the webhook verification paths without any real provider. */
import crypto from 'node:crypto';
import { pool, one, query } from '../../server/db.js';
import { seal, randomId } from '../../server/crypto.js';

const BASE = 'http://localhost:3000';

async function main() {
  const board = await one<{ id: string }>(
    'select id from boards order by created_at limit 1',
  );
  if (!board) throw new Error('no board; sign in first');

  // --- Telegram: secret-token header
  const tgSecret = randomId(24);
  const tgPath = randomId();
  let row = await one<{ id: string }>(
    `insert into board_integrations (board_id, kind, enabled, webhook_path_id)
     values ($1,'telegram',true,$2)
     on conflict (board_id, kind) do update set enabled=true, webhook_path_id=$2
     returning id`,
    [board.id, tgPath],
  );
  let s = seal({ botToken: 'x', webhookSecret: tgSecret }, `${row!.id}:telegram`);
  await query(
    `update board_integrations set secret_ciphertext=$2, secret_nonce=$3, secret_tag=$4 where id=$1`,
    [row!.id, s.ciphertext, s.nonce, s.tag],
  );

  const tg = (secret: string, updateId: number) =>
    fetch(`${BASE}/hooks/telegram/${tgPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify({ update_id: updateId, message: { text: 'TELEGRAM WORKS' } }),
    }).then((r) => r.status);

  console.log('telegram wrong secret ->', await tg('nope', 1), '(want 401)');
  console.log('telegram right secret ->', await tg(tgSecret, 42), '(want 200)');
  await new Promise((r) => setTimeout(r, 600));
  const after = await one<any>('select override_text from boards where id=$1', [board.id]);
  console.log('  board override      ->', JSON.stringify(after.override_text));
  console.log('telegram replay same id ->', await tg(tgSecret, 42), '(want 200, deduped)');
  const dupes = await query(
    `select count(*)::int as n from webhook_events where provider_event_id='tg:42'`,
  );
  console.log('  webhook_events rows ->', dupes.rows[0].n, '(want 1)');

  // --- Slack: HMAC signature
  const slackSecret = 'shh-signing-secret-value';
  const slPath = randomId();
  row = await one<{ id: string }>(
    `insert into board_integrations (board_id, kind, enabled, webhook_path_id)
     values ($1,'slack',true,$2)
     on conflict (board_id, kind) do update set enabled=true, webhook_path_id=$2
     returning id`,
    [board.id, slPath],
  );
  s = seal({ signingSecret: slackSecret }, `${row!.id}:slack`);
  await query(
    `update board_integrations set secret_ciphertext=$2, secret_nonce=$3, secret_tag=$4 where id=$1`,
    [row!.id, s.ciphertext, s.nonce, s.tag],
  );

  const slackPost = (body: any, sign: boolean, ts = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(body);
    const sig =
      'v0=' + crypto.createHmac('sha256', slackSecret).update(`v0:${ts}:${raw}`).digest('hex');
    return fetch(`${BASE}/hooks/slack/${slPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': String(ts),
        'X-Slack-Signature': sign ? sig : 'v0=deadbeef',
      },
      body: raw,
    });
  };

  console.log('slack bad signature   ->', (await slackPost({ type: 'x' }, false)).status, '(want 401)');
  const chal = await slackPost({ type: 'url_verification', challenge: 'abc123' }, true);
  console.log('slack url_verification->', chal.status, JSON.stringify(await chal.json()), '(want challenge echoed)');
  console.log('slack stale timestamp ->', (await slackPost({ type: 'x' }, true, 1000)).status, '(want 401)');
  const ev = await slackPost(
    { event_id: 'Ev1', event: { text: 'SLACK WORKS', channel: 'C1', ts: '1.0' } },
    true,
  );
  console.log('slack real event      ->', ev.status, '(want 200)');

  // --- Discord: Ed25519
  const kp = crypto.generateKeyPairSync('ed25519');
  const pubHex = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  const dcPath = randomId();
  row = await one<{ id: string }>(
    `insert into board_integrations (board_id, kind, enabled, webhook_path_id)
     values ($1,'discord',true,$2)
     on conflict (board_id, kind) do update set enabled=true, webhook_path_id=$2
     returning id`,
    [board.id, dcPath],
  );
  s = seal({ publicKey: pubHex, botToken: 'x' }, `${row!.id}:discord`);
  await query(
    `update board_integrations set secret_ciphertext=$2, secret_nonce=$3, secret_tag=$4 where id=$1`,
    [row!.id, s.ciphertext, s.nonce, s.tag],
  );

  const dc = (body: any, good: boolean) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.sign(null, Buffer.from(ts + raw), kp.privateKey).toString('hex');
    return fetch(`${BASE}/hooks/discord/${dcPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Timestamp': ts,
        'X-Signature-Ed25519': good ? sig : 'aa'.repeat(64),
      },
      body: raw,
    });
  };

  console.log('discord bad signature ->', (await dc({ type: 1 }, false)).status, '(want 401)');
  const ping = await dc({ type: 1 }, true);
  console.log('discord PING          ->', ping.status, JSON.stringify(await ping.json()), '(want type 1)');
  const cmd = await dc(
    { type: 2, id: 'i1', data: { options: [{ name: 'text', value: 'DISCORD WORKS' }] } },
    true,
  );
  console.log('discord /board        ->', cmd.status, '(want 200)');
  await new Promise((r) => setTimeout(r, 600));
  const fin = await one<any>('select override_text from boards where id=$1', [board.id]);
  console.log('  board override      ->', JSON.stringify(fin.override_text));

  await query(`delete from board_integrations where board_id=$1`, [board.id]);
  console.log('\n(cleaned up test integrations)');
}
main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());

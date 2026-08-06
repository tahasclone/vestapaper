/** Creates a local test user + session so the signed-in pages can be viewed
 *  without Google credentials. Dev only. */
import crypto from 'node:crypto';
import { one, query, pool } from '../../server/db.js';
import { createBoard, getBoardByUser } from '../../server/boardService.js';

async function main() {
  const user = await one<{ id: string; email: string }>(
    `insert into users (google_sub, email, name, last_login_at)
          values ('dev-local-sub', 'dev@localhost', 'Dev User', now())
     on conflict (google_sub) do update set last_login_at = now()
       returning id, email`,
  );
  const board = (await getBoardByUser(user!.id)) ?? (await createBoard(user!.id));
  const sid = crypto.randomBytes(32).toString('base64url');
  await query(
    `insert into sessions (id, user_id, expires_at) values ($1, $2, now() + interval '1 day')`,
    [sid, user!.id],
  );
  console.log('SESSION=' + sid);
  console.log('BOARD=' + board.public_token);
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());

/**
 * One-shot import of the old single-user data/config.json into the dev board.
 * Run once, then the file can be deleted.
 *   DATABASE_URL=... npx tsx scripts/import-local-config.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../server/db/migrate.js';
import { one, pool } from '../server/db.js';
import { withDefaults } from '../server/config.js';
import { createBoard, saveBoardConfig } from '../server/boardService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '..', 'data', 'config.json');

async function run() {
  if (!fs.existsSync(file)) {
    console.log('No data/config.json to import.');
    return;
  }
  await migrate();
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Only main + sound carry over; message credentials move to their own table
  // and must be re-entered so they get encrypted at rest.
  const cfg = withDefaults({ main: raw.main, sound: raw.sound });

  const board =
    (await one<{ id: string; public_token: string }>(
      'select id, public_token from boards where user_id is null order by created_at limit 1',
    )) ?? (await createBoard(null));

  await saveBoardConfig(board.id, cfg);
  console.log('Imported into board', board.public_token);
  console.log('selected:', cfg.main.selected, '| rotate:', cfg.main.rotate);
  if (raw.messages && Object.values(raw.messages).some((m: any) => m?.botToken || m?.appToken)) {
    console.log('Note: message tokens were NOT imported. Re-enter them in settings.');
  }
}

run()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => pool.end());

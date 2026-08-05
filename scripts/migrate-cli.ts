/** Apply pending migrations, then exit. `npm run migrate` */
import { migrate } from '../server/db/migrate.js';
import { pool } from '../server/db.js';

migrate()
  .then(() => console.log('Done.'))
  .catch((e) => {
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

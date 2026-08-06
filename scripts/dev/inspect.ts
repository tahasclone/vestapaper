import { query, pool } from '../../server/db.js';

async function main() {
  const c = await query(
    `select cache_key, rows, cols, left(text, 44) as preview,
            round(extract(epoch from (expires_at - now()))) as ttl_s
       from source_cache order by cache_key`,
  );
  console.log('source_cache:');
  if (!c.rows.length) console.log('  (empty)');
  for (const r of c.rows as any[]) {
    console.log(`  ${String(r.cache_key).padEnd(16)} ${r.rows}x${r.cols}  ttl ${String(r.ttl_s).padStart(6)}s  ${r.preview}`);
  }
  const b = await query(
    `select left(public_token,10) as tok, main_source, rotation_index, revision,
            config->'main'->>'selected' as selected,
            config->'main'->>'rotate' as rotate,
            config->'main'->>'refreshMinutes' as mins
       from boards`,
  );
  console.log('\nboards:');
  for (const r of b.rows as any[]) console.log(' ', JSON.stringify(r));
}
main().finally(() => pool.end());

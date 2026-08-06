import { query, pool } from '../../server/db.js';

async function main() {
  const r = await query(
    `select kind, subject, coalesce(delivery_error,'(delivered)') as delivery
       from support_requests order by created_at desc limit 5`,
  );
  console.log('support_requests:');
  for (const x of r.rows as any[]) {
    console.log(`  ${String(x.kind).padEnd(8)} ${JSON.stringify(x.subject)}`);
    console.log(`  ${' '.repeat(8)} delivery: ${x.delivery}`);
  }

  // Same sanitizer the email builder uses.
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  const evil = 'hi\nBcc: evil@example.com';
  console.log('\nheader sanitization:');
  console.log('  raw     :', JSON.stringify(evil));
  console.log('  in email:', JSON.stringify(oneLine(`[Solaris] Other: ${evil}`)));
  console.log('  newlines remaining:', /[\r\n]/.test(oneLine(evil)) ? 'YES (BAD)' : 'none');
}
main().finally(() => pool.end());

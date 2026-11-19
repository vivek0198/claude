// Usage: npm run db:make-admin -- someone@example.com
import { pool, query } from '../src/db/pool.js';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run db:make-admin -- <email>');
    process.exitCode = 1;
    return;
  }

  const result = await query("UPDATE users SET role = 'admin' WHERE email = ?", [email]);
  console.log(result.affectedRows ? `${email} is now an admin.` : `No user found with email ${email}.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

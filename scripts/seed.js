// Adds development users. Safe to run more than once: emails that already
// exist are skipped, never overwritten. Refuses to run in production.
//
// Usage: npm run db:seed
//        SEED_PASSWORD=MyPass123 npm run db:seed   (default password: Password123)
const bcrypt = require('bcryptjs');
const { config } = require('../src/config');
const { pool, query } = require('../src/db/pool');

const PASSWORD = process.env.SEED_PASSWORD || 'Password123';

const USERS = [
  { email: 'admin@example.com', name: 'Admin User', role: 'admin', verified: true },
  { email: 'alice@example.com', name: 'Alice Johnson', role: 'user', verified: true },
  { email: 'bob@example.com', name: 'Bob Smith', role: 'user', verified: true },
  // Not verified, so you can try the verification flow (login returns EMAIL_NOT_VERIFIED)
  { email: 'carol@example.com', name: 'Carol White', role: 'user', verified: false },
];

async function main() {
  if (config.isProd) {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }

  const passwordHash = await bcrypt.hash(PASSWORD, config.env === 'test' ? 4 : 12);
  const rows = [];

  for (const u of USERS) {
    const result = await query(
      `INSERT IGNORE INTO users (email, password_hash, name, role, email_verified_at)
       VALUES (?, ?, ?, ?, ${u.verified ? 'UTC_TIMESTAMP()' : 'NULL'})`,
      [u.email, passwordHash, u.name, u.role]
    );
    rows.push({
      email: u.email,
      role: u.role,
      verified: u.verified,
      status: result.affectedRows ? 'created' : 'already exists (skipped)',
    });
  }

  console.log(`Seeding database "${config.db.database}":`);
  console.table(rows);
  if (rows.some((r) => r.status === 'created')) {
    console.log(`Password for new users: ${PASSWORD}`);
  }
}

main()
  .catch((err) => {
    if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_DB_ERROR') {
      console.error('Seed failed: tables are missing. Run "npm run db:migrate" first.');
    } else {
      console.error('Seed failed:', err.message);
    }
    process.exitCode = 1;
  })
  .finally(() => pool.end());

import { createApp } from './app.js';
import { config } from './config/index.js';
import { pool } from './db/pool.js';

async function start() {
  // Fail fast if the database isn't reachable
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`Cannot connect to MySQL at ${config.db.host}:${config.db.port}: ${err.message}`);
    console.error('Is MySQL running, and have you run "npm run db:migrate"?');
    process.exit(1);
  }

  const server = createApp().listen(config.port, () => {
    console.log(`Server listening on http://localhost:${config.port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();

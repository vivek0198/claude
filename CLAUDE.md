# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An authentication REST API built with Express 5 and MySQL (via XAMPP). It provides JWT access tokens, rotating refresh tokens, email verification, password reset, user/admin roles and rate limiting. The code uses CommonJS (`require` / `module.exports`, not `import`) and needs Node 20 or later. Scripts wrap top-level `await` in an async `main()`. There's no build step, linter or TypeScript.

The README lists every endpoint and the security rules (token lifetimes, password rules, rate limits). Read it before changing auth behaviour.

## Commands

```bash
npm install
npm run db:migrate                          # creates DB_NAME if missing, applies src/db/schema.sql
npm run dev                                 # node --watch src/server.js
npm start
npm test                                    # node --test tests/*.test.js
npm run db:make-admin -- someone@example.com
npm run db:seed                             # dev users (password: Password123, or SEED_PASSWORD)
```

- `scripts/seed.js` uses `INSERT IGNORE`, so existing emails are skipped and never overwritten. It refuses to run when `NODE_ENV=production`. It seeds `admin@example.com` (admin), `alice@` and `bob@` (verified users) and `carol@` (unverified).

- MySQL must be running (start it from the XAMPP control panel) for the server, the migration and the tests.
- `.env` is required. Copy it from `.env.example`. `src/config/index.js` validates it with zod and exits on startup if anything is invalid. For example, `JWT_ACCESS_SECRET` must be at least 32 characters.
- **Tests** are integration tests that use `supertest` against `createApp()`. They switch to a separate `<DB_NAME>_test` database, run the migration on it, and empty the tables before the suite starts.
- **Running one test:** you can filter with `node --test --test-name-pattern="refresh" tests/auth.test.js`. Most tests in `auth.test.js` depend on earlier ones, though (they share a registered user, its tokens and its changing password), so a single test run on its own will usually fail. Run the whole file.

## Architecture

- `src/app.js` exports `createApp()`. It sets up the middleware and routes but doesn't listen on a port, which is what lets tests use it directly. `src/server.js` starts the server.
- Request flow: router → rate limiters → `validate(schema, source)` → controller → service → repository / `db/pool.js`.
  - **Controllers** (`*.controller.js`) handle HTTP concerns only: cookies, status codes and request metadata. The refresh token lives in an httpOnly cookie scoped to `/api/auth` and is never returned in the JSON body. `sendSession()` in `auth.controller.js` sets that cookie.
  - **Services** contain the business logic. `token.service.js` owns all token logic: access JWTs, refresh-token families with reuse detection, and single-use verification and reset tokens.
  - **Repositories** run raw SQL through `query(sql, params, conn)`. Pass `conn` to run a query inside a transaction opened by `withTransaction(fn)`. `toPublicUser()` is the only user shape that may be returned to clients, because it leaves out the password hash.
- **Errors:** route handlers and services throw `AppError` (`src/utils/AppError.js`, which has static helpers such as `AppError.badRequest(message, code, details)`). Express 5 sends errors from async handlers to `errorHandler`, so there's no try/catch or `next(err)` boilerplate. Every error response has the shape `{ error: { code, message, details? } }`. Tests check the `code` values, so keep them stable.
- **Validation:** `validate()` replaces `req.body` with the parsed value. For the `query` and `params` sources the result goes to `req.validated.query` or `req.validated.params`, because Express 5 doesn't let you assign to `req.query`. The auth schemas are in `auth.validation.js`. Emails are normalised to lowercase there.
- `authenticate` checks only the JWT and sets `req.user = { id, role }` without a database lookup. The role is embedded in the token, so a role change takes effect only on the user's next refresh or login. `authorize(...roles)` checks `req.user.role`.
- **Schema:** `src/db/schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`) and there's no migration framework. Changing an existing table means writing `ALTER` statements by hand. Store all timestamps in UTC: the pool uses `timezone: 'Z'`, and queries use `UTC_TIMESTAMP()`.

## Test-environment behaviour (`NODE_ENV=test`)

- `sendMail` stores messages in the exported `sentMail` array instead of sending them. Tests read the token from the link in the last email.
- All rate limiters are turned off.
- bcrypt uses 4 rounds instead of 12.

Outside tests, emails are printed to the console when `SMTP_HOST` is empty.

## Things to preserve

- Login, forgot-password and resend-verification must respond the same way whether or not the email exists. Login compares against `DUMMY_HASH` so the timing matches too.
- Store only the SHA-256 hash of any token (`utils/crypto.js`).
- Rate-limit counters are kept in memory. If the app runs as more than one instance, they need a shared store such as Redis. Behind a proxy, enable `app.set('trust proxy', 1)` in `app.js`.

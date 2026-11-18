# Auth API (Express 5 + MySQL)

User authentication with JWT access tokens, rotating refresh tokens, email verification, password reset, roles and rate limiting.

## Setup

```bash
npm install
cp .env.example .env      # then set DB_* and a long random JWT_ACCESS_SECRET
npm run db:migrate        # creates the database and tables
npm run dev               # or: npm start
npm test                  # integration tests; uses a separate <DB_NAME>_test database
```

Make a user an admin with `npm run db:make-admin -- someone@example.com`.

When `SMTP_HOST` is empty, emails (verification and reset links) are printed to the server console.

## Endpoints

All auth routes are under `/api/auth`. Routes marked 🔒 need `Authorization: Bearer <accessToken>`.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/register` | `email, password, name` | Sends a verification email |
| POST | `/login` | `email, password` | Returns `{ user, accessToken }` and sets the `refreshToken` cookie |
| POST | `/refresh` | none (cookie), or `refreshToken` | Rotates the refresh token and returns a new access token |
| POST | `/logout` | none (cookie), or `refreshToken` | Revokes the current session |
| POST | `/logout-all` 🔒 | none | Revokes every session for the user |
| GET | `/me` 🔒 | none | Returns the current user |
| POST | `/verify-email` | `token` | Token from the verification email |
| POST | `/resend-verification` | `email` | Always returns 200 |
| POST | `/forgot-password` | `email` | Always returns 200 |
| POST | `/reset-password` | `token, password` | Signs out all sessions |
| POST | `/change-password` 🔒 | `currentPassword, newPassword` | Signs out other sessions and returns a new one |

Admin only (🔒 with role `admin`): `GET /api/users?page=&pageSize=` and `PATCH /api/users/:id/role` with `{ role }`.

Errors always have the shape `{ "error": { "code", "message", "details?" } }`.

## How it works

- **Access token:** HS256 JWT, valid for 15 minutes (`JWT_ACCESS_EXPIRES_IN`). Keep it in memory on the client, not in localStorage.
- **Refresh token:** a random opaque value in an `httpOnly`, `SameSite=Strict` cookie scoped to `/api/auth`, valid for 7 days. Only its SHA-256 hash is stored. Each use issues a new token. If an old token is reused, the whole session is revoked, because that means the token was stolen.
- **Passwords:** hashed with bcrypt (cost 12). They need 8 or more characters with at least one letter and one number, and may be at most 72 bytes.
- **Verification and reset tokens:** single use, stored hashed, valid for 24 hours and 1 hour respectively. Requesting a new one cancels the previous one.
- **User enumeration:** login, forgot-password and resend-verification give the same response whether or not the email exists.
- **Rate limits:** failed logins are limited to 5 per 15 minutes per IP and email. Reset and verification emails are limited to 3 per hour. Registration is limited to 10 per hour per IP. Everything under `/api/auth` is limited to 100 per 15 minutes. Counts are kept in memory, so use a shared store such as Redis when running more than one instance. Behind a proxy, enable `trust proxy` in `src/app.js`.

## Layout

```
src/
  app.js, server.js
  config/index.js              env validation
  db/pool.js, db/schema.sql
  middleware/                  authenticate, authorize, validate, rateLimit, errorHandler
  modules/auth/                routes, controller, service, token.service, validation
  modules/users/               repository and admin routes
  utils/                       AppError, crypto, mailer
scripts/                       migrate, make-admin
tests/auth.test.js
```

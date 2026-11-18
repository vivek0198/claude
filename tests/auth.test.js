// Integration tests. Needs MySQL running; they use a separate database
// (<DB_NAME>_test) that is created and wiped automatically.
require('dotenv').config({ quiet: true });
process.env.NODE_ENV = 'test';
process.env.DB_NAME = `${process.env.DB_NAME || 'claude_code_app'}_test`;
process.env.REQUIRE_EMAIL_VERIFICATION = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const request = require('supertest');

execFileSync(process.execPath, ['scripts/migrate.js'], { env: process.env, stdio: 'ignore' });

// Loaded after the env vars above are set, so the app picks up the test config
const { createApp } = require('../src/app');
const { pool, query } = require('../src/db/pool');
const { sentMail } = require('../src/utils/mailer');

const app = createApp();
const user = { email: 'Alice@Example.com', password: 'secret123', name: 'Alice' };

const tokenFromLastMail = () => new URL(sentMail.at(-1).text.match(/https?:\S+/)[0]).searchParams.get('token');
const refreshCookie = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('refreshToken='));
const cookieValue = (cookie) => cookie.split(';')[0].split('=')[1];

before(async () => {
  await query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['user_tokens', 'refresh_tokens', 'users']) await query(`TRUNCATE TABLE ${t}`);
  await query('SET FOREIGN_KEY_CHECKS = 1');
});
after(() => pool.end());

let accessToken;
let cookie;

test('register validates input', async () => {
  const res = await request(app).post('/api/auth/register').send({ email: 'nope', password: 'short', name: '' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  const fields = [...new Set(res.body.error.details.map((d) => d.field))].sort();
  assert.deepEqual(fields, ['email', 'name', 'password']);
});

test('register creates a user, normalises the email and sends a verification email', async () => {
  const res = await request(app).post('/api/auth/register').send(user);
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'alice@example.com');
  assert.equal(res.body.user.role, 'user');
  assert.equal(res.body.user.emailVerified, false);
  assert.equal(res.body.user.password_hash, undefined);
  assert.match(sentMail.at(-1).subject, /verify/i);
});

test('register rejects a duplicate email', async () => {
  const res = await request(app).post('/api/auth/register').send({ ...user, email: 'alice@example.com' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EMAIL_TAKEN');
});

test('login is blocked until the email is verified', async () => {
  const res = await request(app).post('/api/auth/login').send(user);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'EMAIL_NOT_VERIFIED');
});

test('verify-email accepts the emailed token once', async () => {
  const token = tokenFromLastMail();
  const ok = await request(app).post('/api/auth/verify-email').send({ token });
  assert.equal(ok.status, 200);
  const again = await request(app).post('/api/auth/verify-email').send({ token });
  assert.equal(again.status, 400);
});

test('login rejects a wrong password and an unknown email with the same error', async () => {
  const a = await request(app).post('/api/auth/login').send({ ...user, password: 'wrong123' });
  const b = await request(app).post('/api/auth/login').send({ ...user, email: 'ghost@example.com' });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('login returns an access token and sets an httpOnly refresh cookie', async () => {
  const res = await request(app).post('/api/auth/login').send(user);
  assert.equal(res.status, 200);
  assert.ok(res.body.accessToken);
  assert.equal(res.body.refreshToken, undefined);
  cookie = refreshCookie(res);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/auth/);
  accessToken = res.body.accessToken;
});

test('/me requires a valid access token', async () => {
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer junk')).status, 401);
  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'alice@example.com');
  assert.equal(res.body.user.emailVerified, true);
});

test('refresh rotates the token, and reusing an old token revokes the session', async () => {
  const first = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
  assert.equal(first.status, 200);
  assert.ok(first.body.accessToken);
  const rotated = refreshCookie(first);
  assert.notEqual(cookieValue(rotated), cookieValue(cookie));

  // Replaying the old token is treated as theft...
  const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'TOKEN_REUSED');

  // ...so the newest token in that session is revoked too.
  const after = await request(app).post('/api/auth/refresh').set('Cookie', rotated);
  assert.equal(after.status, 401);
});

test('refresh also accepts the token in the request body', async () => {
  const login = await request(app).post('/api/auth/login').send(user);
  const res = await request(app)
    .post('/api/auth/refresh')
    .send({ refreshToken: cookieValue(refreshCookie(login)) });
  assert.equal(res.status, 200);
});

test('logout revokes the refresh token', async () => {
  const login = await request(app).post('/api/auth/login').send(user);
  const c = refreshCookie(login);
  assert.equal((await request(app).post('/api/auth/logout').set('Cookie', c)).status, 204);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', c)).status, 401);
});

test('forgot-password gives the same answer for known and unknown emails', async () => {
  const before = sentMail.length;
  const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
  const known = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(sentMail.length, before + 1);
});

test('reset-password sets the new password and signs out all sessions', async () => {
  const session = refreshCookie(await request(app).post('/api/auth/login').send(user));

  // Ask again so the earlier reset token is replaced
  const oldToken = tokenFromLastMail();
  await request(app).post('/api/auth/forgot-password').send({ email: user.email });
  const token = tokenFromLastMail();

  const stale = await request(app).post('/api/auth/reset-password').send({ token: oldToken, password: 'newpass456' });
  assert.equal(stale.status, 400);

  const res = await request(app).post('/api/auth/reset-password').send({ token, password: 'newpass456' });
  assert.equal(res.status, 200);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', session)).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send(user)).status, 401);

  user.password = 'newpass456';
  assert.equal((await request(app).post('/api/auth/login').send(user)).status, 200);
});

test('change-password checks the current password and returns a new session', async () => {
  const login = await request(app).post('/api/auth/login').send(user);
  const auth = `Bearer ${login.body.accessToken}`;
  const oldSession = refreshCookie(login);

  const wrong = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', auth)
    .send({ currentPassword: 'nope', newPassword: 'another789' });
  assert.equal(wrong.status, 400);

  const res = await request(app)
    .post('/api/auth/change-password')
    .set('Authorization', auth)
    .send({ currentPassword: user.password, newPassword: 'another789' });
  assert.equal(res.status, 200);
  assert.ok(refreshCookie(res));
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', oldSession)).status, 401);
  user.password = 'another789';
});

test('admin routes require the admin role', async () => {
  const login = await request(app).post('/api/auth/login').send(user);
  const asUser = await request(app).get('/api/users').set('Authorization', `Bearer ${login.body.accessToken}`);
  assert.equal(asUser.status, 403);

  await query("UPDATE users SET role = 'admin' WHERE email = ?", ['alice@example.com']);
  const adminLogin = await request(app).post('/api/auth/login').send(user);
  const adminAuth = `Bearer ${adminLogin.body.accessToken}`;

  const list = await request(app).get('/api/users?page=1&pageSize=10').set('Authorization', adminAuth);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);

  const self = await request(app)
    .patch(`/api/users/${adminLogin.body.user.id}/role`)
    .set('Authorization', adminAuth)
    .send({ role: 'user' });
  assert.equal(self.status, 400);
});

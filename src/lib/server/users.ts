// SERVER-ONLY. Admin accounts, sessions and sign-in, stored in Neon.
import { env } from 'cloudflare:workers';
import { sql } from './db';
import {
  SESSION_TOKEN_RE,
  authSecretProblem,
  hashRecoveryCode,
  hashSessionToken,
  newSessionToken,
  openSecret,
  prehashPassword,
  verifyTotp,
} from './authcrypto';

export const SESSION_COOKIE = '__Host-sx_session';
export const SESSION_DAYS = 7;
const TOUCH_AFTER_MS = 5 * 60_000;
const LOCK_AFTER = 5;

// A well-formed bcrypt string (cost 12) that matches nothing. Checking against it when
// the email is unknown keeps the response time the same, so emails can't be enumerated.
const DUMMY_HASH = '$2a$12$fQw6erJfrwxC4LZA2pvR2ua52pPyTWPMU/0NlTbSThQqEvajVT5cN';

export type Role = 'owner' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  totpEnabled: boolean;
}

export interface RequestMeta {
  ip: string;
  ua: string;
}

export function requestMeta(request: Request, clientAddress?: string): RequestMeta {
  return {
    ip: (clientAddress || request.headers.get('CF-Connecting-IP') || '').slice(0, 64),
    ua: (request.headers.get('User-Agent') ?? '').slice(0, 300),
  };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------- cookies

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

// --------------------------------------------------------------- sessions

export async function createSession(userId: string, meta: RequestMeta): Promise<string> {
  const token = newSessionToken();
  const hash = await hashSessionToken(token);
  await sql()`
    INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
    VALUES (${hash}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}), ${meta.ip}, ${meta.ua})`;
  return token;
}

/** Looks up the signed-in user from the session cookie. Returns null for any problem. */
export async function sessionFromRequest(request: Request, waitUntil?: (p: Promise<unknown>) => void): Promise<{ user: SessionUser; tokenHash: string } | null> {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!token || !SESSION_TOKEN_RE.test(token)) return null;
  const tokenHash = await hashSessionToken(token);
  const rows = await sql()`
    SELECT u.id, u.email, u.name, u.role, u.must_change_password, u.totp_enabled, s.last_seen_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now() AND NOT u.disabled`;
  const r = rows[0];
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at as string).getTime() > TOUCH_AFTER_MS) {
    const touch = sql()`UPDATE sessions SET last_seen_at = now() WHERE token_hash = ${tokenHash}`.catch(() => {});
    if (waitUntil) waitUntil(touch);
  }
  return {
    tokenHash,
    user: {
      id: r.id as string,
      email: r.email as string,
      name: r.name as string,
      role: r.role as Role,
      mustChangePassword: r.must_change_password as boolean,
      totpEnabled: r.totp_enabled as boolean,
    },
  };
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await sql()`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
}

export async function deleteSessionsForUser(userId: string, exceptTokenHash = ''): Promise<void> {
  await sql()`DELETE FROM sessions WHERE user_id = ${userId} AND token_hash <> ${exceptTokenHash}`;
}

// ---------------------------------------------------------------- events

export async function logAuth(userId: string | null, email: string, event: string, ok: boolean, meta: RequestMeta): Promise<void> {
  await sql()`
    INSERT INTO auth_events (user_id, email, event, ok, ip, user_agent)
    VALUES (${userId}, ${email.slice(0, 254)}, ${event.slice(0, 60)}, ${ok}, ${meta.ip}, ${meta.ua})`;
}

/** Nightly housekeeping: expired sessions and old history. */
export async function purgeAuthData(): Promise<void> {
  await sql()`DELETE FROM sessions WHERE expires_at < now()`;
  await sql()`DELETE FROM auth_events WHERE at < now() - interval '180 days'`;
}

// -------------------------------------------------------------- passwords

/** bcrypt (pgcrypto, cost 12) of the Worker-side pre-hash. */
export async function hashPassword(password: string): Promise<string> {
  const pre = await prehashPassword(password);
  const rows = await sql()`SELECT crypt(${pre}, gen_salt('bf', 12)) AS h`;
  return rows[0].h as string;
}

export async function checkPassword(password: string, storedHash: string | null): Promise<boolean> {
  const pre = await prehashPassword(password);
  const hash = storedHash ?? DUMMY_HASH;
  const rows = await sql()`SELECT crypt(${pre}, ${hash}) = ${hash} AS ok`;
  return storedHash !== null && rows[0].ok === true;
}

export async function passwordHashFor(userId: string): Promise<string | null> {
  const rows = await sql()`SELECT password_hash FROM users WHERE id = ${userId}`;
  return (rows[0]?.password_hash as string | undefined) ?? null;
}

// ------------------------------------------------------------ second step

/** Checks an authenticator code or an unused recovery code, and consumes it. */
export async function checkSecondFactor(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
  const trimmed = code.trim();
  if (/^\d{3}\s?\d{3}$/.test(trimmed)) {
    if (authSecretProblem(env.AUTH_SECRET)) return null;
    const rows = await sql()`SELECT totp_secret_enc, totp_last_step FROM users WHERE id = ${userId} AND totp_enabled`;
    const r = rows[0];
    if (!r?.totp_secret_enc) return null;
    const secret = await openSecret(env.AUTH_SECRET!, r.totp_secret_enc as string, userId);
    if (!secret) return null;
    const step = await verifyTotp(secret, trimmed, Date.now(), Number(r.totp_last_step));
    if (step === null) return null;
    // Atomic: a code can be used once, even by two requests at the same moment.
    const won = await sql()`UPDATE users SET totp_last_step = ${step} WHERE id = ${userId} AND totp_last_step < ${step} RETURNING id`;
    return won.length ? 'totp' : null;
  }
  const hash = await hashRecoveryCode(trimmed);
  const used = await sql()`
    UPDATE recovery_codes SET used_at = now()
    WHERE user_id = ${userId} AND code_hash = ${hash} AND used_at IS NULL RETURNING id`;
  return used.length ? 'recovery' : null;
}

// ----------------------------------------------------------------- sign-in

export type LoginResult =
  | { kind: 'ok'; userId: string; mustChangePassword: boolean; usedRecovery: boolean }
  | { kind: 'mfa' }
  | { kind: 'invalid'; message: string }
  | { kind: 'locked'; minutes: number };

const GENERIC = 'Email or password is incorrect.';

export async function attemptLogin(emailIn: string, password: string, code: string | undefined, meta: RequestMeta): Promise<LoginResult> {
  const email = normaliseEmail(emailIn);
  const rows = await sql()`
    SELECT id, password_hash, disabled, totp_enabled, must_change_password,
           CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60) AS lock_minutes
    FROM users WHERE email = ${email}`;
  const u = rows[0];

  if (!u || u.disabled) {
    await checkPassword(password, null);
    await logAuth(u ? (u.id as string) : null, email, u ? 'sign-in (disabled account)' : 'sign-in (unknown email)', false, meta);
    return { kind: 'invalid', message: GENERIC };
  }
  const userId = u.id as string;

  const lockMinutes = Number(u.lock_minutes ?? 0);
  if (lockMinutes > 0) {
    await logAuth(userId, email, 'sign-in (locked)', false, meta);
    return { kind: 'locked', minutes: lockMinutes };
  }

  const fail = async (event: string, message: string): Promise<LoginResult> => {
    const r = await sql()`
      UPDATE users SET
        failed_attempts = failed_attempts + 1,
        locked_until = CASE WHEN failed_attempts + 1 >= ${LOCK_AFTER}
          THEN now() + LEAST(make_interval(mins => POWER(2, failed_attempts + 1 - ${LOCK_AFTER})::int), interval '60 minutes')
          ELSE locked_until END
      WHERE id = ${userId}
      RETURNING CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60) AS lock_minutes`;
    await logAuth(userId, email, event, false, meta);
    const m = Number(r[0]?.lock_minutes ?? 0);
    return m > 0 ? { kind: 'locked', minutes: m } : { kind: 'invalid', message };
  };

  if (!(await checkPassword(password, u.password_hash as string))) return fail('sign-in (wrong password)', GENERIC);

  let usedRecovery = false;
  if (u.totp_enabled) {
    if (!code) return { kind: 'mfa' };
    const how = await checkSecondFactor(userId, code);
    if (!how) return fail('sign-in (wrong code)', 'That code isn’t right. Check your authenticator app and try again.');
    usedRecovery = how === 'recovery';
  }

  await sql()`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = ${userId}`;
  await logAuth(userId, email, usedRecovery ? 'signed in (recovery code)' : 'signed in', true, meta);
  return { kind: 'ok', userId, mustChangePassword: u.must_change_password as boolean, usedRecovery };
}

// ----------------------------------------------------------------- queries

export async function userCount(): Promise<number> {
  const rows = await sql()`SELECT count(*)::int AS n FROM users`;
  return rows[0].n as number;
}

export async function enabledOwnerCount(excludingId = '00000000-0000-0000-0000-000000000000'): Promise<number> {
  const rows = await sql()`SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND NOT disabled AND id <> ${excludingId}`;
  return rows[0].n as number;
}

/** Per-IP limit on sign-in and setup attempts (10 a minute). */
export async function withinLoginLimit(ip: string): Promise<boolean> {
  if (!env.LOGIN_LIMITER) return true;
  const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${ip || 'unknown'}` });
  return success;
}

// SERVER-ONLY. Pure crypto helpers for admin accounts. No imports from
// 'cloudflare:workers', so the CLI (scripts/user.mjs) and the security tests
// use exactly the same code as the Worker.
//
// Passwords: the Worker pre-hashes with SHA-256 (domain-separated), and Neon
// stores bcrypt(prehash) via pgcrypto. The plaintext never leaves the Worker,
// bcrypt's 72-byte limit can't truncate long passphrases, and the expensive
// hashing runs on the database rather than the Worker's CPU budget.

const enc = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b;
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(input)));
}

/** Constant-time comparison of two strings (length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------- passwords

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

/** What is sent to bcrypt: base64(SHA-256("sxingxian/password/v1\0" + NFKC(password))). 44 chars. */
export async function prehashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`sxingxian/password/v1\u0000${password.normalize('NFKC')}`));
  return toB64(new Uint8Array(digest));
}

// The most common passwords that pass a 12-character minimum (from public breach corpora).
const COMMON = new Set([
  'password1234', 'password12345', 'password123456', '123456789012', '1234567890123', '12345678910', 'qwertyuiop12',
  'qwertyuiopas', 'qwerty123456', '1q2w3e4r5t6y', '1qaz2wsx3edc', 'q1w2e3r4t5y6', 'iloveyou1234', 'administrator',
  'adminadmin12', 'admin1234567', 'welcome12345', 'letmein12345', 'passw0rd1234', 'p@ssw0rd1234', 'p@ssword1234',
  'changeme1234', 'abcdefghijkl', 'abc123456789', 'aaaaaaaaaaaa', '111111111111', '000000000000', '123123123123',
  'qazwsxedcrfv', 'zaq12wsxcde3', 'trustno11234', 'football1234', 'baseball1234', 'superman1234', 'sunshine1234',
  'princess1234', 'starwars1234', 'dragon123456', 'monkey123456', 'master123456', 'whatever1234', 'sxingxian123',
  'sxingxian1234', 'sxingxian.com', 'correcthorsebatterystaple',
]);

/** Returns a reason the password is not acceptable, or null if it is. */
export function passwordProblem(password: string, email = ''): string | null {
  if (typeof password !== 'string') return 'Enter a password.';
  const chars = [...password];
  if (chars.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters. A few unrelated words works well.`;
  if (chars.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (new Set(chars).size < 5) return 'Use more varied characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Choose another.';
  const local = email.toLowerCase().split('@')[0] ?? '';
  if (local.length >= 4 && lower.includes(local)) return 'Don’t include your email address in the password.';
  return null;
}

const HUMAN = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i

function humanChars(n: number): string {
  // Rejection sampling: no modulo bias.
  let out = '';
  while (out.length < n) {
    for (const b of randomBytes(n * 2)) {
      if (b < 248 && out.length < n) out += HUMAN[b % HUMAN.length];
    }
  }
  return out;
}

/** Temporary password for a new account or a reset: 4 groups of 5 (~98 bits). */
export function randomPassword(): string {
  return [humanChars(5), humanChars(5), humanChars(5), humanChars(5)].join('-');
}

/** Recovery codes: 10 codes, xxxxx-xxxxx (~49 bits each, single use, rate-limited). */
export function makeRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => `${humanChars(5)}-${humanChars(5)}`);
}

export function normaliseRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return sha256Hex(`sxingxian/recovery/v1\u0000${normaliseRecoveryCode(code)}`);
}

// ----------------------------------------------------------------- sessions

/** 256-bit random session token for the cookie, base64url. */
export function newSessionToken(): string {
  return toB64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Hex(`sxingxian/session/v1\u0000${token}`);
}

// --------------------------------------------------------------------- TOTP

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const u = new Uint8Array(new ArrayBuffer(out.length));
  u.set(out);
  return u;
}

export const TOTP_PERIOD = 30;

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits by default) for one time step. */
export async function totpAt(secret: Uint8Array<ArrayBuffer>, step: number, digits = 6, hash: 'SHA-1' | 'SHA-256' | 'SHA-512' = 'SHA-1'): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash }, false, ['sign']);
  const counter = new Uint8Array(new ArrayBuffer(8));
  let s = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = s & 0xff;
    s = Math.floor(s / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Checks a 6-digit code against the current step ±1 (90 s of clock drift).
 * Returns the matching step (store it to block replays) or null.
 * Only steps greater than `lastStep` are accepted.
 */
export async function verifyTotp(secret: Uint8Array<ArrayBuffer>, code: string, nowMs: number, lastStep = 0): Promise<number | null> {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = Math.floor(nowMs / 1000 / TOTP_PERIOD);
  let match: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    // Check every candidate so timing doesn't reveal which step matched.
    if (safeEqual(await totpAt(secret, step), c) && step > lastStep) match = step;
  }
  return match;
}

export function newTotpSecret(): Uint8Array<ArrayBuffer> {
  return randomBytes(20);
}

export function totpUri(secretB32: string, email: string, issuer = 'sxingxian'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ------------------------------------------------- encryption at rest (TOTP)

async function aesKey(authSecret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(authSecret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('sxingxian/hkdf-salt/v1'), info: enc.encode('totp-secret/v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** "v1.<iv b64>.<ciphertext b64>". The user id is bound as additional data. */
export async function sealSecret(authSecret: string, plaintext: Uint8Array<ArrayBuffer>, userId: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(userId) }, await aesKey(authSecret), plaintext);
  return `v1.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

export async function openSecret(authSecret: string, sealed: string, userId: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const [v, iv, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(userId) }, await aesKey(authSecret), fromB64(ct));
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}

export function authSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'AUTH_SECRET is not set';
  if (secret.length < 32) return 'AUTH_SECRET must be at least 32 characters';
  return null;
}

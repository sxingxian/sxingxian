// POST /api/admin/account/:action — changes to your own account.
//   password        { current, next }       change password; signs out your other devices
//   totp-start      {}                      new authenticator secret (not active until confirmed)
//   totp-enable     { code }                confirm it; returns 10 recovery codes ONCE
//   totp-disable    { password, code }      turn 2FA off
//   recovery-codes  { password }            replace recovery codes; returns them ONCE
//   revoke-others   {}                      sign out every other device
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sql } from '../../../../lib/server/db';
import { error, json, readBody } from '../../../../lib/server/http';
import { passwordChangeSchema, passwordConfirmSchema, totpCodeSchema, totpDisableSchema } from '../../../../lib/shared/schemas';
import {
  authSecretProblem,
  base32Encode,
  hashRecoveryCode,
  makeRecoveryCodes,
  newTotpSecret,
  openSecret,
  passwordProblem,
  prehashPassword,
  sealSecret,
  totpUri,
  verifyTotp,
} from '../../../../lib/server/authcrypto';
import {
  checkPassword,
  checkSecondFactor,
  deleteSessionsForUser,
  logAuth,
  passwordHashFor,
  requestMeta,
  withinLoginLimit,
} from '../../../../lib/server/users';

async function storeRecoveryCodes(userId: string): Promise<string[]> {
  const codes = makeRecoveryCodes();
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  await sql().transaction((tx) => [
    tx`DELETE FROM recovery_codes WHERE user_id = ${userId}`,
    tx`INSERT INTO recovery_codes (user_id, code_hash) SELECT ${userId}, unnest(${hashes}::text[])`,
  ]);
  return codes;
}

export const POST: APIRoute = async ({ params, request, locals, clientAddress }) => {
  const u = locals.user!;
  const meta = requestMeta(request, clientAddress);
  const action = params.action;

  // Everything here re-checks a password or code, so limit it like sign-in.
  if (action !== 'totp-start' && action !== 'revoke-others' && !(await withinLoginLimit(meta.ip))) {
    return error(429, 'Too many attempts. Wait a minute and try again.');
  }

  switch (action) {
    case 'password': {
      const body = await readBody(request, passwordChangeSchema, 4096);
      if (!body.ok) return body.res;
      const { current, next } = body.data;
      if (!(await checkPassword(current, await passwordHashFor(u.id)))) {
        await logAuth(u.id, u.email, 'password change (wrong current password)', false, meta);
        return error(403, 'Your current password is not correct.');
      }
      const problem = passwordProblem(next, u.email);
      if (problem) return error(422, problem);
      if (next === current) return error(422, 'Choose a password you haven’t used here.');
      const pre = await prehashPassword(next);
      await sql()`
        UPDATE users SET password_hash = crypt(${pre}, gen_salt('bf', 12)), must_change_password = false,
          password_changed_at = now(), updated_at = now()
        WHERE id = ${u.id}`;
      await deleteSessionsForUser(u.id, locals.sessionHash);
      await logAuth(u.id, u.email, 'password changed', true, meta);
      return json({ ok: true });
    }

    case 'totp-start': {
      const missing = authSecretProblem(env.AUTH_SECRET);
      if (missing) return error(503, `Two-step sign-in can't be set up yet: ${missing} in the Worker settings.`);
      if (u.totpEnabled) return error(409, 'Two-step sign-in is already on. Turn it off first to move to a new device.');
      const secret = newTotpSecret();
      const sealed = await sealSecret(env.AUTH_SECRET!, secret, u.id);
      await sql()`UPDATE users SET totp_secret_enc = ${sealed}, totp_enabled = false, updated_at = now() WHERE id = ${u.id}`;
      const b32 = base32Encode(secret);
      return json({ secret: b32, uri: totpUri(b32, u.email) });
    }

    case 'totp-enable': {
      const body = await readBody(request, totpCodeSchema, 1024);
      if (!body.ok) return body.res;
      if (authSecretProblem(env.AUTH_SECRET)) return error(503, 'AUTH_SECRET is not set.');
      const rows = await sql()`SELECT totp_secret_enc, totp_enabled, totp_last_step FROM users WHERE id = ${u.id}`;
      const r = rows[0];
      if (r.totp_enabled) return error(409, 'Two-step sign-in is already on.');
      if (!r.totp_secret_enc) return error(409, 'Start setup first.');
      const secret = await openSecret(env.AUTH_SECRET!, r.totp_secret_enc as string, u.id);
      const step = secret ? await verifyTotp(secret, body.data.code, Date.now(), Number(r.totp_last_step)) : null;
      if (step === null) return error(422, 'That code isn’t right. Check the time on your phone and try the newest code.');
      await sql()`UPDATE users SET totp_enabled = true, totp_last_step = ${step}, updated_at = now() WHERE id = ${u.id}`;
      const codes = await storeRecoveryCodes(u.id);
      await logAuth(u.id, u.email, 'two-step sign-in turned on', true, meta);
      return json({ ok: true, recoveryCodes: codes });
    }

    case 'totp-disable': {
      const body = await readBody(request, totpDisableSchema, 2048);
      if (!body.ok) return body.res;
      if (!(await checkPassword(body.data.password, await passwordHashFor(u.id)))) return error(403, 'Your password is not correct.');
      if (!(await checkSecondFactor(u.id, body.data.code))) return error(403, 'That code isn’t right.');
      await sql()`UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, updated_at = now() WHERE id = ${u.id}`;
      await sql()`DELETE FROM recovery_codes WHERE user_id = ${u.id}`;
      await logAuth(u.id, u.email, 'two-step sign-in turned off', true, meta);
      return json({ ok: true });
    }

    case 'recovery-codes': {
      const body = await readBody(request, passwordConfirmSchema, 2048);
      if (!body.ok) return body.res;
      if (!u.totpEnabled) return error(409, 'Turn on two-step sign-in first.');
      if (!(await checkPassword(body.data.password, await passwordHashFor(u.id)))) return error(403, 'Your password is not correct.');
      const codes = await storeRecoveryCodes(u.id);
      await logAuth(u.id, u.email, 'recovery codes replaced', true, meta);
      return json({ ok: true, recoveryCodes: codes });
    }

    case 'revoke-others': {
      await deleteSessionsForUser(u.id, locals.sessionHash);
      await logAuth(u.id, u.email, 'signed out all other devices', true, meta);
      return json({ ok: true });
    }

    default:
      return error(404, 'Unknown action');
  }
};

export const ALL: APIRoute = () => error(405, 'Method not allowed');

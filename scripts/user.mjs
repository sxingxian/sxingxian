// Manage admin accounts from a computer (also the way back in if you're locked out).
//
//   export DATABASE_URL='…'            # Neon connection string; never commit it
//   npm run user -- list
//   npm run user -- create  you@example.com [--name "Your Name"] [--role owner|admin]
//   npm run user -- reset-password  you@example.com
//   npm run user -- reset-2fa  you@example.com
//   npm run user -- unlock  you@example.com
//   npm run user -- disable | enable  you@example.com
//
// Passwords are typed at a hidden prompt (never as an argument, so they don't land in
// shell history). Press Enter at the prompt to generate a temporary password instead;
// the user must then choose their own at first sign-in.
// Uses the same hashing code as the Worker (src/lib/server/authcrypto.ts).
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Export it in your shell (never commit it).');
  process.exit(1);
}

const dir = await mkdtemp(join(tmpdir(), 'sx-user-'));
const out = join(dir, 'authcrypto.mjs');
await build({ entryPoints: ['src/lib/server/authcrypto.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { prehashPassword, passwordProblem, randomPassword } = await import(out);
await rm(dir, { recursive: true, force: true });

const sql = neon(url);
const [cmd, emailArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback;
};

function hiddenPrompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** Prompts for a password (twice). Empty → temporary password. Returns { password, temporary }. */
async function choosePassword(email) {
  if (!process.stdin.isTTY) {
    const password = randomPassword();
    return { password, temporary: true };
  }
  for (;;) {
    const a = await hiddenPrompt('New password (Enter for a temporary one): ');
    if (!a) return { password: randomPassword(), temporary: true };
    const problem = passwordProblem(a, email);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    const b = await hiddenPrompt('Type it again: ');
    if (a !== b) {
      console.log("  They don't match. Try again.");
      continue;
    }
    return { password: a, temporary: false };
  }
}

async function setPassword(id, email) {
  const { password, temporary } = await choosePassword(email);
  const pre = await prehashPassword(password);
  await sql`
    UPDATE users SET password_hash = crypt(${pre}, gen_salt('bf', 12)), must_change_password = ${temporary},
      password_changed_at = now(), updated_at = now()
    WHERE id = ${id}`;
  await sql`DELETE FROM login_throttle WHERE email = ${email}`;
  await sql`DELETE FROM sessions WHERE user_id = ${id}`;
  return temporary ? password : null;
}

async function audit(id, email, event) {
  await sql`INSERT INTO auth_events (user_id, email, event, ok, ip, user_agent) VALUES (${id}, ${email}, ${event}, true, 'cli', 'scripts/user.mjs')`;
}

async function findUser(email) {
  if (!email) {
    console.error('Give the email address, e.g.  npm run user -- reset-password you@example.com');
    process.exit(1);
  }
  const rows = await sql`SELECT id, email FROM users WHERE email = ${email.trim().toLowerCase()}`;
  if (!rows[0]) {
    console.error(`No account for ${email}.`);
    process.exit(1);
  }
  return rows[0];
}

function showTemporary(email, temp) {
  if (!temp) return;
  console.log(`\nTemporary password for ${email}:\n\n    ${temp}\n\nIt is shown only now. They must change it at first sign-in.`);
}

try {
  switch (cmd) {
    case 'list': {
      const rows = await sql`
        SELECT email, role, disabled, totp_enabled, must_change_password, last_login_at,
               EXISTS (SELECT 1 FROM login_throttle t WHERE t.email = users.email AND t.locked_until > now()) AS locked
        FROM users ORDER BY created_at`;
      if (!rows.length) console.log('No accounts yet. Create one with:  npm run user -- create you@example.com --role owner');
      for (const r of rows) {
        const flags = [r.role, r.disabled && 'disabled', r.locked && 'locked', r.totp_enabled ? '2-step on' : '2-step off', r.must_change_password && 'temporary password'].filter(Boolean).join(', ');
        console.log(`${r.email}  (${flags})  last sign-in: ${r.last_login_at ? new Date(r.last_login_at).toISOString() : 'never'}`);
      }
      break;
    }
    case 'create': {
      const email = (emailArg ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        console.error('Give a valid email address, e.g.  npm run user -- create you@example.com --role owner');
        process.exit(1);
      }
      const count = (await sql`SELECT count(*)::int AS n FROM users`)[0].n;
      const role = flag('role', count === 0 ? 'owner' : 'admin');
      if (!['owner', 'admin'].includes(role)) throw new Error('--role must be owner or admin');
      const name = flag('name', '').slice(0, 80);
      const { password, temporary } = await choosePassword(email);
      const pre = await prehashPassword(password);
      const rows = await sql`
        INSERT INTO users (email, name, role, password_hash, must_change_password)
        VALUES (${email}, ${name}, ${role}, crypt(${pre}, gen_salt('bf', 12)), ${temporary})
        ON CONFLICT (email) DO NOTHING RETURNING id`;
      if (!rows[0]) {
        console.error(`An account for ${email} already exists. Use reset-password instead.`);
        process.exit(1);
      }
      await audit(rows[0].id, email, `account created (${role}, command line)`);
      console.log(`✓ Created ${role} ${email}`);
      showTemporary(email, temporary ? password : null);
      break;
    }
    case 'reset-password': {
      const u = await findUser(emailArg);
      const temp = await setPassword(u.id, u.email);
      await audit(u.id, u.email, 'password reset (command line)');
      console.log(`✓ Password reset for ${u.email}; all of their sessions were signed out.`);
      showTemporary(u.email, temp);
      break;
    }
    case 'reset-2fa': {
      const u = await findUser(emailArg);
      await sql`UPDATE users SET totp_enabled = false, totp_secret_enc = NULL, updated_at = now() WHERE id = ${u.id}`;
      await sql`DELETE FROM recovery_codes WHERE user_id = ${u.id}`;
      await sql`DELETE FROM sessions WHERE user_id = ${u.id}`;
      await audit(u.id, u.email, 'two-step sign-in reset (command line)');
      console.log(`✓ Two-step sign-in turned off for ${u.email}. Turn it back on from Account after signing in.`);
      break;
    }
    case 'unlock': {
      const u = await findUser(emailArg);
      await sql`DELETE FROM login_throttle WHERE email = ${u.email}`;
      await audit(u.id, u.email, 'unlocked (command line)');
      console.log(`✓ Unlocked ${u.email}`);
      break;
    }
    case 'disable':
    case 'enable': {
      const u = await findUser(emailArg);
      const disabled = cmd === 'disable';
      await sql`UPDATE users SET disabled = ${disabled}, updated_at = now() WHERE id = ${u.id}`;
      if (disabled) await sql`DELETE FROM sessions WHERE user_id = ${u.id}`;
      await audit(u.id, u.email, `${cmd}d (command line)`);
      console.log(`✓ ${disabled ? 'Disabled' : 'Enabled'} ${u.email}`);
      break;
    }
    default:
      console.log('Usage: npm run user -- list | create <email> [--name N] [--role owner|admin] | reset-password <email> | reset-2fa <email> | unlock <email> | disable <email> | enable <email>');
      process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  // Never print the connection string.
  console.error(`✖ ${e instanceof Error ? e.message.replaceAll(url, '[DATABASE_URL]') : 'failed'}`);
  process.exit(1);
}

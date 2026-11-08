-- Admin accounts, stored in Neon (replaces Cloudflare Access).
-- Passwords: bcrypt (pgcrypto, cost 12) over a SHA-256 pre-hash computed in the Worker,
-- so the plaintext password never leaves the Worker. Session tokens are stored only as SHA-256.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  name                  text NOT NULL DEFAULT '' CHECK (length(name) <= 80),
  role                  text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner','admin')),
  password_hash         text NOT NULL,
  must_change_password  boolean NOT NULL DEFAULT false,
  totp_secret_enc       text,                      -- AES-GCM ciphertext (key derived from AUTH_SECRET)
  totp_enabled          boolean NOT NULL DEFAULT false,
  totp_last_step        bigint NOT NULL DEFAULT 0, -- replay protection: a code's time step is accepted once
  failed_attempts       integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  disabled              boolean NOT NULL DEFAULT false,
  last_login_at         timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   text PRIMARY KEY,                   -- hex SHA-256 of the cookie value
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text NOT NULL DEFAULT '',
  user_agent   text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,                        -- hex SHA-256 of the normalised code
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recovery_codes_user_idx ON recovery_codes (user_id);

-- Sign-in history and account changes (kept 180 days by the nightly job).
CREATE TABLE IF NOT EXISTS auth_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  email      text NOT NULL DEFAULT '',
  event      text NOT NULL,
  ok         boolean NOT NULL DEFAULT true,
  ip         text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_events_user_idx ON auth_events (user_id, at DESC);
CREATE INDEX IF NOT EXISTS auth_events_at_idx ON auth_events (at);

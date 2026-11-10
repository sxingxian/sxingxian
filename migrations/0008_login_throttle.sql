-- Sign-in throttle per (email, IP address), replacing the account-wide lockout.
-- Unknown and real emails are tracked identically, so a lock reveals nothing about which accounts exist,
-- and a stranger's failed attempts lock only their own address, never the owner's sign-in from elsewhere.
-- users.failed_attempts / users.locked_until are no longer written (dropped in a later contract step).
CREATE TABLE IF NOT EXISTS login_throttle (
  email        text NOT NULL CHECK (length(email) <= 254),
  ip           text NOT NULL DEFAULT '' CHECK (length(ip) <= 64),
  failed       integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, ip)
);
CREATE INDEX IF NOT EXISTS login_throttle_updated_idx ON login_throttle (updated_at);

-- One-time sponsor through Stripe and PayPal (11 Nov 2026). Expand only: new tables, nothing existing changes.

-- The payment accounts. One row per provider. Secrets are sealed with AUTH_SECRET (AES-GCM) and never
-- leave the server. Stripe: a restricted key plus the signing secret of the webhook the site created.
-- PayPal: the REST app's client id and secret (sealed together as JSON).
CREATE TABLE IF NOT EXISTS sponsor_keys (
  provider              text PRIMARY KEY CHECK (provider IN ('stripe', 'paypal')),
  secret_sealed         text NOT NULL,
  webhook_id            text,
  webhook_secret_sealed text,
  mode                  text NOT NULL CHECK (mode IN ('live', 'test')),
  account_name          text NOT NULL DEFAULT '' CHECK (length(account_name) <= 120),
  hint                  text NOT NULL DEFAULT '' CHECK (length(hint) <= 16),
  connected_at          timestamptz NOT NULL DEFAULT now()
);

-- One row per attempt. "pending" rows are created when a visitor goes to Stripe or PayPal and become
-- "paid", "cancelled" or "failed"; unfinished ones (and their messages) are deleted after 2 days.
CREATE TABLE IF NOT EXISTS sponsors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL CHECK (provider IN ('stripe', 'paypal')),
  ref          text NOT NULL DEFAULT '' CHECK (length(ref) <= 255),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'failed', 'refunded')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 10000000),
  currency     text NOT NULL DEFAULT 'SGD' CHECK (length(currency) = 3),
  name         text NOT NULL DEFAULT '' CHECK (length(name) <= 200),
  email        text NOT NULL DEFAULT '' CHECK (length(email) <= 254),
  message      text NOT NULL DEFAULT '' CHECK (length(message) <= 280),
  source_id    uuid,
  source_title text NOT NULL DEFAULT '' CHECK (length(source_title) <= 300),
  payment_ref  text NOT NULL DEFAULT '' CHECK (length(payment_ref) <= 255),
  live         boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz
);
CREATE INDEX IF NOT EXISTS sponsors_status_idx ON sponsors (status, paid_at DESC);
CREATE INDEX IF NOT EXISTS sponsors_created_idx ON sponsors (created_at);
CREATE INDEX IF NOT EXISTS sponsors_ref_idx ON sponsors (provider, ref);
CREATE INDEX IF NOT EXISTS sponsors_payment_ref_idx ON sponsors (payment_ref) WHERE payment_ref <> '';

-- PayPal.Me sponsors (12 Nov 2026). Expand only: two CHECK lists get one more allowed value each.
-- A PayPal.Me sponsor is recorded as provider 'paypalme', status 'unconfirmed' until you mark it in the admin
-- (PayPal doesn't tell the site about personal-link payments). Older code never writes or reads these values.
ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsors_provider_check;
ALTER TABLE sponsors ADD CONSTRAINT sponsors_provider_check CHECK (provider IN ('stripe', 'paypal', 'paypalme'));
ALTER TABLE sponsors DROP CONSTRAINT IF EXISTS sponsors_status_check;
ALTER TABLE sponsors ADD CONSTRAINT sponsors_status_check CHECK (status IN ('pending', 'paid', 'cancelled', 'failed', 'refunded', 'unconfirmed'));
CREATE INDEX IF NOT EXISTS sponsors_unconfirmed_idx ON sponsors (created_at DESC) WHERE status = 'unconfirmed';

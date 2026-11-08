-- The watermark logo: a single small PNG drawn to the left of the watermark text.
-- At most one row (id is always 1). The admin re-encodes uploads to PNG (≤512 px) before sending,
-- and the server checks the signature and size again; the database caps it at 256 KB.
CREATE TABLE IF NOT EXISTS watermark_logo (
  id         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mime       text NOT NULL CHECK (mime = 'image/png'),
  data       bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 262144),
  sha256     text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  width      integer NOT NULL CHECK (width BETWEEN 1 AND 1024),
  height     integer NOT NULL CHECK (height BETWEEN 1 AND 1024),
  updated_at timestamptz NOT NULL DEFAULT now()
);

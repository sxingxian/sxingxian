-- sxingxian.com — initial schema (Neon Postgres)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Native content: journal posts, work (projects), photo galleries, films.
CREATE TABLE IF NOT EXISTS entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('post','project','gallery','film')),
  title         text NOT NULL DEFAULT 'Untitled',
  slug          text NOT NULL,
  dek           text NOT NULL DEFAULT '',
  topic         text NOT NULL DEFAULT '',
  body          jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  cover_media_id uuid,
  video_url     text NOT NULL DEFAULT '',
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_minutes  integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  is_public     boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, slug)
);
CREATE INDEX IF NOT EXISTS entries_public_idx ON entries (kind, status, is_public, published_at DESC);

-- Editable standalone pages built in the Notion-style editor (cv, about).
CREATE TABLE IF NOT EXISTS pages (
  slug        text PRIMARY KEY,
  title       text NOT NULL DEFAULT '',
  body        jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  noindex     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Uploaded or embedded media, with the storage host chosen at upload time.
CREATE TABLE IF NOT EXISTS media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL CHECK (provider IN ('r2','nas','b2','youtube','vimeo')),
  object_key  text NOT NULL DEFAULT '',
  embed_id    text NOT NULL DEFAULT '',
  mime        text NOT NULL DEFAULT '',
  bytes       bigint NOT NULL DEFAULT 0,
  width       integer,
  height      integer,
  alt         text NOT NULL DEFAULT '',
  filename    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Site settings as JSON documents: sections, featured, footer, wordpress.
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Mirror of public posts from hey.sxingxian.com (title, excerpt, image, link only).
CREATE TABLE IF NOT EXISTS external_posts (
  wp_id          integer PRIMARY KEY,
  slug           text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  excerpt        text NOT NULL DEFAULT '',
  url            text NOT NULL,
  topic          text NOT NULL DEFAULT '',
  image_url      text NOT NULL DEFAULT '',
  read_minutes   integer NOT NULL DEFAULT 1,
  published_at   timestamptz NOT NULL,
  modified_at    timestamptz NOT NULL,
  show_on_main   boolean NOT NULL DEFAULT false,
  removed_at     timestamptz,
  synced_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_posts_feed_idx ON external_posts (show_on_main, removed_at, published_at DESC);

-- Health and sync state for external sources (one row: 'wordpress').
CREATE TABLE IF NOT EXISTS sources (
  id               text PRIMARY KEY,
  status           text NOT NULL DEFAULT 'up' CHECK (status IN ('up','down')),
  status_since     timestamptz NOT NULL DEFAULT now(),
  consecutive_fail integer NOT NULL DEFAULT 0,
  consecutive_ok   integer NOT NULL DEFAULT 0,
  last_check_at    timestamptz,
  last_check_ms    integer,
  last_sync_at     timestamptz
);
INSERT INTO sources (id) VALUES ('wordpress') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS sync_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  event   text NOT NULL,
  result  text NOT NULL,
  ok      boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS sync_log_at_idx ON sync_log (at DESC);

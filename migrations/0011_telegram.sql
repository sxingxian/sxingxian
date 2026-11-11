-- Telegram announcements (11 Nov 2026). Expand only: new tables, nothing existing changes.

-- The bot. One row. The token is sealed with AUTH_SECRET (AES-GCM) and never leaves the server.
-- connected_at: only entries published after this are posted (connecting doesn't post old entries).
CREATE TABLE IF NOT EXISTS telegram_bot (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token_sealed text NOT NULL,
  bot_id       bigint NOT NULL,
  username     text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);

-- One entry's options: post it or not, its own message (NULL = the default message), which image.
CREATE TABLE IF NOT EXISTS entry_telegram (
  entry_id   uuid PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  announce   boolean NOT NULL DEFAULT true,
  message    text CHECK (message IS NULL OR length(message) <= 4000),
  image      text NOT NULL DEFAULT 'cover',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- What was posted where. One row per entry and channel for the current publication: moving the entry back
-- to draft deletes its rows, so publishing again posts again. status 'sending' is the claim that stops two
-- requests posting the same thing.
CREATE TABLE IF NOT EXISTS telegram_posts (
  entry_id   uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  chat       text NOT NULL,
  status     text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  attempts   int NOT NULL DEFAULT 1,
  message_id bigint,
  error      text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, chat)
);

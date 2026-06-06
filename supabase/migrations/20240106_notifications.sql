-- ── notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          bigserial   PRIMARY KEY,
  user_id     text        NOT NULL,
  icon        text        NOT NULL DEFAULT '🔔',
  text        text        NOT NULL,
  sub         text        NOT NULL DEFAULT '',
  time_label  text        NOT NULL DEFAULT 'Just now',
  unread      boolean     NOT NULL DEFAULT true,
  type        text        NOT NULL DEFAULT 'general',
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO anon;
GRANT USAGE ON SEQUENCE notifications_id_seq TO anon;

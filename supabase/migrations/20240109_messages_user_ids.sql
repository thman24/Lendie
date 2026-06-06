ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_user_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_user_id   text;

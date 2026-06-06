-- Auth migration: tie listings to Supabase Auth users
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/roehykgfltnghsvcvter/sql/new

-- ── Add user_id to listings ───────────────────────────────────────────────────
ALTER TABLE listings ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── Allow authenticated users to read/write their own rows ────────────────────
-- (RLS is currently disabled on this table; just ensure anon+service roles can insert)
GRANT SELECT, INSERT, UPDATE, DELETE ON listings TO authenticated;

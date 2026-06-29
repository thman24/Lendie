-- Track which listings were auto-hidden BY a suspension, so unsuspend restores
-- only those — not listings the user had intentionally paused before suspension.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS hidden_by_suspension boolean NOT NULL DEFAULT false;

-- Lock down the unused public.users table. It has an `email` column but a
-- USING(true) public SELECT policy, so any client could read everyone's email.
-- The app stores user data in Supabase auth metadata, not here (0 rows), so
-- restrict reads to the row's own user to remove the latent PII exposure.
DROP POLICY IF EXISTS "users_select_public" ON users;
CREATE POLICY "users_select_self" ON users FOR SELECT TO authenticated
  USING (auth.uid()::text = id);

-- Lightweight crash log so the team has visibility into production errors without
-- an external monitoring service. The app's error boundary + global handlers
-- best-effort insert a row here when something throws.
CREATE TABLE IF NOT EXISTS error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  message text,
  stack text,
  component_stack text,
  url text,
  user_agent text
);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at DESC);

ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can report their own crash; nobody can read except the
-- owner/admins (so crash logs aren't world-readable).
DROP POLICY IF EXISTS "error_logs_insert" ON error_logs;
CREATE POLICY "error_logs_insert" ON error_logs FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "error_logs_select_admin" ON error_logs;
CREATE POLICY "error_logs_select_admin" ON error_logs FOR SELECT TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8' OR auth.uid() IN (SELECT user_id FROM admins));

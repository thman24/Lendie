-- ── reports ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id text NOT NULL,
  reported_user_id text,
  reported_listing_id integer REFERENCES listings(id) ON DELETE SET NULL,
  context text DEFAULT 'profile',
  reason text NOT NULL,
  details text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports_insert" ON reports;
DROP POLICY IF EXISTS "reports_select_admin" ON reports;
DROP POLICY IF EXISTS "reports_update_admin" ON reports;

CREATE POLICY "reports_insert"
  ON reports FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = reporter_id);

CREATE POLICY "reports_select_admin"
  ON reports FOR SELECT TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8');

CREATE POLICY "reports_update_admin"
  ON reports FOR UPDATE TO authenticated
  USING (auth.uid()::text = '8f7af82b-b44e-436f-995a-530eb24925e8');

GRANT SELECT, INSERT, UPDATE ON reports TO authenticated;

-- ── blocks ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id text NOT NULL,
  blocked_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(blocker_id, blocked_id)
);

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocks_select_own" ON blocks;
DROP POLICY IF EXISTS "blocks_insert_own" ON blocks;
DROP POLICY IF EXISTS "blocks_delete_own" ON blocks;

CREATE POLICY "blocks_select_own"
  ON blocks FOR SELECT TO authenticated
  USING (auth.uid()::text = blocker_id);

CREATE POLICY "blocks_insert_own"
  ON blocks FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = blocker_id);

CREATE POLICY "blocks_delete_own"
  ON blocks FOR DELETE TO authenticated
  USING (auth.uid()::text = blocker_id);

GRANT SELECT, INSERT, DELETE ON blocks TO authenticated;

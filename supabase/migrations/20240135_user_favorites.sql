-- Per-user favorites so they sync across devices and between the website and the
-- installed PWA (previously favorites lived only in per-browser localStorage).
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id    uuid   NOT NULL,
  listing_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favorites_select_own" ON user_favorites;
CREATE POLICY "favorites_select_own" ON user_favorites FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "favorites_insert_own" ON user_favorites;
CREATE POLICY "favorites_insert_own" ON user_favorites FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "favorites_delete_own" ON user_favorites;
CREATE POLICY "favorites_delete_own" ON user_favorites FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

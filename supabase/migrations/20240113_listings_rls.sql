ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read listings" ON listings;
DROP POLICY IF EXISTS "Owners can insert their own listings" ON listings;
DROP POLICY IF EXISTS "Owners can update their own listings" ON listings;
DROP POLICY IF EXISTS "Owners can delete their own listings" ON listings;

-- Everyone (including guests) can read all listings
CREATE POLICY "Anyone can read listings"
  ON listings FOR SELECT
  TO public
  USING (true);

-- Authenticated users can only insert rows where user_id matches themselves
CREATE POLICY "Owners can insert their own listings"
  ON listings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Only the owner can update their listing
CREATE POLICY "Owners can update their own listings"
  ON listings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Only the owner can delete their listing
CREATE POLICY "Owners can delete their own listings"
  ON listings FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

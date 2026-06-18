-- Profiles table for Stripe Connect account tracking
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id text,
  stripe_charges_enabled boolean DEFAULT false,
  stripe_details_submitted boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users manage own profile" ON profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Index for fast owner lookups in create-payment-intent
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account
  ON profiles(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- Add lat/lng to listings for delivery radius calculation
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/roehykgfltnghsvcvter/sql/new

ALTER TABLE listings ADD COLUMN IF NOT EXISTS lat numeric;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS lng numeric;

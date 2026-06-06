-- Add delivery radius to listings
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/roehykgfltnghsvcvter/sql/new

ALTER TABLE listings ADD COLUMN IF NOT EXISTS delivery_radius_miles numeric;

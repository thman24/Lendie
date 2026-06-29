-- Records the owner's condition/liability attestation at listing publish time,
-- for legal protection. Set to the publish timestamp when the owner ticks the
-- "item is as described, Lendie not liable for loss/damage" box. Re-stamped on
-- each edit (re-attestation is required to publish). NULL = not attested
-- (e.g. service listings, which don't show the box).
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS condition_attested_at timestamptz;

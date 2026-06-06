-- Storage bucket for listing photos
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/roehykgfltnghsvcvter/sql/new

-- ── Create the bucket (public so images are served without auth tokens) ────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-images',
  'listing-images',
  true,
  10485760,           -- 10 MB per file
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- ── Storage policies ──────────────────────────────────────────────────────────
-- Anyone can read (images are embedded in the public marketplace)
CREATE POLICY "Public read listing images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'listing-images');

-- Authenticated users can upload into their own folder (uid/filename)
CREATE POLICY "Authenticated users can upload listing images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete only their own uploads
CREATE POLICY "Users can delete own listing images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

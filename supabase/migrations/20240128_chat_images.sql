-- Allow image attachments in chat messages. The image itself lives in the
-- existing public listing-images bucket (uploaded under the sender's user-id
-- folder, matching that bucket's RLS); this column stores its public URL.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS image_url text;

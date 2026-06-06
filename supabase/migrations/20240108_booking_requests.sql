CREATE TABLE IF NOT EXISTS booking_requests (
  id               bigserial   PRIMARY KEY,
  renter_id        text        NOT NULL,
  owner_id         text        NOT NULL,
  item_title       text        NOT NULL,
  item_json        jsonb       NOT NULL,
  date_str         text        NOT NULL,
  start_date       text,
  end_date         text,
  wants_delivery   boolean     NOT NULL DEFAULT false,
  delivery_address text,
  delivery_fee     numeric,
  status           text        NOT NULL DEFAULT 'pending',
  renter_name      text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE booking_requests DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_requests TO anon;
GRANT USAGE ON SEQUENCE booking_requests_id_seq TO anon;

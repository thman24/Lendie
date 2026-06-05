-- Lendie database schema
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/roehykgfltnghsvcvter/sql/new

-- ── listings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listings (
  id             bigserial PRIMARY KEY,
  title          text        NOT NULL,
  price          numeric     NOT NULL,
  price_unit     text        NOT NULL DEFAULT 'day',
  category       text        NOT NULL,
  emoji          text        DEFAULT '📦',
  color          text,
  description    text        DEFAULT '',
  amenities      jsonb       NOT NULL DEFAULT '[]',
  capacity       integer,
  available      boolean     NOT NULL DEFAULT true,
  booked         jsonb       NOT NULL DEFAULT '[]',
  views          integer     NOT NULL DEFAULT 0,
  requests       integer     NOT NULL DEFAULT 0,
  earnings       numeric     NOT NULL DEFAULT 0,
  rating         numeric,
  reviews        integer     NOT NULL DEFAULT 0,
  listing_type   text        NOT NULL DEFAULT 'rent',
  offers_delivery boolean    NOT NULL DEFAULT false,
  delivery_fee   numeric,
  uploaded_images jsonb      NOT NULL DEFAULT '[]',
  photos         jsonb       NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            text        PRIMARY KEY,
  name          text        NOT NULL,
  avatar        text,
  email         text        UNIQUE,
  joined        text,
  rating        numeric,
  reviews       integer     DEFAULT 0,
  bio           text,
  verified      boolean     DEFAULT false,
  superhost     boolean     DEFAULT false,
  response_time text,
  created_at    timestamptz DEFAULT now()
);

-- ── bookings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id             bigserial   PRIMARY KEY,
  listing_id     bigint      REFERENCES listings(id) ON DELETE SET NULL,
  user_name      text,
  start_date     date,
  end_date       date,
  status         text        DEFAULT 'pending',
  total_price    numeric,
  wants_delivery boolean     DEFAULT false,
  created_at     timestamptz DEFAULT now()
);

-- ── messages ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              bigserial   PRIMARY KEY,
  conversation_id text,
  from_name       text,
  from_avatar     text,
  to_name         text,
  listing_title   text,
  content         text        NOT NULL,
  is_mine         boolean     DEFAULT false,
  read            boolean     DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

-- ── reviews ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id            bigserial   PRIMARY KEY,
  listing_id    bigint      REFERENCES listings(id) ON DELETE CASCADE,
  reviewer_name text,
  owner_name    text,
  rating        integer     CHECK (rating BETWEEN 1 AND 5),
  comment       text,
  created_at    timestamptz DEFAULT now()
);

-- ── access grants (anon key can read/write all tables) ────────────────────────
ALTER TABLE listings  DISABLE ROW LEVEL SECURITY;
ALTER TABLE users     DISABLE ROW LEVEL SECURITY;
ALTER TABLE bookings  DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages  DISABLE ROW LEVEL SECURITY;
ALTER TABLE reviews   DISABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON listings, users, bookings, messages, reviews TO anon;
GRANT USAGE ON SEQUENCE listings_id_seq, bookings_id_seq, messages_id_seq, reviews_id_seq TO anon;

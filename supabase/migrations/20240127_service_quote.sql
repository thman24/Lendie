-- Services are priced as a "starting price" on the listing; the provider
-- confirms a final price (a quote) when accepting the request, since scope
-- varies (e.g. a 1-acre vs 7-acre lawn). That agreed amount is stored here, in
-- cents, and is what the customer actually pays (the payment engine charges it
-- flat, never multiplied by dates).
ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS quoted_cents integer;

# Lendie — Application Overview (Briefing for Tint.ai meeting)

> Paste this into Claude (or read top-to-bottom) to walk through the whole app.
> Goal of the meeting: explore **embedded protection / insurance** for a peer-to-peer
> rental + resale marketplace. The "what we have" and "gaps" sections below are the
> ones most relevant to that conversation.

---

## 1. What Lendie is
A peer-to-peer marketplace where people **rent out or sell physical items** to others
nearby. Think Airbnb-for-stuff: an owner lists an item, a renter books dates (or buys
it), they coordinate in-app, pay, and hand it off (pickup or delivery).

- **Two transaction types:** Rentals (by hour/day/night/week) and Sales (buy outright).
- **Categories (high-value physical goods):** Tools, Trailers, Equipment, Kitchen,
  Garden, Outdoors, Venues, Party, Tech, Other.
- **Local/geographic:** map view + radius search; owners can offer delivery within a
  set radius for a fee.
- **Form factor:** installable mobile PWA (works like an app on phones).

## 2. What users can do
- **Owners:** create listings (photos, price, delivery options, blocked dates),
  accept/decline booking requests, manage a calendar of booked dates, cancel with
  refunds, receive payouts, see earnings.
- **Renters/Buyers:** browse/search/map, request a booking or make an offer, chat,
  pay by card or arrange cash, cancel (refund per policy), leave reviews.
- **Both:** in-app chat, push + in-app notifications, reviews/ratings, report/block
  users.

## 3. Tech architecture
- **Frontend:** React + Vite, single-file app (`src/App.jsx`), inline-style components,
  PWA with service worker + auto-update.
- **Backend:** Supabase — Postgres (with Row-Level Security), Realtime (live chat,
  bookings, notifications), Auth (email/password; social login built but disabled),
  Storage (listing photos, avatars), and Edge Functions (Deno) for anything touching
  secrets/money.
- **Payments:** Stripe + Stripe Connect (see §5). **Currently dormant** — the payment
  code is gated behind a Stripe key that's intentionally unset until launch-ready, so
  today money flows are not live (cash coordination works; card is off).
- **Hosting:** Vercel (frontend).

## 4. Core flows
1. **List:** owner posts item → price, unit, delivery radius/fee, photos, optional
   blocked-out dates.
2. **Request:** renter picks dates → sends request (or an offer / a buy request).
3. **Accept:** owner accepts → those dates are blocked on the calendar so no one else
   can double-book.
4. **Pay:** renter pays by **card** (Stripe) or agrees **cash** at handoff.
5. **Hand-off:** pickup or delivery.
6. **Return / complete:** dates free up; both parties can review.
7. **Cancel:** either side can cancel; refund behavior depends on who and when (§6).

## 5. Money model (when Stripe is live)
- **Platform fee: 12% total** — 8% paid by the renter (service fee on top), 4% taken
  from the owner's payout.
- **Funds are held in escrow, not paid instantly.** Lendie uses Stripe "separate
  charges & transfers": the renter's full payment lands in **Lendie's** balance and is
  **held for 24 hours after the rental start** (or 24h after purchase for a sale),
  then the owner's share is transferred automatically (hourly job).
- **Why the hold matters for protection:** there's a built-in window where funds sit
  with the platform before reaching the owner — a natural place to handle disputes,
  damage claims, or deposit releases before money moves.
- **Owner payouts:** owners onboard via Stripe Connect (bank/debit) and get paid out;
  they see earnings (week/month/year/all-time) and pending payouts in-app.

## 6. Cancellation & refund policy (already built)
- **Owner cancels:** renter gets a **full refund, always.**
- **Renter cancels a rental:** full refund if **>72h before start**; within 72h the 8%
  service fee is kept.
- **Renter/buyer cancels a sale:** 8% service fee kept.
- Disclosed at checkout and again at cancel time (with the exact refund amount).
- Refund/payout coordination is race-safe (a refund can't both repay the renter and
  pay the owner).

## 7. Trust & safety today (what exists)
- Reviews & star ratings per user/listing.
- Report and block users.
- Stripe-handled card security (no card data touches Lendie) and Stripe Connect
  identity/verification **for payout eligibility only**.
- Calendar locking so booked dates can't be double-booked or un-blocked by the owner
  while a booking is active.

## 8. Protection / insurance gaps — **the Tint-relevant part**
Lendie currently has **no** layer protecting the physical item or the parties. Today if
an item is damaged, lost, stolen, or returned late, there is no built-in financial
remedy — it's owner-vs-renter goodwill. Specifically missing:

- **No security deposits / authorization holds** on the renter's card.
- **No damage or theft protection** for owners (their gear is unprotected).
- **No liability coverage** (e.g. someone hurt by a rented tool/trailer/equipment).
- **No condition documentation** (before/after photos, checklists, e-signature).
- **No claims flow** (file, evidence, adjudicate, pay out).
- **No renter identity verification / KYC** beyond email (the "✓" badge today is
  cosmetic — it just means the profile has an avatar). Owners only verify via Stripe
  to get paid.

These map directly to embedded-protection products. Worth discussing how Tint could
slot in:
- A **protection fee** added at checkout (per booking) → coverage for damage/theft.
- **Deposit / auth-hold** handling, ideally released automatically after the return +
  the existing 24h fund-hold window.
- A **claims workflow** tied to a booking, using before/after condition photos.
- **Renter verification / risk scoring** at request or checkout time.
- **Liability coverage** for higher-risk categories (trailers, equipment, venues).

## 9. Data model (Postgres tables)
`listings`, `booking_requests` (bookings + payment/payout/refund state), `bookings`,
`profiles` (Stripe Connect status), `reviews`, `messages`, `notifications`,
`push_subscriptions`, `reports`, `blocks`, `users`. Bookings carry dates, amounts,
fee/payout breakdown, payment status, and payout state — so a protection/claim record
could attach cleanly to a `booking_requests` row.

## 10. Status snapshot
- **Live:** browsing, listings, requests, chat, reviews, cash coordination, the PWA.
- **Built but dormant:** all card payments, Connect payouts, the 24h escrow hold, the
  cancellation-refund engine (gated off until launch).
- **Deferred pre-launch:** transactional email (Resend), social login (pending Meta
  verification).
- **Not built:** any deposit / damage / insurance / verification layer (this meeting).

## 11. Good questions to bring to Tint
- Embedded protection as a **per-booking fee** vs a subscription — what fits a
  marketplace with both rentals and one-off sales?
- Can coverage bind **programmatically at checkout** via API (so it's invisible to the
  user)? What data does Tint need per booking?
- **Deposit / authorization-hold** mechanics — does Tint handle that, or does it stay
  on Stripe with Tint covering the gap above the hold?
- **Claims:** what evidence is required (before/after photos, police report for theft)?
  SLA to adjudicate and pay?
- **Renter verification / risk:** does Tint provide it, or expect us to?
- Which **categories** are coverable vs excluded (trailers, equipment, venues = higher
  liability)?
- Pricing/revenue share, and who is the policyholder (platform vs owner vs renter)?
- Geographic coverage and regulatory constraints.

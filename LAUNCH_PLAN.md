# Lendie — Phased Launch Plan

A staged plan so risk is taken on deliberately, one phase at a time, instead of all at once.
The detailed task checklist lives in **LAUNCH.md**; this is the strategy on top of it.

---

## Phase 0 — Cash-only soft launch (NOW)

**Goal:** Get the first real transactions and let real usage surface what testing can't.
The app is ready for this today.

**Do first (small, fast):**
- [ ] Register the **DMCA agent** (~$6, U.S. Copyright Office) — activates ToS §11.1 safe harbor.
- [ ] **Rotate the Resend API key** (it was screenshotted).
- [ ] 2-minute **manual spot-check** of the two authenticated flows the automated tests couldn't
      exercise: submit a review after a completed booking (should save); accept/cancel a booking
      (the other party should get their notification).

**Then:** Concentrate on **one geography** (WV panhandle). Don't spread nationwide — density in
one area beats a few scattered listings everywhere. Get friends/neighbors to list ~10–20 items,
aim for **5–10 real cash transactions.**

**Success = ** you've watched real people list, request, message, and hand off — and you've fixed
whatever *that* surfaces. This is the real test the code review can't replace.

---

## Phase 1 — Validate & harden (after first transactions)

**Goal:** Turn early usage into trust and stability.

- Fix whatever real users hit in Phase 0.
- **Legal in parallel:** attorney review of ToS/Privacy (see **ATTORNEY_BRIEF.md**), decide on
  **general-liability insurance**, resolve **business-address privacy**.
- Start building **reputation signals** (reviews now gate on real bookings) and **seed supply**
  in the launch area.
- Optional cheap wins already scoped: search-recall improvement, the `venues`/`other` taxonomy
  cleanup (partially done), a referral/invite flow.

---

## Phase 2 — Turn on card payments (deliberate, its own testing day)

**Do NOT flip cards on until this whole phase is done.** A large amount of built-but-dormant
code (delayed charging, gentle refund policy, escrow/payout, several bug fixes) has **never run
a live transaction.** Treat it as a dedicated test-mode day.

Prereqs:
- [ ] Attorney sign-off on the **stored-card mandate** (ATTORNEY_BRIEF §C) and cancellation policy.
- [ ] **Sales-tax** registration plan (ATTORNEY_BRIEF §D) + Stripe Tax configured.

Go-live sequence (full detail in LAUNCH.md → "Stripe go-live"):
1. Swap test keys → **live Stripe keys**; set `CASH_ONLY_LAUNCH = false`.
2. `STRIPE_CONNECT_ENABLED = true`.
3. Register the **live webhook** — subscribe to `payment_intent.succeeded/payment_failed/
   canceled`, **`setup_intent.succeeded`**, `account.updated`.
4. Turn on both crons: `release-payouts-hourly` and `charge-due-bookings-hourly`.
5. Verify all edge functions deployed (incl. `create-setup-intent`, `charge-due-bookings`).

**Test in Stripe TEST mode before real cards:**
- [ ] Happy path: pay a rental → 24h payout hold → payout releases.
- [ ] **Delayed charge**: book >24h out → card saved ($0, `scheduled`) → cron charges → paid.
- [ ] **Decline path**: test card `4000 0000 0000 0341` → `payment_failed` → renter notified →
      retries → **auto-cancel at the rental day**, dates freed.
- [ ] **Cancel before charge** → confirm **zero Stripe fee** (no charge/refund happened).
- [ ] **Refund path** on a paid booking (gentle policy: full minus 8% for renter cancels;
      full for owner cancels).
- [ ] Cancel a `scheduled` booking → confirm the cron does **not** later charge it.

---

## Phase 3 — Grow

- **Referral / invite** flow (neighbor-invites-neighbor — the natural growth engine; share
  plumbing + OG previews already built).
- **Saved-item re-engagement** nudges ("an item you favorited is available").
- **SEO / shareable listing pages** (per-listing OG previews already live via `/api/og`).
- **Performance hardening** once traffic is real: browse **pagination**, card **memoization**
  (both deferred on purpose — no benefit at current scale).
- Expand to a second geography only after the first has real liquidity.

---

## The two things that gate everything

1. **Card payments** stay off until Phase 2's full test-mode pass. It's the biggest untested
   surface in the app.
2. **Legal sign-offs** (attorney review, insurance, DMCA agent, sales-tax) are real gates before
   relying on the terms or taking card money — and they're on you + counsel, not code.

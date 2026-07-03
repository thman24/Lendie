# Lendie — Pre-Launch Checklist

Living checklist of admin/legal/infra tasks to complete **before going fully live**
(real users + real money). Code is in good shape; these are the things that live
*outside* the codebase or are deliberately deferred. Check items off as you go.

---

## 🏛️ Legal & business admin

- [ ] **Register a DMCA agent** — U.S. Copyright Office, [dmca.copyright.gov](https://dmca.copyright.gov).
  - Service: **Lendie LLC**, contact email: **legal@lendie.app**, + a business address.
  - Cost ~$6. **Renews every 3 years** — set a calendar reminder (it expires if not renewed).
  - Activates the copyright safe-harbor that ToS §11.1 references.
- [ ] **Business address / privacy** — your home address may be on your **WV LLC filing**
      and would be public in the DMCA directory.
  - Look up the LLC on the **WV Secretary of State** business search to see what's exposed.
  - If it's your home: consider a **commercial registered agent** (~$50–150/yr) and/or a
    **UPS Store mailbox or virtual business address** (~$10–25/mo, real street address) and
    reuse it for DMCA, email footers, etc.
- [ ] **Lawyer review of ToS & Privacy** — the updated docs (sales + services, independent-
      contractor & assumption-of-risk language) were drafted carefully but not by an attorney.
      Have a lawyer review before relying on them.
- [ ] **Service-provider insurance** — decide whether providers (lawn care, handyman, moving)
      must carry their own liability insurance, or whether to restrict high-risk service types.
- [ ] **Trademark** — hire a flat-fee trademark attorney to clear + file **LENDIE**
      (clearance concern: **LENDIO**, an existing fintech in classes 35/36/42). Don't gate launch
      on it, but resolve early — a forced rebrand only gets more painful with growth.

## 💳 Stripe go-live

> CURRENT STATE: **cash-only soft-launch.** Card payments are OFF via the
> `CASH_ONLY_LAUNCH = true` flag in `src/App.jsx` (Stripe key tree-shaken out of the
> bundle; users see "card coming soon"). The live Stripe account is activated and
> Mercury is connected — only the app-side flip below remains.
>
> TO TURN ON CARD PAYMENTS:
> 1. Set `CASH_ONLY_LAUNCH = false` in `src/App.jsx`.
> 2. Add the **live** `VITE_STRIPE_PUBLISHABLE_KEY` (pk_live_…) in Vercel env.
> 3. Set the **live** `STRIPE_SECRET_KEY` (sk_live_…) as a Supabase edge-function secret.
> 4. Then the steps below (webhook, Connect, payout cron). Build + redeploy.

- [x] **Activate the LIVE Stripe account** — DONE (Lendie LLC activated, KYC complete during setup).
- [x] **Connect Mercury to the PLATFORM Stripe account** — DONE (Mercury set as payout bank on the
      live account). This is how Lendie's revenue (the 12% platform fee) lands in the LLC's bank.
      (Sellers connect their OWN banks in-app — separate, not Mercury.)
- [ ] **Swap test keys → live keys**: `VITE_STRIPE_PUBLISHABLE_KEY` (Vercel env) + the Stripe
      secret key in the edge-function env. ⚠️ This is the moment real cards get charged — do it LAST,
      after the live account is activated, Mercury is connected, and everything's verified.
- [ ] **Enable Connect**: set `STRIPE_CONNECT_ENABLED=true` so card payments require the owner
      to have a connected account (card blocked for un-onboarded owners; cash still works).
- [ ] **Register the LIVE webhook** pointing at the `stripe-webhook` function (test webhook ≠ live).
      Subscribe to at least: `payment_intent.succeeded`, `payment_intent.payment_failed`,
      `payment_intent.canceled`, **`setup_intent.succeeded`** (needed for delayed charging —
      it flips a saved-card booking to `scheduled`), and `account.updated`.
- [ ] **Turn on the payout-release cron** (deliberately not auto-applied — `20240126_payout_release_cron.sql`):
  1. `create extension pg_cron; create extension pg_net;`
  2. Store Vault secrets (in the Supabase SQL editor, NOT in git):
     `select vault.create_secret('https://roehykgfltnghsvcvter.supabase.co','project_url');`
     `select vault.create_secret('<SERVICE_ROLE_KEY>','service_role_key');`
  3. Run the `cron.schedule('release-payouts-hourly', ...)` block from the migration.
  - Without this, held owner payouts never release on the 24h timer.
- [ ] **Verify all edge functions are deployed** (create-payment-intent, **create-setup-intent**,
      stripe-webhook, create-refund, release-payouts, **charge-due-bookings**, create-connect-account,
      get-connect-status, get-stripe-dashboard-link, admin-* , send-email).
- [ ] **End-to-end test** a live card rental: pay → 24h hold → payout releases → refund path.

### Delayed charging (built 2026-07-03 — inert until cards are on)

To avoid Stripe fees on cancellations, rentals & dated services with a start date **>24h out
don't charge at checkout** — the card is SAVED (SetupIntent, $0) and charged off-session **24h
before the rental day** by the `charge-due-bookings` cron. Sales, undated services, and
last-minute bookings still charge immediately (= "charge on acceptance"). A cancellation before
the scheduled charge costs **zero** Stripe fees because no charge ever happened.

- `payment_status` states added: `saving` → `scheduled` → (`charging`) → `paid`; `payment_failed`
  during the notify+grace window. Columns on `booking_requests`: `stripe_customer_id`,
  `stripe_payment_method_id`, `charge_at`, `charge_attempts`, `charge_last_error`,
  `payment_failed_at` (migration `20240137`).
- Charge cron `charge-due-bookings-hourly` scheduled via `20240138` (reuses the release-payouts
  Vault secrets). On a failed charge: renter is notified with a pay-now link (also clears 3DS),
  retried through the day, then **auto-cancelled at the rental day** if still unpaid (dates freed).
- New edge functions to confirm deployed: **`create-setup-intent`**, **`charge-due-bookings`**
  (plus the updated `stripe-webhook`).

**Delayed-charge go-live checklist (do in Stripe TEST mode first):**
- [ ] Webhook subscribes to **`setup_intent.succeeded`** (see webhook step above) — without it,
      saved-card bookings never become `scheduled` and never charge.
- [ ] Confirm the **`charge-due-bookings-hourly`** cron exists (`select * from cron.job;`) — it was
      scheduled by `20240138` and reuses the release-payouts Vault secrets.
- [ ] TEST the happy path: book a rental >24h out → card saved ($0, `scheduled`) → move `charge_at`
      back / wait → cron charges → `paid` → payout hold → release.
- [ ] TEST the decline path with Stripe test card **`4000 0000 0000 0341`** (fails off-session):
      charge fails → renter notified w/ pay-now link → retries → **auto-cancel at rental day** → dates freed.
- [ ] TEST a cancel BEFORE the charge → confirm **no Stripe charge/refund happened** (zero fee).
- [ ] **LAWYER: stored-card authorization (mandate).** Delayed charging saves the renter's card
      and charges it later, so the ToS + checkout must include an authorization clause. The checkout
      already shows: *"I authorize Lendie to securely save this card and charge $X on [date] (24
      hours before my rental). I can cancel free of charge until then."* Have the lawyer confirm
      this wording + add a matching stored-card / future-charge clause to the ToS. (Card data still
      lives only at Stripe — this is a consent/disclosure item, not new data-security scope; PCI
      stays SAQ A.) Fold into the ToS/Privacy review above.

## 🔴 LAUNCH-DAY BLOCKERS (do these first)

- [x] **Email deliverability** — DONE. Resend connected: domain lendie.app verified (auto-config via
      GoDaddy, Google MX untouched), Supabase Auth custom SMTP set (smtp.resend.com, sender
      noreply@lendie.app), email rate limit raised 2/hr → 30/hr, `RESEND_API_KEY` set on the
      `send-email` edge function. Test email delivered. NOTE: new-domain mail may land in spam on
      Outlook for the first few days (reputation warmup) — signup/reset copy now tells users to check
      spam. Rotate the Resend key (it appeared in a screenshot) once stable.
- [x] **Restrict the Google Maps API key** — DONE. Website (HTTP-referrer) restriction applied to
      `https://lendie.app/*` and `https://www.lendie.app/*` (localhost skipped — Google rejects the
      `:*` port wildcard; not needed for prod). Restrictions column now shows "HTTP referrers". Map
      still works. (For local-dev maps later, make a separate dev key with `http://localhost:5173/*`.)
- [x] **Error monitoring** — DONE: error boundary (no white-screen crashes) + crash logging to the
      `error_logs` table (admin-readable). Optionally add a Sentry DSN later for alerts.

## ✉️ Email — detail (see memory `project_email_setup`)

- Covered by the blocker above. The `send-email` edge function silently skips notifications until
  `RESEND_API_KEY` is set; auth emails need the custom SMTP config.

## 🔑 Social login (deferred — see memory `project_social_login`)

- [ ] Facebook login is **dev-mode only** pending Meta business verification; Google/Apple not
      configured. Buttons are hidden behind `false &&`. Re-enable when ready.

## 🖼️ Infra / cost

- [ ] **Supabase egress** — Free plan is 5 GB/mo; you hit it once. Mitigated (image compression,
      1-yr cache, thumbnails). Watch usage; upgrade to Pro (~$25/mo) when real traffic arrives.

---

> Deployment workflow reminder: `npx vite build` → `vercel deploy --prod --yes` →
> `git commit` + `git push`. Risky DB/money/auth changes: verify first.

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

## 💳 Stripe go-live (currently TEST mode / Connect dormant)

- [ ] **Swap test keys → live keys**: `VITE_STRIPE_PUBLISHABLE_KEY` (Vercel env) + the Stripe
      secret key in the edge-function env.
- [ ] **Enable Connect**: set `STRIPE_CONNECT_ENABLED=true` so card payments require the owner
      to have a connected account (card blocked for un-onboarded owners; cash still works).
- [ ] **Register the LIVE webhook** pointing at the `stripe-webhook` function (test webhook ≠ live).
- [ ] **Turn on the payout-release cron** (deliberately not auto-applied — `20240126_payout_release_cron.sql`):
  1. `create extension pg_cron; create extension pg_net;`
  2. Store Vault secrets (in the Supabase SQL editor, NOT in git):
     `select vault.create_secret('https://roehykgfltnghsvcvter.supabase.co','project_url');`
     `select vault.create_secret('<SERVICE_ROLE_KEY>','service_role_key');`
  3. Run the `cron.schedule('release-payouts-hourly', ...)` block from the migration.
  - Without this, held owner payouts never release on the 24h timer.
- [ ] **Verify all edge functions are deployed** (create-payment-intent, stripe-webhook,
      create-refund, release-payouts, create-connect-account, get-connect-status,
      get-stripe-dashboard-link, admin-* , send-email).
- [ ] **End-to-end test** a live card rental: pay → 24h hold → payout releases → refund path.

## ✉️ Email (deferred — see memory `project_email_setup`)

- [ ] **Set up Resend** (`RESEND_API_KEY`) so transactional/notification emails actually send —
      they're currently silently skipped.
- [ ] Auth emails are on Supabase's built-in **2/hr cap** — move to a real SMTP/provider before launch.

## 🔑 Social login (deferred — see memory `project_social_login`)

- [ ] Facebook login is **dev-mode only** pending Meta business verification; Google/Apple not
      configured. Buttons are hidden behind `false &&`. Re-enable when ready.

## 🖼️ Infra / cost

- [ ] **Supabase egress** — Free plan is 5 GB/mo; you hit it once. Mitigated (image compression,
      1-yr cache, thumbnails). Watch usage; upgrade to Pro (~$25/mo) when real traffic arrives.

---

> Deployment workflow reminder: `npx vite build` → `vercel deploy --prod --yes` →
> `git commit` + `git push`. Risky DB/money/auth changes: verify first.

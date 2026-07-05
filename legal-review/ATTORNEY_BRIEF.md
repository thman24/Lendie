# Lendie — Attorney Briefing Packet

*Prepared for legal review. This summarizes the business, the documents to review, and
the specific questions we'd like answered. The Terms of Service and Privacy Policy were
drafted in-house (not by an attorney) and need your review before we rely on them.*

---

## 1. The business

- **Entity:** Lendie LLC, a **West Virginia** limited liability company (solo-owned).
- **What it is:** A peer-to-peer online marketplace where neighbors **rent** items to each
  other, **sell** items, and offer **local services** (e.g. lawn care, handyman, moving).
  Users are both consumers and providers.
- **Our role:** We are a **neutral technology platform / venue** — not a party to the
  transactions, not the seller/renter/provider, and (for services) **not the employer** of
  service providers. We don't own, inspect, store, or deliver items, and we don't screen,
  vet, or background-check users.
- **Money:** We charge a **platform fee** — 8% to the renter/buyer + 4% taken from the
  owner's payout (≈12% total). Payments will be processed by **Stripe** (Stripe Connect for
  owner payouts; funds held in our platform balance and released ~24h after the rental
  begins). **We never touch or store card numbers — Stripe does.**
- **Current status:** Live at **www.lendie.app**, operating **cash-only** today (card
  payments are built but disabled behind a flag). Nationwide-capable but launching in one
  local area (WV panhandle) first.
- **Users:** 18+ only (age-gated at signup with recorded consent).

## 2. Documents to review

- **Terms of Service:** `public/terms.html` (also live at https://www.lendie.app/terms.html)
- **Privacy Policy:** `public/privacy.html` (https://www.lendie.app/privacy.html)

Both are already fairly built out. Key sections we specifically want checked are below.

## 3. Specific questions for you

### A. Enforceability of our core protections (nationwide)
1. **Governing law (ToS §17):** We chose **West Virginia** law with a savings clause ("except
   non-waivable consumer-protection law of your home state"). Is this enforceable, and is the
   savings-clause approach the right call for a nationwide consumer marketplace?
2. **Arbitration + class-action waiver (ToS §16):** AAA Consumer Rules, arbitration in the
   user's home state, small-claims carve-out. Is our clause enforceable under the FAA, and is
   there anything (mass-arbitration exposure, recent case law) we should change?
3. **Limitation of liability / disclaimers / indemnification (ToS §13–15):** Are these
   enforceable, and do the state carve-outs (esp. **New Jersey TCCWNA**, §20) adequately
   protect us?

### B. Services / worker classification — our biggest concern
4. We facilitate **local services** and classify providers as **independent contractors**
   (ToS §5.5, §5.7). Given aggressive state tests (**California AB5 / ABC test**,
   Massachusetts, New Jersey), what is our exposure to a provider being reclassified as an
   employee, and how should we tighten the language or the product to reduce it?
5. Should we **restrict or exclude** certain high-risk service or listing categories
   (e.g. **vehicles**, **short-term lodging/housing**, licensed trades) to limit regulatory
   exposure? (We already prohibit weapons, alcohol, controlled substances, unregistered
   vehicles, and unlicensed regulated services — ToS §4.2.)

### C. Payments & stored cards (activates when we enable card payments)
6. **Delayed charging / stored-card mandate:** For most dated bookings we plan to **save the
   renter's card via Stripe and charge it ~24h before the rental** (not at booking). ToS §6.2
   contains the stored-card authorization and §6.4 the cancellation policy. Please confirm the
   **authorization/mandate language is sufficient** to support charging a saved card later and
   to defend a "I didn't authorize this" dispute.
7. **Cancellation policy (ToS §6.4):** Free cancellation before the card is charged; after
   charge, refund minus a non-refundable 8% service fee; owners always refund fully. Is this
   fair/enforceable and adequately disclosed?

### D. Sales tax
8. **Marketplace-facilitator obligations:** As a marketplace that takes a fee on sales, what
   are our **sales-tax collection/remittance** obligations, in which states, and at what
   nexus/thresholds? ToS §6.6 authorizes us to collect/remit; we plan to use Stripe Tax for
   the mechanics. When do we need to register?

### E. Privacy
9. **State privacy laws:** Privacy §15 covers CCPA/CPRA and other state laws (VA, CO, CT, UT,
   TX, OR, MT). We do **not** sell data or run ads/analytics. At our size are we compliant, and
   what triggers additional obligations as we grow? California **Civ. Code §1789.3** notice is
   included (ToS §20, Privacy §15.1).
10. We disclose sub-processors (Stripe, Supabase, Vercel, Google Maps, Resend, and an IP-
    geolocation lookup). Is that disclosure adequate?

### F. Copyright / DMCA
11. ToS §11.1 references DMCA safe harbor. We understand we must **register a DMCA agent** with
    the U.S. Copyright Office for the safe harbor to apply — please confirm and flag anything
    else needed.

### G. Trademark (may need a separate IP/trademark attorney)
12. We want to clear and file the mark **LENDIE**. There is a known potentially-conflicting
    mark, **LENDIO** (an existing fintech, roughly classes 35/36/42). We'd like a **clearance
    opinion** and, if viable, filing in the appropriate classes. If you don't handle trademark
    prosecution, a referral to a flat-fee trademark attorney would help.

## 4. Related items we're already handling (context, not questions)
- **General liability / marketplace insurance** — evaluating a policy.
- **Business-address privacy** — the owner's home address may be exposed on the WV LLC filing
  and would be public in the DMCA agent directory; considering a registered agent / virtual
  address.
- **Rotating a screenshotted API key** — operational, done separately.

## 5. What we are NOT asking
We're not asking you to draft from scratch — the ToS/Privacy exist. We want your **review,
corrections, and sign-off**, with particular attention to **B (worker classification)**,
**C (stored-card mandate)**, and **D (sales tax)**, which are the areas we're least certain
about.

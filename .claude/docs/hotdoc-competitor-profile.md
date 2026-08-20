# HotDoc — Competitor Profile
### 20 August 2026 · What HotDoc provides, in detail. [PUB]=published/primary · [EST]=estimate · [MEDIA]=media-reported

## 1. The company

Founded **2012, Melbourne**, by Dr Ben Hurst (a former doctor; first customers were his mother's clinic and his cousin's). Funding: $2.2m Series A (AirTree, 2015), $5m Series B (Right Click Capital, 2018), a scaled-back Series D (2021). **In February 2026 Potentia Capital bought a majority stake** (Acclivis and AirTree co-investing) at a reported **$250–300m — roughly 8× revenue and 30× EBITDA** on ~$30m revenue at ~25% EBITDA margin [MEDIA]. Hurst stepped back in **July 2026**; AirTree's David Parfett is interim CEO. Headcount ~95 [EST].

**Scale claims [PUB]:** 13–14m active patients ("1 in 3 Australians"), 23,000+ practitioners, ~2.5m appointments/month, 1.1m online bookings/month (half after-hours). Media puts it in **~two-thirds of Australian GP practices**, "almost entirely hubbed in general practice."

## 2. The product, module by module

**Online bookings (the core).** Patient app (claims 4.8 stars) + website widget + the hotdoc.com.au directory. 24/7 booking against the PMS appointment book: custom appointment types with per-practitioner lengths and windows, multi-slot bookings (vaccine clinics), tandem practitioner+nurse appointments, per-patient booking restrictions and alerts. Reads slots from and writes bookings into the PMS.

**Reminders.** Omni-channel cascade (push → email → SMS), two-way confirm/cancel/reschedule, self-serve rebooking, cancelled slots automatically reopened (gap-fill — but **no separately marketed waitlist product**). Claims: 75% of appointments verified, 51% no-show reduction.

**Recalls and results.** Clinical recall delivery by SMS/push with configurable escalation (e.g. three messages then a printed letter), auto-stopping when the patient books; positioned as RACGP-compliant. Results notifications are **non-urgent only**, triggered daily from PMS record flags, with book-from-notification and letter fallback.

**Digital forms.** Fully custom forms auto-sent by appointment type (including phone bookings); structured data uploads to the PMS plus a signed PDF into the record. Template library: new-patient registration, vaccine consents, mental-health screens (K10, DASS21, DMI-10), records transfer, **MyMedicare enrolment**.

**Check-in.** Geofenced (100m) mobile check-in with three-point identification, arrival written to the PMS, queue position shown; kiosk check-in bundled.

**Payments.** Card-on-file via Stripe/Pin/Spreedly (PCI-DSS Level 1); pre-authorisation holds (99.98% collection claim); no-show and cancellation fees; telehealth payments; bulk-billing eligibility screening. Deepest write-back with Best Practice (auto invoice/receipt). **Fee: 1.75% + $0.30 per transaction.** Note: a March 2026 move to route patient payments upstream through HotDoc caused practice backlash and payroll-tax/GST questions [MEDIA].

**Telehealth.** Video and phone with per-appointment links, launched from the PMS, with integrated payments and telehealth bulk-billing consent (since ~Oct 2023).

**Telehealth On Demand — the controversy.** HotDoc's *own* on-demand GP network (piloted Feb 2025): same-day single-issue consults offered inside the app, notes returned to the home practice. Practices saw it as **competing with them for their own patients**; public backlash, an apology from Hurst, a pause, and an opt-in relaunch (Aug 2025) with "regular GP unavailable" screening. HealthEngine ran switching offers off the back of it. The clearest illustration of HotDoc's structural tension: **the consumer brand owns the patient relationship, not the practice.**

**Inform.** In-journey preventive-health campaign placements (shown during booking, forms, reminders, check-in): skin checks, immunisations, cervical/bowel/breast screening, mental health, flu clinics; age/gender targeting; ~200 impressions per clinic per week claimed.

**Broadcast.** One-way bulk SMS to cohorts (age/gender filters or CSV upload) with booking links and opt-out. **$0.063 per SMS on top of the subscription.**

**Vaccines.** The COVID-era suite: eligibility screening, digital consents filed as PDFs, dose scheduling with mandated gaps, stock-based slot control. No AIR integration found.

**Routine Requests.** Asynchronous script/referral/medical-certificate requests routed to the doctor's HotDoc sidebar, pay-on-approval. (Drew scrutiny over online pathology/imaging referrals.)

**Caller ID.** Matches inbound calls to the patient database — name, SMS history, appointments — for compatible phone systems.

**Reviews.** Automated Google-review requests ~2 hours post-visit; capped at 400 review-SMS per practice per month; AHPRA-compliant framing.

## 3. The AoB feature (know thine overlap)

Free, bundled. **Post-consent** auto-triggers when the invoice lands in the PMS; **pre-consent** is manually sent up to 7 days ahead using Basic Service Descriptions, with a post-consent backstop if the billed item falls outside the description. Cascade push → email → SMS (SMS free; face-to-face consults get push/email only, telehealth adds SMS). **PMS support: Bp, MD Pracsoft, Zedmed only** — on Bp/MD the PDF files to Correspondence In but the AoB checkbox is still ticked manually; on Zedmed it's dashboard download only with a **30-day purge**. Cannot detect externally captured consent (e.g. Tyro EasyClaim). One automated follow-up only. **No tablet/kiosk capture, no identity verification, no enduring agreements (planned H2 2026), no retention/audit product, English only.** Roadmap: consent inside the booking flow and reminders.

## 4. Commercials and integration

- **GP pricing [PUB]:** subscription per *active practitioner* (any who used bookings/reminders/recalls that cycle); **minimum $170.60/month covering 2 practitioners → ~$85.30/practitioner/month**. Whole suite bundled — no module tiers; "unlimited" SMS except Broadcast and the review cap; **no lock-in contracts**; minimum fee charged per PMS database.
- **Allied health:** free profile + **$30.92 per new-patient booking** made through the app/directory.
- **PMS integrations:** full suite on Best Practice, MedicalDirector Clinical/Pracsoft, Zedmed; **Helix reduced**; Genie for specialists; Cliniko, Nookal, coreplus for allied. Depth: read appointment books, write bookings and arrivals, read recall/result flags, write PDFs to correspondence, payment write-back on Bp.
- **Security:** SOC 2 Type II, AWS Australia-only, AES-256/TLS, MFA, 99.5% uptime claim. No public breach found.

## 5. Weaknesses and churn drivers

1. **Channel conflict** — Telehealth On Demand proved HotDoc will monetise the patient relationship over the practice's objection; PE ownership sharpens the fear.
2. **The payments migration backlash** (Mar 2026) — poor change management, distressed patients, tax questions.
3. **Lock-in resentment** — "an operating layer of a practice… leaving HotDoc is hard" [MEDIA]; no white-label; the brand faces the patient, not the practice.
4. **Patient app trust** — ProductReview 1.6/5 (small sample): login failures, phantom bookings, unauthorised charges, AI-only support.
5. **No shipped AI** — as of Aug 2026, no AI receptionist/voice/phone product; only stated intent. Commentators rate it behind HealthEngine's AI pivot.
6. **GP-only depth** — thin, pay-per-booking model outside general practice.

## 6. What this means for us (one paragraph)

HotDoc is the incumbent to respect on *reach* (two-thirds of GP practices) and to attack on *alignment*: it is a consumer brand renting practices back their own patients, now owned by PE, with a free-but-shallow AoB checkbox (three PMSs, no verification, no tablet, no enduring, no audit record) and no shipped AI. Our counters are already in the plan: practice-branded not consumer-branded, white-label-friendly to PMS vendors, compliance depth they don't have, in-practice capture they can't do, the uncovered PMSs (Medtech, Magentus, allied), and the agent measured on outcomes rather than messages. Their $250–300m PE price on ~$30m revenue is also the clearest public comp for what a practice-engagement platform in Australia is worth.

*Sources: practices.hotdoc.com.au product and support pages; Medical Republic (valuation, sale, Telehealth On Demand, payments, AoB launch, founder transition); SmartCompany/Startup Daily/Capital Brief (Potentia acquisition); Bp Partner Network. Full URLs in the research trail of 20 Aug 2026.*

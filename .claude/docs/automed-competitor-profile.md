# AutoMed Systems — competitor / partner profile

**Status:** working profile, v1.0 — 20 August 2026
**Sources:** automedsystems.com.au product pages, Best Practice and MedicalDirector partner listings, Medical Republic (Jul 2024), Good Design Awards 2017, Google Play. Inline links throughout. Confidence caveats in §7.

> **Headline for AoBPlatform: AutoMed is not just "the check-in company" — it ships a live AoB product today.** "AutoMed Medicare Benefit Assignment" sends a digitised DB4(e) form by secure SMS when the invoice is raised, for a one-off **$125 + GST per location** establishment fee. It is shallow (SMS-only, no verification layer, no enduring-agreement machinery, no evidence vault), but it exists, it is cheap, and its CTO has been the most public advocate of AoB digitisation in the trade press. Treat AutoMed as the closest *functional* competitor on the wedge — and simultaneously the most natural acquirer-of or partner-for a deeper compliance record.

---

## 1. Company

| | |
|---|---|
| Founded by | Dr Peter Demaio, Melbourne GP (43 years clinical); "developed and patented by, and for, Melbourne GPs" |
| First visible activity | 2017 — 200,000+ patient visits processed by May 2017; Good Design Award (Digital Apps & Software) 2017 |
| HQ | Williams Landing / Laverton, Melbourne VIC |
| Ownership | Privately owned; no known outside funding, acquisition, or PE involvement (contrast HotDoc/Potentia) |
| Key people | Peter Demaio (Founder), Louis Putter (CTO — the public voice on AoB digitisation) |
| Scale | Medical Republic (Jul 2024): booking/communication platform "used by approximately one in five Australian GPs" — vendor-sourced claim. Patient app AMS Connect: 100K+ downloads, 4.7★ (~8.5k reviews), still actively updated (Jun 2026) |
| Security posture | SMB1001:2025 Gold Level 3 certified; "globally patented" system |

Recent news is thin: no funding rounds, acquisitions or leadership changes found 2024–2026. Marketing site is partly stale (blog last updated Jan 2020; some pages 404), while the product and app remain actively maintained — a build-not-market company.

## 2. Product modules

Sold as independent opt-in modules, per location, month-to-month after a 1-month free trial:

- **Online Appointments** — web booking, 135+ configuration options, multi-resource booking, upfront payment, unlimited appointment types, ~100 languages.
- **AMS Connect app** — patient bookings, mobile check-in, family members, repeat script/referral requests with payment, clinic news feed.
- **Kiosk** (the module they are known for) — BYOD tablet ≥10.1″; "5-second self-arrival" by Medicare card read; late/early-arrival validation; demographic updates; expired Medicare/Pension/HCC card detection; waiting-room direction; **digital signature capture for T&Cs**; optional billing mode with Tyro EFTPOS (invoice, Medicare rebate via Tyro, receipt). Known price point: **$50/month**.
- **SMS** — clinical reminders and recalls, single and bulk (CSV) campaigns, consent management, and Medicare Benefit Assignment via secure SMS (§4).
- **Telehealth** — end-to-end video with AMS Doc Connect doctor app, auto-payment, online script renewal.
- **Digital Forms / Concierge** — paperless new-patient registration and consent forms.
- Long tail: Caller ID (Telair), Vaccination module, Advanced Reports (results/callback messaging), Debtors Book, Appointment Book Audit, Email Campaigns, Patient Queue Display, **MyMedicare Administration Tool** (eligibility + QR/email registration invites), Chatbot AI, eCommerce payments with tokens.

Claimed ROI: 35% DNA reduction; one recovered DNA per day covers the whole suite for a 3–5 FTE practice.

## 3. PMS integrations

| PMS | Status |
|---|---|
| Best Practice (Bp Premier) | Accredited partner |
| MedicalDirector (Clinical, Pracsoft, Helix) | Accredited Smart Marketplace partner since 2018 |
| Zedmed | **No evidence of support** |
| **Medtech Evolution** | **No evidence of support** — not listed anywhere |
| Genie/Gentu (Magentus) | No evidence of support |

Same pattern as HotDoc and Cubiko: **the Bp/MD duopoly is served; Medtech, Magentus and allied health are not.** Our wedge territory is untouched by AutoMed too.

## 4. The AoB product — what it does and does not do

**AutoMed Medicare Benefit Assignment** (live product page):

- Trigger: invoice raised in the PMS → secure SMS auto-sent from a clinic-dedicated number (Tier-1 enterprise gateway).
- Content: digitised **DB4(e)** form; patient approves or declines assignment in the SMS flow; can save the form as PDF.
- Pricing: **one-off $125 + GST establishment fee per location**; runs standalone or inside the package.
- Public posture: CTO Louis Putter, Jul 2024, Medical Republic — manual AoB paperwork costs GP clinics **~$375m/year**; AutoMed engaged in the Services Australia / DoHDA / MSIA co-design process.

**Gaps against the 2026/27 regime (our differentiation):**

- Product page still references DB4(e) and does not mention the 1 July 2026 changes, s 65C element checking, or Services Australia conformance — currency unverified.
- SMS-only channel: no in-practice tablet flow (ironic, given they own the kiosk), no portal, no carer/vulnerable-patient pathway, no multilingual agreement flow.
- No RACGP 3-point verification layer; no ETA s 10 "reliably identify the assignor" positioning.
- No enduring-agreement lifecycle (per-practitioner registration, anniversary re-registration, 89AA notices, termination within 2 business days).
- No evidence vault: no non-repudiable logs, no compliance reporting, no reconciliation.
- Not available at all on Medtech/Magentus/allied systems.

Also validating: their $375m/yr sector-cost figure is a usable third-party anchor for our business case.

## 5. Commercials

- No published price list — per-clinic quote via CRM; 1-month free trial; opt-in/opt-out monthly (no visible lock-in).
- Model is **per-location, per-module** — not per-practitioner. Kiosk $50/mo and AoB $125 one-off are the two known price points; both signal a *low-price, high-volume* culture.
- Implication for us: on shared Bp/MD turf we will not win on price against a $125-one-off SMS product. We win on *compliance depth* and on the segments AutoMed does not serve.

## 6. Weaknesses

- **Shallow AoB** — a form-delivery feature, not a compliance record (see §4 gaps).
- **No Medtech / Zedmed / Magentus / allied health** coverage.
- Stale public marketing; opaque pricing; thin third-party review footprint — low brand gravity outside its installed base.
- App reliability complaints: lost appointment data after updates, expired-card data silently blocking script requests, re-registration friction.
- Single-founder, privately held, small — limited capacity to chase the regulatory long tail (enduring registration, conformance, reconciliation) at speed.

## 7. Confidence caveats

Founding year and headcount unverified (registries paywalled/blocked); "one in five GPs" is vendor-sourced; AoB product launch date and 2026-rule conformance unverified; absence of Medtech/Zedmed support inferred from absence of any listing, not from an explicit statement.

## 8. What this means for AoBPlatform

1. **Update the map.** "AutoMed owns check-in" understates them: they are the incumbent *AoB SMS* vendor on Bp/MD. Our strategy slide's unowned-layer claim survives — nobody owns *completion* — but the wedge pitch on Bp/MD practices must answer "we already get AoB by SMS for $125."
2. **The answer is the record, not the message.** SMS delivery of a form ≠ a verified, element-checked, enduring-capable, non-repudiable compliance record with write-back. Sell the audit, the verification, and the 2027 enduring machinery.
3. **Fight where they are absent.** Medtech (our design partner's PMS), Magentus, allied health, specialists — AutoMed has no path there. Same conclusion as HotDoc and Cubiko: the wedge territory is genuinely open.
4. **Partner potential is real.** Per-location pricing, Tyro partnership, kiosk hardware in waiting rooms, no VC pressure: AutoMed could be a distribution ally for a deeper compliance engine (white-label) rather than an enemy — the roadmap's "white-label suite" bar has a named candidate.
5. **Watch Putter.** Their CTO shaped the public AoB narrative once and sits inside the MSIA co-design loop; assume they will ship a 2026-rules update. Track the product page quarterly.

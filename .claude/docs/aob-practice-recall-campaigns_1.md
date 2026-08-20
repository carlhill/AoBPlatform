# Feature note — Practice recall campaigns ("flu clinic" outreach)
### 20 August 2026 · Practice-funded patient outreach through the AoBPlatform channel

## 1. The scenario

The practice holds flu vaccine stock ahead of the season, sets aside special clinic mornings, and asks AoBPlatform to message its patients: *"Free flu vaccination at our Saturday morning clinic — coffee and muffin provided. Book here."* Priced as one included campaign per quarter in the subscription, with additional campaigns purchasable.

## 2. Is it legal? Yes — this is practice-initiated clinical recall, an established and lawful category. Four tripwires:

**(a) No vaccine brand names — TGA.** Advertising prescription medicines to consumers is prohibited, and vaccines are prescription medicines. But inviting patients to a **vaccination service** is not advertising the medicine, provided the message stays generic: "flu vaccination" is fine; a brand name (Fluad, Fluzone, Vaxigrip) or any brand comparison is not. The TGA has published guidance to exactly this effect for flu clinic advertising. ⚠️ *Verify the current guidance wording before templating.* (The COVID-era permission that allowed businesses to offer vaccination rewards was specific to COVID vaccines — do not rely on it for flu.)

**(b) "Free" must be true for the person reading it — Australian Consumer Law.** Flu vaccination is free under the National Immunisation Program only for eligible cohorts (65+, pregnant women, Aboriginal and Torres Strait Islander people, specified medical conditions; under-5s and broader cohorts in some states). Two compliant designs: **target the message to NIP-eligible cohorts only** (age and register-based selection the platform can do), or say *"free for eligible patients; $X otherwise."* A blanket "free" to the whole patient list is a misleading-conduct problem.

**(c) The coffee and muffin — National Law s 133.** Advertising a regulated health service **must not offer a gift, discount or other inducement without stating the terms and conditions of the offer.** So the hospitality is lawful *if the T&Cs are stated* — and the safer framing is hospitality at an event ("refreshments provided at our Saturday clinic") rather than a conditional reward ("get vaccinated and receive…"). Never alcohol, never therapeutic goods, as the incentive. The platform should enforce this in the campaign template: any gift wording auto-inserts a T&Cs line.

**(d) Spam Act and privacy.** The message is commercial, so: sender identified as **the practice** (our ACMA-registered sender ID does this), functional unsubscribe, consent basis is the existing patient relationship. Cohort selection off the clinical record (age, risk group) is a care-related use the practice is entitled to make and we perform as its service provider — never for our own purposes. Confidentiality-flagged patients and prior opt-outs are excluded automatically, as everywhere else in the platform.

## 3. Why this fits the channel promise where pharma content did not

The rule we set was "a message from us is only ever about your consent." The precise version worth adopting: **"a message through this channel is only ever from your practice, about your care."** A flu recall is the practice talking to its own patients about its own clinical service — the same trust relationship the consent capture runs on, not a third party renting the pipe. It is also, not incidentally, what RACGP accreditation expects: the Standards require practices to run reminder and recall systems for preventive care. This feature *is* that system.

**Keep one wall intact:** campaign messages never share a message with a signature request. Different message, clearly practice-branded, so the consent request stays unmistakable.

## 4. The tie-in nobody else has

Each campaign visit is a bulk-billed attendance — **which needs an AoB**. So the booking link in the campaign can capture the **episodic pre-agreement at booking time**, and clinic morning runs with zero queue at the front desk: patient arrives, already verified, already signed, gets vaccinated, claim lodges same day, inside the 12-month window by 11 months and 3 weeks. HotDoc sells recall campaigns; it cannot bundle the consent capture. That is the differentiator, and it also makes the campaign self-justifying: a Saturday clinic of 100 patients is ~$4,000–6,500 of Medicare benefit to the practice, chase-free.

## 5. Pricing and revenue

- **One campaign per quarter included** in the core subscription (retention value; it makes the platform the practice's outreach tool, not just its compliance tool).
- **Additional campaigns: ~$199 each** up to a message cap, then per-message; SMS at cost per the existing rule.
- Revenue at scenario-4 scale (~3,300 practices, ~2 paid extra campaigns a year): **~$1.3m/yr** — same order as the notice-fee line. Modest, high-margin, and it compounds the feedback module (post-clinic smiley survey closes the loop).

## 6. The campaign family — full specifications

All five run on the flu-clinic engine: same channels, same exclusions (confidentiality flag, opt-outs, active chases), same s 133 / no-brand-names / Spam Act template, same wall between campaigns and signature requests. What differs per campaign is the **cohort rule, the trigger, and the money hook**. Common requirements first, then each campaign.

### 6.0 Common requirements

- **REQ-CAMP-01** A campaign is a first-class object: cohort rule, message set (multilingual), schedule, funder (always the practice in this family), included/paid flag, and full audit of who approved it, when, and to whom it went.
- **REQ-CAMP-02** Cohort selection uses **register and demographic data only** — age, sex where clinically relevant, AIR status, MyMedicare status, item-claim history for eligibility. Never inferred sensitivity (no cohorts built from mental health, sexual health or drug/alcohol consultation content).
- **REQ-CAMP-03** Every campaign message carries: practice identity, opt-out, and — where any gift or discount is mentioned — the terms and conditions line (National Law s 133), auto-inserted and not removable.
- **REQ-CAMP-04** Booking links embed **episodic pre-agreement capture** where the visit will be bulk billed. The campaign that fills the clinic also clears the front desk.
- **REQ-CAMP-05** Per-campaign results: sent, delivered, booked, attended, items claimed, benefit received. The report is the renewal pitch — every campaign must be able to say what it earned the practice.
- **REQ-CAMP-06** Frequency cap per patient across all campaign types (default: one campaign message per patient per month) so five well-meaning campaigns don't become spam in aggregate.
- **REQ-CAMP-07** A campaign never runs without a named practice approver. We draft; the practice owns the send.

### 6.1 Campaign A — Seasonal vaccination clinics (flu, COVID/RSV boosters)

*Specified in §1–§5 above.* Cohort: NIP-eligible by age/register, or all-patients with "free for eligible patients" wording. Trigger: practice-scheduled clinic days. Money hook: ~$40–65 of benefit per attendance, chase-free via REQ-CAMP-04.

### 6.2 Campaign B — MyMedicare registration drive ⭐ build first

**Why first:** registration gates both the practice's 12.5% BBPIP loading (all-or-nothing across the whole practice) and the enduring-agreement pathway — the only campaign where the practice's revenue and our own compound. Only ~2.6m of 22.6m GP patients were registered at last count, so almost every practice has a large unregistered majority.

- **Cohort:** active patients (seen in the last 24 months) with no MyMedicare registration at this practice.
- **Message:** "Register with [Practice] on MyMedicare — it keeps you eligible for telehealth with us and supports bulk billing. Register via myGov here; then sign once and you won't need to sign at every visit."
- **Flow:** SMS/email → myGov registration (patient completes; we cannot do it for them — link and instructions only) → on confirmed registration, **offer the enduring agreement** in the same journey. Registration is the qualifying step; enduring enrolment is the close.
- **Compliance notes:** no gift needed, so no s 133 exposure; statements about telehealth eligibility and bulk billing must be accurate per the current rules (verify wording at launch). We never see myGov credentials.
- **Practice money hook:** protects the quarterly BBPIP loading (~$52k/yr per fully bulk-billing FTE GP at stake practice-wide) and reduces future capture labour.
- **Our hook:** every completed registration expands the enduring-eligible pool — direct feed into enrolment-campaign revenue ($2/agreement) and the notice line.
- **REQ-CAMP-B1** Detect registration status via PMS/MyMedicare data where held; refresh before send.
- **REQ-CAMP-B2** The enduring offer only appears after registration is confirmed, never before.

### 6.3 Campaign C — Preventive health assessment reactivation ("you're due for a free health check")

**The reconciliation engine pointed forward:** instead of finding money the practice failed to claim, find patients entitled to funded care they never received.

- **Cohort rules (register/age/claim-history only):** 75+ annual health assessment — aged 75+ with no assessment item in 12 months; 45–49 chronic-disease-risk assessment — age window, risk factor recorded, never claimed; heart health check — 45+ (30+ ATSI), none in 24 months; ATSI health assessment (item 715) — annual. Items are worth roughly **$60–230 each**, bulk-billable.
- **Message:** "Our records show you may be due for a free health check with [Practice]. It takes about [X] minutes with our nurse and doctor. Book here."
- **Compliance notes:** "free" is accurate when bulk billed — state it as the practice's billing choice. **Hard guardrail (extends REQ-RECON-01): the engine surfaces *eligibility under the item descriptor*, never a suggestion to book a longer or higher-value item.** Eligibility rules live in the versioned MBS rule set so item changes update campaigns automatically.
- **Practice money hook:** the most direct of all five — a nurse-led assessment clinic filled from this cohort is high-margin, underused, and clinically defensible (these items exist because the care is wanted).
- **REQ-CAMP-C1** Every cohort rule cites the MBS item and descriptor version it implements.
- **REQ-CAMP-C2** Exclude patients whose record shows the assessment was clinically declined.

### 6.4 Campaign D — Telehealth eligibility recall

**The deadline nobody watches:** a patient must generally have attended the practice face-to-face within 12 months to remain eligible for telehealth items (MyMedicare-registered patients exempt since Nov 2025). Eligibility lapses patient by patient, silently, and the practice discovers it as rejected telehealth claims.

- **Cohort:** patients who use telehealth with the practice, are **not** MyMedicare-registered, and whose last face-to-face attendance is 10–12 months old.
- **Message:** "To keep phone and video appointments available with [Practice], you need an in-person visit by [date]. Book here — or register with us on MyMedicare and this requirement no longer applies."
- **Note the built-in cross-sell:** the honest best answer for the patient is often Campaign B. Present both paths.
- **Practice money hook:** preserves telehealth billability per patient; prevents rejected claims (rejection handling is reconciliation's job — this prevents the rejection existing).
- **REQ-CAMP-D1** Per-patient eligibility clock computed from claim history; banded urgency like the chase workflow (60/30/14 days).
- **REQ-CAMP-D2** Suppress where the patient is MyMedicare-registered (exempt) or has a face-to-face booking already.
- ⚠️ Verify the current 12-month-rule wording and exemptions at build time — telehealth rules have moved repeatedly.

### 6.5 Campaign E — Childhood immunisation catch-up

- **Cohort:** children with overdue vaccinations per AIR status held in the PMS; parent/guardian is the message recipient — **the assignor model already handles exactly this routing.**
- **Message:** "[Child]'s [vaccine stage] immunisation is overdue. Catch-up appointments available at [Practice] — free under the National Immunisation Program. Book here."
- **Compliance notes:** generic vaccine-stage naming (no brands); NIP items genuinely free; messages route to the recorded parent/guardian with the 14+ confidentiality rules enforced (a 14–17-year-old's own catch-up never routes to a parent if flagged).
- **Practice money hook:** attendance benefit per visit plus immunisation-related incentives; practices are measured on childhood immunisation rates.
- **Strategic hook:** every campaign generates practice-channel outcome data — the evidence base for the government advocacy play (AuTOMATIC showed ~6% uplift from practice-channel reminders; the national AIR SMS program launches mid-2027 centrally). **REQ-CAMP-E1** capture booked/attended/vaccinated rates in a form quotable to the Department and PHNs.

### 6.6 Campaign F — Cancer screening participation (bowel and cervical)

- **Cohort:** screening-age patients (bowel 45–74, cervical 25–74) with no screening item or recorded result in the program interval, register-derived.
- **Message:** "You're due for [bowel/cervical] screening. [Practice] can help — book here / your free home test kit may be waiting."
- **Compliance notes:** aligns with, and never contradicts, National Cancer Screening Register communications the patient may also receive; wording from the SMARTscreen GP-endorsed templates (trial-proven to lift bowel participation).
- **Practice money hook:** modest directly — the real hook is **PIP Quality Improvement measures and PHN part-funding**: screening participation is a QI measure PHNs fund practice projects around. **REQ-CAMP-F1** produce a per-campaign report formatted for PIP QI evidence, so the campaign pays the practice twice — attendances plus incentive compliance.
- **Distribution note:** the PHN co-funding angle makes this the campaign to pilot *with* a PHN — their logo on it is distribution disguised as a feature.

### 6.7 Pricing across the family

One inclusion covers any type: **one campaign per quarter included; extras ~$199 each.** No per-type pricing — the value story is the family ("your outreach tool"), and mixed usage maximises the frequency cap's headroom. Modelled: 1.5 paid extras per practice per year, in the cash model as at 20 Aug 2026 (FY31 revenue ~$1.10m at scenario-4 scale, ~75% margin).

## 7. Verify before launch
Current TGA guidance wording on advertising vaccination services; NIP eligibility lists per state; National Law s 133 template wording with a health lawyer (one review covers every campaign); Spam Act consent position for recall vs marketing in the practice contract; current telehealth 12-month rule wording and exemptions; MBS descriptors for the §6.3 assessment items; MyMedicare registration claims wording.

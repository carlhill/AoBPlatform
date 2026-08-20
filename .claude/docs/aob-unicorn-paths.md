# Can AoBPlatform be a unicorn?
### 20 August 2026 · An honest anatomy, and three paths that change the shape

---

## 1. What Heidi Health actually did

Heidi (AI medical scribe, Melbourne) raised a **$98m Series B at a ~$703m valuation** (late 2025, Point72-led, upsized from the initial US$65m at ~$465m). Not yet a unicorn — but the mechanics that price it that way are exactly the ones worth stealing:

| Mechanic | Heidi | AoBPlatform as specced |
|---|---|---|
| **Global surface** | A scribe works in any country, any specialty — deployed in 116 countries with zero regulatory rebuild per market | Locked to one regulation in one country by design; the s 65C engine is the moat *and* the cage |
| **Horizontal pain** | Every clinician on earth hates documentation; TAM = every consultation, billions/yr | Pain is real but jurisdictional: ~358m bulk-billed items in one country |
| **Bottom-up, near-zero CAC** | An individual clinician self-serves in minutes, no integration, no procurement; the org deal comes later | Our verification pass showed CAC is the binding constraint; a consent platform needs PMS integration before it works at all |
| **Expands along the workflow** | Scribe → coding → referrals → care plans: "the clinician's AI assistant" platform story | Consent → record → reconciliation: real, but it expands along *compliance*, which buyers cap-spend |
| **Per-seat economics** | ~$100+/clinician/month, priced against clinician hours | $49/practitioner/month, priced against front-desk labour — and we can't exceed ~70% of the customer's saving |
| **Category multiple** | AI-native categories currently price at 15–30× forward revenue | Consent/intake software prices like Phreesia: ~$480m revenue, ~3× market cap — the public-market comp for our category |

**The uncomfortable summary:** a unicorn needs a believable path to $100m+ ARR growing fast, or infrastructure with network effects. AoBPlatform's ceiling is $37–52m ARR at 100% share of Australia. **No execution inside the current shape gets there.** The ceiling is the product definition, not the team.

---

## 2. The three paths that change the shape

Ordered by credibility. Each is staged so the profitable core funds the bet.

### Path A — The AI practice-administration agent ("the autonomous front desk")

**The reframe:** stop selling consent capture; sell the *whole administrative layer* of a practice as an AI agent. Consent chase was the wedge — the same channel, identity layer, PMS integration and audit spine can run: recalls and rebooking, eligibility checks before booking, claim preparation and rejection reworking, the reconciliation loop, notice obligations, DNA follow-up, payment plans, intake. Everything a front desk does that isn't a human at the counter.

**Why it 10×es ARPU:** a 5-GP practice spends **$150–250k/yr on administrative labour**; we currently charge ~$5.7k. An agent credibly absorbing 20–30% of that work supports **$30–60k/practice/yr** — the managed-follow-up line generalised from one task to the job. 19,000 practices × $35k = **$650m+ Australian TAM**, before allied health, and the same product shape exists in every country (revenue-cycle management is a $10bn+ category in the US alone).

**Why we're positioned:** we already hold the four things an admin agent needs and nobody else assembles — verified patient identity, the consent/authority record, the money reconciliation, and a trusted comms channel. Heidi owns the *clinical* conversation; the *administrative* conversation is unowned in Australia.

**Risks:** the AI-delivery-cost assumption becomes the whole business; Heidi/Lyrebird may expand downward from the consult into admin; PMS vendors may see it as war rather than partnership.

### Path B — The consent and authority rail ("DocuSign for regulated care")

**The reframe:** one platform for *every* legally mandated consent/agreement artefact in the Australian care economy — Medicare AoB, NDIS support logs and service agreements, Support at Home agreements, workers-comp certificates, CCS CWAs, clinical-trial consent, advance care directives. One engine (already ~60–70% built per the adjacency assessment), one authority model, N schemas.

**Ceiling arithmetic:** AoB $37–52m + NDIS $60–107m + Support at Home + workers comp + CCS + trials ≈ **$200–300m ARR** at full national coverage. Not global — but big enough that 30% share supports a $500m–1bn valuation at ordinary SaaS multiples, without betting on AI-category pricing.

**Why credible:** the regulatory tailwind is synchronised — every scheme is moving the same direction (prescribed data, retention, claim-to-record matching) within a 24-month window, and the research found no vendor treating consent as the product in *any* of them.

**Risks:** five go-to-markets; the CCS buyer shares nothing with the GP buyer; each scheme adds a regulator relationship to maintain.

### Path C — The authority graph (the genuinely unicorn-shaped one)

**The reframe:** the deepest asset in the design isn't the form — it's the **verified record of who may act for whom**: parents for children, EPOA holders, guardians, nominees, carers, with scope, evidence and lifecycle. Australia has an ageing population, a supported-decision-making policy push, and *no infrastructure* for "prove this person may act for that person." Banks, telcos, utilities, insurers, aged care, government all solve it badly, one org at a time, with certified photocopies.

**The product:** an authority-verification network — the person/family establishes the authority once (evidence sighted, verified, revocable), and any relying organisation queries it by API. Think *Plaid/Auth0 for legal authority to act*. Two-sided network effects: every enrolled family makes the network more valuable to institutions; every institution makes enrolment more valuable to families. **Network effects are what actually mint unicorns** — and neither Path A nor B has them; this does.

**Why we'd have the right to build it:** the AoB and NDIS work forces us to model, verify and maintain exactly these relationships at population scale, with clinical-grade safeguarding rules already designed (silent revocation, coercion patterns, confidentiality flags).

**Risks — and they're real:** it's a different company (identity infrastructure, not health SaaS); government could build it (links to the Digital ID ecosystem); trust failures are catastrophic; monetisation is per-verification and slow to start. This is the option to *hold*, not the plan to execute — every quarter of AoB/NDIS operation builds the dataset and the safeguarding credibility that would make it fundable later.

### Not paths (examined, rejected)

Geographic expansion of AoB itself (no other country has the prescribed data set — nothing to sell into); becoming a payment rail (capital-heavy, Tyro/HICAPS incumbency); monetising the data (destroys the trust the whole thing runs on); pharma messaging (unlawful for prescription products, and the HealthEngine precedent).

---

## 3. The scorecard

| | Ceiling | Time to prove | Capital | Unicorn probability | What it rides |
|---|---|---|---|---|---|
| Base plan (AoB + NDIS, well run) | $40–80m ARR | 2–3 yrs | $6–10m | ~0% — but a $100–250m strategic exit is realistic | Compliance deadlines |
| **A — AI admin agent** | $650m+ AU, global analogue | 3–4 yrs | $15–30m | Low-moderate — the best odds of the three | AI-category multiple + labour substitution |
| **B — Consent rail** | $200–300m ARR AU | 4–5 yrs | $10–20m | Low — likelier a $300–600m outcome | Synchronised regulatory tailwind |
| **C — Authority graph** | Uncapped, network-effect | 5–8 yrs | $30m+ | Very low, highest variance | Ageing population + digital identity |

**The recommended architecture: A on top of B, holding C as an option.** Ship the base plan (it funds everything and builds the assets); expand the managed-follow-up line into the admin agent (Path A) once the AI delivery cost is measured; add schemes (Path B) as the second product per the adjacency sequence; and keep the authority model built to Path C's standard from day one — polymorphic, evidenced, revocable — so the option never closes.

## 4. What to do *now* that costs nothing

1. **Name the company for the destination, not the wedge.** "AoBPlatform" describes the 2026 product; the entity should be named for consent/authority/care administration.
2. **Keep the authority model to registry grade** (already specced — REQ-NOM-*, polymorphic anchors, evidence attachments). That is Path C's seed.
3. **Instrument AI resolution rates from the first managed-follow-up customer.** Path A's fundability is one number: what % of admin contacts the agent closes without a human.
4. **Write the investor narrative in this order:** profitable compliance core → admin agent expansion → rail → graph. Investors fund staged option value; they do not fund a $40m-ceiling SaaS at unicorn prices, and pretending otherwise burns credibility in the first meeting.
5. **Watch Heidi and Lyrebird's product announcements** for downward expansion into admin — they are the likeliest Path-A collision, and their move would both validate and crowd it.

## 5. The plan, on a timeline

Staged so that each phase is funded by the one before it, and each gate has a number that must be true before the next bet is placed. Dates are Australian financial years; "now" is August 2026.

### Phase 0 — Prove the wedge (now → 30 June 2027, the verbal-assignment cliff)
- Medtech write-back proven; design-partner practice live; AoB core GA well before the 30 Jun 2027 deadline
- First 50–80 practices, won through the free reconciliation retrospective
- **Instrument everything**: capture rate by channel, chase resolution by attempt, AI vs human resolution in managed follow-up
- Raise ~$6.5m against the lean plan; register with the Health Systems Developer Portal; ask Services Australia the enduring-registration question
- **Gate to Phase 1:** write-back works in production; ≥50 paying practices; measured capture rate ≥75% in-practice

### Phase 1 — Own the compliance record (FY28: Jul 2027 → Jun 2028)
- Enduring agreements + 89AA notice engine + anniversary tracking shipped (the market's largest gap)
- **Channel deals signed** — at least one PMS referral/white-label arrangement, because the CAC finding says direct sales alone kills the model
- Managed follow-up live at ≥100 practices; NDIS discovery done (class 0137 answered, support-log formalisation confirmed)
- ~350+ practices; reconciliation converted from land motion to paid annual review
- **Gate to Phase 2:** blended CAC ≤ ~$1,000 via channel; AI resolves ≥60% of follow-up contacts without a human; churn <10%

### Phase 2 — Second scheme + agent beta (FY29)
- **Path B begins:** NDIS product launches on the shared engine (scenario 3/4 of the NDIS model — ~$4.4m incremental need, mostly covered by core cash)
- **Path A begins:** admin-agent beta — expand managed follow-up from consent chase to rejection reworking, recalls, DNA rebooking, eligibility checks, at 20–30 pilot practices, priced $2–3k/practice/month
- ~1,000 practices on core; core approaching cash-flow positive (FY30 in the model)
- **Gate to Phase 3 (the Series A gate):** agent resolves **≥70% of administrative contacts end-to-end**; pilot practices measurably cut admin hours; NDIS attach ≥25% among allied customers. If the 70% number isn't real, Path A dies here and the company stays the profitable rail — that is a good outcome, not a failure

### Phase 3 — The agent becomes the product (FY30–31)
- Admin agent GA; ARPU migrates from ~$6k toward $30k+ for agent practices
- Path B widens: Support at Home and workers-comp modules (same engine, per the adjacency sequence)
- Series A ($15–30m) raised **on the agent metrics**, not the consent story — this is where the AI-category multiple attaches
- Core AoB+NDIS business cash-generative, funding the ramp
- **Gate to Phase 4:** $15m+ ARR with agent revenue the fastest-growing line; a referenceable claim like "practices on the agent run with one fewer FTE"

### Phase 4 — Shape decision (FY32–33)
- If agent metrics are exceptional → international with the **agent** (it travels; the consent engine doesn't), starting NZ via Medtech
- **Path C option call:** if the authority dataset covers 1m+ patients with clean safeguarding history, pilot the authority-verification API with one bank or aged-care group. Fund it only from strength
- If Phase 3 fell short → the fallback is explicit: a profitable $20–30m-revenue compliance rail sold strategically (Telstra Health, Tyro, NAB/HICAPS, a PE roll-up) at $100–250m. Every phase is designed so this remains true

**The discipline that makes the plan honest:** each gate is a number, each number is being instrumented from Phase 0, and the unicorn bets are only ever placed with the profitable core's money — never instead of it.

**One sentence of honesty to close:** the base plan is a very good business that is almost certainly not a unicorn; the unicorn versions require becoming a different, riskier company — and the only sound way to get there is to let the boring, profitable consent business pay for the attempts.

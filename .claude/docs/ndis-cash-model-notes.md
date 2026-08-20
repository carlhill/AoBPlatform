# NDIS Consent & Evidence Platform — Cash Model Notes
### Companion to `NDIS-Cash-Model.xlsx` · 20 August 2026 · Kept fully separate from the AoB model

---

## 1. What the product is here

Not assignment of benefit — the NDIS has no AoB. The product is **signed evidence of service delivery**:

- **Signed support logs** — the record-keeping rules already require participant / nominee / guardian signatures documenting individual supports delivered. Today that is paper. With 90% of claims reportedly lacking evidence and a new claims platform that will check every claim against service delivery records, this artefact is about to become the thing that determines whether a provider gets paid.
- **Service agreements** — e-signed, retained, with the prescribed SDA/SIL content where it applies.
- **7-year retention** and audit-pack export (pending Bill: new s45B, 120 penalty units).
- **Claim-to-record reconciliation** against the **90-day claim window** (from 1 Dec 2026) — the deadline-banded chase logic, with a far tighter clock than Medicare's 12 months.

## 2. The four scenarios

| Scenario | Y5 revenue | Y5 EBITDA | EBITDA+ from | Cash trough | Raise (incl. buffer) |
|---|---|---|---|---|---|
| 1 Standalone base (team 7→32) | $10.7m | $1.2m | Y5 | ($7.8m) | ~$8.4m |
| 2 Standalone lean (6→23) | $10.7m | $2.9m | Y4 | ($5.2m) | ~$5.8m |
| 3 **Shared engine** (4→18) | $10.7m | $3.7m | Y4 | ($3.8m) | ~$4.4m |
| 4 **Shared engine + plan-manager channel** | **$13.8m** | **$5.3m** | **Y4** | **($3.0m)** | **~$3.6m** |

The gap between scenario 1 and scenarios 3–4 is the entire adjacency argument in one number: **as a standalone company this is marginal; as a second product on an engine that already exists, it needs less than half the capital and turns profitable a year earlier.** The model keeps them separate so the difference is visible rather than assumed.

## 3. Customer segments and pricing

| Segment | Count | Price | Annual | Sanity check |
|---|---|---|---|---|
| Registered therapy orgs | 7,274 | $45/practitioner/mo × ~3 | $1,620 | 0.7% of their avg $225k NDIS billings |
| Unregistered solo therapists | 46,330 | $19/mo flat | $228 | ~1% of avg $22k billings — the practical ceiling for this tier |
| Support/SIL orgs | ~10,000 (estimate) | $600/mo avg, tiered by workforce | $7,200 | ~0.36% of a $2m org's revenue |
| Plan managers | ~1,100 (estimate) | $1,000–1,250/mo | $12–15k | Evidence checking on invoices from unregistered providers |

**Ceiling at 100% share: ~$107m ARR — roughly double AoB's $37.6–51.7m.** But the dominant line (support orgs, $72m of it) rests on two estimates stacked: the org count and the price. Treat the ceiling as $60–110m until both are tested.

## 4. What moves the answer (scenario 4)

| Lever | Change | Y5 EBITDA |
|---|---|---|
| **Adoption** | ±25% | **±$2.34m** |
| **Support-org price** | $400 vs $800/mo | ±$1.12m |
| Churn | 18% vs 12% | −$0.99m |
| Delivery cost | 25% vs 18% | −$0.96m |

Same ranking as AoB: adoption first, then the one price nobody has tested. **The support-org price is the single assumption to validate before anything else** — five conversations with SIL providers about what audit-proof evidence is worth to them.

## 5. Who the customers are, in the order I would call them

1. **Registered support/SIL organisations** — the money segment. Facing mandatory registration (SIL from Jul 2026, personal care and daily living Jul 2027), audits for the first time, thousands of support-worker shifts a month each needing signed logs, and the highest willingness to pay. Reachable through National Disability Services (NDS), the provider peak.
2. **Plan managers** — the aggregation channel, and the most interesting one. Plan-managed participants are the majority of the scheme; plan managers process invoices from the 46,000 unregistered providers and carry the risk of paying unevidenced claims. **One plan manager is a channel to hundreds of solo providers you could never sell to directly.** Peak body: Disability Intermediaries Australia (DIA).
3. **Registered therapy orgs** — your natural entry, because they overlap with the allied-health AoB buyer and already run Cliniko/Splose/Halaxy/Nookal. Same integration conversation, second schema.
4. **Unregistered solos** — self-serve only, $19/month, reached through plan managers and PMS marketplaces, never through direct sales.

## 6. Who to talk to in government

| Who | Why | How |
|---|---|---|
| **NDIA — Integrity Transformation** (John Dardo has been the public face — *verify current title*) | Owns the $3.7bn leakage problem and the claims-checking agenda. The pitch is the same as to Services Australia on AoB: providers should not be exposed to claims that fail evidence checks they cannot see | Via NDIA provider engagement; his parliamentary evidence (1 May 2026) is the reference point |
| **NDIA — new claims platform program** | The system that will "check every claim against service delivery records" from Jul 2026 rollout. The question to ask: *what evidence formats will the platform accept, and can third-party platforms submit evidence on a provider's behalf?* Watch AusTender for the procurement trail | Written enquiry; developer/API channel once published |
| **NDIS Quality and Safeguards Commission — Registrar** | Owns the mandatory-registration rollout and the practice standards. Two questions: whether signed support logs will be formalised as an audit expectation, and **whether a consent/evidence platform itself needs registering under the new "NDIS digital platform" class 0137** — that one is about us, not the customer | Commission enquiries; registration reform hub |
| **DSS — NDIS policy division** | Owns the Act and the pending Bill (s45B retention, 90-day window). The AoB-style question: how should the 7-year evidence obligation be dischargeable? | Written submission channel |
| **Ministers** — Health, Ageing, Disability and NDIS (Mark Butler); Minister for the NDIS (Jenny McAllister) — *verify current allocation* | Context only; policy engagement goes through the agencies | — |
| **Fraud Fusion Taskforce** | Not a sales target. Relevant only as the reason the market exists | — |

**⚠️ The class 0137 question is the one to answer first.** From 1 July 2026 "NDIS digital platform providers" must be registered with the Commission. If a consent/evidence platform falls inside that class, registration is a cost, a timeline and — once held — a moat. Nobody in the AoB work needed anything like it; this is NDIS-specific.

## 7. Verify before relying

1. **The Bill.** NDIS Amendment (Securing the NDIS for Future Generations) Bill 2026 passed the Senate 18 Aug 2026, awaiting House concurrence. Every retention and claim-window date depends on assent.
2. **Whether support logs will be formalised** in the new claims platform's evidence model — ask NDIA directly.
3. **Class 0137 applicability** to this platform.
4. **Plan manager count** (~1,100 is an estimate) and the support-org count (~10,000 derived, not published).
5. **The support-org price.** Five SIL-provider conversations before any deck shows $600/month.
6. Minister and Dardo titles — current as best known, unverified this week.

## 8. The one-line comparison with AoB

Same engine, same playbook, one difference in each direction: **the NDIS market is roughly twice the size and the integrity pressure is an order of magnitude louder — but the artefact is not yet prescribed by law, so the compliance argument is anticipatory rather than statutory.** AoB sells on "this is already the law." NDIS sells on "this is where the law is visibly going, and 90% of you cannot pass the check that is coming." Both are true; the second needs the first to have built the credibility.

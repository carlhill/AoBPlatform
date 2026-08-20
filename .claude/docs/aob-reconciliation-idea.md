# Business idea — Three-way reconciliation
### Claim ↔ Consent ↔ Payment · 19 August 2026

---

## 1. The gap this exploits

There are three separate ledgers, and **nobody reconciles all three**:

| Ledger | Held by | Records |
|---|---|---|
| **Consent** | AoBPlatform | Who agreed to what, with whom, and whether it is still live |
| **Billing** | The practice management system | What was claimed, for whom, by which practitioner |
| **Payment** | Services Australia processing and payment reports | What was assessed, what was paid, what was rejected and why |

Practices loosely reconcile billing against payment — the payment report tells them the deposit total. **Almost nobody reconciles consent at all**, for the simple reason that until now consent was a signature on paper and not a machine-readable record.

**We will hold the ledger nobody else has.** That makes three-way reconciliation uniquely available to this platform, and it is the single strongest reason the product is more than a form.

## 2. Why the regulator's weakness is the argument — carefully

The Philip Review found only 40 to 60 compliance projects a year against 511 million transactions, and that *"less than 10% of risks brought to the attention of regulators are progressed to some sort of treatment pathway."* Detection has been largely reactive — referrals and tip-offs — with proactive analytics still developing as at June 2024.

**That does not mean a practice's exposure is small. It means it is unrealised and unquantified.** And the direction of travel is clear:

- The claim lodgement window **halved to one year** in September 2025
- The September 2025 Act added **forgery and identity fraud** to pursuable offences, widened who can be compelled to produce information, and **removed restrictions on using review information as evidence** in prosecutions, debt recovery and practitioner-regulator proceedings
- **$146.8 million over four years** from 2026-27 for integrity capability, with **$674.1 million** in savings forecast over the same period — government has explicitly budgeted for finding more
- From 1 November 2026, further claim restrictions, system controls and fraud prevention measures on high-priced items

**So the pitch is arithmetic, not fear:** the gap between what is detected today and what will be detected in three years is the practice's unmanaged liability. Self-reconciliation converts it into a managed one, at a time of the practice's choosing rather than the regulator's.

## 3. What it finds

### A. Money the practice is owed and has not collected — the commercial hook

- **Agreements signed, never claimed.** The consent exists; the claim was never lodged. Pure lost revenue, invisible to every existing system.
- **Rejections never resubmitted.** A rejection code came back and nobody worked it.
- **Claims approaching the twelve-month cliff.** Ranked by days remaining. After that date the item is unbillable, permanently.
- **Paid less than claimed.** The processing report flagged a line where the benefit differed from the amount claimed, and nobody read it.
- **Bulk billing incentive not claimed** where the patient was eligible — worth $20.65 metropolitan, more in regional and remote areas.
- **Practice loading at risk.** The 12.5% BBPIP loading requires **every** GP to bulk bill **100%** of eligible services. A handful of privately billed items can forfeit an entire quarter for the whole practice. Surfacing that in week two rather than at quarter end is worth real money.

### B. Compliance exposure — the defensive value

- Claims lodged with **no valid agreement** on record
- Claims lodged against an agreement that had **already ceased** — the silent failure mode from the automatic cessation triggers
- Claims where the agreement **names a different practitioner** than the one who delivered the item
- Items falling **outside the basic service description** on a pre-agreement
- Enduring claims with **no 24-hour notice** dispatched, or dispatched by the wrong method
- **Retention gaps** — agreements not retrievable for the full two years

### C. Data quality

Orphaned agreements with no matching claim and vice versa; duplicates; contact-detail failures causing repeated notice non-delivery.

### D. Signals into the anomaly engine

Everything above feeds REQ-ANOM-01. A reconciliation exception is a fraud signal when it repeats.

## 4. Why it is commercially strong

- **It pays for itself in found revenue.** That converts the sale from a cost centre to a profit centre, and *"we found $X you had not claimed"* is the best renewal conversation available in any software business.
- **It is a natural annuity.** It runs every day, forever, and its value grows with the size of the consent ledger.
- **It is defensible.** A competitor without the consent ledger can reconcile two of the three at best.
- **It reframes the compliance conversation** from an unbounded worry into a specific, dated, actionable list.

### The land motion — an onboarding retrospective

Run the reconciliation over the practice's **last twelve months** at signup, before they have paid anything. Find the unclaimed items, the unresubmitted rejections and the claims about to expire.

That is the demonstration, the business case and the pricing justification in one artefact — and it is the most persuasive thing this product can put in front of a practice manager. **This is how you get into a Medtech practice that has never bought a point solution.**

## 5. Product shapes

| Shape | Cadence | Position |
|---|---|---|
| Continuous reconciliation | Daily | In the subscription |
| Onboarding retrospective | Once, at signup | Free — it is the demonstration |
| Deep reconciliation | Quarterly | Paid, or in a higher tier |
| Pre-audit readiness review | On demand | High value, pairs with the audit response offering |

## 6. Guardrails — non-negotiable

**⚠️ REQ-RECON-01 — The tool NEVER suggests a higher-value item.** Not a hint, not a "you may be eligible for", not a nudge. It reports what was consented and what was claimed. It does not optimise billing.

This matters more than any feature in the product. The same reconciliation engine pointed the other way is an **upcoding assistant** — and upcoding is the most-cited pattern in review findings. Building it, or being perceived to have built it, would end the company faster than any breach.

**REQ-RECON-02 — Never characterise a finding as fraud.** Report the discrepancy factually: *"claim lodged 14 March; no agreement on record."* Nothing more.

**REQ-RECON-03 — The practice decides what to do.** We surface, they act, with their own professional advice. We do not self-report on their behalf, and we do not report their findings onward. (Cross-practice **pattern** reporting under REQ-ANOM-04 is a separate thing, subject to human review, and it must not be confused with this.)

**REQ-RECON-04 — Findings are the practice's data.** They are not aggregated into a saleable product, and they are not used in marketing without specific consent.

**REQ-RECON-05 — Frame it as revenue assurance, not fear.** The first screen shows money found, not risk exposed. Both are real; only one of them makes a practice want to open the tool again next week.

## 7. What to say to a practice

> You already have three sets of records that have never been compared: what your patients agreed to, what you claimed, and what Medicare paid. We compare all three, every day. The first run usually finds items you were entitled to and never claimed, rejections nobody worked, and claims about to pass the twelve-month deadline. It also tells you where a claim went out without a valid agreement behind it — so you can fix that on your own timetable rather than someone else's.

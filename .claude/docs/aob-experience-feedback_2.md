# Feature plan — Patient and assignor experience feedback
### 19 August 2026 · Proposed add-on module

---

## 1. The idea, and where I would change it

**Your idea:** attach a short smiley-face questionnaire to the communication sent for enduring agreements, capturing how the patient found the care and how the assignor found the process.

**The instinct is right — the channel is the asset.** You will be the only party sending a message to a known assignor, about a specific service, within 24 hours of it being claimed. Nobody else in Australian primary care has that. Roughly **24 million such messages a year nationally by FY31**.

**But I would not put the survey on that message, and the reason is not cosmetic.**

### ⚠️ Why the reg 89AA notice is the wrong carrier

**1. It is a statutory notice, and adding commercial content puts its compliance at risk.**
Reg 89AA prescribes exactly what the notice must contain: practitioner name, patient name, date of service, benefit amount, sent by the method named in the agreement, within 24 hours. If the message becomes a survey with a notice attached rather than a notice, an auditor can reasonably ask whether the obligation was properly discharged. The notice must be identifiable *as* the notice.

**2. The assignor cannot opt out of the notice — so they cannot opt out of the survey either.**
That is coercive by construction. A person compelled by law to receive a message should not, as a consequence, be compelled to receive market research. This is exactly the pattern that generates complaints and regulator attention.

**3. Spam Act 2003 exposure.**
A statutory notice is not a commercial electronic message. Bolt a survey onto it and it may become one — which brings consent, sender identification and functional unsubscribe obligations that the notice itself does not have and cannot satisfy.

**4. The timing produces bad data.**
The notice says *"a claim for $65.70 was made in your name."* Asking "how did we do?" in the same breath, about a bill, conflates billing sentiment with clinical experience and will score the practice worse than the care deserved. The practice will not thank you for that, and the data will not be useful.

---

## 2. The design I would build instead

**Same trigger, same infrastructure, legally distinct message.**

| Surface | When | Why here |
|---|---|---|
| **Post-signature confirmation** | Immediately after the assignor signs an episodic agreement | The natural moment. The interaction just ended, we control the message entirely, and it carries no statutory obligation. **This is the primary channel.** |
| **Patient portal** | Passive, always available | Zero marginal cost, zero intrusion, and the patient chose to be there |
| **Periodic experience survey** | Consented, opt-out honoured, cadence set by the practice | The proper instrument for accreditation-grade feedback |
| **89AA notice** | **A single, unobtrusive, opt-outable link.** Nothing embedded, nothing required, no smiley faces in the notice body | Uses the reach without compromising the artefact |

**Two questions, not five.**

- *"How was your visit?"* — 🙂 😐 🙁, on the **patient's** experience of care
- *"How easy was this to complete?"* — 🙂 😐 🙁, on the **assignor's** experience of the process

Keep them separate and label them separately. They measure different things and a practice needs to be able to tell a clinical problem from an admin one. An optional free-text box, and nothing more.

**Rules that are not negotiable:**

- **Never sent to a confidentiality-flagged patient** (REQ-CHILD-02). Asking a 16-year-old to rate a sexual health consultation, on a device that might be shared, is the failure mode that ends the company.
- **Never sent during an active chase.** Someone being asked to sign is not being asked to rate.
- **Opt-out honoured permanently**, across every channel, per person not per practice.
- **In the patient's or assignor's language** (REQ-LANG-\*). A survey only English speakers can answer produces a biased score and tells the practice something false.
- **Responses are the practice's data.** Not aggregated into a saleable product, not used in marketing, consistent with REQ-RECON-04.

---

## 3. The commercial case that is actually strong

The direct subscription revenue is modest. **The reason to build it is accreditation.**

RACGP accreditation requires practices to seek and act on patient feedback on a defined cycle, using an approved tool or a documented alternative. Practices currently pay a third party for this, run it as a one-off exercise every three years, get a snapshot, and file it.

**A continuous feedback stream riding on a channel that already reaches every patient is a materially better product than a triennial survey — and it displaces a line item the practice already budgets for.**

⚠️ **Verify before building the pitch:** confirm the current criterion and whether continuous smiley-face feedback satisfies it, or only contributes to it. Speak to AGPAL and QPA directly. If it satisfies the requirement, this feature sells itself. If it only contributes, it is a nice-to-have and should be priced as one. **That single question determines whether this is a $49 or a $120 module.**

**Volume, for one 5-GP practice on the recommended design:**

| | Sends/month | Responses/month |
|---|---|---|
| Post-signature confirmations | ~1,122 | ~135 at 12% |
| Portal and periodic survey | ~198 | ~16 at 8% |
| **Total** | | **~150/month, ~1,800/year** |

Roughly 1,800 responses a year per practice, continuously, versus a snapshot every three years. That comparison is the sales pitch.

---

## 4. Pricing and the effect on the bottom line

Modelled as an add-on module on top of scenario 4. Delivery cost assumed at 18% of that revenue — it is messaging and storage on infrastructure that already exists.

| Price and attach | Add-on revenue FY31 | Total revenue FY31 | FY31 EBITDA | Cash trough |
|---|---|---|---|---|
| *Scenario 4 base* | *—* | *$16.21m* | *$3.28m* | *($5.72m)* |
| $49/practice/month at 40% | $0.87m | $17.08m | $3.87m **(+$0.59m)** | ($5.53m) |
| **$79/practice/month at 45%** | **$1.57m** | **$17.78m** | **$4.35m (+$1.07m)** | **($5.37m)** |
| $79/practice/month at 60% | $2.09m | $18.30m | $4.70m (+$1.42m) | ($5.26m) |
| $120/practice/month at 35% | $1.85m | $18.06m | $4.54m (+$1.26m) | ($5.31m) |

**Recommended: $79 per practice per month, priced as a module, not per practitioner.**

Feedback volume scales with patients, not with practitioners, and a per-practice price is simpler to sell and cheaper to explain.

### Does it improve the bottom line? Yes — by about a third.

At $79 and 45% attach it adds **$1.07m to FY31 EBITDA**, lifting it from $3.28m to $4.35m — a **33% improvement** — and takes $350k off the cash trough. That is more than the price lever ($10 per practitioner is worth $1.08m) and comparable to six staff.

**But the retention value probably exceeds the revenue.** Once a practice has eighteen months of experience trend data in your system, the switching cost is no longer the consent workflow — it is their quality history. That shows up as lower churn, and churn from 10% to 5% is worth **$0.85m of FY31 EBITDA** on its own. The two effects compound.

**And it strengthens the strategic story.** The thesis is a *consent and compliance record*, not an AoB form. Patient experience is a compliance obligation the practice already has, captured on infrastructure already built. It is the first proof that the platform extends beyond the wedge — which is precisely what the ceiling problem (see the cost model notes, §9) requires.

---

## 5. What it costs to build

Small. The infrastructure exists: messaging with delivery evidence, multilingual rendering, a patient portal, an audit log, per-practice data separation.

What is new: two survey components, a response store, an aggregation and trend view for the practice, an accreditation-format export, and opt-out plumbing that spans channels.

**A few weeks of engineering, not a quarter.** The expensive part is not the code — it is the accreditation verification in §3 and getting the consent and exclusion rules right.

---

## 6. What I would not do

- **Do not put smiley faces in the body of a statutory notice.** A link at the foot, opt-outable, is the limit.
- **Do not sell the aggregated data.** It is patient health information and monetising it would undercut the trust the whole product runs on. Same answer as the reconciliation findings.
- **Do not benchmark practices against each other publicly.** Privately, in their own dashboard, against a de-identified cohort, is fine and useful. A published league table makes you an adversary.
- **Do not let it become a five-question survey.** Every additional question halves the response rate, and the value here is continuous volume, not depth.
- **Do not report a score without the response count beside it.** Three responses is not a score, and a practice acting on three responses is worse off than one acting on none.

---

## 7. Actions

| # | Action | Priority |
|---|---|---|
| 1 | **Ask AGPAL and QPA whether continuous feedback satisfies the accreditation requirement or only contributes to it.** This determines the price. | 🔴 Do this before building |
| 2 | Confirm the current RACGP criterion for patient feedback and its cycle | 🔴 |
| 3 | Add the exclusion rules to the requirements — confidentiality flag, active chase, permanent opt-out | 🟠 |
| 4 | Design the 89AA footer link so a compliance reviewer would not mistake the notice for a survey | 🟠 |
| 5 | Model at $79 per practice per month, 45% attach, 18% delivery cost, in the cash model | 🟢 |
| 6 | Measure response rate by channel at the design partner before committing to the volume figures above | 🟢 |

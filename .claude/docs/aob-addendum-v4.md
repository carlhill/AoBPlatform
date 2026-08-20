# Addendum v4 — Automated-abuse controls, and the auto-roll question
### 19 August 2026

---

## 1. Bot and automation controls

Adopted, and worth separating from the safeguarding work in §3 of Addendum v3 — that detects *human* patterns of authority abuse; this detects *machine* activity. Different signals, different responses.

### 1.1 The threat

A practice with an integration, an API key or a scripted browser could create agreements at machine speed — mass-enrolling a patient list into enduring agreements, or manufacturing episodic agreements for items nobody consented to. At scale, the consent artefact is the only thing standing between a claim and an invalid claim, so the artefact is what an attacker would forge.

Two distinct cases, and they need different treatment:

| Case | Example | Response |
|---|---|---|
| **Legitimate high volume** | A genuine enduring enrolment campaign; an aged care session capturing 40 residents | Must not be blocked. Step up, do not stop. |
| **Automated fabrication** | 400 agreements in nine minutes for patients with no attendance history; identical signature strokes | Halt, quarantine, escalate |

**The whole design problem is telling these apart** — and volume alone cannot do it, because the legitimate case is also high volume.

### 1.2 Requirements

**REQ-BOT-01 — Velocity-triggered human verification, graduated.**
Interaction challenges are applied by risk score, not by raw count:

| Tier | Trigger | Response |
|---|---|---|
| Normal | Within baseline | No friction |
| Elevated | Rate above the practice's own baseline | Invisible checks — behavioural signals, timing, device attestation |
| High | Sustained above baseline, or a plausibility signal fires | Interactive human verification on the practice-side actor |
| Critical | Multiple signals concurrent | Capture suspended for that actor; practice principal alerted; nothing auto-reported |

**REQ-BOT-02 — Challenge the practice-side actor, never the patient.**
A patient signing on a tablet or a phone must never see a bot challenge. It suppresses conversion, penalises exactly the elderly and low-literacy cohort the product exists to serve, and is the wrong target — the abuse originates at the practice end, not the patient end.

**REQ-BOT-03 — Signature-authenticity signals.**
A drawn signature carries stroke timing, pressure where available, velocity and path entropy. Repeated near-identical strokes across different assignors, or strokes with no human timing variance, are strong automation indicators. Store the signals; never store a biometric template.

**REQ-BOT-04 — Device and session integrity.**
One device fingerprint signing for many unrelated assignors within a short window; sessions with no realistic reading interval between render and signature; headless-browser and emulator indicators.

**REQ-BOT-05 — Minimum dwell time.**
The signature control does not enable until the rendered agreement has been displayed for a minimum interval. Deliberately modest — long enough to make scripted signing detectable, short enough that a fast reader never notices. Configurable, and logged.

**REQ-BOT-06 — Campaign pre-declaration.**
A practice running a legitimate bulk enrolment declares it in advance: expected volume, patient list, practitioners, window. Declared campaigns run without friction and are fully audited. Undeclared bulk activity is what triggers escalation. This converts an ambiguous signal into a clear one, at almost no cost to an honest practice.

**REQ-BOT-07 — Rate limits per actor, per practitioner, per API key**, with a documented request path for a temporary lift.

**REQ-BOT-08 — Human review before any onward report**, per REQ-ANOM-05. Automated detection, human decision. Always.

**REQ-BOT-09 — Never expose the thresholds.** Anyone who can see where the line sits can stay under it.

**REQ-BOT-10 — Accessibility.** Any interactive challenge has a non-visual, non-auditory alternative and a staffed fallback. A challenge nobody can pass is an outage.

---

## 2. The auto-roll question — and a misconception worth clearing up

### 2.1 There is no annual re-consent requirement

The 358 million figure is **bulk-billed items per year**, each needing an agreement — not 358 million annual contracts. The distinction changes the answer completely.

| | Renewal position |
|---|---|
| **Episodic agreement** | Covers **one practitioner, one patient, one day**. It does not expire because it never had a duration. The next item needs a new one. |
| **6-month plan agreement** | Covers an enumerated schedule up to six months. Expires when the schedule ends. |
| **Enduring agreement** | **Runs indefinitely until terminated.** No expiry. No annual renewal. No re-signing. |

The only twelve-month clock anywhere in the regime is the **registration anniversary** for enduring agreements entered on or before 30 June 2027 — and that is a one-time act. Record it with Services Australia before the anniversary and it runs indefinitely. It is not a renewal cycle.

**So the thing you are describing already exists.** For general practice it is called an enduring agreement, and the legislature has already made exactly the judgement you were reaching for: most people don't change their GP, so let them consent once and be done.

### 2.2 Can episodic agreements auto-roll? No — and it isn't a policy question

An episodic agreement must contain **that item's particulars** — the date, the practitioner, and either the basic service description or the MBS item number — and must be signed by the assignor with those particulars complete before the claim is lodged.

An agreement that rolls forward to next year's unknown items cannot satisfy that. There is nothing to auto-roll onto: the required content does not exist until the item does. And the Department has already applied this logic at a much shorter horizon — a pre-agreement is void if the **date** changes, the **practitioner** changes, or the item falls outside the agreed description. A twelve-month roll-forward fails all three tests at once.

Building it would generate agreements that look valid and are not, across a patient's entire year. That is the worst possible failure mode: silent, systematic, and only discovered on audit.

### 2.3 Would auto-roll be a good idea even if it were allowed?

**For enduring agreements: the question doesn't arise** — they already run until terminated, which is better than annual renewal.

**For episodic: no, and not only because it's unlawful.** Consent that renews without an affirmative act is the pattern regulators across every sector have been moving against. Given this regime exists *because* the ANAO found legal risk in verbal consent, quietly reintroducing consent-by-inertia is the last place to innovate. It would also hand every critic of the product an easy line.

### 2.4 But your underlying observation is right, and it's a policy gap worth raising

The insight — *most people don't change their optometrist either* — is correct, and it exposes something real:

**A GP gets an enduring mechanism. A specialist, physiotherapist, optometrist or podiatrist gets nothing.** Optometry bulk-bills at roughly 94% with highly repeatable item patterns and long-term patient relationships. Allied health delivers 28 million Medicare attendances a year, often in structured courses of treatment. Neither has any relief mechanism at all, and both face permanent per-item capture.

There is no stated policy rationale for that boundary. Enduring agreements were introduced to reduce administrative burden — and the burden falls just as heavily outside general practice.

**This is a legitimate advocacy position, and it is better than a product feature.** Optometry Australia, the allied health peaks and the specialist colleges have the same interest. A vendor arriving with the operational detail — *here is the volume, here is the burden, here is what a workable mechanism looks like* — is a useful contributor to a conversation the Department has said it is having during the transition period.

**REQ-ROLL-01** Do not build episodic auto-roll. Add an explicit architecture decision record saying why, so nobody proposes it again in eighteen months.
**REQ-ROLL-02** Where a patient is enduring-eligible, actively surface it: *"This patient could sign once instead of every visit."* That is the compliant version of the same idea, and it is a conversion feature.
**REQ-ROLL-03** For non-eligible segments, make the **6-month plan agreement** the flagship — it is the longest lawful horizon available to them.
**REQ-ROLL-04** Track how much episodic volume in the customer base would be eliminated by extending enduring beyond general practice. That number is the advocacy case, and only a platform holding real agreements can produce it.

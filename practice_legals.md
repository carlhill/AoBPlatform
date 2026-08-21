# Practice legals — what a GP clinic must hold, and what we do with it

Compiled 21 August 2026. Scope: a standard 5-doctor general practice.

**Read this as a fraud document, not a compliance checklist.** We are not the
regulator and we do not police whether a practice holds these. The question
here is narrower and more useful: *which of these artefacts help us decide that
an applicant is who they say they are, and is entitled to act for the entity
they claim?*

⚠ **Verify anything here before relying on it commercially.** This is a working
summary, not legal advice, and several items vary by state.

---

## The fraud lens, first

Everything below sorts into three groups, and the sorting is the point.

**1. Things that verify a PERSON.** AHPRA registration is the only one that is
free, public and instant. It tells you Dr X exists and may practise. It tells
you *nothing* about a clinic — AHPRA has no record of a practice at all.

**2. Things that verify an ENTITY.** The ABN does this, and we already gate on
it. But an ABN is public, so it proves the entity exists and nothing about who
is applying on its behalf.

**3. Things that bind an ENTITY to an ADDRESS or an IDENTITY, verified by
somebody else.** These are the valuable ones, and they are the ones we use
least. A NASH certificate, an HPI-O, RACGP accreditation, an S4/S8 premises
permit — each of these exists because a third party already did organisation
verification, at a specific address, for a real clinic. **A fraudster cannot
obtain them by reading a public register.**

That is the whole asymmetry: what we can check cheaply (ABN, AHPRA) is public
and therefore weak evidence of entitlement; what would be strong evidence
(group 3) needs a manual check with a third party.

And the sharpest problem sits outside all three: **the Medicare provider
number, which matters most to us, is the artefact we can least verify.**
Services Australia publishes no lookup. We collect it, bind agreements to it,
and cannot independently confirm a single digit of it. That is precisely why
REQ-PKI-01 exists — the ceremony is the compensating control for a number we
cannot check.

---

## 1. Practitioner and individual licensing

| Item | Status | Why |
|---|---|---|
| **AHPRA registration** | ✅ **Using** | Free, public, instant. Verifies the person. Captured with status, per-type expiry, conditions, undertakings, reprimands, and principal suburb/postcode. A past expiry **never blocks** — AHPRA says such practitioners may still be practising. |
| **Medicare provider number** | ✅ **Using — but cannot verify** | Held per practitioner **per location** (FR-1.8), because the number is a property of a doctor *at a place*. **No public lookup exists.** We record it and never confirm it. See the note above. |
| **Prescribing authority (PBS / Authority)** | ❌ **Never** | Nothing in an assignment of benefit touches prescribing. Collecting it would be data we have no use for and a breach waiting to happen. |
| **Indemnity insurance (MDO)** | 🟡 **May — good fraud signal** | Every genuine practitioner carries it, and it is hard to fake because the MDO will confirm it. Worth asking for on a **high-risk** application, not on every one. |

## 2. Practice and facility approvals

| Item | Status | Why |
|---|---|---|
| **ABN / ACN, GST** | ✅ **Using** | ABN must be ACTIVE, the applied name must match a registered legal or business name, and the ACN is derived from the ABN rather than asked for. |
| **Council DA / CDC (Class 9a health premises)** | 🟡 **May — strong but slow** | Ties a **specific address** to approved health-service use, which is exactly our entitlement gap. But it is per-council, not centrally searchable, and slow to obtain. A last-resort check for a disputed application. |
| **Poisons / scheduled medicines permit (S4, S8)** | 🟡 **May — strong** | Issued by a state health department **to a premises**. Another entity-to-address binding a fraudster cannot manufacture. Not centrally searchable; verified by asking the state department. |
| **Radiation / equipment licence** | ❌ **Never** | Irrelevant to consent capture. |

## 3. Standards and scheme accreditation

| Item | Status | Why |
|---|---|---|
| **RACGP accreditation (AGPAL / QPA / GPA)** | 🟡 **May — the best practical option** | Practice-level, verifiable by asking the accrediting body, and commercially near-mandatory so most real practices have it. **Already an accepted credential type** in registration. Probably the first thing to promote from "may" to "using". |
| **PIP / WIP participation** | 🟡 **May** | Follows accreditation, so it adds little beyond it. `bbpipParticipant` is captured because BBPIP is all-or-nothing across a practice and affects bulk-billing behaviour — not as a fraud check. |

## 4. Operational and software compliance

| Item | Status | Why |
|---|---|---|
| **HPI-O** | 🟡 **May — strong** | Issued through the Healthcare Identifiers Service to a **verified organisation**. Already an accepted credential type. Someone has already done the identity work. |
| **NASH certificate** | 🟡 **May — strongest single artefact** | PKI issued by Services Australia to an organisation that has already passed their verification. A practice holding a valid NASH certificate has been vetted by the Commonwealth. Hard to fake, meaningful to check. |
| **PRODA / HPOS** | 🟡 **May** | The identity rail Services Australia itself uses, with organisation accounts and delegation — the precedent our org model follows. We cannot verify someone's PRODA account externally today. |
| **My Health Record / HI Service** | ❌ **Never (as a check)** | Out of frame: we hold the consent record, not clinical data. |
| **Privacy / Australian Privacy Principles** | ✅ **Using — but it is OUR obligation** | Not a check on the practice. It is why there is no Medicare number anywhere in this system, why verification logs store identifier *types* and outcomes but never values, and why G-NAF is held locally rather than sending addresses offshore. |

---

## What this suggests we should actually do

1. **Promote RACGP accreditation from "may" to "used"** for any application
   where the phone check is inconclusive. It is practice-level, verifiable,
   and most real practices have it.
2. **Ask for NASH or HPI-O on high-risk applications.** Both mean the
   Commonwealth already verified the organisation. Neither is obtainable by
   someone who has merely read an ABN off a public register.
3. **Never collect prescribing, radiation or My Health Record artefacts.**
   They answer no question we are asking, and holding them is pure liability.
4. **Keep the provider number honest about its own weakness.** We cannot verify
   it. Everything that binds to it — the enrolment ceremony, anomaly detection,
   the immutable agreement anchor — exists because of that, and any future
   claim that we "verify provider numbers" would be false.

## Where this connects

- The entitlement problem — the applicant's right to act for the entity — is
  [ORG-MODEL-PROPOSAL.md §11](ORG-MODEL-PROPOSAL.md). The credential captured
  at registration (`ahpra` / `hpio` / `accreditation`) is the hook for
  everything in groups 2 and 3 above.
- REQ-PKI-01, the practitioner enrolment ceremony, is the compensating control
  for the unverifiable provider number.
- The AHPRA capture rules, including why a past expiry is never a block, are in
  `packages/domain/src/ahpra.ts`.

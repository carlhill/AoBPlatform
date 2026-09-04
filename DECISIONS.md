# Decisions

A running log of product and regulatory decisions taken in working sessions,
each dated and attributed, with the requirement it rests on and what would
reopen it. Earlier decisions live in `.claude/docs/aob-design-decisions.md`
(19 Aug 2026) and are cross-referenced from `TODO.md`; from 4 Sep 2026 new
decisions are recorded here first.

Format: **what was decided · who · when · why · what changes it.**

---

## D-2026-09-04-01 — Verification stays at three identifiers; two is not enough

**Decided:** A patient verifying themselves on the kiosk must match **three**
approved identifiers. Family and given names together count as **one**, so
name + date of birth is two, and a failed address is a failed verification —
the patient is told the generic "some details don't match" and, after three
attempts, to see reception. The floor is not lowered for the in-practice
kiosk. — Carl Hill, 4 September 2026, after asking whether name + DOB with a
non-matching address was "enough of a security check".

**Why:**
- RACGP *Standards for General Practices* 5th ed., criterion C6.1, indicator
  C6.1A: a minimum of **three** approved patient identifiers, explicitly
  including identification "over the telephone or electronically". Adopted as
  REQ-VER-01. The identifier set is configurable per practice but the floor of
  three is not (REQ-VER-03; C4.3 default 3).
- Name is one identifier, not two (REQ-VER-02: "family + given names together
  count as one").
- A screen we design that passes a patient on two matches would put the
  practice below the accreditation standard it is assessed against.

**What we do instead of lowering the bar:**
- Address is the identifier most likely to fail for non-identity reasons
  (abbreviations, a moved patient, a stale PMS line). The match is already
  component-based (`addressMatches`, 3 Sep 2026); the address-validation
  service on the TODO (G-NAF / PAF canonicalisation of both sides) completes
  it. A genuine patient with an out-of-date address still fails — correctly —
  and reception updates the record.
- In the reception-push flow the patient types nothing: staff performed the
  three-identifier check across the counter and the push records it as the
  staff-verified verification event (REQ-VER-03, REQ-VER-04). Kiosk address
  mismatches therefore only affect unsupervised walk-ups, for whom "see
  reception" is the right outcome.

**What would reopen it:** the RACGP 6th edition. The draft (Sept 2025
consultation) appears to require a minimum of **two** identifiers (criterion
renumbered CG2). It is not in force, the 5th edition remains the accreditation
standard, and that reading is single-sourced from a machine read of the draft
PDF (REQ-VER-06) — it must be verified page by page before it appears in any
customer-facing claim. If it lands as read, the floor becomes a practice
setting with a default of two, and name + DOB becomes a legitimate
configuration. Until then: three.

**Where it is enforced:** `apps/core/src/verification/identifier-matching.ts`
(`evaluateChallenge` — every challenged type must match; no partial pass),
`apps/core/src/kiosk` (`POST /kiosk/claim` evaluates all three), the
practice's `identifierTypes` setting (floor enforced server-side). Named test
to add: `two_matching_identifiers_do_not_pass` (see TODO).

---

## Index of decisions taken 3–4 September 2026 (recorded in TODO.md at the time)

| Date | Decision | Where |
|---|---|---|
| 3 Sep | Name rule: family name + first given name, any order | TODO "The practice flow" (a) |
| 3 Sep | No QR card; post-service approval is a second push to the reception tablet | TODO "The practice flow" (b, reversed) |
| 3 Sep | The agreement gates the claim, never the consultation | TODO "The practice flow" (c) |
| 3 Sep | Zero-footprint kiosk: nothing installed on or written to the device but one pairing credential | CLAUDE.md §7; TODO |
| 3 Sep | C2.2 offline-first withdrawn; C2.3 tightened; C2.5 RACF batch mode → roadmap | `.claude/docs/AoB_requirements.md` |
| 3 Sep | Kiosk folds into `apps/web` (Next.js); Expo retired | CLAUDE.md §4/§7; TODO |
| 3 Sep | Choose tech for iteration speed; option lists are content files | CLAUDE.md §7 |
| 3 Sep | Nothing on the patient surface is ever staff entry; a mismatch stays on K-2 | TODO |
| 4 Sep | Two front doors: walk-up kiosk stays; reception push is its own use case | TODO "Two front doors" |
| 4 Sep | Walk-up list is testing-only (per-device console flag); Begin → confirm details; no count | TODO |
| 4 Sep | Verification stays at three identifiers | **D-2026-09-04-01 above** |

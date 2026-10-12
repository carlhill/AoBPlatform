# Brief: telehealth "went ahead", the Telehealth register, and DB4 matching

Written 12 Oct 2026 for a fresh session. Decision: `DECISIONS.md` D-2026-10-12-03
items 6-8 (Carl). Plan context: `TELEHEALTH-PLAN.md` sections 3, 5 and 8 (this
is section 8 steps 3 and 4 with Carl's reception-confirms rule added).

Every build: Postgres in Docker, schema changes only as Prisma migrations, test
data in the seed script, all committed, README/test_scripts.md updated with the
one-command run. Branch from `main`, one PR per piece, merge green the same day
(CLAUDE.md). Stop and report when weekly usage reaches 90%.

## Read first
- `CLAUDE.md` hard rules (esp. 8 never block care, 9 types never values,
  11 write and vault event in one transaction, 13 one render path, 14 templates
  are versioned).
- `apps/core/src/telehealth/` (service, evidence, dispatcher) and
  `apps/web/app/practice/practitioner/telehealth/TelehealthPanel.tsx`.
- `ROLES.md`, `PRACTICE-SURFACES.md`, `PRACTICE-NAVIGATION.md` for how a page
  gets a role and a surface.
- `DB4-AND-AOBL.md` and the AOBPRINTER print-job model for unmatched DB4s.
- `wow.md` (ways of working), `TESTING-GUIDE.md`, `test_scripts.md`.

## Piece 1: "went ahead" - BUILT 12 Oct 2026, skip it
Built in the session that wrote this brief: state `went_ahead` (migration
`20261012020000_telehealth_went_ahead`), vault type `telehealth.consultation_held`,
`POST /telehealth/sessions/:id/went-ahead`, the "Consultation complete" button on
an agreed session, and "Your telehealth consultation is complete" on the
patient's page. Open: whether "complete" should also follow `not_done`.

## Piece 1 as originally briefed (for reference)
- Migration: add `went_ahead` to `telehealth_sessions_state_check`.
- Add `telehealth.consultation_held` to `VAULT_EVENT_TYPES` (packages/contracts)
  and to `TELEHEALTH_EVENT_TYPES`; payload `fromState`, `consultationAt`,
  `recordedAt`; actor practitioner. Mirror `markDidNotProceed`.
- `POST /telehealth/sessions/:id/went-ahead`, allowed from `agreed` (and from
  `not_done`, where the step before was skipped but the consultation happened:
  confirm with Carl if unsure, record as an assumption).
- Panel: on an agreed session, two buttons "Consultation went ahead" / "did not
  go ahead". Named tests for the transaction (write + vault event together).
- Note: the vault container must be REBUILT to accept the new type
  (`docker compose up -d --build vault`), and see TODO.md for the vault
  state-folder issue that a rebuild re-triggers.

## Piece 2: the Telehealth register page (item 7) - FRIDAY 16 OCT (TODO.md)
Carl, 12 Oct 2026, added: each row opens the same detail view as the doctor's
side panel (`SessionDetails` in `TelehealthPanel.tsx`, `GET /telehealth/sessions/:id`,
both built 12 Oct): record and contact read now, kinds checked, who was on the
call, carer name and mobile; for a call-back in an emergency. The register's
version of that endpoint must widen past "my own sessions" only for the role
that grants the register. Link to the register from the doctor's telehealth page.
- A new role grant for "Telehealth register" (follow ROLES.md); reception and
  practice manager hold it; a practitioner sees their own sessions only,
  enforced server-side, not by hiding rows.
- `GET /telehealth/register?q=&practitionerId=&from=&to=&state=&match=` paged,
  practice-scoped through RLS.
- Page under `/practice/telehealth`: search by patient name or record number,
  doctor, date range, status, DB4 match status. Show values on screen only;
  nothing new is stored.

## Piece 3: DB4 matching, reception confirms (item 8)
- Suggest: the first DB4 print job for the same patient printed after the
  session's `agreedAt` (and the same provider when the DB4 names one), not
  already matched. Never final without a person.
- Reception confirms on the register row; the manual route is a pick list of
  that patient's UNMATCHED DB4 print jobs (no typed PMS id).
- On confirm: link print job and session in one transaction with a vault event
  (a new type needs Carl's approval: propose `telehealth.db4_matched`, actor
  staff, payload sessionId, printJobId, how = suggested|picked; ask before
  wiring), mark the agreement `deliveryMode: telehealth` so the Signed-DB4 says
  TELEHEALTH, then send the DB4 to the patient by the existing link path
  (D-2026-10-12-01).
- Unmatch/rematch before signing; never after a signature.

## Open for Carl (ask, do not assume)
- Matching window: same day only, or N days?
- Does "went ahead" also apply after "not done"?

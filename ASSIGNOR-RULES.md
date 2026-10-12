# ASSIGNOR-RULES.md — who signs, how they are reached, and what may change after the lock
### v1.0 · 11 September 2026 · Owner: Carl. Companion to CLAUDE.md §2 (hard rules 2, 10, 13) and DECISIONS.md D-2026-09-07-01, D-2026-09-10-01, D-2026-09-11-01. Product rules for the assignor block; the regulatory facts they rest on are cited, never restated.

## 1. Two kinds of fact on a "someone else is signing" record

| Fact | Fields | Nature | Rendered into the agreement artefact? | After the lock |
|---|---|---|---|---|
| **Who signs** | `assignorIsPatient`, name, relationship to the patient, authority basis and note, the 18+ attestation | A particular of the agreement (D7; REQ-REG-06, hard rule 2) | Yes — name and relationship are in the s 65C particulars (`packages/domain/src/agreement.ts`) and hashed at render (hard rule 13) | Changes only by **supersession**: a new agreement carrying `supersedesAgreementId`, validated and rendered from scratch; the old one untouched |
| **How they are reached** | mobile, email, preferred channel | A delivery detail: how the signer's copy of the agreement reaches them | No — the render path carries only the practice letterhead's phone and email (verified 11 Sep 2026) | Changes **in place** on the signer record, with its own vault event; the agreement, its render and its hash are untouched (D-2026-09-11-01) |

The distinction is mechanical, not a judgement call: `classifyAssignorChange(current, requested)` in `packages/domain/src/assignor.ts` returns `party`, `contact_only` or `none`, and the server acts on that answer. Nothing else decides.

## 2. Rules

1. **Who signs is confirmed before a push, never assumed.** "The patient is signing" is the default on every agreement and is indistinguishable from a confirmed answer, so reception's Save records `assignorConfirmedAt`/`By` and emits `agreement.assignor_confirmed`. The tablet push refuses `assignor_not_confirmed` until then; the console's ①→②→③ strip makes step one the only live control until it is done. (Carl, 7 Sep 2026.)
2. **A party change after the lock supersedes.** Same answer as a wrong name or address on a locked agreement. The superseding agreement inherits the confirmation through the Save that created it, never by copy. Asking twice supersedes once: the same whole answer on a superseded row returns the existing successor.
3. **A different answer on a superseded row is refused, never silently absorbed.** `successorAlreadySays` compares the WHOLE answer — isPatient, normalised name, relationship, basis, note, mobile, email. Anything else is `409 agreement_moved_on`, and the console re-reads so reception is editing the newest agreement in the chain. (Bug fixed 10–11 Sep 2026, `ef632b5`: it used to compare the name only, so a mobile change vanished.)
4. **A superseded agreement leaves the desk.** Pushable rows and Send-again rows never show an agreement that another agreement supersedes; its successor takes its place.
5. **A contact-only change never supersedes.** Mobile and email are updated on the agreement's current signer record with `assignor.contact_changed` {agreementId, assignorId, changedBy, fields: names only}. Works on locked and unlocked agreements, but only on the newest member of a chain (rule 3 otherwise). Never the values in the event (hard rule 9).
6. **The patient's own contact does not live here.** When the patient signs for themselves, mobile and email belong to the patient record (the PMS is the source of truth, REQ-DATA-10). A contact change on a patient-signer is refused with `patient_contact_lives_on_the_patient_record`, and the fix is the details correction panel, not this one.
7. **Rule 10 runs before every write, on every path.** Practice-staff hard-block, 18+ for anyone acting for another, 14+ self-assign; the UI never asks staff to assess capacity, and no copy anywhere uses capacity language. A refused party confirms nothing and supersedes nothing.
8. **Each Save creates a fresh signer record.** Nothing is shared by name across agreements or patients. A carer signing for two patients is two records (a one-record-per-carer model is an open question — TODO).
9. **The console remembers a draft across Close, in memory only** (D-2026-09-10-01), until it is saved, pushed, the row leaves the list, the practice changes or the page is left. Reopening a saved someone-else shows what was saved, including contact; the 18+ attestation is shown as given, not asked twice.
10. **Save says which box.** A missing 18+ tick, name or relationship marks the field, puts the reason beneath it and moves focus there. Save is never a greyed button with small print beside it.

## 2a. Somebody who is both staff and patient (Carl, 12 Sep 2026: "Jo is both — this is a special case")

Practitioners and receptionists get treated too, often at the practice they work
at. The staff hard-block must not stop them consenting to their own bulk
billing, and it does not — but the reason is worth stating, because the rule
reads at first glance as though it might.

**Signing for themselves: allowed, and untouched by the block.** The check lives
inside `buildAssignorForAnother`, the path taken only when the signer is NOT the
patient. A patient self-assigning never reaches it. That is the right reading of
hard rule 10: the block exists to stop a practice's own people signing on behalf
of patients, which is where the coercion and fraud risk sits, not to deny staff
the ordinary right to assign their own benefit.

**Signing for anybody else: blocked, exactly as for any other staff member.** A
doctor cannot sign for their own patient, their colleague, or a family member
seen at the practice they work at. `matchesPracticeStaff` compares normalised
names against every name the practice knows, active or not, and fails closed.
There is no override and none should be added.

**The consequence to watch.** The block matches on NAME, so a staff member and
an unrelated patient who share a name are treated as the same person, and the
patient loses the ability to sign for their child. That is the deliberate
fail-closed choice, and the way out is the desk, not a switch.

Named tests: `staff_assignor_still_hard_blocked_after_lock`, and a case for this
section — `a_staff_member_may_still_sign_their_own_agreement`.

## 3. Where each rule is enforced

| Rule | Code | Named tests |
|---|---|---|
| 1 | `agreements.service.ts` Save paths; `tablet-sessions.service.ts` push refusal; `pushDesk.tsx` `SendSteps` | `push_refused_until_who_is_signing_is_confirmed`, `confirming_the_patient_records_who_confirmed_and_when`, `assignor_confirmed_event_carries_ids_only`, `send_and_tablet_select_are_dead_until_who_is_signing_is_saved` |
| 2 | `supersedeForAssignorChange`, `createSupersedingDraft` | `who_is_signing_on_a_locked_row_supersedes_rather_than_edits`, `concurrent_who_is_signing_supersedes_once`, `reverting_to_the_patient_after_the_lock_evidences_the_confirmation` |
| 3 | `successorAlreadySays`, `assignorRepointDisposition` | `a_contact_change_on_a_superseded_row_is_not_a_repeat`, `the_same_answer_twice_still_supersedes_once`, `who_is_signing_refused_when_signed_between_read_and_write` |
| 4 | `tablet-sessions.service.ts` row queries | `a_superseded_agreement_leaves_the_desk_and_its_successor_takes_its_place` |
| 5 | `classifyAssignorChange`; contact-only branch of the assignor endpoint | `a_contact_only_change_updates_the_signer_and_does_not_supersede`, `a_party_change_after_the_lock_still_supersedes`, `contact_change_on_a_stale_chain_member_is_refused_as_moved_on` |
| 6 | same endpoint | `contact_change_on_the_patient_signer_is_refused` |
| 7 | `buildAssignorForAnother` | `staff_assignor_still_hard_blocked_after_lock`, the REQ-VUL-05 capacity-language test |
| 9–10 | `pushDesk.tsx` who panel | `closing_the_who_panel_keeps_what_was_typed`, `reopening_shows_the_saved_someone_else_not_the_default`, `save_with_no_18_plus_tick_marks_the_box_and_focuses_it`, `reopening_prefills_mobile_and_email_from_the_row` |

Partial unique index `agreements_one_successor` on `supersedesAgreementId` backs rules 2–3 at the database.

## 4. Open questions

- One signer record per carer per practice, reused across patients (rule 8)? Needs a second identifier to match on and a privacy view; Carl to decide.
- ~~Whether a contact-only change should be offered on the tablet (patient surface) as well as the desk.~~ ANSWERED NO, 11 Sep 2026 (D-2026-09-11-03): the tablet offers to send to the contact on file and never accepts a new one; a wrong address is reception's to fix at the desk. Asked by W6 "send me a copy".

## Change log
| Date | Change |
|---|---|
| 11 Sep 2026 | v1.0. Written when contact-only changes stopped superseding (D-2026-09-11-01). Collects the rules built 7–11 Sep 2026. |
| 11 Sep 2026 | §4 open question closed: no contact typing on the tablet (D-2026-09-11-03). |
| 12 Sep 2026 | §2a: somebody who is both staff and patient — self-signing is allowed, signing for another is blocked. |

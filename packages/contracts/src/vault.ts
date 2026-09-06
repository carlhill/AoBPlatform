/**
 * FR-11.1 — the Evidence Vault event contract.
 *
 * ⚠ HUMAN-AUTHORED ZONE: the vault service implementation (hash chain, immudb,
 * anchoring, key management) is written and reviewed by humans (CLAUDE.md §7).
 * This file defines only the append-only event shape and the client contract.
 *
 * Structural guarantees (rule 11, ADR A-02):
 *  - The vault API has NO update and NO delete endpoint — note the interface
 *    below simply has no such method. Deletion is crypto-shredding + tombstone.
 *  - Domain writes and vault events commit via the outbox pattern (FR-11.2):
 *    the outbox row is inserted in the SAME transaction as the domain write;
 *    a relay publishes it. One without the other is structurally impossible.
 *  - Events carry no plaintext identifiers (REQ-LOG-08): reference records by
 *    ID, never by content.
 */
import type { IsoTimestamp, VaultEventId } from '@aobplatform/domain';

/**
 * Event type registry. Extend by adding literals here AND to the vault
 * service's runtime whitelist — never cast. (Lesson inherited from
 * ReferralPlatform: casts silenced the compiler while the service rejected
 * the event with 400, and evidence went unrecorded.)
 */
export const VAULT_EVENT_TYPES = [
  'agreement.created',
  'agreement.particulars_locked',
  'agreement.rendered',
  'agreement.signed',
  'agreement.validated',
  'agreement.stored',
  'agreement.written_back',
  'agreement.status_changed',
  /**
   * WHO SIGNS CHANGED, before the particulars were locked — the patient was
   * the default and somebody else is actually signing, or the reverse.
   *
   * Recorded because D7 is a particular, and "this agreement was always going
   * to be signed by the child's mother" and "it was re-pointed at her thirty
   * seconds before it locked" are different histories that the agreement
   * itself cannot tell apart. The payload carries the authority basis and the
   * TYPE of contact channel — never the name, never the number or the address
   * (REQ-LOG-08, REQ-VER-04): identifiers stay in the encrypted store.
   */
  'agreement.assignor_changed',
  /**
   * D6a WAS CHOSEN — the Basic Service Description a pre-agreement needs, set
   * on a STAFF surface before the particulars were locked (hard rule 2), or
   * written by the appointment sweep from the practice's own default.
   *
   * Recorded because it is the one particular no PMS field determines while
   * the MBS mapping does not exist, and "a receptionist chose these words at
   * 8:42" and "the platform applied the practice's standing default" are
   * different histories the agreement cannot tell apart afterwards. The actor
   * is the staff member's subject id for the first and the system for the
   * second — never a name typed into a form. The payload carries the
   * description, which is a contractual particular rather than an identifier,
   * and the VERSION of the list it was chosen from (hard rule 14) so a
   * question asked in 2028 has an answer.
   */
  'agreement.service_description_set',
  /**
   * AN AGREEMENT FOR TODAY'S VISIT WAS OFFERED IN PLACE OF AN ONGOING ONE
   * (Carl, 5 Sep 2026).
   *
   * The sibling of `tablet.episodic_offered_after_decline`, and a different
   * fact: there the PATIENT read the ongoing agreement and said they would
   * rather agree each visit; here the ongoing agreement could never be put in
   * front of them at all, because the s 65C rule set's enduring branch is not
   * authored yet (a human-authored zone, CLAUDE.md §7). Reception answered the
   * block by asking for this visit instead. Folding the two into one type
   * would make "the patient declined" and "we could not ask" indistinguishable
   * in the evidence, which is the one distinction somebody would want.
   *
   * THE ENDURING DRAFT IS NOT TOUCHED and the payload names it for that
   * reason: it stays, at its own status, as the record of what was offered
   * (hard rule 11 — the vault is append-only, and a draft is not deleted
   * because it was overtaken).
   *
   * AGREEMENT IDS AND NOTHING ELSE. What the replacement says, when its
   * description of the service was set and when its particulars were locked
   * are already `agreement.created`, `agreement.service_description_set` and
   * `agreement.particulars_locked` on the new agreement; repeating them here
   * would be two records of one fact. No patient, no identifier, no amount
   * (REQ-LOG-08, hard rules 1 and 4).
   */
  'agreement.episodic_offered_instead',
  'agreement.superseded',
  'agreement.ceased',
  'agreement.terminated',
  'verification.attempted',
  'verification.locked_out',
  'capture.requested',
  'capture.link_opened',
  'capture.completed',
  'capture.cancelled',
  'capture.expired',
  /**
   * The cascade looked at a service or an appointment and decided NOT to ask
   * the patient for anything — covered by an enduring agreement, a
   * confidentiality flag, the lodgement window closed, no way to reach them,
   * or the assignor is a choice a human has to make. Recorded because a
   * decision and a silence look identical in a table, and "why was this
   * patient never asked" is a question somebody will put to the evidence.
   */
  'capture.suppressed',
  /**
   * A PATIENT WALKED UP TO RECEPTION (Carl, 4 Sep 2026; TODO.md
   * "Reception-centric" §2).
   *
   * Evidence rather than telemetry, and for two reasons. First, it is the
   * moment the platform's mirror of the five details was refreshed from the
   * PMS, which is the source of truth (REQ-DATA-10) — so "why does our record
   * say this address" has an answer with a time on it. Second, it carries the
   * DECISION and the VERSION of the policy that made it (hard rule 14): what
   * this visit needed signed was decided by our own rule table, not by the
   * practice's software, and in 2028 somebody will ask which table.
   *
   * WRITTEN IN THE SAME TRANSACTION AS THE ARRIVAL ROW (hard rule 11, FR-11.2),
   * so an arrival with no record of having been received is structurally
   * impossible.
   *
   * THE PAYLOAD CARRIES NO VALUE. Ids, the decision, the policy version, and
   * the detail TYPES that changed on the mirror — `address`, `mobile` — never
   * the old value and never the new one (REQ-VER-04, REQ-LOG-08). No Medicare
   * number appears because none is ever held (hard rule 1), and no amount
   * appears because an arrival is a person at a desk, not a claim (hard rule 4).
   */
  'arrival.received',
  /**
   * THE ARRIVAL NAMED SOMEBODY WHO CANNOT BE THE PROVIDER (Carl, 5-7 Sep 2026).
   *
   * A practice nurse, a phlebotomist -- somebody whose billing role at this
   * location says the claim does not go under their number. It is refused, and
   * reception picks the provider it does go under. Recorded because the
   * connector's mapping being wrong is a fact about an onboarding, and because
   * the arrival that was later accepted for the same walk-in should be
   * traceable back to the one that was not.
   *
   * NO PATIENT VALUE, as with `arrival.received`: ids, the reason code, and
   * the role that produced it.
   */
  'arrival.refused',
  'signature.captured',
  /**
   * FR-7.3 — a person decided what happens to a service that never got its
   * agreement: convert to private billing, forgo the benefit, or keep
   * chasing. Nothing happens by default; the choice, the chooser and the
   * reason are the record.
   */
  'reconciliation.decided',
  /**
   * A PERSON at the practice chased the patient — rang them, texted them,
   * caught them at the desk, put a letter in the post — and said what came of
   * it. The platform's own attempts are already evidenced by
   * `capture.requested` and the correspondence rows; this is the half that
   * happens off the platform, and without it a practice that chased
   * diligently and still got nothing has no evidence it tried. Payload
   * carries channel, outcome and the band at the time — never a number, an
   * address, or a note's text.
   */
  'chase.attempted',
  'notice.composed',
  'notice.dispatched',
  'notice.delivered',
  'notice.failed',
  'notice.corrected',
  'agreement.terminated',
  'artefact.accessed',
  'artefact.exported',
  'retention.expiry_scheduled',
  'retention.crypto_shredded', // tombstone — the chain stays intact
  'legal_hold.applied',
  'legal_hold.released',
  'nomination.changed',
  // Organisation and affiliation lifecycle. An affiliation ending is a
  // consent-relevant event — enduring agreements cease with it (65CA(8)) — so
  // it is evidence, not merely an admin action.
  /**
   * The practice chose the Basic Service Description to use when the PMS
   * supplies no appointment type — a standing setting that decides a
   * particular of every pre-agreement drafted afterwards, which is why it is
   * evidence rather than configuration. Carries the list version it was chosen
   * from, and the staff member who chose it.
   */
  'practice.default_service_description_set',
  'organisation.registered',
  'organisation.validated',
  'organisation.rejected',
  /**
   * The Australian Business Register was asked AGAIN about a practice already
   * on the platform, and answered.
   *
   * Evidence rather than housekeeping, for two reasons. An ABN check is a fact
   * about a day: "ACTIVE when we approved them" and "ACTIVE last Tuesday" are
   * different claims, and only the events say which one the record rests on.
   * And a re-check can UPGRADE PROVENANCE — an entity verified by a typed
   * attestation during an ABR outage becomes one verified by the register
   * itself — which is a change in the strength of the evidence and must be
   * visible as one.
   *
   * Only written when the register actually answered. A failed re-check says
   * nothing about the entity and writes nothing.
   */
  'organisation.abn_rechecked',
  /**
   * Contact details corrected AFTER approval. A separate event from
   * `organisation.registered` on purpose: this changes the record of who was
   * approved, and it has an author and a stated reason that the original
   * registration does not.
   */
  'organisation.contacts_changed',
  /** The sign-in invitation sent again, after the one at approval failed. */
  'organisation.invitation_resent',
  /**
   * The practice administrator CHANGED — a handover, not a contact
   * correction. The outgoing account is disabled, so this event is the record
   * that somebody lost access and who decided it.
   */
  'organisation.admin_handover',
  /**
   * Practice structure and evidence. Every one of these used to happen
   * silently: a location added with an unrecognised address, a department, a
   * credential offered, and a credential REMOVED — the last by hard delete.
   */
  'location.added',
  'department.added',
  'credential.added',
  'credential.removed',
  'location.activated',
  // A reviewer looked and declined to confirm, with a reason the practice can
  // act on. Recorded because deciding NOT to confirm is a decision, and an
  // audit trail that only records approvals cannot show what was scrutinised.
  'location.address_rejected',
  // The practice answered, by correcting the address itself.
  'location.address_corrected',
  // Console access at a practice: who was given it, what changed, and when
  // it was withdrawn. Deactivation is recorded and DELETION IS NOT POSSIBLE —
  // somebody who approved or confirmed something must stay identifiable for
  // as long as that record matters, which outlasts their employment.
  'practice_user.granted',
  // Distinct from `granted`, because they are distinct acts: granting
  // records that somebody may sign in, inviting is us writing to them with
  // the means to. Somebody can be granted and never invited, which was
  // exactly the state the user list used to misreport as "invited".
  'practice_user.invited',
  'practice_user.role_changed',
  'practice_user.deactivated',
  'practice_user.reactivated',
  // A platform operator wearing a practice's face, and stepping out of it.
  // Every event caused inside a session also carries actingAsSessionId, added
  // ambiently so no call site can forget it.
  'acting_as.started',
  'acting_as.ended',
  /*
   * A TABLET WAS GIVEN, OR LOST, THE ONE CREDENTIAL IT MAY HOLD.
   *
   * Evidence rather than configuration, and the reason is REQ-SIG-02: every
   * signature event already binds a `deviceFingerprint`, and until now that
   * fingerprint referred to nothing — a string with no registry behind it. A
   * device that was registered by a named person, paired at a known moment and
   * revoked at another turns it into a fact somebody can put a question to in
   * 2028: which tablet was this signed on, who put it there, and was it still
   * the practice's at the time?
   *
   * THE PAYLOAD NEVER CARRIES THE CREDENTIAL, nor its hash, nor the pairing
   * code. It carries the device id, the label a human chose and the actor —
   * ids and words, never secrets (REQ-LOG-08, and the spirit of REQ-VER-04:
   * types and outcomes, never values). `device.paired` in particular is
   * written in the SAME transaction as the credential it evidences, so a
   * paired tablet with no record of being paired is structurally impossible
   * (hard rule 11).
   */
  'device.registered',
  'device.paired',
  'device.revoked',
  /**
   * The credential was thrown away and a fresh pairing code issued — a device
   * that stays the same device. Distinct from revoke-then-register because the
   * history has to stay attached to the tablet on the desk: "this one was
   * re-paired in March" and "this is a different tablet" are different facts.
   */
  'device.rotated',
  /**
   * A TABLET WAS TOLD IT MAY (OR MAY NOT) SHOW THE WAITING LIST (Carl, 4 Sep
   * 2026 — "the list page is only for testing purposes").
   *
   * Ordinary tablets show nobody's name: the walk-up patient states three
   * details and the server finds their row. Turning the list back on for one
   * device puts other patients' names on a screen anybody in the room can
   * read, so it is a security setting rather than a preference — console only,
   * staff actor required, and evidenced here every time it changes.
   */
  'device.waiting_list_visibility_set',
  /**
   * RECEPTION TOOK A TABLET OUT OF USE, AND PUT IT BACK (Carl, 4–5 Sep 2026,
   * TODO.md "Tablets: make one inactive").
   *
   * NOT A REVOKE, and the pair of events exists so the record can tell them
   * apart. A flat battery or a tablet gone for repair is reception's own
   * housekeeping: the credential is untouched, the device keeps heartbeating,
   * and one press puts it back. A revoke is a security act by an
   * administrator. Reading a month of these should let somebody say "that
   * tablet was off the floor for three days", which `device.revoked` could
   * never honestly say.
   *
   * NO PATIENT DATA. The label, who did it, and whether a live session was
   * recalled to make it true — a count of one or none, never a name.
   */
  'device.taken_out_of_use',
  'device.put_back_in_use',
  /*
   * THE WALK-UP CLAIM — "Confirm your details", and the server finds you
   * (Carl, 4 Sep 2026). The patient states their identifiers and the server
   * evaluates every waiting row of that practice; exactly one match verifies
   * and continues, and zero or many are the SAME generic refusal, because
   * "nobody by that name" and "two people match" are both facts about other
   * people.
   *
   * `kiosk.claim_matched` hangs off the verification event the ordinary
   * in-practice path produced, and adds the one thing that path has no column
   * for: WHICH TABLET. It is the walk-up equivalent of a staff identity.
   *
   * `kiosk.claim_failed` and `kiosk.claim_locked_out` hang off the DEVICE,
   * necessarily — a failed claim identified nobody, so there is no patient and
   * no verification event to attach them to, and inventing one would be the
   * fabricated evidence this product exists to prevent. They carry TYPES,
   * counts and outcomes only; never a value, and never a name (REQ-VER-04).
   */
  'kiosk.claim_matched',
  'kiosk.claim_failed',
  'kiosk.claim_locked_out',
  /**
   * The practice was moved to a newer kiosk build floor — the rollback signal
   * that reaches a tab which has been open since eight in the morning. Every
   * tablet below the floor reloads on its next poll, so this is one act with a
   * fleet-wide effect, which is exactly the kind that has to be attributable.
   */
  'practice.minimum_kiosk_build_set',
  /**
   * HOW LONG A TABLET WAITS BEFORE IT RETURNS TO THE START (Carl, 4 Sep 2026).
   *
   * A screen-hygiene control, not a comfort setting: it decides how long a
   * walked-away patient's name, date of birth and address stay on a device
   * sitting on a counter. Lengthening it is therefore a decision somebody
   * should have to own, so the new value and who set it are evidenced here
   * every time it moves.
   *
   * THE VALUE IS A NUMBER OF SECONDS AND IS NOT PII — there is nothing about a
   * patient in it, which is why it may be carried in the payload at all
   * (REQ-LOG-08).
   */
  'practice.kiosk_idle_timeout_set',
  /**
   * WHICH AGREEMENT THE PRE-STEP OFFERS BY DEFAULT (Carl, 4 Sep 2026;
   * GA-PLAN B6).
   *
   * A practice-wide choice with a per-patient consequence: with it on, a GP
   * practice's first offer at the desk is an ONGOING agreement — sign once,
   * nothing post-service — and a patient who declines is offered an agreement
   * for the visit instead. Turning it off changes what thousands of patients
   * are asked, so who changed it and to what is evidence rather than a
   * preference. A boolean is not PII (REQ-LOG-08).
   *
   * IT IS NOT A REGULATORY SWITCH. Enduring stays GP-only and per
   * practitioner × patient whatever this says (hard rule 6, REQ-END-01/-01a);
   * the setting decides what is OFFERED FIRST, never what is allowed.
   */
  'practice.enduring_by_default_set',
  /**
   * THE PATIENT WOULD RATHER AGREE EACH VISIT (Carl, 4 Sep 2026).
   *
   * Its own event, and not a flavour of the walk-away, because it is a
   * different fact with a different next step: the person did not leave the
   * tablet, they read a standing agreement and answered it. Reception's screen
   * then offers an agreement for today's visit instead.
   *
   * NOTHING ON THE AGREEMENT MOVES, and the payload says so — declining an
   * ongoing agreement declines neither bulk billing nor care (hard rule 8,
   * REQ-REC-04). Ids and a state; no patient, no reason typed by anybody, no
   * amount.
   */
  'tablet.enduring_declined',
  /**
   * AND WHAT WAS OFFERED INSTEAD. The episodic draft reception created from
   * the declined ongoing agreement, naming both, so the pair can be read as
   * one story later: this patient was offered a standing agreement, said no,
   * and signed for the visit.
   */
  'tablet.episodic_offered_after_decline',
  /*
   * PUSH-TO-DEVICE CAPTURE — reception handed the patient a locked screen
   * (TODO.md "Push-to-device capture" / "Two front doors", Carl 4 Sep 2026).
   *
   * `tablet.session_pushed` IS THE HEAVIEST OF THE FOUR, because it is the
   * moment the whole act happens: a named staff member, having checked the
   * patient across the desk, sends ONE agreement — validated, locked and
   * rendered — to ONE paired tablet. It is written in the same transaction as
   * the lock, the staff-verified verification event and the session row, so a
   * tablet holding an agreement with no record of who put it there is
   * structurally impossible (hard rule 11).
   *
   * THE VERIFICATION IS A SEPARATE EVENT AND SO ARE THE TICKS, and the naming
   * keeps them apart on purpose. `verification.staff_verified` is the identity
   * check (REQ-VER-03), carrying TYPES and an outcome and never a value.
   * `tablet.details_confirmed` is the patient saying their particulars are
   * right — a DATA-ACCURACY check, part of the ceremony, and never evidence of
   * who was holding the tablet. Recording the second as the first is the
   * mistake this vocabulary exists to prevent.
   *
   * NONE OF THEM CARRIES A VALUE, a patient's name or an amount: ids, a device
   * label, states and identifier TYPES (REQ-LOG-08, REQ-VER-04, hard rule 4).
   */
  'tablet.session_pushed',
  'tablet.details_confirmed',
  /**
   * THE PATIENT SAID SOMETHING WE HOLD IS WRONG (Carl, 4 Sep 2026).
   *
   * Its own event rather than a flag on the confirmation, because it is its
   * own fact and somebody will be asked about it: at this moment, the person
   * the particulars are about looked at them and said one or more were not
   * theirs. It carries the disputed TYPES and nothing else — never the value
   * shown, never the value they believe is right (REQ-VER-04); the patient was
   * never asked for a replacement and the tablet has no field to take one.
   *
   * THE AGREEMENT IS UNTOUCHED. A dispute stops a ceremony, not a visit: the
   * payload says `agreementChanged: false` for the same reason the walked-away
   * event does (hard rule 8, REQ-REC-04).
   */
  'tablet.details_disputed',
  'tablet.session_state_changed',
  /**
   * Signed, walked away, recalled or expired. Three of the four change NOTHING
   * on the agreement, and the payload says so in a field — a patient who walks
   * away from a screen is still seen and still billable by another route
   * (REQ-REC-04).
   */
  'tablet.session_ended',
  /**
   * RECEPTION ASKED A TABLET TO GO BACK TO BEGIN (Carl, 4–5 Sep 2026, TODO.md
   * "Tablet heartbeat and Return to Begin").
   *
   * THE ACT IS THE EVIDENCE, NOT THE HEARTBEAT. A heartbeat is telemetry —
   * where a tablet is, thirty times a minute — and writing one to an
   * append-only vault would bury the record in noise for no evidentiary gain.
   * The moment somebody DECIDES to take a screen off a patient is different:
   * it may have interrupted a ceremony, so who did it and when is a question
   * that can be asked later.
   *
   * IT SAYS WHAT IT DID, NOT WHO IT DID IT TO. The device, the command id, the
   * staff member, and whether a live session was recalled to make it true. No
   * patient, no identifier, no screen contents (REQ-LOG-08, hard rule 9). The
   * recall itself writes its own `tablet.session_ended`, which is where the
   * session's story belongs.
   */
  'tablet.return_to_begin_requested',
  /**
   * THE STAFF CHECK ACROSS THE DESK, recorded as its own kind of event.
   *
   * Distinct from `verification.attempted` because the act is distinct: nobody
   * stated anything into a form and nothing was compared. A receptionist with
   * the patient in front of them checked the card in the PMS and asked the
   * approved identifiers (REQ-VER-03), and what the platform can record is
   * WHICH TYPES were checked, that they matched, and BY WHOM. Filing it as an
   * attempt would imply values were compared that never existed.
   */
  'verification.staff_verified',
  /**
   * RECEPTION CORRECTED A DETAIL ON THE PLATFORM'S MIRROR (Carl, 4 Sep 2026),
   * after the patient crossed it on the tablet.
   *
   * THE TYPE AND THE STAFF MEMBER, NEVER THE VALUE. `name`, `address`,
   * `mobile` — the same five words the tick-boxes use — plus the identity of
   * the person who typed it, which is the whole evidentiary point: a patient
   * detail that changed and nobody to ask about it is the shape this platform
   * exists to prevent. The value itself lives only in the encrypted store
   * (REQ-VER-04's rule about identifier values, applied to the mirror).
   *
   * IT SAYS NOTHING ABOUT THE PMS, WHICH IS STILL THE SOURCE OF TRUTH
   * (REQ-DATA-10). Until the Medtech write-back exists (D-01) a correction
   * here lives on our copy, the next sync would bring the old value back, and
   * the console says so on screen. The event's timestamp is what a later sync
   * compares against so a staff correction newer than the PMS value is not
   * silently overwritten.
   */
  'patient.details_corrected',
  // Somebody -- or something -- decided about a change that needed a second
  // look. The payload always says WHICH, because "a person accepted this" and
  // "a model scored it and nobody looked" are different claims.
  'review_task.resolved',
  'affiliation.invited',
  'affiliation.accepted',
  'affiliation.rejected',
  'affiliation.notice_given',
  // The practitioner stayed. Recorded because a notice that was given and
  // then withdrawn is not the same history as one never given -- somebody
  // was told they were leaving, and that has to remain visible.
  'affiliation.notice_withdrawn',
  'affiliation.ended',
  /**
   * WHOSE PROVIDER NUMBER THE CLAIM GOES UNDER, at this location, CHANGED
   * (Carl, 5-7 Sep 2026; the billing role).
   *
   * It decides who may be named as the provider on an agreement, so a change
   * to it changes which consent records the practice can make -- and a
   * practitioner recorded as a servicing provider on Tuesday and as working
   * under one on Thursday is a question somebody will ask about a Wednesday
   * agreement. The payload carries the role before and after, the content
   * version the list came from (hard rule 14), and who changed it. No name,
   * no provider number, no amount.
   */
  'affiliation.billing_role_set',
  'practitioner.deregistered',
  'campaign.declared',
  'key.used',
  'access.read', // REQ-LOG-07: reads are logged, not only writes
  /**
   * A DISPUTED DETAIL WAS CLOSED AT THE DESK (Carl, 4 Sep 2026).
   *
   * A cross on the tablet is a fact somebody will be asked about later: at
   * that moment the person the particulars are about said one was not theirs.
   * WHAT HAPPENED NEXT is the other half of that record, and there are exactly
   * two honest answers — `corrected` (reception changed the detail on the
   * platform's mirror, which has its own `patient.details_corrected` event) and
   * `patient_error` (the detail was right; the patient crossed it in error).
   * Without this event the second answer would have to be faked as the first,
   * putting a correction in the vault that never happened.
   *
   * THE TYPES AND THE STAFF MEMBER, NEVER A VALUE (REQ-VER-04, hard rule 9) —
   * `address`, `mobile`, the same five words the tick-boxes use. And the
   * AGREEMENT DID NOT MOVE: closing a dispute settles what reception will do
   * next, not what was contracted, so the payload says so for the same reason
   * the walked-away event does (hard rule 8, REQ-REC-04).
   */
  'tablet.dispute_resolved',
  /*
   * THE PATIENT'S OWN PAGE (C8, REQ-PORT-01..08; TODO.md "The patient's own
   * page", Carl 4 Sep 2026).
   *
   * WHY A PORTAL NEEDS EVENTS AT ALL. FR-8.2 makes every access an event, and
   * the card that answers Carl's actual question — "what do you do with my
   * data" — is built out of these. A platform that logs what the PRACTICE did
   * to a record and not what the PATIENT did with it can only ever show the
   * patient half a story about their own data.
   *
   * `portal.activated` is the heaviest of the six. It is the moment a person
   * proved, with three approved identifiers against ONE practice's record,
   * that they are the patient that practice verified across its counter — and
   * a link was made. Its payload carries identifier TYPES, a count and an
   * outcome, never a value and never the token (REQ-VER-04, hard rule 9); the
   * Medicare card number cannot appear because it is refused as an identifier
   * before this event is ever written (hard rule 1).
   *
   * `portal.accessed` IS ONE PER SESSION, NOT ONE PER REQUEST, and that is a
   * decision rather than an economy. A read-per-request log at portal volumes
   * is a second copy of the traffic log wearing evidence clothes; what the
   * patient is entitled to see, and what an auditor asks for, is "somebody
   * signed in as me, then". The per-artefact reads keep their own
   * `artefact.accessed` events, which is where read-level detail belongs.
   *
   * `portal.enduring_terminated` is the patient exercising 65CA(7)(b) — a
   * right they hold whether or not they were the assignor. Carried beside the
   * enduring module's own `agreement.terminated`, because "the patient ended
   * this from their own page" and "it was terminated" are different facts and
   * only one of them can be told from the other's absence.
   *
   * `portal.activation_locked` is the OTHER end of `portal.activated`: three
   * failed identifier checks and the invitation is finished (Carl, 5 Sep
   * 2026). It carries the invitation id, the attempt COUNT and the review task
   * it raised for the practice — never which identifier types were offered,
   * never which failed and never a value (REQ-VER-04, hard rule 9). The
   * per-attempt detail already exists as the verification module's own events;
   * duplicating it here would put a failure profile for one person in a second
   * place. It is written exactly once per invitation, because locking is a
   * one-time transition.
   *
   * NONE OF THE SEVEN CARRIES AN AMOUNT, a name, an address or a detail's
   * value. `portal.correction_requested` carries the field TYPE the patient
   * says is wrong and never what they believe is right — the portal has no
   * field to take one, because reception confirms it in person against the PMS.
   */
  'portal.invitation_minted',
  'portal.activated',
  'portal.activation_locked',
  'portal.accessed',
  'portal.correction_requested',
  'portal.enduring_terminated',
  'portal.assignor_revoked',
  /*
   * PASSKEYS — the second half of FR-8.2 (Carl, 4 Sep 2026: "Implement";
   * D-2026-09-04-02, passkeys in core rather than in Keycloak).
   *
   * WHY THESE ARE VAULT EVENTS AND NOT LOG LINES. "Who could sign in as me,
   * from when, and who removed it" is the question the access-log card exists
   * to answer, and an authentication factor that appeared and vanished
   * without a trace would be the one gap in it. It is also the question an
   * auditor asks after a disputed agreement: a credential enrolled two
   * minutes before a signature is a different story from one enrolled a year
   * earlier, and only these events can tell them apart.
   *
   * `portal.passkey_registered` IS ALWAYS PRECEDED BY A `portal.activated` OR
   * A `portal.passkey_signed_in` FOR THE SAME ACCOUNT, structurally:
   * registration is reachable only inside a live session, so the chain always
   * shows which verified session bound the credential. That is the whole
   * evidential value of doing the bootstrap first.
   *
   * `portal.passkey_rejected` IS THE ONE WORTH ALERTING ON. A signature that
   * verifies but whose counter went BACKWARDS is the signature of a cloned
   * authenticator, and it is the only event in this group that says somebody
   * may be attacking a patient rather than using their phone.
   *
   * NONE OF THE FOUR CARRIES A PUBLIC KEY, A CREDENTIAL ID, A NAME OR A LABEL.
   * A credential's own row id, a transport hint and an authenticator MODEL id
   * (aaguid — a device type, never a device instance) are the whole payload
   * (REQ-LOG-08, REQ-VER-04).
   */
  'portal.passkey_registered',
  'portal.passkey_signed_in',
  'portal.passkey_rejected',
  'portal.passkey_revoked',
  /*
   * THE WORDS OF THE AGREEMENT ITSELF (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md
   * W1).
   *
   * WHY THESE ARE VAULT EVENTS. A practice may propose its own wording for the
   * instrument its patients sign, and the platform reviews it before any
   * patient sees it. "Who wrote these words, who read them, and when did they
   * start being used" is precisely the question a dispute about what somebody
   * agreed to turns into — and it cannot be answered from the templates table
   * alone, because that table holds current state and a status column cannot
   * say who moved it.
   *
   * `template.activated` IS THE HEAVY ONE. It is the moment unreviewed copy
   * becomes the operative text of contracts, and its actor is a PLATFORM
   * principal by construction: a practice cannot activate its own wording, the
   * service refuses it, and the database refuses an active row with no named
   * reviewer. The payload carries the reviewer's name deliberately — a review
   * whose reviewer is anonymous is not a review.
   *
   * `template.retired` covers both endings: superseded by a newer version, and
   * withdrawn back to the generic wording we ship. The two are different
   * histories and the payload says which.
   *
   * NONE OF THE THREE CARRIES THE WORDS. The body lives in the row, at the
   * version these events name; copying it here would put a second, divergeable
   * copy of a contract's text in the log. And none of them carries a patient,
   * an identifier or an amount (REQ-LOG-08, hard rules 1 and 4) — the template
   * loader refuses an amount in the body before it can be stored at all.
   */
  'template.proposed',
  'template.activated',
  'template.retired',
  /*
   * THE PRACTICE'S LETTERHEAD MARK (W1). Recorded because the logo is embedded
   * in the bytes of every agreement the practice makes and therefore in every
   * hash: "why do agreements before Tuesday hash differently" has an answer
   * with a time and a person on it. Hash, type and pixel dimensions only —
   * never the image, which lives in the artefact store like every other
   * artefact. Clearing it is its own event because the artefact is NOT
   * deleted: what stopped is the printing, not the evidence.
   */
  'practice.letterhead_logo_set',
  'practice.letterhead_logo_cleared',
] as const;

export type VaultEventType = (typeof VAULT_EVENT_TYPES)[number];

export interface VaultEventInput {
  readonly type: VaultEventType;
  /** Who did it — staff/provider/system principal ID, never a name. */
  readonly actor: { readonly principalType: string; readonly id: string };
  /** What it concerns — entity type + ID only, never content (REQ-LOG-08). */
  readonly subject: { readonly type: string; readonly id: string };
  /** Content-free structured detail (hashes, versions, channels, outcomes). */
  readonly payload?: Record<string, string | number | boolean>;
}

export interface VaultEventRecord extends VaultEventInput {
  readonly id: VaultEventId;
  /** Server-authoritative time (REQ-VAULT-03). */
  readonly recordedAt: IsoTimestamp;
  /** Hash of the predecessor event — the chain (REQ-VAULT-01). */
  readonly previousHash: string;
  readonly hash: string;
}

/** Append and read. There is deliberately no update or delete method. */
export interface VaultClient {
  append(event: VaultEventInput): Promise<VaultEventRecord>;
  getChainSegment(query: {
    readonly subjectId?: string;
    readonly from?: IsoTimestamp;
    readonly to?: IsoTimestamp;
  }): Promise<readonly VaultEventRecord[]>;
  /** REQ-VAULT-09: confirm existence/timestamp/position without disclosing content. */
  verifyArtefactHash(sha256: string): Promise<{ exists: boolean; recordedAt?: IsoTimestamp }>;
}

/**
 * Outbox row shape (FR-11.2). Inserted in the same DB transaction as the
 * domain write; the relay publishes unpublished rows to the vault and marks
 * them published. Every module in apps/core uses this — never a direct
 * append() call in a request handler for consent-relevant events.
 */
export interface VaultOutboxRow {
  readonly id: string;
  readonly event: VaultEventInput;
  readonly createdAt: IsoTimestamp;
  publishedAt?: IsoTimestamp;
}

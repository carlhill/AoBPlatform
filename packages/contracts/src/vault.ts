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
  'practitioner.deregistered',
  'campaign.declared',
  'key.used',
  'access.read', // REQ-LOG-07: reads are logged, not only writes
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

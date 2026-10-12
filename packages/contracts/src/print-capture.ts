/**
 * What a practice's desktop sends us when the PMS prints — CONSULTATION-CAPTURE-PLAN.md
 * Part 8, the print channel.
 *
 * THE PAYLOAD IS THE CONTRACT. The AoBPrinterApp parses the print job on the
 * desktop (8.2) and ships ONLY the s 65C fields, shaped as the very same
 * records the PMS adapter interface already speaks — `PmsPatientRecord`,
 * `PmsProvider`, `PmsAppointment`, `PmsInvoice`. So the core never learns a
 * new shape for "a patient" or "an invoice" because the data arrived by
 * print rather than by API, and the adapter contract stays the seam without
 * a per-practice adapter object standing between the queue and the cascade.
 *
 * WHAT IS DELIBERATELY ABSENT: the document. No PDF, no text, no image. A
 * print job can carry a Medicare number, a dollar amount, clinical notes if
 * somebody printed the wrong thing — and none of it may reach us. The hash
 * below is how a dispute can still prove "this record came from exactly that
 * document" without the document ever having been stored.
 */
import type { IsoTimestamp, PrintDocumentType } from '@aobplatform/domain';
import type { PmsAppointment, PmsInvoice, PmsPatientRecord, PmsProvider } from './pms-adapter';

export interface PrintJobEnvelope {
  readonly documentType: PrintDocumentType;
  /** SHA-256 (hex) of the source print job. Provenance without possession. */
  readonly sourceSha256: string;
  /** Which downloaded parser template produced these fields (8.2) — PMS-specific, versioned. */
  readonly parserTemplateVersion: string;
  /** The PMS the template was written for. Recorded, never interpreted here. */
  readonly pms: string;
  /** When the desktop captured the job, by its clock. */
  readonly capturedAt: IsoTimestamp;

  /** The people and providers the document named, so they can be mirrored without a PMS read. */
  readonly patients?: readonly PmsPatientRecord[];
  readonly providers?: readonly PrintJobProvider[];
  /** arrival_slip: one; appointment_list: the day. */
  readonly appointments?: readonly PmsAppointment[];
  /** invoice: usually one. */
  readonly invoices?: readonly PmsInvoice[];

  /* --- db4_assignment only. See "THE DB4 PRINT RECORD" below. --- */
  /** Which print queue produced the form. Attribution, never PII. */
  readonly queueName?: string;
  readonly queueLabel?: string;
  /**
   * How many date-led service lines the template's row pattern did NOT read
   * (D-2026-10-11-05). A count, never content. Absent from a desktop that
   * predates it; non-zero is refused at Send-to-tablet.
   */
  readonly unparsedServiceLines?: number;
  readonly heading?: Db4Heading;
  readonly form?: Db4Form;
  readonly servicingLocation?: Db4ServicingLocation;
  /** SINGULAR, and a different field from `patients` — a DB4 is one patient's form. */
  readonly patient?: Db4Patient;
  /** The service rows as printed. `invoices` is the generic path's shape and is not used here. */
  readonly services?: readonly Db4Service[];
  readonly assignment?: Db4Assignment;
  readonly referral?: Db4Referral;
}

/**
 * A provider named on a printed document.
 *
 * `role` IS THE ONE FIELD A DB4 ADDS, and it is why the two shapes share this
 * key rather than each having their own: `DB4-print.example.json` prints its
 * providers under `providers`, and the example is the authority. On every other
 * document type it is absent. A DB4 carries `servicing` and `payee`; only the
 * SERVICING provider anchors the visit, because that is whose number the claim
 * goes under and therefore who the agreement must name (s 65C(5)(a)).
 */
export interface PrintJobProvider extends PmsProvider {
  readonly role?: string;
}

/** What the platform says back — at once, before any of it is processed. */
export interface PrintJobAccepted {
  readonly id: string;
  readonly lane: 'critical' | 'standard' | 'fyi';
  /** True when this exact document (same type, same hash) was already received. Not an error. */
  readonly duplicate: boolean;
  readonly receivedAt: IsoTimestamp;
}

/* ---------------------------------------------------------------------------
 * THE DB4 PRINT RECORD — what AOBPRINTER emits for one DB4 printed from
 * PracSoft (DB4-AND-AOBL.md §2 and §13a piece 1; D-2026-09-14-02/-03/-04).
 *
 * `DB4-print.example.json` IN THE REPO ROOT IS THE AUTHORITY. The interfaces
 * below are that document typed, and so is `PrintJobEnvelopeDto`. The two are
 * hand-kept in step and nothing about the type system notices them drifting —
 * so `a_db4_record_survives_the_validation_pipe` posts the example itself and
 * asserts every field of it comes back off the job row. That test is the guard,
 * and it is the reason this comment can be short.
 *
 * EVERYTHING BELOW THE ENVELOPE IS OPTIONAL, and that is the parser's contract,
 * not laziness: a field AOBPRINTER cannot find on the page is ABSENT, never
 * defaulted and never inferred from a sibling. The server decides what an
 * incomplete set may do (hard rule 2); a parser that filled a gap would be
 * lying to it, and a door that refused one would turn an unreadable form into a
 * retry storm on the critical lane (hard rule 8).
 *
 * WHAT THE RECORD CARRIES THAT NOTHING ELSE MAY. `patient.medicareCardNumber`,
 * `patient.irn` and `services[].benefitAssigned` travel because the Signed-DB4
 * reproduces the printed form (D-2026-09-14-03). They are CONTENT ON A FORM.
 * Hard rule 1 is unchanged in what it forbids — the card number is never used
 * to verify a patient, never used to find or match one, never in a log line, an
 * error message or a vault event, never sent to the rules service — and hard
 * rule 4 is unchanged in what it forbids: AoB never originates or computes an
 * amount. Neither crosses into an agreement: the handler assembles a
 * `ServiceRenderedDto`, which has no field either could land in, and nothing
 * else makes the trip.
 *
 * DUPLICATED, KNOWINGLY, IN `apps/aobprinter/src/db4-record.ts`. That file said
 * it would move here when this piece was built; moving it is a change to the
 * desktop app, which this build does not own. The example fixture is what keeps
 * the three in step until one of them imports the others.
 * ------------------------------------------------------------------------- */

export interface Db4Heading {
  /** The heading lines as printed, in order. Reproduced verbatim; never our claim. */
  readonly lines?: readonly string[];
}

export interface Db4Form {
  /** What the page IS ("DB4"), never an assertion that it is the current form. */
  readonly formCode?: string;
  /**
   * THE IDENTITY OF THE FORM, and the idempotency key for everything that
   * follows it. `sourceSha256` is the identity of the BYTES, and a reprint
   * produces different bytes because the driver stamps a creation id — so
   * sha-level dedup lets one form through twice. `db4:<formReference>` becomes
   * the service record's `pmsInvoiceKey`, which is where the database makes one
   * form one agreement under a race as well as in sequence.
   */
  readonly formReference?: string;
  readonly locationId?: string;
  readonly claimStatus?: string;
  /** True only when the printed page already carries a signature the driver could see. */
  readonly signedOnPaper?: boolean;
  readonly serviceDate?: string;
  readonly currency?: string;
}

export interface Db4ServicingLocation {
  readonly name?: string;
  readonly addressLines?: readonly string[];
  readonly suburb?: string;
  readonly state?: string;
  readonly postcode?: string;
}

export interface Db4Patient {
  /** `chart:<patientRecordNumber>`. Carried; the MATCH is on `patientRecordNumber`. */
  readonly pmsLinkageKey?: string;
  /** THE PRACTICE'S CHART NUMBER — the only key a DB4 is matched on (hard rule 1). */
  readonly patientRecordNumber?: string;
  /*
   * CARRIED FOR THE SIGNED-DB4, NEVER AN IDENTIFIER (D-2026-09-14-03). The lint
   * rule below is the repo's guard against the single most likely design
   * mistake in this product, and it is right to fire here: this is the one
   * field in the codebase that names the number, it exists because a decision
   * with its own entry says the printed form must be reproducible, and hard
   * rule 1's actual prohibitions — never to verify, never to match, never in a
   * log or an event, never to the rules service — are all intact.
   */
  // eslint-disable-next-line no-restricted-syntax
  readonly medicareCardNumber?: string;
  readonly irn?: string;
  readonly givenNames?: string;
  readonly familyName?: string;
  readonly dateOfBirth?: string;
  readonly address?: string;
  readonly mobile?: string;
}

export interface Db4Service {
  readonly serviceDate?: string;
  readonly time?: string;
  readonly mbsItemNumber?: string;
  readonly description?: string;
  /** The amount PracSoft printed. Reproduced, never originated (hard rule 4, as narrowed). */
  readonly benefitAssigned?: string;
}

export interface Db4Statement {
  readonly key?: string;
  readonly text?: string;
  readonly ticked?: boolean;
  /** False for the pathology statement — carried as data, never acted on (s 65C(4) items 1–4). */
  readonly inScope?: boolean;
}

export interface Db4Assignment {
  readonly privacyNotice?: readonly string[];
  readonly statementsJoinedBy?: string;
  readonly statements?: readonly Db4Statement[];
}

export interface Db4Referral {
  readonly acrf?: string | null;
  readonly lspn?: string | null;
  readonly requestingProviderName?: string | null;
  readonly requestingProviderNumber?: string | null;
  readonly dateOfRequest?: string | null;
  readonly periodOfReferral?: string | null;
}

/**
 * WHY A DB4 PRODUCED NO AGREEMENT — a code, mapped to copy and a destination by
 * whoever shows it (CLAUDE.md §7, "shortcuts to the answer, not directions to a
 * screen"). None of these is an error and none of them is retried: a form the
 * platform cannot place is recorded and left alone, because a retry storm on the
 * critical lane is how a queue stops serving the patient at the desk, and
 * because the service has already happened and the practice can still bill it
 * (hard rule 8, REQ-REC-04).
 */
export const DB4_PLACEMENT_REASONS = [
  /** The record named no `form.formReference`, so nothing can make one form one agreement. */
  'no_form_reference',
  /** No `servicing` provider with a provider number on the form. */
  'no_servicing_provider',
  /** No service date could be read from the form or from its service rows. */
  'no_service_date',
  /** The form named no patient record number, so there is no key to match on. */
  'no_chart_number',
  /** No MBS item numbers on the form — there is no D6b to lock. */
  'no_service_items',
  /** This practice holds no patient with that chart number. Send the arrival first. */
  'unknown_chart_number',
  /** The form's provider number matches no practitioner at this practice. */
  'provider_not_found',
  /** More than one practitioner at this practice holds that provider number. */
  'provider_number_ambiguous',
  /** That person cannot be the provider on an agreement — the claim goes under another number. */
  'provider_not_servicing',
  /** That person is not linked to a practitioner at one of this practice's locations. */
  'provider_not_anchored',
  /** Today's signed pre-agreement, or a live ongoing agreement, already covers the service. */
  'already_covered',
  /**
   * THE PATIENT AND THE PROVIDER BOTH RESOLVED AND SOMETHING LATER DECLINED —
   * the rules engine refusing the particulars at the lock, most often, which is
   * what an MBS item number this platform does not map looks like from here.
   * `refusedStatus` carries the status so the code can be diagnosed rather than
   * guessed at; the service record exists and says how far it got.
   */
  'refused_after_service_record',
  /** Refused for a reason the platform can state but has no code for. */
  'refused',
] as const;
export type Db4PlacementReason = (typeof DB4_PLACEMENT_REASONS)[number];

/* ---------------------------------------------------------------------------
 * A DB4 THAT HAS BEEN PRINTED AGAIN — what was done about it.
 *
 * Carl, 28 September 2026: correct the missing data as though corrected from
 * the PMS, reprint, and resend for reprocessing. The rule he approved is
 * three-way — repoint when only the reproduction improved, supersede when a
 * particular changed, refuse under a signature — and it lives as a pure
 * function in `apps/core/src/inbound/db4-reprint.ts`, which carries the
 * reasoning. These are the words it answers in.
 * ------------------------------------------------------------------------ */

/**
 * WHICH KIND OF PARTICULAR MOVED between the agreement and the corrected form.
 *
 * TYPES, NEVER VALUES (hard rule 9, REQ-VER-04). Not one of these can carry a
 * chart number, a provider number, a date or an item number — which is what
 * lets the answer ride on a job row, in a log line and in a vault event.
 */
export const DB4_PARTICULAR_CHANGES = [
  'patient',
  'servicing_provider',
  'service_date',
  'service_items',
] as const;

export type Db4ParticularChange = (typeof DB4_PARTICULAR_CHANGES)[number];

/**
 * WHAT HAPPENED TO THE LINK between an agreement and the page it reproduces.
 *
 *  - `linked` — the ordinary first form. Nothing was pointing anywhere yet.
 *  - `already_linked` — this very job is already the one. Asked twice.
 *  - `repointed` — only the REPRODUCTION improved (an amount, an IRN, the
 *    provider's printed name), so the agreement is untouched and now points
 *    at the better page.
 *  - `supersede` — a PARTICULAR changed, so this is a different agreement and
 *    a replacement was drafted (hard rule 2, HARD-02: never an edit).
 *  - `refused_signed` — somebody has signed. Evidence is not repointed and is
 *    not superseded from a print queue; a human decides.
 */
export const DB4_REPRINT_ACTIONS = [
  'linked',
  'already_linked',
  'repointed',
  'supersede',
  'refused_signed',
] as const;

export type Db4ReprintAction = (typeof DB4_REPRINT_ACTIONS)[number];

/**
 * WHAT A `db4_assignment` JOB DID, written onto the job row.
 *
 * IDS AND CODES ONLY. No name, no chart number, no Medicare number, no amount
 * (hard rules 4 and 9). The DB4 Print Record is already on the row's `payload`;
 * this is the answer to "and then what happened", and it has to be readable by
 * somebody who never opens the payload at all.
 */
export interface Db4JobOutcome {
  /** `db4:<formReference>` — what makes this form one service record. Null when the form named none. */
  readonly idempotencyKey: string | null;
  /** Did the practice's chart number find a patient we already hold. */
  readonly patientMatched: boolean;
  /** The provider the visit is anchored on. A number, not a person's name. */
  readonly servicingProviderNumber: string | null;
  /** Recorded for the claim, NEVER used to anchor — the servicing provider anchors the visit. */
  readonly payeeProviderNumber: string | null;
  readonly serviceRecordId: string | null;
  /** True when this form had already been processed — a reprint, not a second visit. */
  readonly repeat: boolean;
  /** The post-service policy's answer, and the version of the table that gave it (hard rule 14). */
  readonly decision: string | null;
  readonly policyVersion: string | null;
  readonly agreementId: string | null;
  /** True when this form produced (or had already produced) a post-service agreement. */
  readonly placed: boolean;
  /** Why nothing was created. Null when something was. */
  readonly reason: Db4PlacementReason | null;
  /**
   * THE STATUS THE PLATFORM REFUSED WITH, so an unmapped refusal shows its code
   * rather than a shrug (CLAUDE.md §7). Null unless something refused. Never the
   * message: a refusal's sentence can name a person, and this row is read by
   * people who have no business reading one (hard rule 9).
   */
  readonly refusedStatus: number | null;
  /**
   * WHAT A REPRINT DID TO THE LINK. Present on every DB4 that reached the
   * placement step, so `linked` on an original and `repointed` on a
   * correction are distinguishable without reading two rows.
   */
  readonly reprint?: {
    readonly action: Db4ReprintAction;
    /** Types, never values. Empty unless the action is `supersede`. */
    readonly changed: readonly Db4ParticularChange[];
    /** The replacement a supersession drafted. Null for every other action. */
    readonly supersededBy: string | null;
  } | null;
}

/* ---------------------------------------------------------------------------
 * WRITE-BACK BY COLLECTION — the other half of the print channel.
 *
 * Carl, 28 September 2026: *"build the import-folder write-back"*, after
 * being told that a completed approval today reaches the practice's PMS
 * nowhere at all.
 *
 * ── WHY A COLLECTION AND NOT A WRITE ──
 *
 * PRINTING CANNOT WRITE BACK (CONSULTATION-CAPTURE-PLAN.md §8.6). Nothing
 * prints *into* a PMS, and REQ-INT-02 says write-back is the product. The
 * answer is the same installed desktop closing the loop from the other side:
 * it drops the signed PDF/A into the PMS's document-import folder, where a
 * person in the practice files it. Semi-automatic, outside any PMS API, and
 * legally clean.
 *
 * IT IS A PULL, AND THE DIRECTION IS THE WHOLE POINT (DB4-AND-AOBL.md §6b).
 * A practice's network is outbound-only with mutual TLS (ADR); a server that
 * pushed would need an inbound port on a receptionist's PC. So the platform
 * publishes what is ready and AOBPRINTER comes and gets it.
 *
 * ── THE FOLDER AND THE FILENAME ARE THE PRACTICE'S OWN KEYS ──
 *
 * `<chart number>/<form reference>.pdf`, with the manifest beside it as
 * `<form reference>.json` (DB4-AND-AOBL.md §6a). The chart number is the
 * folder because that is what the PMS's own document folder is named for; the
 * form reference is the filename because it is one per form, so a patient
 * with three assignments in a year has three files that never collide.
 *
 * AND THE CHART NUMBER BEING THE FOLDER IS CONFIRMED, NEVER ASSUMED (§6a's
 * correction). The day it turns out to be named for something else is the day
 * fifty signed consents land in the wrong place, so the desktop will not
 * collect until an administrator has said so for that practice.
 * ------------------------------------------------------------------------ */

/**
 * ONE SIGNED FORM WAITING TO BE COLLECTED.
 *
 * WHAT IT CARRIES AND WHY EACH FIELD IS HERE. The folder and the filename,
 * because the desktop cannot ask anyone; the artefact id and its hash,
 * because the desktop verifies what it downloaded before it writes it into a
 * patient's record (rule 13 — a display re-verifies, and so does a copy); and
 * the versions, because the manifest has to say which renderer and which
 * content produced the page.
 *
 * NO NAME, NO DATE OF BIRTH, NO ADDRESS, NO MEDICARE NUMBER. The chart number
 * is an approved identifier (hard rule 1) and is load-bearing here — it IS
 * the folder. Nothing else about the person travels, because nothing else is
 * needed to file a document.
 */
export interface SignedFormForCollection {
  readonly agreementId: string;
  /** The FOLDER. The practice's own chart number for the patient. */
  readonly patientRecordNumber: string;
  /** The FILENAME, without an extension. The reference PracSoft printed on the form. */
  readonly formReference: string;
  /** What to download: `GET /artefacts/:artefactId/content`. */
  readonly artefactId: string;
  /** SHA-256 of those bytes. The desktop verifies before writing, and confirms with it. */
  readonly sha256: string;
  readonly signedAt: string;
  readonly rendererVersion: string;
  readonly contentVersion: string;
  /** `DB4` today — the only form this channel reproduces. */
  readonly formCode: string;
}

/**
 * THE WRITE-BACK MANIFEST — the small JSON beside the PDF in the patient's
 * folder (DB4-AND-AOBL.md §7, row 3b).
 *
 * IT EXISTS SO THE FILE CAN BE CHECKED WITHOUT US. A practice, an auditor or
 * a support engineer holding the folder can tie the page to the agreement, to
 * the form PracSoft printed, and to the hash the platform holds — with no
 * call to anybody and no access to the vault. That is the whole job, and it
 * is why the manifest is a sibling file rather than metadata inside the PDF.
 *
 * EVERY FIELD IS NAMED HERE, NEVER SPREAD FROM A ROW. The same discipline
 * AOBPRINTER's receipts keep (`receipts.ts`): a field added to the collection
 * row must not ride into every manifest ever written, silently, until
 * somebody happens to look at one.
 */
export interface WriteBackManifest {
  readonly formReference: string;
  readonly patientRecordNumber: string;
  readonly agreementId: string;
  readonly signedAt: string;
  readonly sha256: string;
  readonly rendererVersion: string;
  readonly contentVersion: string;
  readonly formCode: string;
  /** When this desktop wrote the pair into the folder. Its own clock, and said to be. */
  readonly collectedAt: string;
  /** Which build of AOBPRINTER wrote it — the receipts rule, applied here. */
  readonly printerVersion: string;
}

/** What the desktop tells the platform once the pair is on disk. */
export interface CollectedConfirmation {
  /** Of the bytes actually written. Refused unless it matches what was published. */
  readonly artefactSha256: string;
  /** Where it landed, as the practice would find it: `<chart>/<reference>.pdf`. */
  readonly pmsDocumentKey: string;
}

/**
 * The DB4 Print Record — what AOBPRINTER emits for one DB4 printed from
 * PracSoft, and what `POST /inbound/print-jobs` receives.
 *
 * THE SHAPE IS `DB4-print.example.json`, in the repo root, and that file is the
 * authority. The interfaces below are that document typed; where the two
 * disagree, the example is right and this is a bug.
 *
 * WHY THIS LIVES HERE AND NOT IN `packages/contracts`. It belongs there, and it
 * will move there when piece 1 — the handler that turns a DB4 Print Record into
 * an arrival, a service record and an agreement — is built (DB4-AND-AOBL.md
 * §13a). That is not this build, and this build's brief is explicit that the
 * only change outside this workspace is the document type on the lane table.
 * Until then the desktop holds the shape, the server's envelope DTO whitelists
 * the five envelope fields it already knows, and everything below them is
 * stripped at the door. See the report: the record is carried in full and
 * arrives in full; what the server currently STORES of it is the envelope.
 *
 * EVERY FIELD IS OPTIONAL BELOW THE ENVELOPE, and that is the rule, not
 * laziness: a field the parser cannot find on the page is absent from the
 * record. It is never defaulted, never inferred from a sibling, and never
 * carried over from a previous job. A validator on the server decides whether
 * an incomplete set may proceed (hard rule 2); a parser that filled a gap
 * would be lying to it.
 */
import type { PrintDocumentType } from '@aobplatform/domain';

/** `db4_assignment` — declared in the domain's lane table, not here. */
export const DB4_DOCUMENT_TYPE: PrintDocumentType = 'db4_assignment';

export interface Db4Heading {
  /** The heading lines as printed, in order. */
  readonly lines?: readonly string[];
}

export interface Db4Form {
  /** What the page IS ("DB4"), never a claim that it is the current form. */
  readonly formCode?: string;
  /** The correlation key for every later message about this form, and the Signed-DB4's filename. */
  readonly formReference?: string;
  readonly locationId?: string;
  readonly claimStatus?: string;
  /** True only when the printed page already carries a signature the driver can see. */
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
  /** `chart:<patientRecordNumber>` — the practice's own key, and the ONLY key used to match a patient. */
  readonly pmsLinkageKey?: string;
  readonly patientRecordNumber?: string;
  /*
   * CARRIED, NEVER AN IDENTIFIER (D-2026-09-14-03). The Signed-DB4 reproduces
   * the form, so the number the form prints travels on the record. Hard rule 1
   * is unchanged in what it forbids, and this field is subject to every part of
   * it: never used to verify who a patient is, never used to find or match a
   * patient, never in a log line, an error message, a filename or an event, and
   * never sent to the rules service. `log.ts` enforces the logging half and
   * `the_medicare_number_never_appears_in_a_log_or_a_filename` names it.
   */
  readonly medicareCardNumber?: string;
  readonly irn?: string;
  readonly givenNames?: string;
  readonly familyName?: string;
  readonly dateOfBirth?: string;
  readonly address?: string;
  readonly mobile?: string;
}

export interface Db4Provider {
  readonly role?: string;
  readonly pmsProviderKey?: string;
  readonly name?: string;
  readonly providerNumber?: string;
}

export interface Db4Service {
  readonly serviceDate?: string;
  readonly time?: string;
  readonly mbsItemNumber?: string;
  readonly description?: string;
  /** The amount PracSoft printed. AoB never originates or computes one (hard rule 4, as narrowed). */
  readonly benefitAssigned?: string;
}

export interface Db4Statement {
  readonly key?: string;
  readonly text?: string;
  readonly ticked?: boolean;
  /** False for the pathology statement — carried as data, never acted on. */
  readonly inScope?: boolean;
}

export interface Db4Assignment {
  readonly privacyNotice?: readonly string[];
  readonly statementsJoinedBy?: string;
  readonly statements?: readonly Db4Statement[];
}

export interface Db4Referral {
  readonly acrf?: string;
  readonly lspn?: string;
  readonly requestingProviderName?: string;
  readonly requestingProviderNumber?: string;
  readonly dateOfRequest?: string;
  readonly periodOfReferral?: string;
}

/**
 * The envelope's five fields are always present; everything below them is what
 * the parser found on the page.
 */
export interface Db4PrintRecord {
  readonly documentType: PrintDocumentType;
  /** SHA-256 (hex) of the spool bytes the driver saw. Provenance, and the idempotency key. */
  readonly sourceSha256: string;
  /** Which versioned template produced these fields. */
  readonly parserTemplateVersion: string;
  readonly pms: string;
  readonly capturedAt: string;

  /*
   * WHICH PRINT QUEUE PRODUCED THIS FORM. Attribution, never PII: the name is
   * the Windows printer ("Room3") and the label is the practice's own words
   * for where it stands ("Room 3"). `config.ts` refuses a queue whose name or
   * label is shaped like a patient identifier, so these two are safe in a log
   * line and in a receipt — which is the point of carrying them, because on a
   * LAN host serving several workstations "which room printed this" is the
   * first question anybody asks about a form that needs chasing.
   *
   * OPTIONAL, like everything below the envelope, and for a narrower reason
   * as well as the general one: a record built by hand in a test, or parsed
   * before this field existed, has no queue and must not be made to invent
   * one.
   */
  readonly queueName?: string;
  readonly queueLabel?: string;

  readonly heading?: Db4Heading;
  readonly form?: Db4Form;
  readonly servicingLocation?: Db4ServicingLocation;
  readonly patient?: Db4Patient;
  readonly providers?: readonly Db4Provider[];
  readonly services?: readonly Db4Service[];
  readonly assignment?: Db4Assignment;
  readonly referral?: Db4Referral;
}

/**
 * THE DRAFT ON THE SCREEN, TURNED INTO THE ENVELOPE AOBPRINTER WOULD SEND.
 *
 * ONE PLACE, SO THE TOOL CANNOT DRIFT FROM THE DOOR. Every field here has a
 * matching property on a DTO in `inbound-print-jobs.controller.ts`, and the
 * global `ValidationPipe({ whitelist: true })` strips anything that does not
 * — so a field this file invents is silently dropped rather than stored, and
 * the tester would be testing nothing. Build the envelope in one function and
 * that mistake is visible in one diff.
 *
 * ── THE HASH IS OF THE ENVELOPE, AND THAT IS A DELIBERATE STAND-IN ──
 *
 * The real driver hashes the SOURCE PRINT BYTES at the practice and sends the
 * parsed record plus that hash — *provenance without possession* (8.2). This
 * tool has no spool file to hash, so it hashes the composed envelope instead.
 *
 * THE PROPERTY THAT MATTERS SURVIVES THE SUBSTITUTION, which is why it is the
 * right stand-in rather than a convenient one. `@@unique([practiceId,
 * documentType, sourceSha256])` makes identical bytes the SAME job: send the
 * same form twice unchanged and the second is a duplicate, exactly as a
 * re-spool of one print would be. CORRECT A FIELD AND THE HASH MOVES, so a
 * corrected reprint arrives as a new job — which is the whole mechanism the
 * reprocessing path turns on.
 *
 * THE KEYS ARE SORTED BEFORE HASHING. Two drafts with the same values must
 * hash the same however the object was assembled, or "send it again
 * unchanged" would produce a new job every time and the duplicate path would
 * never be exercised.
 */
import type { AssignmentStatement, Draft, PrintedAssignment } from './presets';

/**
 * A STORED `assignment` BLOCK, BACK ON THE DRAFT — or null when the form had
 * none, so a form sent without a privacy notice reprints without one. A
 * reprint that dropped it would repoint the agreement at a page with no 2C
 * notice, so whatever the stored block holds, it loads; a malformed entry is
 * skipped, never repaired.
 */
function assignmentOf(value: unknown): PrintedAssignment | null {
  if (!value || typeof value !== 'object') return null;
  const block = value as Record<string, unknown>;
  const privacyNotice = Array.isArray(block.privacyNotice)
    ? block.privacyNotice.filter((line): line is string => typeof line === 'string')
    : [];
  const statements: AssignmentStatement[] = (Array.isArray(block.statements) ? block.statements : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({
      key: typeof s.key === 'string' ? s.key : '',
      text: typeof s.text === 'string' ? s.text : '',
      ...(typeof s.ticked === 'boolean' ? { ticked: s.ticked } : {}),
      ...(typeof s.inScope === 'boolean' ? { inScope: s.inScope } : {}),
    }));
  return {
    privacyNotice,
    ...(typeof block.statementsJoinedBy === 'string' ? { statementsJoinedBy: block.statementsJoinedBy } : {}),
    statements,
  };
}

/** SHA-256 hex, via the browser's own crypto — no dependency added. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Stable JSON: object keys in sorted order, at every depth. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * ABSENT, NOT EMPTY. A field the template did not read is one the envelope
 * does not carry, and the difference is load-bearing: `maskMedicareCardNumber`
 * returns undefined for an absent number and the checks read presence with
 * `read()`. The one deliberate exception is the provider NAME, which the DTO
 * requires — an omitted name is a 400 at the door and never becomes a record,
 * so a blank name must travel as an empty string to reach the check at all.
 */
function present<T extends Record<string, unknown>>(fields: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

export function buildEnvelope(draft: Draft): Record<string, unknown> {
  const headingLines = draft.headingLines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const locationAddressLines = draft.locationAddressLines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    pms: 'pracsoft3',
    documentType: 'db4_assignment',
    parserTemplateVersion: draft.parserTemplateVersion,
    /*
     * `capturedAt` IS REQUIRED AT THE DOOR — `@IsISO8601()` with no
     * `@IsOptional()`, so an omitted one is a 400 reading "capturedAt must be
     * a valid ISO 8601 date string". The first send from this tool hit exactly
     * that, because an earlier version of this file treated it as optional and
     * stripped it when blank. A blank field now means NOW, which is what a
     * driver would stamp anyway; the queue pair beside it genuinely is
     * optional and genuinely is stripped.
     */
    capturedAt: draft.capturedAt.trim() || new Date().toISOString(),
    ...present({ queueName: draft.queueName, queueLabel: draft.queueLabel }),
    form: {
      formCode: 'DB4',
      currency: 'AUD',
      signedOnPaper: false,
      ...present({
        formReference: draft.formReference,
        serviceDate: draft.serviceDate,
        locationId: draft.locationId,
        claimStatus: draft.claimStatus,
      }),
    },
    ...(headingLines.length > 0 ? { heading: { lines: headingLines } } : {}),
    /*
     * THE PLACE THAT PRINTED IT. Absent rather than empty when the tester
     * cleared it, because `buildDb4FormView` draws the block on truthiness
     * and an empty name would be a heading over nothing.
     */
    ...(locationAddressLines.length > 0 ||
    draft.locationName.trim() ||
    draft.locationSuburb.trim() ||
    draft.locationState.trim() ||
    draft.locationPostcode.trim()
      ? {
          servicingLocation: {
            ...present({
              name: draft.locationName,
              suburb: draft.locationSuburb,
              state: draft.locationState,
              postcode: draft.locationPostcode,
            }),
            ...(locationAddressLines.length > 0 ? { addressLines: locationAddressLines } : {}),
          },
        }
      : {}),
    patient: {
      pmsLinkageKey: `chart:${draft.patientRecordNumber}`,
      familyName: draft.familyName,
      givenNames: draft.givenNames,
      dateOfBirth: draft.dateOfBirth,
      ...present({
        patientRecordNumber: draft.patientRecordNumber,
        address: draft.address,
        mobile: draft.mobile,
        // ON A DB4 ALONE (D-2026-09-14-03). It rides because the practice's
        // own form prints it; it identifies nobody (hard rule 1, REQ-VER-02).
        // eslint-disable-next-line no-restricted-syntax -- that decided exception, at the one door that accepts it.
        medicareCardNumber: draft.medicareCardNumber,
        irn: draft.irn,
      }),
    },
    /*
     * THE PRIVACY NOTICE AND STATEMENTS, as AOBPRINTER reads them off the
     * page (`Db4AssignmentDto`). Absent when the draft carries none, which is
     * every preset but `long-form`. Copied, never composed.
     */
    ...(draft.assignment
      ? {
          assignment: {
            privacyNotice: [...draft.assignment.privacyNotice],
            ...(draft.assignment.statementsJoinedBy !== undefined
              ? { statementsJoinedBy: draft.assignment.statementsJoinedBy }
              : {}),
            statements: draft.assignment.statements.map((s) => ({ ...s })),
          },
        }
      : {}),
    providers: draft.providers.map((p) => ({
      // REQUIRED BY THE DTO, so an empty name travels as "" — see `present`.
      name: p.name,
      role: p.role,
      pmsProviderKey: `provider:${p.providerNumber}`,
      ...present({ providerNumber: p.providerNumber }),
    })),
    services: draft.services.map((s) => ({
      ...present({
        serviceDate: s.serviceDate,
        time: s.time,
        mbsItemNumber: s.mbsItemNumber,
        description: s.description,
        // THE STRING THE PRACTICE PRINTED, or nothing at all. Never parsed,
        // never reformatted, never given a symbol we chose (hard rule 4).
        benefitAssigned: s.benefitAssigned,
      }),
    })),
  };
}

/** The envelope plus its own hash — what the tool actually posts. */
export async function envelopeWithHash(draft: Draft): Promise<Record<string, unknown>> {
  const envelope = buildEnvelope(draft);
  const sourceSha256 = await sha256Hex(JSON.stringify(canonical(envelope)));
  return { ...envelope, sourceSha256 };
}

/**
 * A STORED RECORD, TURNED BACK INTO THE DRAFT ON THE SCREEN (Carl, 28
 * September 2026: *"we need a drop down of the list of test cases we have
 * already used. Saves typing"*).
 *
 * THE INVERSE OF `buildEnvelope`, AND IT HAS TO BE FAITHFUL. Correcting one
 * field means every OTHER field goes back out exactly as it came in — a
 * reprint that quietly dropped the rest would read as a CHANGED form rather
 * than a corrected one, which under the reprocessing rule supersedes an
 * agreement that only needed repointing. So everything the tool can hold, it
 * loads.
 *
 * WHAT IT CANNOT HOLD, IT DROPS ON PURPOSE. `sourceSha256` is recomputed on
 * send (a correction must move the hash, or it is the same job) and the
 * fields the tool has no control for fall back to the blank draft's. Both are
 * visible in "Show the envelope" before anything is sent.
 */
export function draftFromEnvelope(practiceId: string, stored: Record<string, unknown>, blank: Draft): Draft {
  const get = (path: string[], fallback = ''): string => {
    let node: unknown = stored;
    for (const key of path) {
      if (!node || typeof node !== 'object') return fallback;
      node = (node as Record<string, unknown>)[key];
    }
    return typeof node === 'string' ? node : fallback;
  };
  const list = (key: string): Record<string, unknown>[] => {
    const value = (stored as Record<string, unknown>)[key];
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  };
  const str = (row: Record<string, unknown>, key: string, fallback = ''): string => {
    const v = row[key];
    return typeof v === 'string' ? v : fallback;
  };

  const heading = ((stored.heading as Record<string, unknown> | undefined)?.lines ?? []) as unknown[];
  const locationLines = (
    ((stored.servicingLocation as Record<string, unknown> | undefined)?.addressLines ?? []) as unknown[]
  ).filter((l): l is string => typeof l === 'string');
  const providers = list('providers');
  const services = list('services');

  return {
    ...blank,
    practiceId,
    formReference: get(['form', 'formReference']),
    serviceDate: get(['form', 'serviceDate'], blank.serviceDate),
    locationId: get(['form', 'locationId'], blank.locationId),
    claimStatus: get(['form', 'claimStatus'], blank.claimStatus),
    headingLines: heading.filter((l): l is string => typeof l === 'string').join(String.fromCharCode(10)) || blank.headingLines,
    /*
     * LOADED BACK EMPTY WHEN THE STORED FORM HAD NONE, not from `blank`. A
     * form sent without a place of practice must reprint without one, or
     * correcting one field would silently add a block the practice's page
     * never had.
     */
    locationName: get(['servicingLocation', 'name']),
    locationAddressLines: locationLines.join(String.fromCharCode(10)),
    locationSuburb: get(['servicingLocation', 'suburb']),
    locationState: get(['servicingLocation', 'state']),
    locationPostcode: get(['servicingLocation', 'postcode']),
    patientRecordNumber: get(['patient', 'patientRecordNumber']),
    givenNames: get(['patient', 'givenNames']),
    familyName: get(['patient', 'familyName']),
    dateOfBirth: get(['patient', 'dateOfBirth'], blank.dateOfBirth),
    address: get(['patient', 'address']),
    mobile: get(['patient', 'mobile']),
    // eslint-disable-next-line no-restricted-syntax -- the DB4's decided exception (D-2026-09-14-03), loaded so a correction reprints the rest faithfully.
    medicareCardNumber: get(['patient', 'medicareCardNumber']),
    irn: get(['patient', 'irn']),
    providers:
      providers.length > 0
        ? providers.map((p) => ({
            role: str(p, 'role') === 'payee' ? ('payee' as const) : ('servicing' as const),
            name: str(p, 'name'),
            providerNumber: str(p, 'providerNumber'),
          }))
        : blank.providers,
    services: services.map((s) => ({
      serviceDate: str(s, 'serviceDate', get(['form', 'serviceDate'], blank.serviceDate)),
      time: str(s, 'time', '09:00'),
      mbsItemNumber: str(s, 'mbsItemNumber'),
      description: str(s, 'description'),
      // THE STRING THE PRACTICE PRINTED, or blank where the template read none.
      benefitAssigned: str(s, 'benefitAssigned'),
    })),
    assignment: assignmentOf(stored.assignment),
    queueName: get(['queueName'], blank.queueName),
    queueLabel: get(['queueLabel'], blank.queueLabel),
    parserTemplateVersion: get(['parserTemplateVersion'], blank.parserTemplateVersion),
    // BLANK MEANS NOW on send. Reprinting a form stamps a fresh capture time,
    // which is what a driver would do.
    capturedAt: '',
  };
}

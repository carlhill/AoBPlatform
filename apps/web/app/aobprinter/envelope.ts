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
import type { Draft } from './presets';

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

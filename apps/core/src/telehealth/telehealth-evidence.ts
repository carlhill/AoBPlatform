import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { VaultEventType } from '@aobplatform/contracts';
import { enqueueVaultEvent } from '@aobplatform/vault-client';

/**
 * THE VAULT EVENTS A TELEHEALTH SESSION EMITS — APPROVED BY CARL, 12 OCT 2026
 * (TELEHEALTH-PLAN.md §6 item 8; DECISIONS.md D-2026-10-12-02, "Carl's ruling"
 * item 1; the eighth, `telehealth.code_wrong`, item 8, later the same day).
 *
 * The eight types below are in `VAULT_EVENT_TYPES` (packages/contracts), so
 * the vault's whitelist accepts them. Every domain write in `TelehealthService`
 * hands its event to `record` INSIDE THE SAME TRANSACTION as the write, and
 * `record` enqueues it on the vault outbox with that same `tx`: the domain
 * write and its vault event commit together or not at all (hard rule 11,
 * FR-11.2). That is why `TelehealthService.enabled()` no longer looks at
 * `NODE_ENV`: that restriction existed only while these events had nowhere to
 * go. `TELEHEALTH_ENABLED` (default off) alone gates the feature now.
 *
 * WHAT ELSE IS VAULTED. The provider's identity check goes through
 * `VerificationService.recordStaffVerified`, which emits the approved
 * `verification.staff_verified` event (types only, never values) in the same
 * transaction. The outbound messages are recorded by the outbound queue.
 *
 * PAYLOADS ARE IDS, TYPES, CODES, COUNTS AND TIMES (hard rule 9). Never the
 * 6-digit code, never a contact, never a name, never the `other` note — only
 * whether there was one. `assertNoValues` refuses a payload key that could
 * carry one, so a later edit cannot slip a value in.
 */
export const TELEHEALTH_VAULT_EVENTS_APPROVED = true;

export type TelehealthVaultEvent =
  | {
      type: 'telehealth.session_opened';
      payload: {
        patientId: string;
        practitionerId: string;
        affiliationId: string;
        verificationEventId: string;
        identifierTypeCount: number;
        consenterIsPatient: boolean;
        channel: string;
        contentVersion: string;
      };
    }
  | { type: 'telehealth.link_sent'; payload: { channel: string; sendCount: number; codeExpiresAt: string } }
  | { type: 'telehealth.code_checked'; payload: { attempts: number } }
  /** A wrong code still under the limit: the count after this attempt. Never the code or the digits entered. */
  | { type: 'telehealth.code_wrong'; payload: { attempts: number } }
  | { type: 'telehealth.code_locked_out'; payload: { attempts: number; reviewTaskId: string } }
  | { type: 'telehealth.consent_recorded'; payload: { consentKey: string; contentVersion: string; consenterIsPatient: boolean } }
  | {
      type: 'telehealth.not_done';
      payload: {
        reason: string;
        reasonsVersion: string;
        hasNote: boolean;
        fromState: string;
        consultationAt: string | null;
        recordedAt: string;
      };
    }
  | { type: 'telehealth.did_not_proceed'; payload: { fromState: string; consultationAt: string | null; recordedAt: string } };

export const TELEHEALTH_EVENT_TYPES = [
  'telehealth.session_opened',
  'telehealth.link_sent',
  'telehealth.code_checked',
  'telehealth.code_wrong',
  'telehealth.code_locked_out',
  'telehealth.consent_recorded',
  'telehealth.not_done',
  'telehealth.did_not_proceed',
] as const satisfies readonly (TelehealthVaultEvent['type'] & VaultEventType)[];

export interface TelehealthEvidenceEntry {
  readonly event: TelehealthVaultEvent;
  readonly actor: { principalType: string; id: string };
  readonly subject: { type: 'TelehealthSession'; id: string };
}

/** Keys that would carry a value rather than a type, a count or an id. */
const VALUE_KEYS = /^(code|note|mobile|email|phone|contact|destination|name|givenNames|familyName|dateOfBirth|address|ihi|medicare.*|stated|token|pageKey)$/i;

export function assertNoValues(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (VALUE_KEYS.test(key)) {
      throw new Error(`A telehealth vault payload may not carry "${key}": types, ids, counts and times only (hard rule 9).`);
    }
  }
}

/**
 * Where an entry goes: the vault outbox, on the caller's `tx` (`outboxSink`).
 * Tests may wrap it in a capturing sink to see every entry a write hands
 * over, calling through to `outboxSink` so the outbox still gets the row.
 */
export type TelehealthEvidenceSink = (tx: Prisma.TransactionClient, entry: TelehealthEvidenceEntry) => Promise<void>;

/**
 * A vault payload holds scalars (`VaultEventInput.payload`). A time the
 * provider did not give (`consultationAt: null`) is left out rather than
 * stored as null, as other events leave out what they do not know.
 */
function scalarPayload(payload: TelehealthVaultEvent['payload']): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== null) out[key] = value;
  }
  return out;
}

/** The outbox, on the SAME `tx` as the domain write (hard rule 11, FR-11.2). */
export const outboxSink: TelehealthEvidenceSink = (tx, entry) =>
  enqueueVaultEvent(tx, {
    type: entry.event.type,
    actor: entry.actor,
    subject: entry.subject,
    payload: scalarPayload(entry.event.payload),
  });

@Injectable()
export class TelehealthEvidence {
  sink: TelehealthEvidenceSink = outboxSink;

  async record(tx: Prisma.TransactionClient, entry: TelehealthEvidenceEntry): Promise<void> {
    assertNoValues(entry.event.payload as Record<string, unknown>);
    await this.sink(tx, entry);
  }
}

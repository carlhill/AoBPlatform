import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * THE VAULT EVENTS A TELEHEALTH SESSION WILL EMIT — PROPOSED, NOT YET APPROVED
 * (TELEHEALTH-PLAN.md §6 item 8; DECISIONS.md D-2026-10-12-01, PROPOSED).
 *
 * Additions to `VAULT_EVENT_TYPES` need Carl's approval: the vault is a
 * human-authored zone (CLAUDE.md §7c). So this file holds the exact shapes, and
 * every domain write in `TelehealthService` hands its event to `record` INSIDE
 * THE SAME TRANSACTION as the write — the outbox pattern's shape, with the one
 * line that enqueues it left for the approval.
 *
 * WHY THIS IS NOT SHIPPABLE AS IT STANDS, AND WHAT STOPS IT SHIPPING. Hard rule
 * 11 says a domain write without its vault event must be structurally
 * impossible. Until approval these writes have no vault event, so the feature
 * MUST NOT run anywhere real. `TelehealthService.enabled()` refuses every
 * telehealth route unless `TELEHEALTH_ENABLED=true`, and even then FAILS CLOSED
 * unless `NODE_ENV` is `development` or `test` while
 * `TELEHEALTH_VAULT_EVENTS_APPROVED` below is false. Turning that constant to true is the same commit that adds the types
 * to `VAULT_EVENT_TYPES` and replaces the sink with `enqueueVaultEvent`.
 *
 * WHAT IS ALREADY VAULTED TODAY. The provider's identity check goes through
 * `VerificationService.recordStaffVerified`, which emits the approved
 * `verification.staff_verified` event (types only, never values) in the same
 * transaction. The outbound messages are recorded by the outbound queue.
 *
 * PAYLOADS ARE IDS, TYPES, CODES, COUNTS AND TIMES (hard rule 9). Never the
 * 6-digit code, never a contact, never a name, never the `other` note — only
 * whether there was one. `assertNoValues` refuses a payload key that could
 * carry one, so a later edit cannot slip a value in.
 */
export const TELEHEALTH_VAULT_EVENTS_APPROVED = false;

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

export const PROPOSED_TELEHEALTH_EVENT_TYPES = [
  'telehealth.session_opened',
  'telehealth.link_sent',
  'telehealth.code_checked',
  'telehealth.code_locked_out',
  'telehealth.consent_recorded',
  'telehealth.not_done',
  'telehealth.did_not_proceed',
] as const satisfies readonly TelehealthVaultEvent['type'][];

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
 * Where an entry goes until the types are approved. The default sink discards
 * it; tests install a capturing sink to prove every write hands one over in
 * its own transaction.
 */
export type TelehealthEvidenceSink = (tx: Prisma.TransactionClient, entry: TelehealthEvidenceEntry) => Promise<void>;

@Injectable()
export class TelehealthEvidence {
  private readonly logger = new Logger(TelehealthEvidence.name);
  private warned = false;

  /** Replaced by `enqueueVaultEvent` on approval (see the file comment). */
  sink: TelehealthEvidenceSink = async () => {
    if (!this.warned) {
      this.warned = true;
      this.logger.warn(
        'Telehealth vault event types are PROPOSED and not yet in VAULT_EVENT_TYPES; events are not reaching the ' +
          'vault. This build must not run anywhere real (DECISIONS.md D-2026-10-12-01).',
      );
    }
  };

  async record(tx: Prisma.TransactionClient, entry: TelehealthEvidenceEntry): Promise<void> {
    assertNoValues(entry.event.payload as Record<string, unknown>);
    await this.sink(tx, entry);
  }
}

/**
 * The shapes the kiosk consumes. The waiting-row type is IMPORTED from
 * @aobplatform/domain rather than redeclared (CONVENTIONS.md §5) — it is the
 * projection that keeps a date of birth off this screen, and a local copy
 * would drift the moment somebody added a field to one and not the other.
 */
import type { KioskWaitingRow } from '@aobplatform/domain';

export type { KioskWaitingRow };

/** `GET /kiosk/waiting-list`. */
export interface WaitingListResponse {
  readonly practiceId: string;
  readonly revision: string;
  /** SERVER-DECLARED cadence. The tablet obeys it; it does not pick its own. */
  readonly pollMs: number;
  /** TYPES only, never values (REQ-VER-04). */
  readonly identifierTypes: readonly string[];
  readonly waiting: readonly KioskWaitingRow[];
}

/** `GET /agreements/:id` — only the fields the ceremony reads. */
export interface AgreementResponse {
  readonly id: string;
  readonly type: string;
  readonly status: string;
  readonly patientId: string;
  readonly assignorId: string;
  readonly assignorIsPatient: boolean;
  readonly particulars: Record<string, unknown> | null;
  readonly particularsLockedAt: string | null;
  readonly ruleSetVersion: string | null;
  readonly mappingVersion: string | null;
  readonly renderedArtefactHash: string | null;
}

export interface ChallengeResponse {
  readonly challengeId: string;
  readonly identifierTypes: readonly string[];
}

export interface AttemptResponse {
  readonly outcome: 'passed' | 'failed' | 'locked_out';
  readonly verificationEventId?: string;
  /** Present on a failure. Generic by construction — the kiosk shows its own copy regardless. */
  readonly message?: string;
}

export interface PracticeResponse {
  readonly id: string;
  readonly name: string;
  readonly state?: string | null;
  /** The practice's configured challenge set — the approved six only (REQ-VER-02). */
  readonly identifierTypes?: readonly string[];
}

export interface PracticeUsersResponse {
  readonly users: ReadonlyArray<{ readonly name: string }>;
}

/** Thrown for any non-2xx. Carries the status so a caller can tell 304 from 500. */
export class KioskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'KioskApiError';
  }
}

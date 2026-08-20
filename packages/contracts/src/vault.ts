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
  'signature.captured',
  'notice.composed',
  'notice.dispatched',
  'notice.delivered',
  'notice.failed',
  'notice.corrected',
  'artefact.accessed',
  'artefact.exported',
  'retention.expiry_scheduled',
  'retention.crypto_shredded', // tombstone — the chain stays intact
  'legal_hold.applied',
  'legal_hold.released',
  'nomination.changed',
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

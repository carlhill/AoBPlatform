import type { VaultEventInput } from '@aobplatform/contracts';

/**
 * Minimal structural type for "anything with a `vaultOutbox.create` model
 * accessor" — satisfied by both a PrismaService and the `tx` argument Prisma
 * hands to a `$transaction(async (tx) => ...)` callback, so
 * `enqueueVaultEvent()` works inside a transaction or outside one.
 *
 * `args: any` rather than `unknown` is deliberate and load-bearing
 * (ReferralPlatform build fix #4): TypeScript's contravariant parameter
 * checking means a method declared to accept only `unknown` can never be
 * structurally satisfied by Prisma's narrower generated signature.
 */
export interface VaultOutboxWriter {
  vaultOutbox: {
    create: (args: any) => Promise<unknown>;
  };
}

/** The subset of a Prisma client the relay needs. Same duck-typing rationale. */
export interface VaultOutboxRelayClient {
  vaultOutbox: {
    findMany: (args: any) => Promise<VaultOutboxDbRow[]>;
    update: (args: any) => Promise<unknown>;
  };
}

/**
 * A queued vault event as stored. Loose about `actor`/`payload` (Prisma types
 * these as JsonValue) — the relay only moves them across the wire, it never
 * inspects them. Per REQ-LOG-08 the payload carries no plaintext identifiers.
 */
export interface VaultOutboxDbRow {
  id: string;
  type: string;
  actor: unknown;
  subjectType: string;
  subjectId: string;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
}

/**
 * Enqueues a vault event. For any consent-relevant write, pass the `tx` of the
 * SAME transaction as the domain write (FR-11.2) — that is what makes "no
 * domain write without a vault event" structurally true rather than
 * best-effort.
 */
export async function enqueueVaultEvent(writer: VaultOutboxWriter, input: VaultEventInput): Promise<void> {
  await writer.vaultOutbox.create({
    data: {
      type: input.type,
      actor: input.actor as unknown as Record<string, unknown>,
      subjectType: input.subject.type,
      subjectId: input.subject.id,
      payload: input.payload ?? {},
      occurredAt: new Date(),
    },
  });
}

/** Just the logging surface the relay uses — satisfied by NestJS's Logger. */
export interface RelayLogger {
  warn: (message: string) => void;
  error: (message: string) => void;
}

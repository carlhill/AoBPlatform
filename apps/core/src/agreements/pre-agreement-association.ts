/**
 * ASSOCIATE AN UNSIGNED PRE-AGREEMENT WITH ITS VISIT'S SERVICE, NEVER LINK IT
 * (D-2026-10-10-09; Carl, 10 Oct 2026: option (b)).
 *
 * WHAT "MATCHES" MEANS. An `episodic_pre` that is unsigned and still open
 * (`UNSIGNED_OPEN_STATUSES`), that no service record links (`agreementId`),
 * that nothing has superseded and that is not already associated, for the
 * same practice (RLS), the same patient, the same servicing provider (the
 * affiliation, or the legacy provider row where the agreement predates
 * affiliations) and the same practice-local day (`visitDayOf`: the booking's
 * date, otherwise the day the draft was created, in `PRACTICE_TIMEZONE`).
 *
 * WHAT IS NEVER TOUCHED. `service_records.agreementId`. The post-service
 * cascade reads that column as "already covered"; this file writes only
 * `pre_agreement_associations` and the vault event, so the post-service
 * agreement is still drafted, linked and chased exactly as before.
 *
 * Plain functions on a transaction client, so the association and its vault
 * event commit in the caller's transaction with the service record itself
 * (hard rule 11). Nothing here logs a patient.
 */
import type { Prisma } from '@prisma/client';
import {
  ASSOCIATION_CANDIDATE_TYPES,
  UNSIGNED_OPEN_STATUSES,
  associationOutcomeFor,
  visitDayOf,
  type PreAgreementAssociationHow,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { anchorForLegacyProvider } from '../affiliations/agreement-anchor';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

/** One service record, as much of it as matching needs. */
export interface ServiceVisit {
  id: string;
  patientId: string | null;
  /** The practitioner-at-location the record names, where the sender said (`serviceRendered`). */
  affiliationId: string | null;
  /** The legacy practice-wide provider row the PMS invoice mirror fills. */
  providerId: string | null;
  /** D5, a calendar date (`@db.Date`). */
  serviceDate: Date;
}

/** An unsigned, open, unlinked, unsuperseded, unassociated pre-agreement and the day it is for. */
export interface OpenPreDraft {
  id: string;
  type: string;
  status: string;
  patientId: string;
  affiliationId: string | null;
  providerId: string | null;
  createdAt: Date;
  /** `YYYY-MM-DD` in the practice's zone (`visitDayOf`). */
  forDay: string;
}

/** `YYYY-MM-DD` of a `@db.Date` value. */
export function calendarDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A `YYYY-MM-DD` day as the `@db.Date` value Prisma compares with. */
export function dateColumnOf(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * EVERY OPEN PRE-DRAFT, optionally for some patients only, with the day each
 * one is for. Associated, linked and superseded drafts are left out here so
 * every caller excludes them the same way.
 */
export async function openPreDrafts(
  tx: Prisma.TransactionClient,
  patientIds?: readonly string[],
): Promise<OpenPreDraft[]> {
  const rows = await tx.agreement.findMany({
    where: {
      ...(patientIds ? { patientId: { in: [...patientIds] } } : {}),
      type: { in: [...ASSOCIATION_CANDIDATE_TYPES] },
      status: { in: [...UNSIGNED_OPEN_STATUSES] },
      signatureEventId: null,
      serviceAssociation: { is: null },
    },
    select: { id: true, type: true, status: true, patientId: true, affiliationId: true, providerId: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [linked, successors, appointments] = await Promise.all([
    tx.serviceRecord.findMany({ where: { agreementId: { in: ids } }, select: { agreementId: true } }),
    tx.agreement.findMany({ where: { supersedesAgreementId: { in: ids } }, select: { supersedesAgreementId: true } }),
    tx.appointment.findMany({ where: { agreementId: { in: ids } }, select: { agreementId: true, date: true } }),
  ]);
  const excluded = new Set<string>([
    ...linked.map((s) => s.agreementId as string),
    ...successors.map((s) => s.supersedesAgreementId as string),
  ]);
  const bookedOn = new Map(appointments.map((a) => [a.agreementId as string, a.date]));
  return rows
    .filter((r) => !excluded.has(r.id))
    .map((r) => ({ ...r, forDay: visitDayOf(r, bookedOn.get(r.id) ?? null) }));
}

/**
 * THE AFFILIATION A SERVICE RECORD NAMES: its own column where the sender
 * named the practitioner, otherwise resolved from the legacy provider row the
 * way the invoice mirror resolves it (`anchorForLegacyProvider`).
 */
export async function affiliationOfService(
  tx: Prisma.TransactionClient,
  visit: Pick<ServiceVisit, 'affiliationId' | 'providerId'>,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  if (visit.affiliationId) return visit.affiliationId;
  if (!visit.providerId) return null;
  if (cache?.has(visit.providerId)) return cache.get(visit.providerId) ?? null;
  const provider = await tx.provider.findFirst({ where: { id: visit.providerId } });
  const resolved = provider ? (await anchorForLegacyProvider(tx, provider)).affiliationId : null;
  cache?.set(visit.providerId, resolved);
  return resolved;
}

/** Same patient, same practice-local day, same servicing provider. */
export function draftMatchesService(
  draft: Pick<OpenPreDraft, 'patientId' | 'forDay' | 'affiliationId' | 'providerId'>,
  service: { patientId: string | null; day: string; affiliationId: string | null; providerId: string | null },
): boolean {
  if (!service.patientId || draft.patientId !== service.patientId) return false;
  if (draft.forDay !== service.day) return false;
  if (draft.affiliationId && service.affiliationId && draft.affiliationId === service.affiliationId) return true;
  if (draft.providerId && service.providerId && draft.providerId === service.providerId) return true;
  return false;
}

/** The open pre-drafts that match one service record, oldest first. */
export async function preAgreementCandidates(
  tx: Prisma.TransactionClient,
  visit: ServiceVisit,
): Promise<OpenPreDraft[]> {
  if (!visit.patientId) return [];
  const affiliationId = await affiliationOfService(tx, visit);
  const service = {
    patientId: visit.patientId,
    day: calendarDayOf(visit.serviceDate),
    affiliationId,
    providerId: visit.providerId,
  };
  return (await openPreDrafts(tx, [visit.patientId])).filter((draft) => draftMatchesService(draft, service));
}

/**
 * THE ASSOCIATION AND ITS EVENT, in the caller's transaction (hard rule 11).
 * IDS, THE DAY AND COUNTS ONLY in the payload (hard rules 4 and 9).
 */
export async function recordPreAgreementAssociation(
  tx: Prisma.TransactionClient,
  practiceId: string,
  input: {
    agreementId: string;
    visit: Pick<ServiceVisit, 'id' | 'serviceDate'>;
    how: PreAgreementAssociationHow;
    candidateCount: number;
    /** The person who chose; absent for `automatic`. */
    chosenBy?: { principalType: string; id: string };
  },
) {
  const row = await tx.preAgreementAssociation.create({
    data: {
      practiceId,
      agreementId: input.agreementId,
      serviceRecordId: input.visit.id,
      how: input.how,
      candidateCount: input.candidateCount,
      associatedByPrincipalId: input.how === 'chosen' ? (input.chosenBy?.id ?? null) : null,
    },
  });
  await enqueueVaultEvent(tx, {
    type: 'agreement.service_associated',
    actor: input.how === 'chosen' && input.chosenBy ? input.chosenBy : SYSTEM_ACTOR,
    subject: { type: 'Agreement', id: input.agreementId },
    payload: {
      serviceRecordId: input.visit.id,
      serviceDate: calendarDayOf(input.visit.serviceDate),
      how: input.how,
      candidateCount: input.candidateCount,
      /* Associated, never linked: the service record's agreementId was not touched. */
      linked: false,
    },
  });
  return row;
}

/**
 * WHEN A SERVICE RECORD ARRIVES. Exactly one match: associate it. More than
 * one: associate none, and Reconciliation lists the service for a person to
 * choose (`associationChoices`). None: nothing. Idempotent: a record that
 * already has an association is left as it is.
 */
export async function associateOnServiceArrival(
  tx: Prisma.TransactionClient,
  practiceId: string,
  visit: ServiceVisit,
): Promise<{ outcome: 'already' | 'none' | 'associate' | 'choose'; candidateCount: number; agreementId?: string }> {
  const existing = await tx.preAgreementAssociation.findFirst({ where: { serviceRecordId: visit.id } });
  if (existing) return { outcome: 'already', candidateCount: existing.candidateCount, agreementId: existing.agreementId };
  const candidates = await preAgreementCandidates(tx, visit);
  const outcome = associationOutcomeFor(candidates.length);
  if (outcome !== 'associate') return { outcome, candidateCount: candidates.length };
  const only = candidates[0]!;
  await recordPreAgreementAssociation(tx, practiceId, {
    agreementId: only.id,
    visit,
    how: 'automatic',
    candidateCount: 1,
  });
  return { outcome, candidateCount: 1, agreementId: only.id };
}

/** A service record with unsigned drafts that match it and none associated. */
export interface AssociationChoice {
  service: ServiceVisit;
  candidates: OpenPreDraft[];
}

/**
 * EVERY SERVICE RECORD A PERSON HAS TO CHOOSE FOR: no association yet, and at
 * least one open pre-draft that matches it. Read, never written.
 */
export async function associationChoices(tx: Prisma.TransactionClient): Promise<AssociationChoice[]> {
  const drafts = await openPreDrafts(tx);
  if (drafts.length === 0) return [];
  const patientIds = [...new Set(drafts.map((d) => d.patientId))];
  const days = [...new Set(drafts.map((d) => d.forDay))].map(dateColumnOf);
  const services = await tx.serviceRecord.findMany({
    where: { patientId: { in: patientIds }, serviceDate: { in: days }, preAgreementAssociation: { is: null } },
    select: { id: true, patientId: true, affiliationId: true, providerId: true, serviceDate: true },
    orderBy: [{ serviceDate: 'asc' }, { id: 'asc' }],
  });
  const cache = new Map<string, string | null>();
  const choices: AssociationChoice[] = [];
  for (const service of services) {
    const affiliationId = await affiliationOfService(tx, service, cache);
    const day = calendarDayOf(service.serviceDate);
    const candidates = drafts.filter((d) =>
      draftMatchesService(d, { patientId: service.patientId, day, affiliationId, providerId: service.providerId }),
    );
    if (candidates.length > 0) choices.push({ service, candidates });
  }
  return choices;
}

/**
 * THE SERVICE RECORDS THAT MATCH ONE DRAFT'S VISIT -- linked to something,
 * associated with something, or neither. What the tablet's earlier-days line
 * and the closure sweep ask: "was a service recorded for this visit at all?"
 */
export async function servicesMatchingDraft(
  tx: Prisma.TransactionClient,
  draft: Pick<OpenPreDraft, 'patientId' | 'forDay' | 'affiliationId' | 'providerId'>,
  cache?: Map<string, string | null>,
) {
  const services = await tx.serviceRecord.findMany({
    where: { patientId: draft.patientId, serviceDate: dateColumnOf(draft.forDay) },
    select: {
      id: true,
      patientId: true,
      affiliationId: true,
      providerId: true,
      serviceDate: true,
      preAgreementAssociation: { select: { agreementId: true } },
    },
    orderBy: [{ id: 'asc' }],
  });
  const matched: typeof services = [];
  for (const service of services) {
    const affiliationId = await affiliationOfService(tx, service, cache);
    const seen = {
      patientId: service.patientId,
      day: calendarDayOf(service.serviceDate),
      affiliationId,
      providerId: service.providerId,
    };
    if (draftMatchesService(draft, seen)) matched.push(service);
  }
  return matched;
}

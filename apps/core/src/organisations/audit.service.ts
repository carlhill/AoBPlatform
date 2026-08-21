import { Injectable } from '@nestjs/common';
import {
  CHECK_CATALOGUE,
  markSuperseded,
  orderAuditTrail,
  summariseAudit,
  type AuditEntry,
} from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Everything that has happened to one application, merged into one trail.
 *
 * The records live in four append-only tables and were previously only
 * readable one at a time. Merging them is the whole point: a reviewer should
 * not have to correlate three lists by timestamp in their head to notice that
 * an applicant changed a phone number the day after it was verified.
 *
 * WHAT IS DELIBERATELY INCLUDED even though it is unflattering: superseded
 * checks, failed checks, and every amendment. An audit trail that only shows
 * the current state is a summary, and a summary is exactly what is useless in
 * a dispute. Nothing here is ever hidden — a later entry can mark an earlier
 * one superseded, and both stay readable.
 *
 * WHAT IS DELIBERATELY EXCLUDED: nothing about any other practice, and no
 * provider numbers. This is scoped by withPractice, so RLS enforces the first;
 * the second never enters these tables at all.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private static label(checkKey: string): string {
    return CHECK_CATALOGUE.find((c) => c.key === checkKey)?.label ?? checkKey;
  }

  private static outcomeWord(outcome: string): string {
    switch (outcome) {
      case 'passed':
        return 'Passed';
      case 'failed':
        return 'Failed';
      case 'not_applicable':
        return 'Not applicable';
      case 'could_not_complete':
        return 'Could not complete';
      default:
        return outcome;
    }
  }

  /** Field names as an applicant would recognise them. */
  private static fieldLabel(field: string): string {
    const labels: Record<string, string> = {
      name: 'Practice name',
      website: 'Website',
      adminName: 'Applicant name',
      adminEmail: 'Applicant email',
      adminPhone: 'Applicant phone',
      adminPosition: 'Applicant position',
      managerName: 'Second contact name',
      managerEmail: 'Second contact email',
      managerPhone: 'Second contact phone',
      managerPosition: 'Second contact position',
      headOfficeLine1: 'Head office address',
      headOfficeLine2: 'Head office unit / level',
      headOfficeSuburb: 'Head office suburb',
      headOfficeState: 'Head office state',
      headOfficePostcode: 'Head office postcode',
      statedPractitionerCount: 'Practitioner count',
    };
    return labels[field] ?? field;
  }

  async trail(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const [practice, checks, amendments, artefacts, ceremonies] = await Promise.all([
        tx.practice.findFirstOrThrow({ where: { id: practiceId } }),
        tx.practiceCheck.findMany({ orderBy: { performedAt: 'asc' } }),
        tx.$queryRaw<
          Array<{
            field: string;
            valueBefore: string | null;
            valueAfter: string | null;
            amendedAt: Date;
            amendedByName: string;
            affectedChecks: string[];
          }>
        >`SELECT "field", "valueBefore", "valueAfter", "amendedAt", "amendedByName", "affectedChecks"
            FROM "application_amendments" ORDER BY "amendedAt" ASC`,
        tx.artefact.findMany({ orderBy: { uploadedAt: 'asc' } }),
        tx.enrolmentCeremony.findMany({ orderBy: { performedAt: 'asc' } }),
      ]);

      const entries: Array<AuditEntry & { subject?: string }> = [];

      entries.push({
        kind: 'submitted',
        at: practice.createdAt.toISOString(),
        who: practice.adminName,
        summary: `Applied as ${practice.name}`,
        detail: {
          ABN: practice.abn ?? '—',
          // Provenance, because "the register said ACTIVE" and "the applicant
          // said the register said ACTIVE" are different claims.
          'Verified via':
            practice.abnVerificationSource === 'manual_attestation'
              ? `Applicant attestation, sighted by ${practice.abnSightedByName ?? 'the applicant'}`
              : 'ABR API',
          'Name match': practice.nameMatchTier ?? '—',
        },
      });

      if (practice.adminEmailVerifiedAt) {
        entries.push({
          kind: 'email_verified',
          at: practice.adminEmailVerifiedAt.toISOString(),
          who: practice.adminName,
          summary: 'Confirmed control of the applicant email address',
          detail: { Address: practice.adminEmail ?? '—' },
        });
      }

      if (practice.correctionRequestedAt) {
        entries.push({
          kind: 'correction_requested',
          at: practice.correctionRequestedAt.toISOString(),
          who: practice.correctionRequestedByName,
          summary: 'Asked the applicant to correct the application',
          detail: {
            Reason: practice.correctionReason ?? '—',
            Closes: practice.correctionExpiresAt?.toISOString().slice(0, 10) ?? '—',
          },
        });
      }

      /*
       * Amendments are GROUPED by submission, not listed one per field.
       *
       * An applicant correcting five fields performed ONE act, and a trail that
       * reports it as five entries buries the rest of the history under it —
       * which is precisely what happened the first time this view was read: a
       * single afternoon produced forty-two rows and nothing else was visible.
       *
       * Grouped by (person, second). Two submissions a second apart by the same
       * person is not a case worth splitting; a hundred fields in one
       * submission is.
       */
      const byBatch = new Map<string, typeof amendments>();
      for (const amendment of amendments) {
        const key = `${amendment.amendedByName}@${amendment.amendedAt.toISOString().slice(0, 19)}`;
        const batch = byBatch.get(key) ?? [];
        batch.push(amendment);
        byBatch.set(key, batch);
      }

      for (const batch of byBatch.values()) {
        const affected = [...new Set(batch.flatMap((a) => a.affectedChecks))];
        entries.push({
          kind: 'amended',
          // The subject is the SET of fields, so a later batch touching the same
          // fields supersedes this one and a batch touching different fields
          // does not.
          subject: batch
            .map((a) => a.field)
            .sort()
            .join(','),
          at: batch[0].amendedAt.toISOString(),
          who: batch[0].amendedByName,
          summary:
            batch.length === 1
              ? `Changed ${AuditService.fieldLabel(batch[0].field)}`
              : `Corrected ${batch.length} fields`,
          detail: {
            ...Object.fromEntries(
              batch.map((a) => [
                AuditService.fieldLabel(a.field),
                `${a.valueBefore ?? '(blank)'}  →  ${a.valueAfter ?? '(blank)'}`,
              ]),
            ),
            // The line that earns this whole view: a value a reviewer had
            // already verified, changed afterwards.
            ...(affected.length > 0
              ? { 'Bears on checks already recorded': affected.map((k) => AuditService.label(k)).join('; ') }
              : {}),
          },
        });
      }

      for (const check of checks) {
        const fields = (check.fields ?? {}) as Record<string, string>;
        entries.push({
          kind: 'check',
          subject: check.checkKey,
          at: check.performedAt.toISOString(),
          who: check.performedByName,
          summary: `${AuditService.outcomeWord(check.outcome)} — ${AuditService.label(check.checkKey)}`,
          detail: {
            Weight: check.weight,
            ...(check.reasonCode ? { Reason: check.reasonCode.replace(/_/g, ' ') } : {}),
            ...(check.note ? { Note: check.note } : {}),
            ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.replace(/_/g, ' '), String(v)])),
            Checklist: check.checklistVersion,
          },
        });
      }

      // Which check each file is cited for, so the trail says what a document
      // was attached AS rather than merely that it was attached.
      const checkById = new Map(checks.map((c) => [c.id, c]));

      for (const artefact of artefacts) {
        const citedFor =
          artefact.subjectType === 'PracticeCheck' && artefact.subjectId
            ? checkById.get(artefact.subjectId)
            : undefined;

        entries.push({
          kind: 'evidence',
          at: artefact.uploadedAt.toISOString(),
          who: artefact.uploadedByName,
          // The id travels with the entry so the reader can OPEN it. A trail
          // that names a document nobody can read is a list of filenames.
          artefactId: artefact.deletedAt ? null : artefact.id,
          summary: citedFor
            ? `Attached ${artefact.filename ?? 'a file'} — ${AuditService.label(citedFor.checkKey)}`
            : `Attached ${artefact.filename ?? 'a file'}`,
          detail: {
            Purpose: artefact.purpose.replace(/_/g, ' '),
            Type: artefact.detectedContentType,
            Size: `${Math.max(1, Math.round(artefact.sizeBytes / 1024))} KB`,
            // The hash is the reason the artefact means anything later: it is
            // what proves the file read in a dispute is the file uploaded now.
            SHA256: artefact.sha256,
            ...(artefact.declaredTypeMismatch
              ? { Note: 'The declared type did not match the detected type.' }
              : {}),
            ...(artefact.deletedAt
              ? { Removed: `${artefact.deletedAt.toISOString().slice(0, 10)} — ${artefact.deletedReason ?? ''}` }
              : {}),
          },
        });
      }

      for (const ceremony of ceremonies) {
        entries.push({
          kind: 'ceremony',
          at: ceremony.performedAt.toISOString(),
          who: ceremony.verifiedByName,
          summary: `Enrolment ceremony recorded (${ceremony.subjectKind})`,
          detail: {
            'Person verified by': ceremony.personVerificationMethod.replace(/_/g, ' '),
            ...(ceremony.evidenceNote ? { Note: ceremony.evidenceNote } : {}),
          },
        });
      }

      if (practice.validatedAt) {
        entries.push({
          kind: 'decision',
          at: practice.validatedAt.toISOString(),
          who: practice.validatedByName,
          summary: practice.validationState === 'validated' ? 'Approved' : 'Rejected',
          detail: {
            ...(practice.validationNote ? { Note: practice.validationNote } : {}),
            ...(practice.entitlementMethod
              ? { 'Entitlement checked by': practice.entitlementMethod.replace(/_/g, ' ') }
              : {}),
            ...(practice.entitlementNumberSource
              ? { 'Number came from': practice.entitlementNumberSource.replace(/_/g, ' ') }
              : {}),
            ...(practice.entitlementSpokeWithName ? { 'Spoke to': practice.entitlementSpokeWithName } : {}),
            ...(practice.identityScoreAtDecision !== null
              ? {
                  'Identity score at the moment of decision': `${practice.identityScoreAtDecision} (${
                    practice.identityWouldPassAtDecision ? 'would meet' : 'would not meet'
                  } the threshold; enforcement ${practice.identityEnforcementAtDecision ?? 'soft'})`,
                }
              : {}),
          },
        });
      }

      const ordered = orderAuditTrail(markSuperseded(entries));
      return { entries: ordered, summary: summariseAudit(ordered) };
    });
  }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PracticeAgreementTemplate, Prisma } from '@prisma/client';
import {
  AGREEMENT_TEMPLATES,
  AGREEMENT_TEMPLATES_VERSION,
  AgreementTemplateError,
  assertAgreementTemplateBody,
  genericAgreementTemplate,
  templateTypeFor,
  type AgreementTemplate,
  type AgreementTemplateType,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../auth/actor.decorator';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

/**
 * WHICH WORDS THIS PRACTICE'S AGREEMENTS ARE MADE FROM (Carl, 5 Sep 2026;
 * PMS_to_AoB_Workflow.md W1).
 *
 * TWO SOURCES, ONE ANSWER. Every practice starts on the generic template —
 * versioned content in `packages/domain/content/agreement-templates.json`,
 * shipped with the platform. A practice that wants different words proposes a
 * VARIANT, which is stored here in the same schema and validated by the same
 * loader, and which takes effect only when a PLATFORM OPERATOR has read it.
 *
 * WHY A PRACTICE CANNOT ACTIVATE ITS OWN. These are the operative words of a
 * contract with statutory exposure. A practice manager rewriting them at 4pm
 * and having them in front of a patient at 4:01 is exactly the failure mode
 * this regime punishes — signing a document whose particulars are wrong is the
 * offence (REQ-REG-06), and words that mis-state what is being assigned are
 * worse than a missing field because they are legible and believed. So
 * activation is a review, by a person, recorded with their name. The database
 * refuses an `active` row without one; this service refuses it earlier and
 * says why.
 *
 * RETIRING FALLS BACK TO THE GENERIC, never to nothing. The platform must
 * always be able to render an agreement (hard rule 8 — no flow may stop a
 * patient being seen), so "this practice's variant is withdrawn" means "back
 * to the words we ship", not "this practice cannot make agreements".
 */
@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * THE ONE RESOLUTION THE LOCK USES. Active practice variant if there is one,
   * generic otherwise.
   *
   * A STORED VARIANT IS RE-VALIDATED ON THE WAY OUT, not merely on the way in.
   * The loader's refusals are compliance rules, and a row written by an older
   * build — or edited in the database by somebody with a psql prompt — must not
   * be able to reach a patient because it passed a check that has since become
   * stricter. If a stored variant no longer validates the practice falls back
   * to the generic and the refusal is surfaced, rather than the agreement
   * being blocked (hard rule 8).
   */
  async resolve(
    practiceId: string,
    agreementType: string,
  ): Promise<{
    readonly template: AgreementTemplate;
    readonly source: 'generic' | 'practice';
    readonly contentVersion: string;
    /** Set when a stored variant was refused and the generic stood in. */
    readonly fallbackReason?: string;
  }> {
    const type = templateTypeFor(agreementType);
    const generic = genericAgreementTemplate(type);

    const active = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practiceAgreementTemplate.findFirst({ where: { agreementType: type, status: 'active' } }),
    );
    if (!active) {
      return { template: generic, source: 'generic', contentVersion: AGREEMENT_TEMPLATES_VERSION };
    }

    try {
      const template = this.parseStoredBody(active);
      return { template, source: 'practice', contentVersion: active.version };
    } catch (err) {
      return {
        template: generic,
        source: 'generic',
        contentVersion: AGREEMENT_TEMPLATES_VERSION,
        fallbackReason: (err as Error).message,
      };
    }
  }

  /** The generic words, read-only, for the console to show beside a variant. */
  generic(type: AgreementTemplateType): AgreementTemplate {
    return genericAgreementTemplate(type);
  }

  async list(practiceId: string) {
    const rows = await this.prisma.withPractice(practiceId, (tx) =>
      tx.practiceAgreementTemplate.findMany({ orderBy: [{ agreementType: 'asc' }, { createdAt: 'desc' }] }),
    );
    return {
      contentVersion: AGREEMENT_TEMPLATES_VERSION,
      generic: AGREEMENT_TEMPLATES.templates,
      placeholders: AGREEMENT_TEMPLATES.placeholders,
      conditions: AGREEMENT_TEMPLATES.conditions,
      variants: rows.map((row) => this.view(row)),
    };
  }

  /**
   * PROPOSE OR REVISE A DRAFT. Validated against the same loader as the
   * generic file, so the practice gets the refusal at the moment it types the
   * thing rather than at a tablet: no amount, no practitioner signature line,
   * no approval words, no missing D-element.
   *
   * A DRAFT IS EDITABLE, AN ACTIVE VARIANT IS NOT. Changing live wording is a
   * new version, proposed and reviewed again — the same "corrections
   * supersede" shape as HARD-02, and for the same reason: an agreement records
   * which version it was made from, and a version whose words can change
   * afterwards records nothing.
   */
  async propose(
    practiceId: string,
    input: { agreementType: string; version: string; body: unknown; notes?: string },
    actor?: Actor,
  ) {
    const type = this.assertType(input.agreementType);
    const template = this.validateBody(input.body, type, input.version);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const existing = await tx.practiceAgreementTemplate.findFirst({
        where: { agreementType: type, version: input.version },
      });
      if (existing && existing.status !== 'draft') {
        throw new BadRequestException(
          `Version ${input.version} is ${existing.status}. Wording that has been submitted or activated is ` +
            'not edited in place — propose a new version, so an agreement made under the old one still says ' +
            'what it was made from.',
        );
      }

      const row = existing
        ? await tx.practiceAgreementTemplate.update({
            where: { id: existing.id },
            data: { body: template as unknown as Prisma.InputJsonValue, notes: input.notes ?? null },
          })
        : await tx.practiceAgreementTemplate.create({
            data: {
              practiceId,
              agreementType: type,
              version: input.version,
              status: 'draft',
              body: template as unknown as Prisma.InputJsonValue,
              notes: input.notes ?? null,
            },
          });

      await enqueueVaultEvent(tx, {
        type: 'template.proposed',
        actor: actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR,
        subject: { type: 'PracticeAgreementTemplate', id: row.id },
        payload: {
          agreementType: type,
          version: input.version,
          revision: existing ? 'edited' : 'created',
          statementCount: template.statements.length,
        },
      });
      return this.view(row);
    });
  }

  /** Hand it to the platform to read. Nothing about the words changes here. */
  async submit(practiceId: string, id: string, actor?: Actor) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const row = await this.require(tx, id);
      if (row.status !== 'draft') {
        throw new BadRequestException(`This wording is ${row.status}, so there is nothing to submit.`);
      }
      const updated = await tx.practiceAgreementTemplate.update({
        where: { id },
        data: {
          status: 'in_review',
          submittedAt: new Date(),
          submittedByName: actor?.name ?? null,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'template.proposed',
        actor: actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR,
        subject: { type: 'PracticeAgreementTemplate', id },
        payload: { agreementType: row.agreementType, version: row.version, action: 'submitted_for_review' },
      });
      return this.view(updated);
    });
  }

  /**
   * `practice_template_cannot_activate_itself` — THE RULE THIS WHOLE MODULE
   * EXISTS FOR.
   *
   * The actor must be a PLATFORM principal. A practice-admin token, however
   * valid, is refused here even though it can reach every other method above;
   * the controller also gates it with `@RequireRoles(PLATFORM_ADMIN)`, and the
   * database refuses an active row with no reviewer. Three layers, because the
   * cost of getting it wrong is unreviewed legal copy in front of a patient.
   */
  async activate(practiceId: string, id: string, reviewNotes: string | undefined, actor: Actor | undefined) {
    this.assertPlatformReviewer(actor);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const row = await this.require(tx, id);
      if (row.status !== 'in_review') {
        throw new BadRequestException(
          `Only wording that has been submitted for review can be activated; this is ${row.status}.`,
        );
      }
      // Re-validate at the moment of activation. The loader may have grown
      // stricter since the practice typed it, and the stricter rule wins.
      this.validateBody(row.body, row.agreementType as AgreementTemplateType, row.version);

      // ONE ACTIVE VARIANT PER TYPE. The one it replaces is retired in the
      // same transaction — a unique index enforces it too, and a retired
      // predecessor is a history rather than a deletion.
      const current = await tx.practiceAgreementTemplate.findFirst({
        where: { agreementType: row.agreementType, status: 'active' },
      });
      if (current) {
        await tx.practiceAgreementTemplate.update({
          where: { id: current.id },
          data: { status: 'retired', retiredAt: new Date() },
        });
        await enqueueVaultEvent(tx, {
          type: 'template.retired',
          actor: { principalType: actor!.principalType, id: actor!.id },
          subject: { type: 'PracticeAgreementTemplate', id: current.id },
          payload: { agreementType: current.agreementType, version: current.version, reason: 'superseded' },
        });
      }

      const now = new Date();
      const updated = await tx.practiceAgreementTemplate.update({
        where: { id },
        data: {
          status: 'active',
          reviewedByName: actor!.name,
          reviewedAt: now,
          activatedAt: now,
          reviewNotes: reviewNotes ?? null,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'template.activated',
        actor: { principalType: actor!.principalType, id: actor!.id },
        subject: { type: 'PracticeAgreementTemplate', id },
        payload: {
          agreementType: row.agreementType,
          version: row.version,
          reviewedBy: actor!.name,
          replaced: current?.version ?? 'none',
        },
      });
      return this.view(updated);
    });
  }

  /** Send it back with a reason. The practice sees the words verbatim. */
  async requestChanges(practiceId: string, id: string, reviewNotes: string, actor: Actor | undefined) {
    this.assertPlatformReviewer(actor);
    if (!reviewNotes?.trim()) {
      throw new BadRequestException('Say what needs to change. A refusal with no reason is not a review.');
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const row = await this.require(tx, id);
      if (row.status !== 'in_review') {
        throw new BadRequestException(`This wording is ${row.status}, so there is nothing under review.`);
      }
      const updated = await tx.practiceAgreementTemplate.update({
        where: { id },
        data: {
          status: 'draft',
          reviewedByName: actor!.name,
          reviewedAt: new Date(),
          reviewNotes,
        },
      });
      return this.view(updated);
    });
  }

  /**
   * WITHDRAW THE PRACTICE'S OWN WORDING. Agreements go back to the generic
   * template from the next lock; every agreement already made keeps the
   * version it records, and keeps re-verifying against the document stored
   * with it (rule 13).
   */
  async retire(practiceId: string, id: string, actor?: Actor) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const row = await this.require(tx, id);
      if (row.status === 'retired') return this.view(row);
      const updated = await tx.practiceAgreementTemplate.update({
        where: { id },
        data: { status: 'retired', retiredAt: new Date() },
      });
      await enqueueVaultEvent(tx, {
        type: 'template.retired',
        actor: actor ? { principalType: actor.principalType, id: actor.id } : SYSTEM_ACTOR,
        subject: { type: 'PracticeAgreementTemplate', id },
        payload: { agreementType: row.agreementType, version: row.version, reason: 'withdrawn' },
      });
      return this.view(updated);
    });
  }

  // ---------------------------------------------------------------- helpers

  private assertPlatformReviewer(actor: Actor | undefined): void {
    /*
     * NO ACTOR IS A REFUSAL, not a fallback to the system principal. Every
     * other write on this platform that predates verified sessions falls back
     * to `SYSTEM_ACTOR` so an existing save keeps working; activation must not,
     * because the whole content of the act is "a named person read this".
     */
    if (!actor) {
      throw new ForbiddenException(
        'Activating wording records who read it, so it cannot be done without a signed-in reviewer.',
      );
    }
    if (actor.principalType === 'practice' || actor.practiceId) {
      throw new ForbiddenException(
        'A practice cannot activate its own agreement wording. These are the operative words of a contract ' +
          'with statutory exposure, and they are read by a platform reviewer before any patient sees them.',
      );
    }
  }

  private assertType(value: string): AgreementTemplateType {
    if (value !== 'episodic' && value !== 'enduring') {
      throw new BadRequestException('agreementType must be "episodic" or "enduring".');
    }
    return value;
  }

  /**
   * The loader, applied to a body that arrived over HTTP or came back out of
   * the database. The refusal text is the loader's own — it names the line and
   * the rule, which is what somebody editing wording needs to see.
   */
  private validateBody(body: unknown, type: AgreementTemplateType, version: string): AgreementTemplate {
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException('The wording must be an object in the template schema.');
    }
    const raw = body as Record<string, unknown>;
    const candidate: AgreementTemplate = {
      id: typeof raw.id === 'string' ? raw.id : `practice-${type}`,
      version,
      agreementType: type,
      // A practice variant is never `active_generic`: that status belongs to
      // the shipped file. Its lifecycle is the row's `status` column.
      status: 'draft_pending_review',
      title: String(raw.title ?? ''),
      note: typeof raw.note === 'string' && raw.note.trim() ? raw.note : 'Practice wording variant.',
      sections: normaliseSections(raw.sections),
      statements: normaliseStatements(raw.statements),
      footer: Array.isArray(raw.footer) ? raw.footer.map(String) : [],
    };
    if (!candidate.title.trim()) throw new BadRequestException('The wording needs a title.');
    try {
      assertAgreementTemplateBody(
        candidate,
        { placeholders: AGREEMENT_TEMPLATES.placeholders, conditions: AGREEMENT_TEMPLATES.conditions },
        `This practice's ${type} wording (${version})`,
      );
    } catch (err) {
      if (err instanceof AgreementTemplateError) throw new BadRequestException(err.message);
      throw err;
    }
    return candidate;
  }

  private parseStoredBody(row: PracticeAgreementTemplate): AgreementTemplate {
    return this.validateBody(row.body, row.agreementType as AgreementTemplateType, row.version);
  }

  private async require(tx: Prisma.TransactionClient, id: string): Promise<PracticeAgreementTemplate> {
    const row = await tx.practiceAgreementTemplate.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('That wording was not found in this practice.');
    return row;
  }

  private view(row: PracticeAgreementTemplate) {
    return {
      id: row.id,
      agreementType: row.agreementType,
      version: row.version,
      status: row.status,
      body: row.body,
      notes: row.notes,
      submittedByName: row.submittedByName,
      submittedAt: row.submittedAt,
      reviewedByName: row.reviewedByName,
      reviewedAt: row.reviewedAt,
      reviewNotes: row.reviewNotes,
      activatedAt: row.activatedAt,
      retiredAt: row.retiredAt,
    };
  }
}

function normaliseSections(value: unknown): AgreementTemplate['sections'] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return {
      key: typeof s.key === 'string' && /^[a-z][a-z0-9_]*$/.test(s.key) ? s.key : `section_${i + 1}`,
      heading: String(s.heading ?? ''),
      paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs.map(String) : [],
    };
  });
}

function normaliseStatements(value: unknown): AgreementTemplate['statements'] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    return { key: String(s.key ?? ''), text: String(s.text ?? '') };
  });
}

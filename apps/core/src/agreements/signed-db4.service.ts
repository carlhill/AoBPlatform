import { Injectable, Logger } from '@nestjs/common';
import type { PrintJobEnvelope } from '@aobplatform/contracts';
import { SIGNED_DB4_CONTENT } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArtefactsService } from '../artefacts/artefacts.service';
import { PrintRecordsService } from '../inbound/print-records.service';
import { RendererRegistry } from '../render/renderer-registry';
import { SignedDb4Renderer } from '../render/signed-db4-renderer';
import { SignedDb4RenderRefusal, type SignedDb4Document } from '../render/signed-db4-document';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

/**
 * THE PURPOSE THE BYTES ARE STORED UNDER. Its own, not `other`: the Signed-DB4
 * is the one artefact kind that deliberately carries both a Medicare card
 * number and an amount, and a retention or export question about it has to be
 * answerable without reading the bytes.
 */
const SIGNED_DB4_PURPOSE = 'signed_db4';

/**
 * NOT THE ASSIGNOR'S NAME. The same attribution the signature artefacts use,
 * and for the same reason: the identity of the signer is bound through the
 * agreement, and copying a name onto an artefact row would put it in a second
 * place for no evidential gain (REQ-LOG-08).
 */
const SIGNED_DB4_ATTRIBUTION = 'signed-db4 render';

/**
 * WHY A SIGNED-DB4 WAS NOT PRODUCED — a code, never a shrug. Every one of
 * these is a normal answer rather than an error, and none of them touches the
 * agreement: it stays signed, stored and written back (hard rule 8).
 */
export const SIGNED_DB4_NOT_PRODUCED_REASONS = [
  /** No agreement with that id for this practice. */
  'agreement_not_found',
  /**
   * THE GATE. `sourcePrintJobId` is null, so this agreement did not come from
   * a printed DB4 — a waiting-room kiosk agreement, an enduring one, a
   * telehealth pre-agreement. There is no form to reproduce and producing one
   * would mean inventing a page. Most agreements land here, on purpose.
   */
  'not_from_a_db4',
  /** The signature has to be ON it, so there is nothing to draw until there is one. */
  'not_signed',
  /**
   * A tap-to-approve signature stores no strokes and no image (REQ-SIG-01), so
   * there is no mark to composite. Recorded rather than faked: a Signed-DB4
   * with a drawn-looking signature nobody drew would be worse than none.
   */
  'no_drawn_signature',
  /** The print job row is gone or belongs to another practice. */
  'print_record_missing',
  /** Already done. Asking twice is how a retry is meant to behave. */
  'already_produced',
  /** The render itself refused or failed; the agreement is untouched. Whether a retry helps depends on why (see the log). */
  'render_failed',
] as const;

export type SignedDb4NotProducedReason = (typeof SIGNED_DB4_NOT_PRODUCED_REASONS)[number];

/**
 * WHAT TO SAY ABOUT RETRYING EACH REASON, AND NOTHING MORE THAN IS TRUE OF
 * IT (wow.md §13). Only the four reasons `produceAfterSignature` warns on
 * reach this map.
 *
 * `agreement_not_found` and `no_drawn_signature` are never retryable: an
 * agreement id this practice does not have now will not exist later, and a
 * tap-to-approve signature event is append-only and will never grow a
 * raster to draw (REQ-SIG-01).
 *
 * `not_signed` and `print_record_missing` are NOT claimed retryable either,
 * because this code cannot tell whether they are. `produce` reads
 * `signatureEventId` but never `status`, so an agreement waiting to be
 * signed and one that will never be signed again (voided, superseded) read
 * identically here. `print-records.service.ts` returns the same null
 * whether the print job row is gone for good or was read for the wrong
 * practice. Saying "retryable" would be true for one cause and false for
 * the other with no way to tell which from this call — exactly the
 * confident wrong answer wow.md §13 rules out.
 */
const NOT_PRODUCED_LOG_DETAIL: Record<SignedDb4NotProducedReason, string> = {
  agreement_not_found: 'no agreement with that id exists for this practice. Not retryable.',
  not_from_a_db4: 'the agreement did not come from a printed DB4.',
  not_signed: 'the agreement has no signature event yet. Whether that will change is not known from here.',
  no_drawn_signature:
    'the signature event has no raster to draw — a tap-to-approve signature never has one. Not retryable.',
  print_record_missing:
    'the source print job row was not found for this practice. Whether it is gone for good, or was read ' +
    'for the wrong practice, cannot be told from here.',
  already_produced: 'a Signed-DB4 already exists for this agreement.',
  render_failed: 'the render itself failed.',
};

/**
 * THE ROW SAID SOMEBODY ELSE GOT THERE FIRST. Thrown to roll the transaction
 * back — a return value could not, and a half-written claim with no artefact
 * beside it would lock the agreement out of ever having one. Private to this
 * file; the caller sees `already_produced` like every other way of getting
 * that answer.
 */
class AlreadyProduced extends Error {
  constructor() {
    super('A Signed-DB4 was produced for this agreement while this render was in flight.');
    this.name = 'AlreadyProduced';
  }
}

export type SignedDb4Outcome =
  | {
      readonly produced: true;
      readonly artefactId: string;
      readonly sha256: string;
      readonly rendererVersion: string;
      readonly contentVersion: string;
    }
  | { readonly produced: false; readonly reason: SignedDb4NotProducedReason };

/**
 * PRODUCE THE SIGNED-DB4 — the practice's own form, reproduced by us, with the
 * cost printed, the Medicare card number in full and the patient's signature
 * at the bottom (D-2026-09-14-02/-03; DB4-AND-AOBL.md §12).
 *
 * ── WHY IT HAPPENS AFTER SIGNING, AND NOT AT THE LOCK ──
 *
 * Because the signature has to be ON it. That is the requirement, in the
 * practice's own words, and it is the one thing the ordinary agreement path
 * deliberately does not do: an agreement's bytes are hashed at the LOCK,
 * before anybody signs, and the mark is stored as its own artefacts and bound
 * on the `SignatureEvent` rather than composited into the PDF. Compositing it
 * there would move the bytes after the hash, which is exactly the tamper
 * signal hard rule 13 exists to raise. So the Signed-DB4 is a SECOND artefact,
 * rendered once the signature has committed, hashed at ITS render, and
 * recorded beside — never instead of — the agreement's own.
 *
 * ── AND WHY IT CAN NEVER UNSIGN OR BLOCK ANYTHING ──
 *
 * Hard rule 8, REQ-REC-04: no flow may prevent a patient being seen or billed,
 * and a platform failure slows evidence rather than service. By the time this
 * runs, the signature, the status transitions to `signed` / `validated` /
 * `stored` and their vault events have all COMMITTED in their own transaction.
 * This opens a new one that only ever adds. A failure here leaves six null
 * columns on a signed agreement, which is precisely the retry state:
 * `produce` is idempotent and can be asked again by anything — a sweep, an
 * operator, the write-back — without a compensating action, because there is
 * nothing to compensate. `produceAfterSignature` is the never-throwing wrapper
 * the signature path calls, so a refusal cannot escape into the signing
 * transaction's caller and be read as a failure to sign.
 *
 * ── DETERMINISM (hard rule 13) ──
 *
 * The page is rendered TWICE and the hashes compared before anything is
 * stored. The agreement path gets this for free — it renders at the lock and
 * re-renders at the signature — and this path has no second moment, so it
 * makes one. The cost is one extra PDF per signed DB4; the alternative is
 * discovering non-determinism years later, on the one document somebody is
 * disputing. The stored render payload carries the resolved content object, so
 * a later re-render under the recorded renderer version reproduces these exact
 * bytes even after `content/signed-db4.json` has been edited.
 */
@Injectable()
export class SignedDb4Service {
  private readonly logger = new Logger(SignedDb4Service.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly artefacts: ArtefactsService,
    private readonly renderers: RendererRegistry,
    private readonly printRecords: PrintRecordsService,
  ) {}

  /**
   * THE CALL THE SIGNATURE PATH MAKES. It cannot throw, and it says so in its
   * type. Everything it catches is logged loudly, saying whether a retry can
   * help for THAT reason (CLAUDE.md §7c) — a refusal or a missing signature
   * mark never succeeds on retry; a transient fault may.
   */
  async produceAfterSignature(practiceId: string, agreementId: string): Promise<SignedDb4Outcome> {
    try {
      const outcome = await this.produce(practiceId, agreementId);
      if (!outcome.produced && outcome.reason !== 'not_from_a_db4' && outcome.reason !== 'already_produced') {
        this.logger.warn(
          `Signed-DB4 not produced for agreement ${agreementId} — ${outcome.reason}: ` +
            `${NOT_PRODUCED_LOG_DETAIL[outcome.reason]}`,
        );
      }
      return outcome;
    } catch (err) {
      /*
       * THE CODE AND THE CLASS, NEVER THE MESSAGE. A render refusal quotes the
       * offending LINE, and a line off a DB4 is a patient's address or a
       * provider's name. No PII in a log (hard rule 9, REQ-LOG-08) — and the
       * refusal's rule code is the thing anybody diagnosing this actually
       * needs, with the agreement id to look the rest up under.
       *
       * A CONTENT REFUSAL IS NOT A TRANSIENT FAULT. HARD-03 and HARD-12 fire on the
       * form's own content or this practice's configured content, and the
       * same input produces the same refusal every time: retrying changes
       * nothing until the form or the content does. Everything else here —
       * the object store, the database, the determinism check — is treated
       * as the transient fault it actually is, which is the one case where
       * "retryable" is true.
       */
      const rule = (err as { rule?: string }).rule;
      /*
       * HARD-13 IS NOT CONTENT. The renderer raises it when it is handed
       * something that is not a Signed-DB4, or when the signature mark could
       * not be loaded — and the artefact store reads a storage fault and a
       * missing artefact as the same null. So say what was checked, and stop.
       */
      const retryNote = !(err instanceof SignedDb4RenderRefusal)
        ? 'The agreement remains signed and stored; the render is retryable.'
        : rule === 'HARD-13'
          ? 'The renderer was handed something that is not a Signed-DB4, or the signature mark could not be ' +
            'loaded (a storage fault and a missing artefact read the same here). Whether a retry helps cannot be ' +
            'told from here.'
          : 'Not retryable — the same form and content refuse the same way until one of them changes.';
      this.logger.error(
        `Signed-DB4 render failed for agreement ${agreementId} — ${(err as Error).name}` +
          `${rule ? ` (${rule})` : ''}. ${retryNote}`,
      );
      return { produced: false, reason: 'render_failed' };
    }
  }

  /**
   * Idempotent. Returns `already_produced` rather than rendering a second
   * artefact, because two Signed-DB4s for one agreement would be two documents
   * for one folder — the exact thing the practice asked us not to produce.
   */
  async produce(practiceId: string, agreementId: string): Promise<SignedDb4Outcome> {
    const agreement = await this.prisma.withPractice(practiceId, (tx) =>
      tx.agreement.findFirst({
        where: { id: agreementId },
        select: {
          id: true,
          status: true,
          sourcePrintJobId: true,
          signatureEventId: true,
          signedDb4Sha256: true,
          renderedLanguages: true,
        },
      }),
    );
    if (!agreement) return { produced: false, reason: 'agreement_not_found' };

    /*
     * THE GATE, AND IT IS THE FIRST THING CHECKED (`a_signed_db4_is_only_
     * produced_for_an_agreement_that_came_from_a_db4`). Without a source print
     * job there is no form to reproduce, and a "Signed-DB4" assembled from an
     * agreement's own particulars would be a page we invented wearing the
     * government's layout. That is a worse artefact than none.
     */
    if (!agreement.sourcePrintJobId) return { produced: false, reason: 'not_from_a_db4' };
    if (agreement.signedDb4Sha256) return { produced: false, reason: 'already_produced' };
    if (!agreement.signatureEventId) return { produced: false, reason: 'not_signed' };

    const signatureEvent = await this.prisma.withPractice(practiceId, (tx) =>
      tx.signatureEvent.findFirst({
        where: { id: agreement.signatureEventId as string, agreementId },
        select: {
          signatureRasterSha256: true,
          method: true,
          channel: true,
          createdAt: true,
        },
      }),
    );
    if (!signatureEvent?.signatureRasterSha256) return { produced: false, reason: 'no_drawn_signature' };

    const envelope = await this.printRecords.envelopeFor(practiceId, agreement.sourcePrintJobId);
    if (!envelope) return { produced: false, reason: 'print_record_missing' };

    const document = this.documentFor(practiceId, agreement.id, agreement.sourcePrintJobId, envelope, {
      rasterSha256: signatureEvent.signatureRasterSha256,
      /*
       * FROM THE EVENT, NEVER `new Date()`. A wall-clock value would make two
       * renders of one form differ, which is hard rule 13's whole subject.
       * The signature event is append-only, so this is stable forever.
       */
      signedAt: signatureEvent.createdAt.toISOString(),
      method: signatureEvent.method,
      channel: signatureEvent.channel,
    });

    const renderer = this.renderers.get(SignedDb4Renderer.VERSION);
    if (!renderer) {
      // Structurally unreachable — the registry is constructed with it — and
      // checked anyway, because an unregistered renderer is an artefact nobody
      // could ever re-verify.
      throw new Error(`Renderer ${SignedDb4Renderer.VERSION} is not registered.`);
    }

    const languages = agreement.renderedLanguages.length > 0 ? agreement.renderedLanguages : ['en'];
    const payload = document as unknown as Record<string, unknown>;
    const rendered = await renderer.render(payload, languages);
    const again = await renderer.render(structuredClone(payload), languages);
    if (again.sha256 !== rendered.sha256) {
      throw new Error(
        'Render determinism violation: two renders of one Signed-DB4 produced different bytes. Nothing was ' +
          'stored (rule 13).',
      );
    }

    /*
     * BYTES BEFORE THE TRANSACTION, ROWS INSIDE IT — the same ordering every
     * artefact upload uses. Content with no row is merely orphaned and
     * identifiable by its hash; a row pointing at content that was never
     * written is a broken reference, and holding a database transaction open
     * across a network call is how a slow store turns into a locked table.
     */
    const staged = await this.artefacts.stage(practiceId, {
      bytes: rendered.bytes,
      purpose: SIGNED_DB4_PURPOSE,
      declaredContentType: rendered.mediaType,
      // The agreement id, not the form reference and not the patient. A
      // filename is a string that ends up in logs and in a practice's file
      // manager.
      filename: `signed-db4-${agreementId}.pdf`,
      uploadedByName: SIGNED_DB4_ATTRIBUTION,
      subjectType: 'Agreement',
      subjectId: agreementId,
    });

    let artefactId: string;
    try {
      artefactId = await this.prisma.withPractice(practiceId, async (tx) => {
        /*
         * THE CLAIM COMES FIRST, AND IT IS THE DATABASE THAT DECIDES IT.
         *
         * The check at the top of this method read `signedDb4Sha256` in an
         * earlier transaction, and the render between them takes as long as a
         * render takes. Two callers — the signature path and a retry, or two
         * retries — can both see null there, both render, and both arrive
         * here, which would be two artefact rows, two `agreement.rendered`
         * events and two documents for one chart folder. An `updateMany`
         * filtered on `signedDb4Sha256: null` makes the row itself the
         * arbiter: exactly one caller updates one row, the loser updates none
         * and throws out of the transaction before the artefact row exists.
         * The same shape, and the same reason, as `linkToPrintJob`'s filter on
         * the inbound side.
         */
        const claimed = await tx.agreement.updateMany({
          where: { id: agreementId, signedDb4Sha256: null },
          data: {
            signedDb4ArtefactId: null,
            signedDb4Sha256: rendered.sha256,
            signedDb4RendererVersion: rendered.rendererVersion,
            signedDb4ContentVersion: document.content.version,
            signedDb4RenderPayload: payload as unknown as Prisma.InputJsonValue,
            signedDb4RenderedAt: new Date(),
          },
        });
        if (claimed.count === 0) throw new AlreadyProduced();

        /*
         * ONE TRANSACTION: the claim above, the artefact row, its own vault
         * event and the render event (hard rule 11, the outbox). A recorded
         * hash with no artefact row, or an artefact nobody can find from the
         * agreement, would each be evidence pointing at nothing — and a claim
         * whose render then failed would lock the agreement out of ever having
         * one. All of it commits, or none of it does.
         */
        const artefact = await this.artefacts.recordStaged(tx, practiceId, staged);
        await tx.agreement.update({
          where: { id: agreementId },
          data: { signedDb4ArtefactId: artefact.id },
        });
        /*
         * `agreement.rendered`, NOT A NEW EVENT TYPE. It is exactly what
         * happened, its payload already carries a hash and a renderer version,
         * and `kind` separates this page from the agreement's own render for
         * anybody reading the chain. A new literal would have bought a clearer
         * filter and cost a vault whitelist change on a service that is a
         * human-authored zone.
         *
         * IDS, HASHES AND VERSIONS ONLY. Not a name, not a chart number, and
         * emphatically not the Medicare card number that is on the page itself
         * (hard rules 1 and 9): the number lives inside the artefact and in
         * nothing that describes it.
         */
        await enqueueVaultEvent(tx, {
          type: 'agreement.rendered',
          actor: SYSTEM_ACTOR,
          subject: { type: 'Agreement', id: agreementId },
          payload: {
            kind: 'signed_db4',
            artefactId: artefact.id,
            artefactSha256: rendered.sha256,
            rendererVersion: rendered.rendererVersion,
            contentVersion: document.content.version,
            sourcePrintJobId: agreement.sourcePrintJobId as string,
          },
        });
        return artefact.id;
      });
    } catch (err) {
      /*
       * THE LOSER OF THE RACE IS NOT A FAILURE. Somebody else produced the
       * page while this call was rendering; the transaction rolled back, so
       * there is no second artefact row and no second event. Asking twice is
       * how a retry is meant to behave, and this is the answer it gets.
       */
      if (err instanceof AlreadyProduced) return { produced: false, reason: 'already_produced' };
      throw err;
    }

    return {
      produced: true,
      artefactId,
      sha256: rendered.sha256,
      rendererVersion: rendered.rendererVersion,
      contentVersion: document.content.version,
    };
  }

  /**
   * THE RENDER INPUT, ASSEMBLED FROM THE FORM AND NOTHING ELSE.
   *
   * Every value is copied out of the DB4 Print Record; not one is computed,
   * defaulted, reformatted or inferred. That is the difference between
   * reproducing a document and drafting one, and it is the whole basis on
   * which this page may carry an amount at all (hard rule 4 as narrowed by
   * D-2026-09-14-02: AoB never originates a figure).
   */
  private documentFor(
    practiceId: string,
    agreementId: string,
    sourcePrintJobId: string,
    envelope: PrintJobEnvelope,
    signature: SignedDb4Document['signature'],
  ): SignedDb4Document {
    return {
      kind: 'signed_db4',
      practiceId,
      agreementId,
      sourcePrintJobId,
      // A COPY, not a reference to the current file. Editing the content file
      // must never move the bytes of a page that already exists.
      content: SIGNED_DB4_CONTENT,
      printRecord: {
        heading: envelope.heading,
        form: envelope.form,
        servicingLocation: envelope.servicingLocation,
        patient: envelope.patient,
        providers: envelope.providers,
        services: envelope.services,
        assignment: envelope.assignment,
        referral: envelope.referral,
        parserTemplateVersion: envelope.parserTemplateVersion,
        capturedAt: envelope.capturedAt,
        sourceSha256: envelope.sourceSha256,
      },
      signature,
    };
  }
}

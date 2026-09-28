import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CollectedConfirmation, PrintJobEnvelope, SignedFormForCollection } from '@aobplatform/contracts';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

/**
 * WRITE-BACK BY COLLECTION — what is signed and waiting to be filed, and the
 * confirmation that it was (GA-PLAN B13; CONSULTATION-CAPTURE-PLAN.md §8.6;
 * DB4-AND-AOBL.md §6a/§6b and §7 row 3b).
 *
 * Carl, 28 September 2026, on being told that a completed approval reaches
 * the practice's PMS nowhere at all: *"build the import-folder write-back"*.
 *
 * ── THE SHAPE, AND WHY IT IS A PULL ──
 *
 * Printing cannot write back: nothing prints *into* a PMS, and REQ-INT-02
 * says write-back is the product. So the same installed desktop closes the
 * loop from the other side — it asks what is ready, downloads it, writes the
 * pair into the PMS's document-import folder and says it did. A practice's
 * network is outbound-only with mutual TLS, so a server that PUSHED would
 * need an inbound port on a receptionist's PC. This class is therefore two
 * reads and one write, all initiated from the practice.
 *
 * ── WHAT IS PUBLISHED, AND THE THREE GATES BEFORE IT IS ──
 *
 * 1. THE PRACTICE HAS ANSWERED WHICH KEY NAMES ITS DOCUMENT FOLDER
 *    (`documentFolderKey`). Null means nobody has been asked, and this
 *    publishes NOTHING — DB4-AND-AOBL.md §6a's correction, which is the one
 *    correction in that section: the day a practice names its folders for
 *    something other than the chart number is the day fifty signed consents
 *    land in a stranger's record, and that failure is silent. Forgetting to
 *    ask must mean write-back does not start, never that it starts wrong.
 *
 * 2. THERE IS A SIGNED-DB4. *"What the practice wants to see in the folder —
 *    one form, not two"* (DB4-AND-AOBL.md §12). An agreement that did not
 *    come off a printed DB4 has no Signed-DB4 and is not published here; see
 *    WHAT THIS LANE DELIBERATELY DOES NOT CARRY, below.
 *
 * 3. IT HAS NOT BEEN COLLECTED. `writtenBackAt` is the platform's one meaning
 *    of "this reached the practice's record", and the folder drop earns it —
 *    §8.6: *"`WriteBackService` gets a second implementation behind the same
 *    `writeArtefact` call"*. One flag, one vault event, and FR-9.3's
 *    staleness alert watches this path for free.
 *
 * ── WHAT THIS LANE DELIBERATELY DOES NOT CARRY ──
 *
 * AN AGREEMENT WITH NO SIGNED-DB4. Its own artefact is not stored as bytes —
 * `WriteBackService` RE-RENDERS it from `rendererVersion` and compares the
 * hash — so publishing one would mean rendering inside a polled read. That is
 * a real gap and it is named rather than papered over: for the first customer
 * it is empty (D-2026-09-14-04, the DB4 path and nothing else), and closing it
 * is a stored-artefact change, not a change here.
 *
 * ── AND NOTHING THAT IS NOT NEEDED TO FILE A DOCUMENT ──
 *
 * The chart number is an approved identifier (hard rule 1, REQ-VER-02) and is
 * load-bearing: it IS the folder. No name, no date of birth, no address, and
 * emphatically no Medicare card number — that is inside the artefact, on the
 * practice's own form, and in nothing that describes it (hard rule 9).
 */
@Injectable()
export class WriteBackCollectionService {
  private readonly logger = new Logger(WriteBackCollectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * WHAT IS SIGNED AND WAITING. Oldest first, because a queue a desktop walks
   * should drain in the order it filled — a practice that has been offline for
   * a day gets yesterday's consents filed before this morning's.
   *
   * `since` IS A FILTER, NOT A CURSOR. The desktop may pass the newest render
   * time it has seen to keep a poll small, but correctness never depends on
   * it: a row stays published until it is confirmed, so a desktop that loses
   * its place asks with no `since` and gets everything it still owes. A cursor
   * that could skip a row is the one thing this must not be.
   */
  async pending(practiceId: string, since?: string): Promise<readonly SignedFormForCollection[]> {
    const after = since ? new Date(since) : null;
    if (after && Number.isNaN(after.getTime())) {
      throw new BadRequestException('`since` must be an ISO 8601 instant.');
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.findFirst({ where: { id: practiceId } });
      /*
       * GATE 1. Not an error — a practice nobody has asked yet is an ordinary
       * state during onboarding, and an empty list is the honest answer to
       * "what may I file". Logged so the gap is visible to us rather than only
       * to the receptionist wondering where the documents are.
       */
      if (practice?.documentFolderKey !== 'patient_record_number') {
        this.logger.log('Collection asked for by a practice with no confirmed document folder key.');
        return [];
      }

      const rows = await tx.agreement.findMany({
        where: {
          status: 'stored',
          writtenBackAt: null,
          signedDb4ArtefactId: { not: null },
          signedDb4Sha256: { not: null },
          ...(after ? { signedDb4RenderedAt: { gt: after } } : {}),
        },
        orderBy: { signedDb4RenderedAt: 'asc' },
        take: 200,
      });
      if (rows.length === 0) return [];

      const patients = await tx.patient.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.patientId))] } },
      });
      const chartOf = new Map(patients.map((p) => [p.id, p.patientRecordNumber]));
      const jobIds = rows.map((r) => r.sourcePrintJobId).filter((id): id is string => !!id);
      const jobs = await tx.inboundPrintJob.findMany({ where: { id: { in: jobIds } } });
      const referenceOf = new Map(
        jobs.map((j) => [j.id, (j.payload as PrintJobEnvelope | null)?.form?.formReference]),
      );
      const signatures = await tx.signatureEvent.findMany({
        where: { agreementId: { in: rows.map((r) => r.id) } },
        orderBy: { createdAt: 'asc' },
      });
      const signedAtOf = new Map<string, Date>();
      for (const s of signatures) {
        if (!signedAtOf.has(s.agreementId)) signedAtOf.set(s.agreementId, s.createdAt);
      }

      const out: SignedFormForCollection[] = [];
      for (const row of rows) {
        const patientRecordNumber = chartOf.get(row.patientId);
        const formReference = row.sourcePrintJobId ? referenceOf.get(row.sourcePrintJobId) : undefined;
        const signedAt = signedAtOf.get(row.id);
        /*
         * A ROW MISSING ITS FOLDER OR ITS FILENAME IS SKIPPED, NOT GUESSED.
         * There is no safe fallback: a made-up folder files a consent in the
         * wrong record, and a made-up filename collides with a real one. It
         * stays unwritten — which is exactly the state FR-9.3's staleness
         * alert exists to surface — and a human finds out.
         */
        if (!patientRecordNumber || !formReference || !signedAt) {
          const missing = !patientRecordNumber
            ? 'no chart number'
            : !formReference
              ? 'no form reference'
              : 'no signature event';
          this.logger.warn(`Agreement ${row.id} is signed but cannot be filed: ${missing}.`);
          continue;
        }
        out.push({
          agreementId: row.id,
          patientRecordNumber,
          formReference,
          artefactId: row.signedDb4ArtefactId as string,
          sha256: row.signedDb4Sha256 as string,
          signedAt: signedAt.toISOString(),
          rendererVersion: row.signedDb4RendererVersion ?? '',
          contentVersion: row.signedDb4ContentVersion ?? '',
          formCode: 'DB4',
        });
      }
      return out;
    });
  }

  /**
   * THE DESKTOP SAYS THE PAIR IS ON DISK.
   *
   * THE HASH IS CHECKED BEFORE THE FLAG MOVES, and that is the point of the
   * call rather than a formality. `writtenBackAt` is the platform's claim that
   * a signed agreement reached the practice's record; a claim taken on trust
   * from a client is a claim about nothing. The desktop hashes what it
   * actually WROTE — not what it downloaded — so a truncated write, a
   * half-copied file, or a folder something else mangled is refused here and
   * the row stays on the list.
   *
   * IDEMPOTENT, BECAUSE AT-LEAST-ONCE IS WHAT A DESKTOP CAN OFFER. The same
   * posture as the outbox at the other end (`outbox.ts`): confirming twice is
   * a retry, answered `written: false`, and never a second vault event.
   */
  async confirmCollected(
    practiceId: string,
    agreementId: string,
    dto: CollectedConfirmation,
  ): Promise<{ written: boolean; pmsDocumentKey: string }> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const agreement = await tx.agreement.findFirst({ where: { id: agreementId } });
      if (!agreement) throw new NotFoundException('No such agreement for this practice.');
      if (agreement.writtenBackAt) {
        return { written: false, pmsDocumentKey: agreement.pmsDocumentKey ?? dto.pmsDocumentKey };
      }
      if (!agreement.signedDb4Sha256) {
        throw new BadRequestException('That agreement has nothing to file: no Signed-DB4 was produced.');
      }
      if (agreement.signedDb4Sha256 !== dto.artefactSha256) {
        /*
         * REFUSED, AND THE ROW STAYS ON THE LIST. Hard rule 13 says a later
         * display re-verifies the hash; a COPY into a patient's permanent
         * record is the same question with more at stake. What the practice
         * files must be the bytes we rendered and hashed, or it is not
         * evidence of anything.
         */
        throw new BadRequestException(
          'The hash of the filed document does not match the Signed-DB4 that was published.',
        );
      }
      await tx.agreement.update({
        where: { id: agreementId },
        data: { writtenBackAt: new Date(), pmsDocumentKey: dto.pmsDocumentKey },
      });
      /*
       * THE SAME EVENT THE ADAPTER PATH EMITS, so a reader of the vault does
       * not have to learn a second name for one fact. `pms: 'import_folder'`
       * is what distinguishes the route taken.
       *
       * NO CHART NUMBER ON THE EVENT. `pmsDocumentKey` is `<chart>/<ref>.pdf`,
       * and while the chart number is an approved identifier rather than a
       * secret, hard rule 9 is about what events may carry, and an event is
       * the last place to start making exceptions. The key is on the agreement
       * row, where a support question reaches it under practice scope.
       */
      await enqueueVaultEvent(tx, {
        type: 'agreement.written_back',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Agreement', id: agreementId },
        payload: {
          pms: 'import_folder',
          artefactSha256: dto.artefactSha256,
          deduplicated: false,
        },
      });
      return { written: true, pmsDocumentKey: dto.pmsDocumentKey };
    });
  }
}

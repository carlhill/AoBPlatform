import { Injectable } from '@nestjs/common';
import type { PrintJobEnvelope } from '@aobplatform/contracts';
import { PrismaService } from '../prisma/prisma.service';

/**
 * READ ONE PRINT RECORD BACK — the inbound module's own door onto its own
 * table, opened for the one caller outside it that legitimately needs the
 * contents of a form after the fact.
 *
 * WHY THIS EXISTS AS A SEPARATE, LEAF SERVICE. The Signed-DB4 is rendered
 * after the signature commits, from the DB4 Print Record the driver captured
 * — headings, patient block, service rows, privacy notice, statements — none
 * of which is in the agreement's particulars, and deliberately so: piece 1
 * kept the Medicare card number and the amounts out of the agreement
 * altogether. So the producer has to read the print job row, and CLAUDE.md §4
 * says a module reads another module's tables through its SERVICE, never
 * directly.
 *
 * AND WHY IT IS NOT A METHOD ON `InboundPrintJobsService`. `InboundModule`
 * imports `ArrivalsModule`, which imports `AgreementsModule`. An agreements-side
 * caller that imported `InboundModule` would close a cycle, and the honest fix
 * for a cycle is not `forwardRef` — it is noticing that the QUEUE (lease,
 * retry, lane, dead-letter) and READING A CAPTURED RECORD are two different
 * jobs with two different dependency sets. This one depends on nothing but
 * Prisma, so anything may import it.
 *
 * IT IS READ-ONLY, AND IT STAYS THAT WAY. Nothing outside the inbound module
 * writes to that table.
 */
@Injectable()
export class PrintRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The envelope exactly as it was received, or null when there is no such job
   * for this practice.
   *
   * PRACTICE-SCOPED THROUGH `withPractice` LIKE EVERY OTHER READ, so RLS is
   * the fence rather than the `practiceId` in the where clause — which is
   * belt and braces, and the braces are the ones that hold.
   */
  async envelopeFor(practiceId: string, printJobId: string): Promise<PrintJobEnvelope | null> {
    const job = await this.prisma.withPractice(practiceId, (tx) =>
      tx.inboundPrintJob.findFirst({
        where: { id: printJobId, practiceId },
        select: { payload: true, documentType: true },
      }),
    );
    if (!job) return null;
    /*
     * THE DISCRIMINATOR IS CHECKED, NOT MERELY FETCHED. Nothing writes
     * `sourcePrintJobId` today except the DB4 handler, so this cannot be wrong
     * yet — and "cannot be wrong yet" is how a wrong id gets here in six
     * months. The renderer's own defence is a shape check, and an arrival slip
     * or an appointment list would pass it and draw a mostly-empty form rather
     * than refuse. A caller reads null as `print_record_missing`, which is the
     * honest answer: there is no DB4 here.
     */
    if (job.documentType !== 'db4_assignment') return null;
    return job.payload as unknown as PrintJobEnvelope;
  }
}

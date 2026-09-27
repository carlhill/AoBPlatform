import { Injectable } from '@nestjs/common';
import type { Db4PrintRecordIdentity, PrintJobEnvelope } from '@aobplatform/contracts';
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
/**
 * A TIMESTAMP TO THE SECOND, for a refusal a person reads.
 *
 * TWO REASONS, AND THE SECOND IS THE SERIOUS ONE.
 *
 * IT READS BETTER: nobody at a front desk matching a form against a print run
 * needs three decimal places of a second, and the block this feeds is read
 * aloud down a phone to support.
 *
 * AND MILLISECONDS LOOK EXACTLY LIKE MONEY. `...T13:20:54.953Z` contains
 * "54.953", which the named hard-rule-4 assertion in
 * `post-service-push.e2e-spec.ts` reads as a dollar amount in a refusal body
 * — and it is right to: a test that guards *"no amount anywhere near this"*
 * (REQ-REG-04) must not be taught to tell the difference between a real
 * amount and something shaped like one, because the version of it that can be
 * argued with is the version that eventually lets one through. So the data
 * loses a precision nobody wanted rather than the guard losing its teeth.
 *
 * THE STORED RECORD IS UNTOUCHED. This trims the copy that goes in a refusal;
 * the row and the payload keep whatever precision they arrived with, which is
 * what an audit reads.
 *
 * ANYTHING THAT IS NOT AN ISO INSTANT COMES BACK UNCHANGED. `capturedAt` is a
 * desktop's own clock reading and may be malformed; a refusal is not the
 * place to start correcting it, and dropping the field would lose a fact.
 */
function toTheSecond(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  return iso.replace(/\.\d{1,6}(?=(Z|[+-]\d{2}:?\d{2})$)/, '');
}

/** One row, as the envelope plus the identity. Shared so the two reads cannot drift. */
function describe(job: {
  id: string;
  payload: unknown;
  sourceSha256: string;
  parserTemplateVersion: string;
  receivedAt: Date;
}): { envelope: PrintJobEnvelope; identity: Db4PrintRecordIdentity } {
  const envelope = job.payload as PrintJobEnvelope;
  return {
    envelope,
    identity: {
      printJobId: job.id,
      sourceSha256: job.sourceSha256,
      formReference: envelope.form?.formReference,
      queueName: envelope.queueName,
      queueLabel: envelope.queueLabel,
      capturedAt: toTheSecond(envelope.capturedAt),
      receivedAt: toTheSecond(job.receivedAt.toISOString()) ?? job.receivedAt.toISOString(),
      parserTemplateVersion: job.parserTemplateVersion,
    },
  };
}

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
    return (await this.recordFor(practiceId, printJobId))?.envelope ?? null;
  }

  /**
   * THE SAME READ, PLUS WHICH RECORD IT WAS (Carl, 27 September 2026: *"some
   * unique id to identify the print ... we must have some unique ref from
   * AOBPrinter which we must be storing for audit"*).
   *
   * ONE QUERY, NOT TWO. The push-time check needs the contents AND the
   * identity in the same breath — the contents to decide, the identity to put
   * in the refusal — and a second round trip to name a record we have just
   * read would be a read per refusal for no new fact. `envelopeFor` is kept
   * and now delegates here, so its callers are untouched and there is one
   * place where a print job is fetched.
   *
   * `sourceSha256` IS AOBPRINTER'S OWN REF and the row's audit key
   * (`@@unique([practiceId, documentType, sourceSha256])`). The queue pair and
   * `capturedAt` come off the payload because that is where AOBPRINTER puts
   * them; everything else is the row's.
   *
   * NOTHING PATIENT-IDENTIFYING CROSSES THIS BOUNDARY (hard rule 9,
   * REQ-LOG-08). The identity describes the document and the machinery that
   * read it — no name, no chart number, no card number, no amount.
   */
  /**
   * THE SAME READ FOR A WHOLE LIST, IN ONE QUERY (Carl, 27 September 2026:
   * the refusal has to be ON THE ROW, before anybody presses Send).
   *
   * WHY IT IS BATCHED AND NOT A LOOP. `pushable()` runs on a three-second
   * poll on two pages at once; a read per row would turn one desk into a
   * query storm against a table the print driver is also writing to. One
   * `IN` over the ids the list actually has is the same answer for one round
   * trip.
   *
   * MISSING IDS ARE SIMPLY ABSENT FROM THE MAP, never an error. A print job
   * that has been pruned, or belongs to another practice and was refused by
   * RLS, means "we cannot check this one" -- and the caller reads that as
   * "let it through", which is the direction that fails safe (a form we could
   * not check reaches a tablet, where the patient can say it is wrong;
   * failing closed would stop a working practice over an infrastructure
   * fault they cannot see).
   */
  async recordsFor(
    practiceId: string,
    printJobIds: readonly string[],
  ): Promise<Map<string, { envelope: PrintJobEnvelope; identity: Db4PrintRecordIdentity }>> {
    const wanted = [...new Set(printJobIds)];
    const found = new Map<string, { envelope: PrintJobEnvelope; identity: Db4PrintRecordIdentity }>();
    if (wanted.length === 0) return found;
    const jobs = await this.prisma.withPractice(practiceId, (tx) =>
      tx.inboundPrintJob.findMany({
        where: { id: { in: wanted }, practiceId, documentType: 'db4_assignment' },
        select: {
          id: true,
          payload: true,
          documentType: true,
          sourceSha256: true,
          parserTemplateVersion: true,
          receivedAt: true,
        },
      }),
    );
    for (const job of jobs) found.set(job.id, describe(job));
    return found;
  }

  async recordFor(
    practiceId: string,
    printJobId: string,
  ): Promise<{ envelope: PrintJobEnvelope; identity: Db4PrintRecordIdentity } | null> {
    const job = await this.prisma.withPractice(practiceId, (tx) =>
      tx.inboundPrintJob.findFirst({
        where: { id: printJobId, practiceId },
        select: {
          id: true,
          payload: true,
          documentType: true,
          sourceSha256: true,
          parserTemplateVersion: true,
          receivedAt: true,
        },
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
    return describe(job);
  }
}

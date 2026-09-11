import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { portalRecordId } from '@aobplatform/contracts';
import { portalRecordIdLine } from '@aobplatform/domain';
import type { EmailBlock } from './template';

/**
 * ONE SENTENCE, IN EVERY MESSAGE, FOR A PATIENT WHO HAS A PORTAL RECORD
 * (Carl, 4 Sep 2026).
 *
 * THE ANTI-SCAM IDEA IN FULL. A patient can see `AoBPlatform-PatientId-<id>`
 * in three places that a forger cannot reach at once: on the portal page after
 * they sign in, in their password manager as the passkey's user name, and at
 * the bottom of every message we send them about their record. A message that
 * does not quote it is not ours. That only works if EVERY message quotes it,
 * which is why this is one helper rather than a line copied into each sender.
 *
 * IT APPENDS NOTHING WHEN THERE IS NO PORTAL ACCOUNT, and that is the whole of
 * its conditional logic. A patient who never activated has no id to check
 * against, and telling them about one they cannot see would be noise in the
 * one paragraph whose job is to be checkable.
 *
 * WHY IT READS `portal_account_patients` FROM HERE. Messaging is where a
 * message is composed, and the question — "does this recipient have a record
 * id?" — is asked at composition time by senders that have nothing else to do
 * with the portal. The alternative, messaging depending on the portal module,
 * is a cycle: the portal's own dispatcher composes through this module. The
 * read is one row by patient id, returns only the account id, and runs inside
 * the caller's practice-scoped transaction, so RLS fences it like everything
 * else.
 *
 * IT NEVER LOGS AND NEVER RETURNS A PATIENT DETAIL. The account id is an
 * opaque uuid the patient is shown themselves; nothing here touches a name, an
 * address or an identifier value (REQ-VER-04, REQ-LOG-08).
 */
@Injectable()
export class PortalRecordIdLine {
  /**
   * The sentence for this patient, or null when they have no portal record.
   *
   * TAKES THE CALLER'S TRANSACTION, so the line is decided inside the same
   * scope that is writing the message. A separate connection would be a second
   * RLS scope for one act.
   */
  async lineFor(tx: Prisma.TransactionClient, patientId: string): Promise<string | null> {
    const link = await tx.portalAccountPatient.findFirst({
      where: { patientId },
      select: { accountId: true },
      orderBy: { linkedAt: 'asc' },
    });
    if (!link) return null;
    return portalRecordIdLine(portalRecordId(link.accountId));
  }

  /** Email: the line goes in the small print, under everything else. */
  async appendToBlocks(
    tx: Prisma.TransactionClient,
    patientId: string,
    blocks: readonly EmailBlock[],
  ): Promise<EmailBlock[]> {
    const line = await this.lineFor(tx, patientId);
    return line ? [...blocks, { small: line }] : [...blocks];
  }

  /** SMS: the line goes on the end, after a space. */
  async appendToText(tx: Prisma.TransactionClient, patientId: string, body: string): Promise<string> {
    const line = await this.lineFor(tx, patientId);
    return line ? `${body} ${line}` : body;
  }
}

import { Module } from '@nestjs/common';
import { AgreementCopyController } from './agreement-copy.controller';
import { AgreementCopyKioskController } from './agreement-copy-kiosk.controller';
import { AgreementCopyService } from './agreement-copy.service';
import { RenderModule } from '../render/render.module';
import { OutboundModule } from '../outbound/outbound.module';
import { MessagingModule } from '../messaging/messaging.module';
import { DevicesModule } from '../devices/devices.module';

/**
 * W6 — "SEND ME A COPY" (REQ-PORT-02, the s 65C copy-on-request obligation).
 *
 * FOUR IMPORTS, EACH FOR SOMETHING THIS MODULE MUST NOT DO ITSELF (CLAUDE.md
 * §4 — module APIs for behaviour, never another module's tables):
 *
 *   - `RenderModule`, because rule 13 says the artefact is re-rendered under
 *     the version recorded on the agreement and hash-checked before a byte is
 *     served. The same `verifiedArtefactOf` the patient's own page runs.
 *   - `OutboundModule`, because a message must be durable BEFORE it is
 *     attempted, and because `enqueue` writes the correspondence twin in the
 *     caller's transaction — which is what puts the queued send, the copy link
 *     and the vault event in one commit (hard rule 11).
 *   - `MessagingModule`, for the one email composer. The WORDS are content
 *     (`content/patient-message-templates.json`); the composer only lays them
 *     out, so nothing here writes a sentence.
 *   - `DevicesModule`, so the kiosk routes resolve a paired tablet's practice
 *     from its credential rather than from anything the caller sent.
 *
 * IT OWNS EXACTLY ONE TABLE, `agreement_copy_links`, and reads agreements,
 * patients and assignors to answer "whose address, and is there anything to
 * copy". It writes to none of them.
 */
@Module({
  imports: [RenderModule, OutboundModule, MessagingModule, DevicesModule],
  controllers: [AgreementCopyController, AgreementCopyKioskController],
  providers: [AgreementCopyService],
  exports: [AgreementCopyService],
})
export class AgreementCopyModule {}

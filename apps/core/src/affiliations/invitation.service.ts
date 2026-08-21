import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INVITATION_ATTEMPT_CAP,
  INVITATION_CONSEQUENCES,
  INVITATION_DAYS,
  canAnswerInvitation,
  invitationMessage,
  invitationSummary,
  isInvitationCodeShaped,
  type InvitationState,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailComposer } from '../messaging/composer.service';
import type { EmailBlock } from '../messaging/template';

/**
 * Sending an affiliation invitation, and answering one.
 *
 * SEPARATE FROM AffiliationsService ON PURPOSE. Everything here runs OUTSIDE
 * any practice scope: the practitioner answering has no practice, no session
 * and no header, so every read and write goes through a SECURITY DEFINER
 * function keyed on the token. Mixing that with the practice-scoped service
 * would put RLS-exempt queries next to RLS-protected ones in the same file,
 * and the third time somebody adds a method there they will not notice which
 * kind they are writing.
 *
 * THE ONE RULE: only the practitioner turns an invitation into an active
 * affiliation. Note what is NOT here — no endpoint by which a practice can
 * accept, not even for a practitioner standing in front of them. That case is
 * real and is handled by recording it as `console` acceptance, which says in
 * the evidence that the only witness was the practice itself.
 */
@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: EmailComposer,
    private readonly config: ConfigService,
  ) {}

  private baseUrl(): string {
    return this.config.get<string>('APPLICATION_STATUS_BASE_URL', 'http://localhost:21100');
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /**
   * Issue a token and a code, and email them to the PRACTITIONER'S own address.
   *
   * Re-issuable, and re-issuing REPLACES the previous token and clears the
   * attempt count. A practice whose practitioner deleted the email must be able
   * to send another, and the old link must stop working the moment they do —
   * otherwise every re-send leaves another live credential behind.
   */
  async send(practiceId: string, affiliationId: string): Promise<{ notified: boolean; detail: string }> {
    // Scoped read FIRST, so this endpoint cannot be used to send invitations
    // for somebody else's affiliation by guessing an id. The issuing function
    // below is SECURITY DEFINER and would happily do it.
    const owned = await this.prisma.withPractice(practiceId, (tx) =>
      tx.affiliation.findFirst({
        where: { id: affiliationId },
        // The location comes from HERE rather than from the issuing function,
        // because this read is practice-scoped and that one is SECURITY
        // DEFINER. Same data, and this way the address in the email cannot be
        // for a location outside the practice that asked.
        select: { id: true, status: true, location: true, department: true },
      }),
    );
    if (!owned) throw new NotFoundException('That affiliation is not in this practice.');
    if (owned.status !== 'invited') {
      throw new BadRequestException(
        `This affiliation is ${owned.status}, so there is nothing to invite. An invitation can only be sent ` +
          'while one is still awaiting an answer.',
      );
    }

    const [issued] = await this.prisma.$queryRaw<
      Array<{
        token: string;
        code: string;
        expiresAt: Date;
        practitionerEmail: string | null;
        practitionerName: string;
        practiceName: string;
      }>
    >`SELECT * FROM issue_affiliation_invitation(${affiliationId}::uuid, ${INVITATION_DAYS}::integer)`;

    if (!issued) throw new NotFoundException('That invitation could not be issued.');

    if (!issued.practitionerEmail) {
      // NOT an error. A practitioner with no address on record is a real and
      // ordinary case; what is wrong is pretending we sent something.
      return {
        notified: false,
        detail:
          'This practitioner has no email address on record, so there is nowhere to send an invitation. ' +
          'Add one, or record their answer in the console — which is recorded as the practice’s own word ' +
          'for it, because that is what it is.',
      };
    }

    const url = `${this.baseUrl()}/invitation/${issued.token}`;
    const summary = invitationSummary({
      practiceName: issued.practiceName,
      locationAddress: owned.location.addressCanonical ?? owned.location.address,
      locationCode: owned.location.code,
      departmentName: owned.department?.name,
    });

    const blocks: EmailBlock[] = [
      { text: `${issued.practitionerName},` },
      { text: summary },
      {
        text:
          'AoBPlatform is where that practice records patient consent to bulk billing. Only you can accept ' +
          'this — they cannot do it for you, which is the whole reason it comes to your own address rather ' +
          'than to them.',
      },
      { rule: true },
      { heading: 'To answer it' },
      { button: { label: 'Open the invitation', url } },
      { url },
      { text: 'Then enter this code:' },
      { code: issued.code },
      {
        small:
          'The code is what answers it, not the link — so an automated scanner opening the link on your ' +
          'behalf cannot answer for you. The page shows you which practice and which address before you ' +
          'decide anything.',
      },
      { rule: true },
      { heading: 'What accepting means' },
      ...INVITATION_CONSEQUENCES.map((line) => ({ text: line })),
      {
        small:
          `This invitation works until ${issued.expiresAt.toISOString().slice(0, 10)}. After ` +
          `${INVITATION_ATTEMPT_CAP} wrong codes it locks and the practice has to send a new one. If you were ` +
          'not expecting this, you can decline it on the same page, or simply ignore it.',
      },
    ];

    return this.mail.send({
      to: issued.practitionerEmail,
      subject: `${issued.practiceName} has invited you on AoBPlatform`,
      blocks,
      // They never applied to us — their employer named them. Saying otherwise
      // would be false in the one paragraph whose job is to make the message
      // credible.
      footer: this.mail.footerFor(
        `You received this because ${issued.practiceName} gave this address when inviting you. ` +
          'If that is wrong, you can decline the invitation without accepting anything.',
      ),
      context: `Affiliation invitation ${affiliationId}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Answering
  // ---------------------------------------------------------------------------

  /**
   * What the page may show before a code is entered.
   *
   * IT NAMES THE PRACTICE AND THE PLACE, which is a deliberate departure from
   * the email-verification page, and the departure is the interesting part.
   * That page asks somebody to confirm an address they already own, so it
   * reveals nothing. This one asks somebody to accept a working relationship —
   * and NOBODY CAN CONSENT TO AN UNNAMED THING. Making a practitioner prove
   * they read an email before telling them what it was about would be both
   * useless and slightly sinister.
   *
   * What it still withholds is the provider number.
   */
  async state(token: string) {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        state: string;
        attemptsLeft: number;
        practiceName: string;
        locationAddress: string;
        locationCode: string | null;
        departmentName: string | null;
        practitionerName: string;
        invitedByName: string | null;
        invitedAt: Date;
      }>
    >`SELECT * FROM affiliation_invitation_state(${token})`;

    if (!row) {
      // Same answer for a token that never existed and one already used —
      // both clear the token, and distinguishing them would turn this into an
      // oracle for "was this a real invitation".
      return { state: 'not_found' as InvitationState, message: invitationMessage('not_found') };
    }

    const state = row.state as InvitationState;
    return {
      state,
      canAnswer: canAnswerInvitation(state),
      message: invitationMessage(state, row.attemptsLeft),
      attemptsLeft: row.attemptsLeft,
      summary: invitationSummary({
        practiceName: row.practiceName,
        locationAddress: row.locationAddress,
        locationCode: row.locationCode,
        departmentName: row.departmentName,
      }),
      consequences: INVITATION_CONSEQUENCES,
      practiceName: row.practiceName,
      locationAddress: row.locationAddress,
      locationCode: row.locationCode,
      departmentName: row.departmentName,
      practitionerName: row.practitionerName,
      invitedByName: row.invitedByName,
      invitedAt: row.invitedAt,
    };
  }

  /**
   * Accept or decline.
   *
   * THE ORDER MATTERS. The attempt is counted BEFORE the answer is attempted,
   * not after a failure, because a caller who disconnects mid-request would
   * otherwise get a free guess every time — and a free guess every time is an
   * uncapped code, which is the only thing making six digits safe.
   */
  async answer(token: string, code: string, decision: 'accept' | 'decline') {
    if (!isInvitationCodeShaped(code)) {
      // Shape-checked before it costs an attempt. A typo of five digits is not
      // a guess at the code, and spending one of five attempts on it would
      // lock people out for being clumsy rather than for being an attacker.
      throw new BadRequestException('The code is the six digits shown in the invitation email.');
    }

    const before = await this.state(token);
    if (!canAnswerInvitation(before.state)) {
      throw new BadRequestException(before.message);
    }

    await this.prisma.$queryRaw`SELECT record_invitation_attempt(${token})`;

    const [answered] = await this.prisma.$queryRaw<
      Array<{ id: string; practiceId: string; practitionerId: string; status: string }>
    >`SELECT * FROM answer_affiliation_invitation(${token}, ${code.trim()}, ${
      decision === 'accept' ? 'accept' : 'decline'
    })`;

    if (!answered) {
      // Re-read, so the reader is told the truth about where they now are:
      // one attempt closer to the cap, or locked by this very attempt.
      const after = await this.state(token);
      throw new BadRequestException(
        after.state === 'locked' ? after.message : invitationMessage('live', after.attemptsLeft ?? 0),
      );
    }

    await this.prisma.withPractice(answered.practiceId, (tx) =>
      enqueueVaultEvent(tx, {
        type: decision === 'accept' ? 'affiliation.accepted' : 'affiliation.rejected',
        // The PRACTITIONER is the actor. They performed this, not the practice
        // — recording it as the practice's act would erase the only thing that
        // makes an acceptance worth anything.
        actor: { principalType: 'provider', id: answered.practitionerId },
        subject: { type: 'Affiliation', id: answered.id },
        payload: {
          decision,
          // HOW, never just THAT. An emailed code and a passkey assertion must
          // not compare equal two years from now.
          acceptanceMethod: 'email_link_and_code',
          proves: 'access to the practitioner’s email inbox, not the identity of the person at the keyboard',
        },
      }),
    );

    this.logger.log(
      `Affiliation ${answered.id} was ${answered.status} by the practitioner via an emailed link and code.`,
    );

    return {
      id: answered.id,
      status: answered.status,
      decision,
      acceptanceMethod: 'email_link_and_code' as const,
    };
  }
}

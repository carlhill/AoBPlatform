import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEPARTURE_REASONS, DEPARTURE_REASON_KEYS } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AffiliationsService } from './affiliations.service';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';

/*
 * EMAIL ONLY. `practitioners` carries no phone column, and this is not the
 * place to add one: the address is the one that matters, because it is where
 * invitations go and therefore the thing worth protecting.
 */
class UpdateContactDto {
  @IsEmail() email!: string;
}

class DepartDto {
  @IsIn(DEPARTURE_REASON_KEYS) reason!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Ignored for the reasons that mean "this listing was wrong". */
  @IsOptional() @IsDateString() endsAt?: string;
}

/**
 * What a practitioner sees and does about themselves.
 *
 * `me`, NEVER `/practitioners/:id`. The id comes off the token, so there is no
 * parameter to tamper with and no ownership check to forget — the endpoint
 * cannot be pointed at somebody else because it takes no target. The existing
 * `/practitioners/:practitionerId/...` routes are the PRACTICE's view and check
 * ownership in their queries; this is the person's own, and the simplest way to
 * be sure is to give it nothing to be wrong about.
 *
 * NOTHING HERE IS PRACTICE-SCOPED. A practitioner works at several practices
 * and which ones changes, so their token carries no practice claim. Their
 * affiliations come through the SECURITY DEFINER function that already exists
 * for exactly this cross-tenant read.
 */
@Controller('practitioner')
export class PractitionerSelfController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly affiliations: AffiliationsService,
    private readonly reviewTasks: ReviewTasksService,
  ) {}

  private practitionerIdOf(actor: Actor | undefined): string {
    const id = actor?.practitionerId;
    if (!id) {
      throw new BadRequestException(
        'This sign-in is not a practitioner’s, so there is nothing of your own to show. If you think it ' +
          'should be, tell us.',
      );
    }
    return id;
  }

  /** Their record and where they work — the two things every screen needs. */
  @Get('me')
  async me(@SessionActor() actor: Actor | undefined) {
    const practitionerId = this.practitionerIdOf(actor);

    // Not practice-scoped, so no scope is needed. That is the point of the
    // person-level record.
    const practitioner = await this.prisma.practitioner.findFirst({ where: { id: practitionerId } });
    if (!practitioner) throw new BadRequestException('We could not find your record.');

    const affiliations = await this.affiliations.listForPractitioner(practitionerId);

    return {
      id: practitioner.id,
      // WHAT A CHECK ATTESTED TO. Shown as verified rather than as editable,
      // because a reviewer confirmed these against the public register and
      // changing them here would silently invalidate that.
      ahpraNumber: practitioner.ahpraNumber,
      givenNames: practitioner.givenNames,
      familyName: practitioner.familyName,
      providerType: practitioner.providerType,
      registrationStatus: practitioner.registrationStatus,
      // Theirs to change.
      email: practitioner.email,
      passkeyEnrolledAt: practitioner.passkeyEnrolledAt,
      deregisteredAt: practitioner.deregisteredAt,
      affiliations,
    };
  }

  /**
   * Leaving a practice. Their own act, and nobody has to agree to it.
   *
   * IF THE PRACTICE HAD TO AGREE, a practice could keep somebody listed after
   * they had gone — and a listed practitioner is one under whose name consent
   * can still be captured. That is not an inconvenience, it is the fraud this
   * platform exists to make impossible.
   *
   * The affiliation id is checked against THEM, by the query rather than by a
   * comparison afterwards: a departure that could be aimed at somebody else's
   * affiliation would let one practitioner end another's employment.
   */
  @Post('me/affiliations/:affiliationId/depart')
  depart(
    @Param('affiliationId', ParseUUIDPipe) affiliationId: string,
    @Body() dto: DepartDto,
    @SessionActor() actor: Actor | undefined,
  ) {
    const practitionerId = this.practitionerIdOf(actor);
    return this.affiliations.departByPractitioner(practitionerId, affiliationId, {
      reason: dto.reason,
      note: dto.note ?? null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    });
  }

  /** The reasons, so the screen offers the same list the server accepts. */
  @Get('departure-reasons')
  departureReasons() {
    return { reasons: DEPARTURE_REASONS };
  }

  /**
   * Contact details, and ONLY contact details.
   *
   * Name and AHPRA number are absent by design rather than forgotten. A
   * reviewer attested that the name matches the public register; letting the
   * practitioner edit it here would leave a completed check attesting to a
   * value that no longer exists, with nothing to mark that it had happened.
   *
   * A name genuinely does change — marriage, correction, a register update —
   * so the answer is not "never", it is "not silently". That path raises a
   * review task and re-runs the register check, and it is the next piece of
   * work rather than a gap: refusing here is the safe half, and shipping the
   * safe half first is deliberate.
   */
  @Patch('me/contact')
  async updateContact(@Body() dto: UpdateContactDto, @SessionActor() actor: Actor | undefined) {
    const practitionerId = this.practitionerIdOf(actor);
    // Hoisted so the narrowing survives into the closure below, where TypeScript
    // would otherwise widen it back to `string | undefined`.
    const email = dto.email.trim();

    const before = await this.prisma.practitioner.findFirst({ where: { id: practitionerId } });
    if (!before) throw new BadRequestException('We could not find your record.');

    if (before.email && email.toLowerCase() === before.email.toLowerCase()) {
      throw new BadRequestException('That is already your address, so there is nothing to record.');
    }

    const updated = await this.prisma.practitioner.update({
      where: { id: practitionerId },
      data: { email },
    });

    /*
     * A CHANGED ADDRESS IS WORTH SOMEBODY SEEING, for the same reason it is on
     * a practice: this is where invitations go, and redirecting it is the first
     * step somebody would take to accept affiliations in another person's name.
     *
     * Raised against the practice that introduced them, because a review task
     * is practice-scoped and that is the practice with standing to have
     * introduced this identity in the first place.
     */
    {
      const practiceId = before.invitedByPracticeId;
      if (practiceId) {
        await this.prisma.withPractice(practiceId, (tx) =>
          this.reviewTasks.raise(tx, {
            practiceId,
            kind: 'admin_contact_changed',
            subjectType: 'Practitioner',
            subjectId: practitionerId,
            summary: 'A practitioner changed the address their invitations go to',
            detail: {
              reason:
                'Invitations to join a practice are sent to this address, so a change to it is the first ' +
                'step somebody would take to accept an affiliation in another person’s name.',
              changes: [{ field: 'email', from: before.email, to: email }],
            },
            raisedBy: actor?.name ?? 'the practitioner',
          }),
        );
      }
    }

    return { id: updated.id, email: updated.email };
  }
}

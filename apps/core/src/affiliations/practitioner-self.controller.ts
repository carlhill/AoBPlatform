import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { IsDateString, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DEPARTURE_REASONS, DEPARTURE_REASON_KEYS } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';
import { AffiliationsService } from './affiliations.service';
import { ReviewTasksService } from '../review-tasks/review-tasks.service';
import { SessionActor, type Actor } from '../auth/actor.decorator';
import { PractitionerEmailService } from '../identity/practitioner-email.service';

/*
 * EMAIL ONLY. `practitioners` carries no phone column, and this is not the
 * place to add one: the address is the one that matters, because it is where
 * invitations go and therefore the thing worth protecting.
 */
class UpdateContactDto {
  @IsEmail() email!: string;
}

/*
 * THE SECOND CHANNEL. Not a contact detail in the ordinary sense — nobody
 * writes to it about work. It exists so that a change to the FIRST channel has
 * somewhere to be announced when the first channel has stopped working, which
 * is the commonest reason anybody changes it.
 */
class BackupEmailDto {
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
    private readonly practitionerEmail: PractitionerEmailService,
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
      // Theirs to change — but not instantly. See `updateContact`.
      email: practitioner.email,
      backupEmail: practitioner.backupEmail,
      backupEmailVerifiedAt: practitioner.backupEmailVerifiedAt,
      /*
       * SHOWN WHETHER OR NOT THEY ASKED FOR IT. If somebody else raised this,
       * the person it concerns finds out by opening their own page — not only
       * by reading an email that may be going to the address under attack.
       */
      pendingEmailChange: await this.practitionerEmail.live(practitionerId),
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

  /**
   * A practice they work at, as the BUSINESS publishes itself.
   *
   * Goes through a SECURITY DEFINER function because a practitioner has no
   * practice claim — their scope is their affiliations, which RLS cannot
   * express. The function checks the affiliation itself, so this cannot be
   * pointed at a practice they have nothing to do with.
   *
   * WHAT IT DELIBERATELY DOES NOT RETURN: the administrator, the manager, the
   * other practitioners, the application, the verification state. Working
   * somewhere does not make somebody a reader of that practice's record — and
   * the guarantee is that those columns are not selected, rather than that
   * somebody remembered not to render them.
   *
   * An ENDED affiliation still counts. Somebody who worked there last year may
   * legitimately need the practice's details to chase something from then.
   */
  @Get('me/practices/:practiceId')
  async practice(@Param('practiceId', ParseUUIDPipe) practiceId: string, @SessionActor() actor: Actor | undefined) {
    const practitionerId = this.practitionerIdOf(actor);

    const [practice] = await this.prisma.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT * FROM core.practice_public_for_practitioner(${practitionerId}::uuid, ${practiceId}::uuid)`;

    if (!practice) {
      // The same answer whether the practice does not exist or they are not
      // affiliated with it, so this cannot be used to discover practices.
      throw new NotFoundException('That practice was not found, or you are not affiliated with it.');
    }

    /*
     * THE PLACES, alongside the entity. One request rather than two, because a
     * page that fetches them separately can render the practice and then fail
     * to render its locations — leaving somebody looking at a practice that
     * appears to have none.
     */
    const places = await this.prisma.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT * FROM core.practice_places_for_practitioner(${practitionerId}::uuid, ${practiceId}::uuid)`;

    /*
     * Pivoted here rather than in the browser: the SQL returns one row per
     * location-and-department, which is the shape a join produces and not the
     * shape a reader wants. Doing it in two places is how two screens come to
     * disagree about how many sites a practice has.
     */
    const byLocation = new Map<string, Record<string, unknown>>();
    for (const row of places) {
      const id = String(row.locationId);
      const entry = byLocation.get(id) ?? {
        id,
        code: row.code,
        address: row.address,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        suburb: row.suburb,
        state: row.state,
        postcode: row.postcode,
        country: row.country,
        departments: [] as { id: string; name: string }[],
      };
      // The LEFT JOIN yields a null department for a location that has none,
      // which is a location rather than a row to drop.
      if (row.departmentId) {
        (entry.departments as { id: string; name: string }[]).push({
          id: String(row.departmentId),
          name: String(row.departmentName),
        });
      }
      byLocation.set(id, entry);
    }

    return { ...practice, locations: [...byLocation.values()] };
  }

  /**
   * The messages themselves, with what was in them.
   *
   * NOT A CUBE QUERY, deliberately. The reporting layer carries counts and no
   * content, which is what makes it safe to let a query engine roam over it.
   * Answering "what did it say" from there would mean putting message bodies
   * into that surface and undoing the reason it is defensible.
   *
   * A practitioner reading a message sent TO THEM is not a privacy question —
   * they received it. So it is answered from a different place: Cube for how
   * many, this for what one said.
   *
   * The practitioner id comes off the token, never from the request, so this
   * cannot be asked about somebody else.
   */
  @Get('me/messages')
  async messages(@SessionActor() actor: Actor | undefined) {
    const practitionerId = this.practitionerIdOf(actor);

    const rows = await this.prisma.$queryRaw<
      Array<Record<string, unknown>>
    >`SELECT * FROM core.practitioner_message_detail(${practitionerId}::uuid, 100)`;

    return {
      messages: rows.map((r) => ({
        id: r.id,
        practice: r.practiceName,
        channel: r.channel,
        mediaType: r.mediaType,
        state: r.state,
        occurredAt: r.occurredAt,
        sentAt: r.sentAt,
        subject: r.subject,
        body: r.body,
        /*
         * WHO COMPOSED IT, which decides whether a body exists at all. An
         * enrolment link is sent by Keycloak — we record that it went and hold
         * the subject, never the text. The screen says so rather than showing
         * an empty message, because a blank body reads as "we sent you nothing"
         * rather than "we did not keep a copy".
         */
        sentBy: r.sentBy ?? 'aobplatform',
      })),
    };
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
    const email = dto.email.trim();

    const before = await this.prisma.practitioner.findFirst({ where: { id: practitionerId } });
    if (!before) throw new BadRequestException('We could not find your record.');

    /*
     * HELD, NOT APPLIED. This used to write the new address immediately and
     * raise a review task afterwards — which is a record of what happened, not
     * a control over whether it happens. A practice administrator's address had
     * been held pending proof for months by then; a practitioner's, which is
     * where their SIGN-IN LINKS go, applied on save.
     *
     * Now the new address proves itself with a code, and the old address and
     * the backup are told with the power to stop it. `PractitionerEmailService`
     * carries the reasoning for why the old address is TOLD rather than asked
     * to authorise.
     */
    /*
     * NO REVIEW TASK for the ordinary case. Carl's instruction, directly: "we
     * should only have a review if the Platform rule was broken... otherwise
     * we let the practitioner make the change and approve it." This used to
     * raise `admin_contact_changed` on EVERY request, which put an ordinary
     * practitioner updating their own address in the same queue as a
     * practice-admin handover — noise that trained reviewers to skim past
     * "PRACTITIONER" rows, which is worse than not having them.
     *
     * The system's own hold-and-prove mechanism IS the safeguard for the
     * ordinary case: the new address must answer a code, and the old address
     * plus the backup are warned with the power to stop it. A human is not
     * needed to approve what the practitioner can already only do by proving
     * they hold the mailbox.
     *
     * The genuine platform rule — three changes in a month — is a SEPARATE,
     * narrower signal and is raised from `PractitionerEmailService.request()`
     * as `email_change_churn`, at the point the rule is actually broken, not
     * on every ordinary request that has not broken anything.
     */
    const pending = await this.practitionerEmail.request(
      practitionerId,
      email,
      // Never free text. The session names who is doing this.
      actor?.name ?? 'the practitioner',
    );

    return {
      id: practitionerId,
      // UNCHANGED, and the screen must show this rather than the new one.
      email: before.email,
      pending: {
        requestedEmail: pending.requestedEmail,
        expiresAt: pending.expiresAt,
        warned: pending.warned,
        unwitnessed: pending.unwitnessed,
      },
      detail: pending.unwitnessed
        ? `We have written to ${pending.requestedEmail} with a code. Nothing changes until you enter it. You ` +
          'have no backup address — please add one, so that next time we have somewhere to warn you.'
        : `We have written to ${pending.requestedEmail} with a code. Nothing changes until you enter it, and ` +
          'we have told your other addresses so they can stop it.',
    };
  }

  /** What is waiting, on its own, for a screen that only needs this. */
  @Get('me/pending-email')
  pendingEmail(@SessionActor() actor: Actor | undefined) {
    return this.practitionerEmail.live(this.practitionerIdOf(actor));
  }

  /**
   * Setting the backup address.
   *
   * NOT HELD PENDING PROOF, unlike the primary — and that asymmetry is the
   * point rather than an oversight. The primary is where sign-in links go, so
   * moving it is an attack; the backup receives nothing but warnings, so the
   * worst a wrong one does is fail to warn, which is exactly where somebody
   * with no backup already is. Holding it would mean a person with an
   * unreachable primary could never establish one, and that is the case that
   * matters most.
   */
  @Put('me/backup-email')
  setBackupEmail(@Body() dto: BackupEmailDto, @SessionActor() actor: Actor | undefined) {
    return this.practitionerEmail.setBackup(this.practitionerIdOf(actor), dto.email);
  }

  /** Removing it. Allowed, and the screen says plainly what it costs. */
  @Delete('me/backup-email')
  clearBackupEmail(@SessionActor() actor: Actor | undefined) {
    return this.practitionerEmail.clearBackup(this.practitionerIdOf(actor));
  }
}

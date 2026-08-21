import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeycloakAdminClient } from '@aobplatform/auth-client';
import {
  assertCeremonySufficient,
  CeremonyError,
  CEREMONY_FRESHNESS_DAYS,
  type CeremonyRecord,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PrismaService } from '../prisma/prisma.service';
import { KEYCLOAK_ADMIN } from './identity.tokens';

const SYSTEM_ACTOR = { principalType: 'system', id: 'core' } as const;

export interface InvitationResult {
  keycloakUserId: string;
  username: string;
  invitedAt: string;
  /** Where the enrolment email went. In dev that is Mailhog. */
  emailedTo: string | null;
  note: string;
}

/**
 * Practitioner and staff onboarding (FR-1.9, FR-1.5).
 *
 * The account is created holding NO password and carrying the
 * webauthn-register-passwordless required action, then invited by emailed
 * action link. That link is the only way in, because the clinician browser
 * flow requires a passkey the practitioner does not yet have (rule 15) — and
 * it is exactly the "admin-attested invitation, not self-service reset"
 * posture FR-1.9 specifies.
 *
 * REQ-PKI-01 IS ENFORCED HERE: no invitation is sent — and therefore no key
 * can ever be bound — without a fresh, complete, third-party-attested
 * enrolment ceremony on record. The ceremony checks AHPRA registration, the
 * provider number and its location, and the person by video or in person.
 * Re-enrolment (recovery, REQ-PKI-05) additionally requires an explicitly
 * stepped-up ceremony and notifies the practice principal.
 *
 * Still manual by design (FR-1.11): the AHPRA existence check is a human
 * looking at the register and attesting to it. Automated re-verification is
 * roadmap. What the platform guarantees is that SOMEONE NAMED attested, and
 * that the attestation is fresh, third-party and permanent.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(KEYCLOAK_ADMIN) private readonly keycloak: KeycloakAdminClient | null,
  ) {}

  private admin(): KeycloakAdminClient {
    if (!this.keycloak) {
      throw new NotImplementedException(
        'Keycloak is not configured for this instance (KEYCLOAK_BASE_URL / KEYCLOAK_ADMIN_PASSWORD). ' +
          'Identity onboarding is unavailable — no partial account is created.',
      );
    }
    return this.keycloak;
  }

  private consoleUrl(): string {
    return this.config.get<string>('CONSOLE_URL', 'http://localhost:21100');
  }

  /** Stable, human-readable, unique per practice. */
  private usernameFor(name: string, practiceId: string): string {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.|\.$/g, '');
    return slug + '.' + practiceId.slice(0, 8);
  }

  private splitName(full: string): { firstName: string; lastName: string } {
    const parts = full.trim().split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  }

  /**
   * REQ-PKI-01 — record a ceremony. The three checks are performed by a human
   * (AHPRA register lookup, provider-number verification at the location, and
   * meeting the person by video or in person); this records WHO attested to
   * them and WHEN, permanently and append-only.
   */
  async recordCeremony(
    practiceId: string,
    input: {
      providerId?: string;
      staffId?: string;
      ahpraNumber: string;
      ahpraRegistrationCurrent: boolean;
      providerNumber: string;
      providerNumberLocation: string;
      providerNumberVerified: boolean;
      personVerificationMethod: string;
      verifiedByName: string;
      verifiedByStaffId?: string;
      evidenceNote?: string;
      steppedUp?: boolean;
    },
  ) {
    if (!input.providerId && !input.staffId) {
      throw new BadRequestException('A ceremony must name the provider or staff member it verifies.');
    }
    const performedAt = new Date();

    // Validate BEFORE storing, so a ceremony on record is always sufficient
    // for a first enrolment. Re-enrolment adds the stepped-up check at binding
    // time, when we know whether a key already exists.
    const record: CeremonyRecord = {
      ...input,
      personVerificationMethod: input.personVerificationMethod as never,
      performedAt,
    };
    try {
      assertCeremonySufficient(record, { isReEnrolment: false });
    } catch (err) {
      if (err instanceof CeremonyError) throw new BadRequestException(err.message);
      throw err;
    }

    return this.prisma.withPractice(practiceId, async (tx) => {
      const ceremony = await tx.enrolmentCeremony.create({
        data: {
          practiceId,
          providerId: input.providerId ?? null,
          staffId: input.staffId ?? null,
          ahpraNumber: input.ahpraNumber.trim().toUpperCase(),
          ahpraRegistrationCurrent: input.ahpraRegistrationCurrent,
          providerNumber: input.providerNumber,
          providerNumberLocation: input.providerNumberLocation,
          providerNumberVerified: input.providerNumberVerified,
          personVerificationMethod: input.personVerificationMethod,
          verifiedByName: input.verifiedByName,
          verifiedByStaffId: input.verifiedByStaffId ?? null,
          evidenceNote: input.evidenceNote ?? null,
          steppedUp: input.steppedUp ?? false,
          performedAt,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'nomination.changed',
        actor: { principalType: 'staff', id: input.verifiedByStaffId ?? 'unattributed' },
        subject: { type: 'EnrolmentCeremony', id: ceremony.id },
        payload: {
          action: 'enrolment_ceremony_recorded',
          personVerificationMethod: input.personVerificationMethod,
          ahpraCurrent: input.ahpraRegistrationCurrent,
          providerNumberVerified: input.providerNumberVerified,
          steppedUp: input.steppedUp ?? false,
        },
      });
      return ceremony;
    });
  }

  /**
   * The gate. Finds the newest unconsumed ceremony for this subject and
   * re-asserts it against the CURRENT context — in particular whether this is
   * a re-enrolment, which only becomes knowable here (REQ-PKI-05).
   */
  private async requireCeremony(
    practiceId: string,
    subject: { providerId?: string; staffId?: string },
    isReEnrolment: boolean,
  ) {
    const ceremony = await this.prisma.withPractice(practiceId, (tx) =>
      tx.enrolmentCeremony.findFirst({
        where: {
          providerId: subject.providerId ?? undefined,
          staffId: subject.staffId ?? undefined,
          consumedAt: null,
        },
        orderBy: { performedAt: 'desc' },
      }),
    );
    if (!ceremony) {
      throw new ForbiddenException(
        'REQ-PKI-01: no enrolment ceremony is on record for this person. A key must not be bound to whoever ' +
          'answered the email — verify AHPRA registration, the provider number and its location, and the ' +
          'person by video or in person, then POST /identity/ceremonies.',
      );
    }
    try {
      assertCeremonySufficient(
        {
          ahpraNumber: ceremony.ahpraNumber,
          ahpraRegistrationCurrent: ceremony.ahpraRegistrationCurrent,
          providerNumber: ceremony.providerNumber,
          providerNumberLocation: ceremony.providerNumberLocation,
          providerNumberVerified: ceremony.providerNumberVerified,
          personVerificationMethod: ceremony.personVerificationMethod as never,
          verifiedByName: ceremony.verifiedByName,
          verifiedByStaffId: ceremony.verifiedByStaffId ?? undefined,
          performedAt: ceremony.performedAt,
          steppedUp: ceremony.steppedUp,
        },
        { isReEnrolment },
      );
    } catch (err) {
      if (err instanceof CeremonyError) throw new ForbiddenException(err.message);
      throw err;
    }
    return ceremony;
  }

  /** A ceremony authorises ONE binding. Consuming it stops replay. */
  private async consumeCeremony(practiceId: string, ceremonyId: string): Promise<void> {
    await this.prisma.withPractice(practiceId, (tx) =>
      tx.enrolmentCeremony.update({ where: { id: ceremonyId }, data: { consumedAt: new Date() } }),
    );
  }

  /** What the console needs to show whether onboarding may proceed. */
  async ceremonyStatus(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const ceremonies = await tx.enrolmentCeremony.findMany({ orderBy: { performedAt: 'desc' } });
      return {
        freshnessDays: CEREMONY_FRESHNESS_DAYS,
        ceremonies: ceremonies.map((c) => ({
          id: c.id,
          providerId: c.providerId,
          staffId: c.staffId,
          attestedBy: c.verifiedByName,
          personVerificationMethod: c.personVerificationMethod,
          steppedUp: c.steppedUp,
          performedAt: c.performedAt,
          consumedAt: c.consumedAt,
          ageDays: Math.floor((Date.now() - c.performedAt.getTime()) / 86400000),
        })),
      };
    });
  }

  /** FR-1.9 — invite a practitioner to enrol a passkey. */
  async inviteProvider(practiceId: string, providerId: string, email?: string): Promise<InvitationResult> {
    const admin = this.admin();
    const provider = await this.prisma.withPractice(practiceId, (tx) =>
      tx.provider.findFirst({ where: { id: providerId } }),
    );
    if (!provider) throw new NotFoundException('Provider not found in this practice.');

    // REQ-PKI-01/-05 — no ceremony, no key. A provider who already holds an
    // account is RE-ENROLLING: that is recovery, and it needs a stepped-up
    // ceremony plus a principal notification.
    const isReEnrolment = provider.keycloakUserId !== null;
    const ceremony = await this.requireCeremony(practiceId, { providerId }, isReEnrolment);

    const username = this.usernameFor(provider.name, practiceId);
    const { firstName, lastName } = this.splitName(provider.name);
    const user = await admin.createPasskeyOnlyUser({
      username,
      email,
      firstName,
      lastName,
      realmRoles: ['provider'],
      // The practice claim is what replaces the dev x-practice-id header once
      // auth enforcement is switched on.
      attributes: { practice_id: practiceId, provider_id: providerId },
    });

    if (email) {
      await admin.sendPasskeyEnrolment(user.id, {
        clientId: this.config.get<string>('KEYCLOAK_WEB_CLIENT_ID', 'web'),
        redirectUri: this.consoleUrl(),
      });
    }

    const invitedAt = new Date();
    await this.prisma.withPractice(practiceId, async (tx) => {
      await tx.provider.update({ where: { id: providerId }, data: { keycloakUserId: user.id, invitedAt } });
      await enqueueVaultEvent(tx, {
        type: 'nomination.changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Provider', id: providerId },
        payload: {
          action: 'passkey_invitation_sent',
          emailed: Boolean(email),
          role: 'provider',
          // The binding is traceable to the attestation that authorised it.
          ceremonyId: ceremony.id,
          attestedBy: ceremony.verifiedByName,
          personVerificationMethod: ceremony.personVerificationMethod,
          reEnrolment: isReEnrolment,
        },
      });
    });
    await this.consumeCeremony(practiceId, ceremony.id);

    if (isReEnrolment) {
      // REQ-PKI-05 — recovery is where an attacker applies pressure, so it is
      // never silent. Dispatch to the principal lands with the notification
      // work; the vault event above is the durable record meanwhile.
      this.logger.warn(
        'RE-ENROLMENT: a new key was authorised for provider ' +
          providerId +
          ' on stepped-up ceremony ' +
          ceremony.id +
          ' attested by ' +
          ceremony.verifiedByName +
          '. Notify the practice principal.',
      );
    }

    this.logger.log('Invited provider ' + providerId + ' as ' + username + ' (passkey enrolment)');
    return {
      keycloakUserId: user.id,
      username,
      invitedAt: invitedAt.toISOString(),
      emailedTo: email ?? null,
      note: email
        ? 'Enrolment email sent. In local dev it lands in Mailhog (http://localhost:21026).'
        : 'Account created with the passkey requirement, but NO email address was supplied so no invitation was ' +
          'sent. Re-invite with an email, or send the action link from the Keycloak admin console.',
    };
  }

  /** FR-1.5 — same for practice staff; admin roles get passkeys too (rule 15). */
  async inviteStaff(practiceId: string, staffId: string, email?: string): Promise<InvitationResult> {
    const admin = this.admin();
    const staff = await this.prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { id: staffId } }),
    );
    if (!staff) throw new NotFoundException('Staff member not found in this practice.');

    // Rule 15 covers admin roles, not just clinicians — so does the ceremony.
    const isReEnrolment = staff.keycloakUserId !== null;
    const ceremony = await this.requireCeremony(practiceId, { staffId }, isReEnrolment);

    const username = this.usernameFor(staff.name, practiceId);
    const address = email ?? staff.email ?? undefined;
    const { firstName, lastName } = this.splitName(staff.name);
    const user = await admin.createPasskeyOnlyUser({
      username,
      email: address,
      firstName,
      lastName,
      realmRoles: [staff.role],
      attributes: { practice_id: practiceId, staff_id: staffId },
    });

    if (address) {
      await admin.sendPasskeyEnrolment(user.id, {
        clientId: this.config.get<string>('KEYCLOAK_WEB_CLIENT_ID', 'web'),
        redirectUri: this.consoleUrl(),
      });
    }

    const invitedAt = new Date();
    await this.prisma.withPractice(practiceId, async (tx) => {
      await tx.staffMember.update({
        where: { id: staffId },
        data: { keycloakUserId: user.id, invitedAt, email: address ?? staff.email },
      });
      await enqueueVaultEvent(tx, {
        type: 'nomination.changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'StaffMember', id: staffId },
        payload: {
          action: 'passkey_invitation_sent',
          emailed: Boolean(address),
          role: staff.role,
          ceremonyId: ceremony.id,
          attestedBy: ceremony.verifiedByName,
          reEnrolment: isReEnrolment,
        },
      });
    });
    await this.consumeCeremony(practiceId, ceremony.id);

    return {
      keycloakUserId: user.id,
      username,
      invitedAt: invitedAt.toISOString(),
      emailedTo: address ?? null,
      note: address
        ? 'Enrolment email sent. In local dev it lands in Mailhog (http://localhost:21026).'
        : 'Account created with the passkey requirement, but no email address was supplied so no invitation was sent.',
    };
  }

  /**
   * REQ-PKI-04 — a practitioner marked inactive (departure, licence loss)
   * loses access immediately. The domain consequences (enduring agreements
   * flagged for termination, pending captures reassigned) are FR-1.11 and
   * land with that work; this is the identity half.
   */
  async revokeProvider(practiceId: string, providerId: string): Promise<{ revoked: boolean }> {
    const admin = this.admin();
    const provider = await this.prisma.withPractice(practiceId, (tx) =>
      tx.provider.findFirst({ where: { id: providerId } }),
    );
    if (!provider) throw new NotFoundException('Provider not found in this practice.');
    if (!provider.keycloakUserId) return { revoked: false };

    await admin.setEnabled(provider.keycloakUserId, false);
    await this.prisma.withPractice(practiceId, async (tx) => {
      await tx.provider.update({ where: { id: providerId }, data: { active: false } });
      await enqueueVaultEvent(tx, {
        type: 'nomination.changed',
        actor: SYSTEM_ACTOR,
        subject: { type: 'Provider', id: providerId },
        payload: { action: 'identity_revoked' },
      });
    });
    return { revoked: true };
  }

  /** Onboarding status for the console — who can actually sign in. */
  async status(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const providers = await tx.provider.findMany({ where: { active: true } });
      const staff = await tx.staffMember.findMany({ where: { active: true } });
      const shape = (
        rows: Array<{ id: string; name: string; keycloakUserId: string | null; invitedAt: Date | null }>,
      ) =>
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          hasAccount: r.keycloakUserId !== null,
          invitedAt: r.invitedAt,
          canSignIn: r.keycloakUserId !== null,
        }));
      return {
        keycloakConfigured: this.keycloak !== null,
        providers: shape(providers),
        staff: shape(staff),
      };
    });
  }
}

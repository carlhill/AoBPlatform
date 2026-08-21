import { Inject, Injectable, Logger, NotFoundException, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeycloakAdminClient } from '@aobplatform/auth-client';
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
 * ⚠ NOT YET IMPLEMENTED — the REQ-PKI-01 enrolment ceremony. That requires
 * AHPRA registration, the provider number and the PERSON to be verified
 * before a key is bound, because a key is only as good as the ceremony that
 * bound it. Today this endpoint trusts whoever holds practice-admin access.
 * Wiring the ceremony is a prerequisite for real practitioner onboarding —
 * not for local testing.
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

  /** FR-1.9 — invite a practitioner to enrol a passkey. */
  async inviteProvider(practiceId: string, providerId: string, email?: string): Promise<InvitationResult> {
    const admin = this.admin();
    const provider = await this.prisma.withPractice(practiceId, (tx) =>
      tx.provider.findFirst({ where: { id: providerId } }),
    );
    if (!provider) throw new NotFoundException('Provider not found in this practice.');

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
        payload: { action: 'passkey_invitation_sent', emailed: Boolean(email), role: 'provider' },
      });
    });

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
        payload: { action: 'passkey_invitation_sent', emailed: Boolean(address), role: staff.role },
      });
    });

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

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KEYCLOAK_ADMIN } from './identity.tokens';
import type { KeycloakAdminClient } from '@aobplatform/auth-client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Giving a practitioner a way to sign in.
 *
 * WHY THIS DID NOT EXIST. Accounts were created by `inviteProvider`, which
 * keys on `providers` — the PRACTICE-SIDE row. A practitioner working at three
 * practices is three provider rows, so that path would have made them three
 * accounts, except Keycloak enforces one email per realm and the second would
 * have failed. Nothing ever wrote `practitioners.keycloakUserId`, so no
 * practitioner has ever had a login.
 *
 * The person-level record was already right for this: it is keyed on AHPRA,
 * carries the practitioner's OWN email, and says in its own comment that
 * invitations go there "so a practice cannot accept an affiliation on the
 * practitioner's behalf". Only the account was missing.
 *
 * NO PRACTICE CLAIM ON THE TOKEN, deliberately. A practitioner is not scoped to
 * a practice — they work at several, and which ones changes. Their scope comes
 * from live affiliations, read at request time. Stamping one practice on the
 * token would pick a winner arbitrarily and be wrong the moment they took a
 * second job.
 *
 * ISSUED ON ACCEPTANCE, which is the ceremony. Accepting an invitation means
 * opening a message sent to their own address and typing the code from it —
 * that is possession of the address, proved, before any credential is issued.
 * REQ-PKI-01: no ceremony, no key.
 */
@Injectable()
export class PractitionerAccessService {
  private readonly logger = new Logger(PractitionerAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(KEYCLOAK_ADMIN) private readonly keycloak: KeycloakAdminClient | null,
  ) {}

  /**
   * Make sure this practitioner can sign in, and send them the link if they
   * cannot yet.
   *
   * IDEMPOTENT, because it runs on every acceptance. A practitioner joining a
   * second practice already has an account and must not be handed a fresh
   * enrolment link — that would invalidate the passkey they are already using,
   * turning "I accepted a job" into "I am locked out of the other two".
   */
  async ensureAccount(practitionerId: string): Promise<{ created: boolean; invited: boolean; detail: string }> {
    // `practitioners` is not practice-scoped, so this needs no scope. That is
    // the entire point of the person-level record.
    const practitioner = await this.prisma.practitioner.findFirst({ where: { id: practitionerId } });

    if (!practitioner) {
      return { created: false, invited: false, detail: 'No such practitioner, so no account was made.' };
    }

    if (practitioner.deregisteredAt) {
      /*
       * A deregistered practitioner does not get a way in. Their affiliations
       * are ended by REQ-XFER-08 anyway, so an account would be a credential
       * with nothing behind it — and reissuing one on some later acceptance is
       * exactly the path somebody would try.
       */
      return { created: false, invited: false, detail: 'This practitioner is deregistered, so no account was made.' };
    }

    if (!practitioner.email) {
      return {
        created: false,
        invited: false,
        detail: 'We have no address for this practitioner, so there is nowhere to send a sign-in link.',
      };
    }

    if (!this.keycloak) {
      this.logger.warn('Keycloak is not configured, so no practitioner account was created.');
      return { created: false, invited: false, detail: 'Keycloak is not configured in this environment.' };
    }

    // Already has one: nothing to do, and nothing to re-send.
    if (practitioner.keycloakUserId) {
      return { created: false, invited: false, detail: 'They already have a sign-in.' };
    }

    /*
     * LOOK BEFORE CREATING. Keycloak enforces one email per realm, so a second
     * create would fail — but the reason to look first is that finding an
     * existing account and adopting it keeps ONE identity for the person,
     * rather than leaving an orphan nothing points at.
     */
    const existing = await this.keycloak.findByEmail(practitioner.email);
    let userId = existing?.id ?? null;
    let created = false;

    if (!userId) {
      const user = await this.keycloak.createPasskeyOnlyUser({
        username: practitioner.email,
        email: practitioner.email,
        firstName: practitioner.givenNames,
        lastName: practitioner.familyName,
        realmRoles: ['provider'],
        /*
         * `practitioner_id` and NOT `practice_id`. Their scope is their live
         * affiliations, resolved per request — a practice on the token would
         * be arbitrary the moment they work at two.
         */
        attributes: { practitioner_id: practitionerId },
      });
      userId = user.id;
      created = true;
    }

    await this.keycloak.sendPasskeyEnrolment(userId, {
      clientId: this.config.get<string>('KEYCLOAK_WEB_CLIENT_ID', 'web'),
      redirectUri: this.config.get<string>('CONSOLE_URL', 'http://localhost:21100'),
      lifespanSeconds: 60 * 60,
    });

    await this.prisma.practitioner.update({
      where: { id: practitionerId },
      data: { keycloakUserId: userId, invitedAt: new Date() },
    });

    this.logger.log(`Practitioner ${practitionerId} can now sign in; enrolment link sent.`);
    return {
      created,
      invited: true,
      detail: `A link to set up a passkey was sent to ${practitioner.email}. It lasts an hour.`,
    };
  }
}

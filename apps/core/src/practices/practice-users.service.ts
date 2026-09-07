import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_PASSKEYS_PER_ADMIN,
  MAX_USERS_PER_SCOPE,
  PracticeUserError,
  assertMayAddUser,
  countsToward,
  inactivityAction,
  passkeysRemaining,
  scopeOf,
  userStatus,
} from '@aobplatform/domain';
import { ConfigService } from '@nestjs/config';
import { KEYCLOAK_ADMIN } from '../identity/identity.tokens';
import type { KeycloakAdminClient } from '@aobplatform/auth-client';
import { PrismaService } from '../prisma/prisma.service';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Actor } from '../auth/actor.decorator';

/**
 * The practice's own user list.
 *
 * WHY A PRACTICE NEEDS THIS AT ALL. Everything a practice does here is
 * recorded against a name, and until now the only account a practice had was
 * the single administrator. That meant every act by every person at the
 * practice was attributed to one shared login — which is not an audit trail,
 * it is a shrug. Reports, status views and recertification all want to say WHO
 * looked and WHO answered.
 *
 * IT DOES NOT DELETE. Deactivation withdraws access and keeps the record,
 * because somebody who confirmed or approved something must stay identifiable
 * for as long as that record matters — longer than their employment. The same
 * rule as acting-as records.
 */
@Injectable()
export class PracticeUsersService {
  private readonly logger = new Logger(PracticeUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(KEYCLOAK_ADMIN) private readonly keycloak: KeycloakAdminClient | null,
  ) {}

  /**
   * MAY THIS CALLER DECIDE WHO ELSE MAY SIGN IN?
   *
   * Being scoped to a practice was the entire access model here, which
   * separated a practice from the platform and separated nothing inside a
   * practice. So somebody granted "ordinary access" -- a receptionist, the
   * least privileged role we issue -- could open this screen and grant
   * themselves the administrator role, withdraw the real administrator, or
   * invite anybody they liked. Every cap the domain enforces sat behind a door
   * that anybody at the practice could walk through.
   *
   * The check is against the STAFF ROW rather than the token's realm roles.
   * The row is what the screen shows, what the domain caps at one per
   * practice, and what `changeRole` writes; a realm role is a copy that drifts
   * the moment somebody is promoted here without Keycloak being told.
   *
   * A PLATFORM OPERATOR PASSES, and only by acting as somebody at the
   * practice: that is the supported support route, it already refuses the
   * destructive verbs, and it records who did what on whose behalf. Reaching
   * this code at all means the practice claim is present, and for an operator
   * the only way to have one is an open acting-as session.
   */
  private async assertMayManageUsers(practiceId: string, actor?: Actor): Promise<void> {
    if (!actor?.id) {
      throw new ForbiddenException(
        'We could not tell who is asking, so this was refused. Sign out and in again.',
      );
    }

    /*
     * A PLATFORM OPERATOR PASSES ONLY WHILE ACTING AS THE PRACTICE.
     *
     * The claim is the evidence. An operator's own token carries none; the
     * acting-as interceptor puts one there for the life of an open session. So
     * "has a practice claim" and "is acting as this practice" are the same
     * statement for an operator, and checking the role alone would have let
     * support perform the practice's own acts with no session, no stated
     * reason, and nothing said to the practice.
     */
    if (actor.roles?.includes('platform_admin')) {
      if (actor.practiceId === practiceId) return;
      throw new ForbiddenException(
        'These are the practice’s own acts, so they need a practice session rather than yours. Act as ' +
          'somebody at the practice and do it from there — it works, and it records who did it on whose behalf.',
      );
    }

    const me = await this.prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { keycloakUserId: actor.id } }),
    );

    if (!me || me.deactivatedAt || me.consoleRole !== 'admin') {
      throw new ForbiddenException(
        'Only this practice’s administrator can change who may sign in. If you need somebody added or ' +
          'removed, ask them — this is deliberately not something an ordinary account can do.',
      );
    }
  }

  /**
   * Everyone at this practice, with what they may do and how many places are
   * left.
   *
   * THE COUNTS ARE RETURNED, not left for the screen to derive. A limit that a
   * practice discovers by hitting it reads as a bug, and two surfaces counting
   * it differently is how somebody is told there is room when there is not.
   */
  async list(practiceId: string, actor?: Actor) {
    /*
     * WHETHER THE CALLER MAY CHANGE ANY OF THIS, answered by the server.
     *
     * The screen could work it out — it knows the roles — but then the rule
     * would exist twice and the copy in the browser would be the one that
     * drifts. Worse, it is the copy an attacker edits. The server decides and
     * the screen obeys; the buttons it hides are the same ones the API refuses.
     */
    const mayManage = await this.assertMayManageUsers(practiceId, actor).then(
      () => true,
      () => false,
    );

    return this.prisma.withPractice(practiceId, async (tx) => {
      const staff = await tx.staffMember.findMany({
        where: { practiceId },
        orderBy: [{ deactivatedAt: 'asc' }, { name: 'asc' }],
      });
      const locations = await tx.practiceLocation.findMany({ where: { practiceId } });
      const departments = await tx.department.findMany({ where: { practiceId } });

      /*
       * THE ADMINISTRATOR'S ADDRESS HAS ONE HOME, and it is not here.
       *
       * `practices.adminEmail` is the authoritative one: it is what the
       * application record holds, what verification proves, and what a handover
       * moves. The staff row carries a copy only so the administrator appears
       * in this list at all, and a copy of a fact that something else owns is a
       * cache — which drifts. It did: the list showed the address from before a
       * change while the application form showed the address after it, and both
       * were reporting honestly from different sources.
       *
       * So the copy is not trusted at read time. Kept in the row rather than
       * dropped, because the invite path needs somewhere to write to when the
       * practice has no admin yet, but never preferred over the practice.
       */
      const practice = await tx.practice.findFirst({ where: { id: practiceId } });

      const users = staff.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.consoleRole === 'admin' ? (practice?.adminEmail ?? s.email) : s.email,
        role: s.role,
        consoleRole: s.consoleRole,
        locationId: s.locationId,
        departmentId: s.departmentId,
        scope: scopeOf(s),
        invitedAt: s.invitedAt,
        invitationsSent: s.invitationsSent,
        lastSignInAt: s.lastSignInAt,
        inactivityWarnedAt: s.inactivityWarnedAt,
        deactivatedAt: s.deactivatedAt,
        deactivatedReason: s.deactivatedReason,
        deactivatedByName: s.deactivatedByName,
        passkeyEnrolledAt: s.passkeyEnrolledAt,
        status: userStatus(s),
      }));

      /*
       * One entry per scope INSTANCE — the organisation, each location, each
       * department — because that is how the cap works. A single number for
       * "locations" would be wrong the moment a practice has two.
       */
      const scopes = [
        { key: 'organisation', label: 'Whole practice', locationId: null as string | null, departmentId: null as string | null },
        ...locations.map((l) => ({
          key: `location:${l.id}`,
          label: l.code ?? l.address,
          locationId: l.id,
          departmentId: null as string | null,
        })),
        ...departments.map((d) => ({
          key: `department:${d.id}`,
          label: d.name,
          locationId: d.locationId,
          departmentId: d.id,
        })),
      ].map((s) => {
        const used = staff.filter((u) => countsToward(u, s)).length;
        return { ...s, used, limit: MAX_USERS_PER_SCOPE, remaining: Math.max(0, MAX_USERS_PER_SCOPE - used) };
      });

      const admin = staff.find((s) => s.consoleRole === 'admin' && !s.deactivatedAt);

      return {
        // Read-only callers still SEE the list — knowing who has access is not
        // privileged, and hiding it would leave an ordinary user unable to tell
        // who to ask.
        mayManage,
        users,
        scopes,
        admin: admin
          ? {
              id: admin.id,
              name: admin.name,
              email: admin.email,
              // Passkey count is Keycloak's to answer; the screen links out to
              // the Account Console rather than pretending to know.
              maxPasskeys: MAX_PASSKEYS_PER_ADMIN,
              passkeysRemaining: passkeysRemaining(admin.passkeyEnrolledAt ? 1 : 0),
            }
          : null,
      };
    });
  }

  /**
   * Give somebody access — creating the staff record if they are new.
   *
   * The invitation itself is NOT sent here. Creating the record and sending a
   * credential-bearing link are separate acts on purpose: the first is
   * reversible and the second is not, and a practice administrator adding five
   * people should not fire five enrolment links by side effect.
   */
  async grant(
    practiceId: string,
    input: {
      name: string;
      email: string;
      consoleRole: string;
      role?: string;
      locationId?: string;
      departmentId?: string;
    },
    actor?: Actor,
  ) {
    await this.assertMayManageUsers(practiceId, actor);
    return this.prisma.withPractice(practiceId, async (tx) => {
      const existing = await tx.staffMember.findMany({ where: { practiceId } });

      let consoleRole;
      try {
        consoleRole = assertMayAddUser({
          role: input.consoleRole,
          existing,
          locationId: input.locationId,
          departmentId: input.departmentId,
        });
      } catch (err) {
        if (err instanceof PracticeUserError) throw new BadRequestException(err.message);
        throw err;
      }

      /*
       * ONE ACCOUNT PER EMAIL, PER PRACTICE. Keycloak enforces one email per
       * realm and will refuse the second anyway (we already hit that in the
       * e2e logs) — refusing here means the practice gets a sentence they can
       * act on rather than a Keycloak error surfaced through three layers.
       */
      const clash = existing.find(
        (s) => s.email && s.email.toLowerCase() === input.email.trim().toLowerCase() && !s.deactivatedAt,
      );
      if (clash) {
        throw new BadRequestException(
          `${input.email} already has access here, as ${clash.name}. Change that person's role rather ` +
            'than adding them twice.',
        );
      }

      if (input.locationId) {
        const location = await tx.practiceLocation.findFirst({ where: { id: input.locationId } });
        if (!location) throw new NotFoundException('That location is not part of this practice.');
      }
      if (input.departmentId) {
        const department = await tx.department.findFirst({ where: { id: input.departmentId } });
        if (!department) throw new NotFoundException('That department is not part of this practice.');
      }

      const created = await tx.staffMember.create({
        data: {
          practiceId,
          name: input.name.trim(),
          email: input.email.trim(),
          // The practice-facing job title. Defaults to the least privileged
          // thing rather than inheriting the console role, which would grant
          // by description.
          role: input.role ?? 'front_desk',
          consoleRole,
          locationId: input.locationId ?? null,
          departmentId: input.departmentId ?? null,
          active: true,
        },
      });

      await enqueueVaultEvent(tx, {
        type: 'practice_user.granted',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'StaffMember', id: created.id },
        payload: {
          consoleRole,
          scope: scopeOf(created),
          grantedBy: actor?.name ?? 'practice',
          onBehalfOfPractice: practiceId,
        },
      });

      return { id: created.id, name: created.name, consoleRole, scope: scopeOf(created) };
    });
  }

  /**
   * Send somebody their enrolment link — the step that actually reaches them.
   *
   * WHY IT IS SEPARATE FROM `grant`. Adding five people should not fire five
   * credential links, so adding records the person and inviting writes to
   * them. That split was deliberate and it was also invisible: the status
   * read the absence of a sign-in as evidence of an invitation, so somebody
   * nobody had written to appeared as "Invited — not signed in yet". The
   * practice went looking for a person who was waiting on an email that had
   * never been sent. `userStatus` now distinguishes the two, and this is the
   * step that moves between them.
   *
   * SENDING AGAIN IS ORDINARY. Enrolment links expire in an hour and mail goes
   * astray, so re-inviting is a normal thing a practice does, not a repair. It
   * issues a fresh link and never a second account.
   */
  async invite(practiceId: string, staffId: string, actor?: Actor) {
    await this.assertMayManageUsers(practiceId, actor);

    const member = await this.prisma.withPractice(practiceId, (tx) =>
      tx.staffMember.findFirst({ where: { id: staffId } }),
    );
    if (!member) throw new NotFoundException('That person is not on this practice.');

    if (!member.consoleRole) {
      throw new BadRequestException(
        `${member.name} is on the staff list but has no sign-in access, so there is nothing to invite them ` +
          'to. Give them access first.',
      );
    }
    if (member.deactivatedAt) {
      throw new BadRequestException(
        `${member.name}’s access was withdrawn. Restore it before sending them a new link, so the invitation ` +
          'and the access decision cannot disagree.',
      );
    }
    if (!member.email) {
      throw new BadRequestException(`We have no email address for ${member.name}, so there is nowhere to send it.`);
    }

    if (!this.keycloak) {
      throw new BadRequestException(
        'Keycloak is not configured in this environment, so no sign-in link can be issued. The person is ' +
          'still on the list and can be invited once it is.',
      );
    }

    /*
     * REUSE THE ACCOUNT IF ONE EXISTS. Keycloak enforces one email per realm,
     * so creating a second would fail anyway — but the reason to look first is
     * that re-inviting somebody must not orphan the account they already hold,
     * along with whatever they have already done under it.
     */
    let keycloakUserId = member.keycloakUserId;
    if (!keycloakUserId) {
      const existing = await this.keycloak.findByEmail(member.email);
      keycloakUserId = existing?.id ?? null;
    }

    if (!keycloakUserId) {
      const [firstName, ...rest] = member.name.trim().split(/\s+/);
      const created = await this.keycloak.createPasskeyOnlyUser({
        username: member.email,
        email: member.email,
        firstName: firstName || member.name,
        lastName: rest.join(' ') || firstName || member.name,
        // Not `practice_principal`: that is the administrator's role. An
        // ordinary console user gets the least privileged realm role, and what
        // they may do here comes from consoleRole rather than from Keycloak.
        realmRoles: ['front_desk'],
        attributes: { practice_id: practiceId },
      });
      keycloakUserId = created.id;
    }

    await this.keycloak.sendPasskeyEnrolment(keycloakUserId, {
      clientId: this.config.get<string>('KEYCLOAK_WEB_CLIENT_ID', 'web'),
      redirectUri: this.config.get<string>('CONSOLE_URL', 'http://localhost:21100'),
      lifespanSeconds: 60 * 60,
    });

    const invitedAt = new Date();
    await this.prisma.withPractice(practiceId, async (tx) => {
      await tx.staffMember.update({
        where: { id: staffId },
        data: {
          keycloakUserId,
          invitedAt,
          // Counted rather than replaced: "we have written to this person four
          // times and they have never signed in" is worth being able to see.
          invitationsSent: { increment: 1 },
        },
      });

      await enqueueVaultEvent(tx, {
        type: 'practice_user.invited',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'StaffMember', id: staffId },
        payload: {
          invitedBy: actor?.name ?? 'practice',
          onBehalfOfPractice: practiceId,
          // WHICH person, never the address. An audit event is not a second
          // copy of the contact book.
          consoleRole: member.consoleRole ?? 'unknown',
        },
      });
    });

    this.logger.log(`Enrolment link sent to staff member ${staffId} at ${practiceId}.`);
    return {
      id: staffId,
      name: member.name,
      invitedAt: invitedAt.toISOString(),
      detail: `An enrolment link was sent to ${member.email}. It lasts an hour.`,
    };
  }

  /** Change what somebody may do. Same caps, same refusals. */
  async changeRole(practiceId: string, staffId: string, consoleRole: string, actor?: Actor) {
    await this.assertMayManageUsers(practiceId, actor);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const member = await tx.staffMember.findFirst({ where: { id: staffId } });
      if (!member) throw new NotFoundException('That person is not on this practice.');
      if (member.deactivatedAt) {
        throw new BadRequestException('Restore this account before changing what it may do.');
      }

      try {
        assertMayAddUser({
          role: consoleRole,
          // Themselves excluded, or keeping a role would count as taking a
          // second place and a no-op change would be refused.
          existing: (await tx.staffMember.findMany({ where: { practiceId } })).filter((s) => s.id !== staffId),
          locationId: member.locationId,
          departmentId: member.departmentId,
        });
      } catch (err) {
        if (err instanceof PracticeUserError) throw new BadRequestException(err.message);
        throw err;
      }

      const updated = await tx.staffMember.update({ where: { id: staffId }, data: { consoleRole } });
      await enqueueVaultEvent(tx, {
        type: 'practice_user.role_changed',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'StaffMember', id: staffId },
        payload: {
          from: member.consoleRole ?? 'none',
          to: consoleRole,
          changedBy: actor?.name ?? 'practice',
          onBehalfOfPractice: practiceId,
        },
      });
      return { id: updated.id, consoleRole: updated.consoleRole };
    });
  }

  /**
   * Withdraw access. NOT a delete, and the API has no delete.
   *
   * The record stays because evidence points at it. What goes is the ability
   * to sign in — and the place they occupied against the cap, so the practice
   * can immediately give it to somebody else.
   */
  /**
   * Switch the Keycloak account off, or back on.
   *
   * DISABLE, NEVER REVOKE. Withdrawing access is reversible by design -- the
   * practice can give it back, and the screen offers exactly that -- so the
   * credential must survive it. Revoking the passkey would make "restore" mean
   * "enrol again from a fresh emailed link", which is a different and much
   * worse operation wearing the same button.
   *
   * The handover case is the opposite and revokes deliberately: there the
   * account is passing to a DIFFERENT person, and the previous holder keeping
   * a working passkey is the whole thing being prevented. Reversible when the
   * same person may return; irreversible when somebody else takes over.
   *
   * Never a platform operator. A practice whose staff email happens to match
   * an account here must not be able to switch us off, and a shared address is
   * the ordinary way that would happen.
   */
  private async setAccountEnabled(keycloakUserId: string | null, enabled: boolean): Promise<string> {
    if (!keycloakUserId) {
      return 'They have no sign-in account yet, so there was nothing to switch.';
    }
    if (!this.keycloak) {
      return 'Keycloak is not configured here, so the account itself was not switched.';
    }

    const roles = await this.keycloak.realmRolesOf(keycloakUserId);
    if (roles.includes('platform_admin')) {
      throw new BadRequestException(
        'That account belongs to AoBPlatform rather than to this practice, so it cannot be changed from ' +
          'here. Tell us if you think this is wrong.',
      );
    }

    await this.keycloak.setEnabled(keycloakUserId, enabled);
    return enabled
      ? 'Their sign-in works again, with the passkey they already have.'
      : 'Their sign-in has been switched off. The passkey is kept, so restoring access does not need a new one.';
  }

  async deactivate(practiceId: string, staffId: string, reason: string, actor?: Actor) {
    await this.assertMayManageUsers(practiceId, actor);
    if (!reason?.trim()) {
      throw new BadRequestException('Say why access is being withdrawn — the practice will read this later.');
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const member = await tx.staffMember.findFirst({ where: { id: staffId } });
      if (!member) throw new NotFoundException('That person is not on this practice.');
      if (member.deactivatedAt) return { id: member.id, deactivatedAt: member.deactivatedAt };

      /*
       * THE ACCOUNT IS SWITCHED OFF, not just the row.
       *
       * This used to write these columns and stop. Nothing read them -- not the
       * guard, not Keycloak, nothing -- so "Withdraw access" withdrew nothing:
       * the person kept their passkey and could sign in and act exactly as
       * before, while the screen said their access had been withdrawn. A false
       * statement about who can reach a practice's records.
       */
      const accountNote = await this.setAccountEnabled(member.keycloakUserId, false);

      const updated = await tx.staffMember.update({
        where: { id: staffId },
        data: {
          deactivatedAt: new Date(),
          deactivatedReason: reason.trim(),
          deactivatedByName: actor?.name ?? 'practice',
          active: false,
        },
      });

      await enqueueVaultEvent(tx, {
        type: 'practice_user.deactivated',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'StaffMember', id: staffId },
        payload: {
          reason: reason.trim(),
          deactivatedBy: actor?.name ?? 'practice',
          hadConsoleRole: member.consoleRole ?? 'none',
          onBehalfOfPractice: practiceId,
          // Whether the sign-in itself was stopped, not merely recorded as
          // stopped. A reader in two years needs to know which happened.
          accountDisabled: Boolean(member.keycloakUserId),
        },
      });
      return { id: updated.id, deactivatedAt: updated.deactivatedAt, detail: accountNote };
    });
  }

  /** Give it back. The cap applies again, so this can be refused. */
  async reactivate(practiceId: string, staffId: string, actor?: Actor) {
    await this.assertMayManageUsers(practiceId, actor);

    return this.prisma.withPractice(practiceId, async (tx) => {
      const member = await tx.staffMember.findFirst({ where: { id: staffId } });
      if (!member) throw new NotFoundException('That person is not on this practice.');
      if (!member.deactivatedAt) return { id: member.id, deactivatedAt: null };

      if (member.consoleRole) {
        try {
          assertMayAddUser({
            role: member.consoleRole,
            existing: (await tx.staffMember.findMany({ where: { practiceId } })).filter((s) => s.id !== staffId),
            locationId: member.locationId,
            departmentId: member.departmentId,
          });
        } catch (err) {
          if (err instanceof PracticeUserError) {
            throw new BadRequestException(
              `${err.message} (Restoring ${member.name} would take a place that is already used.)`,
            );
          }
          throw err;
        }
      }

      /*
       * SWITCHED BACK ON, WITH THE PASSKEY THEY ALREADY HAVE.
       *
       * No new enrolment link, and that is the point of disabling rather than
       * revoking: the credential was never destroyed, so restoring access is
       * one click here rather than an email, a link, and the person finding a
       * device to enrol on.
       */
      const accountNote = await this.setAccountEnabled(member.keycloakUserId, true);

      const updated = await tx.staffMember.update({
        where: { id: staffId },
        data: {
          deactivatedAt: null,
          deactivatedReason: null,
          deactivatedByName: null,
          active: true,
          // The clock starts again from the restoration, not from whenever
          // they last signed in — which may be a year ago.
          inactivityWarnedAt: null,
        },
      });

      await enqueueVaultEvent(tx, {
        type: 'practice_user.reactivated',
        actor: { principalType: 'staff', id: actor?.id ?? practiceId },
        subject: { type: 'StaffMember', id: staffId },
        payload: {
          reactivatedBy: actor?.name ?? 'practice',
          onBehalfOfPractice: practiceId,
          accountReEnabled: Boolean(member.keycloakUserId),
        },
      });
      return { id: updated.id, deactivatedAt: null, detail: accountNote };
    });
  }

  /**
   * The lifecycle sweep: who should be warned, and whose access lapses.
   *
   * RETURNS THE DECISIONS RATHER THAN ACTING ON THEM where messaging is
   * involved, so the caller owns the send. Deactivation IS applied, because a
   * lapse that depends on somebody remembering to run something is not a
   * control.
   */
  async runInactivitySweep(practiceId: string, now = new Date()) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const staff = await tx.staffMember.findMany({
        where: { practiceId, consoleRole: { not: null }, deactivatedAt: null },
      });

      const toWarn: { id: string; name: string; email: string | null }[] = [];
      const deactivated: { id: string; name: string }[] = [];

      for (const member of staff) {
        const action = inactivityAction(member, now);
        if (action === 'warn') {
          await tx.staffMember.update({ where: { id: member.id }, data: { inactivityWarnedAt: now } });
          toWarn.push({ id: member.id, name: member.name, email: member.email });
        } else if (action === 'deactivate') {
          // The same switch as a withdrawal the practice makes by hand. A lapse
          // that only writes a column leaves the person able to sign in, which
          // would make this sweep a record of enforcement rather than the
          // enforcement itself.
          await this.setAccountEnabled(member.keycloakUserId, false);
          await tx.staffMember.update({
            where: { id: member.id },
            data: {
              deactivatedAt: now,
              deactivatedReason: 'Inactive for nine months, having been asked to sign in.',
              deactivatedByName: 'AoBPlatform',
              active: false,
            },
          });
          await enqueueVaultEvent(tx, {
            type: 'practice_user.deactivated',
            actor: { principalType: 'system', id: 'inactivity_lifecycle' },
            subject: { type: 'StaffMember', id: member.id },
            payload: {
              reason: 'inactivity',
              deactivatedBy: 'AoBPlatform',
              hadConsoleRole: member.consoleRole ?? 'none',
              onBehalfOfPractice: practiceId,
            },
          });
          deactivated.push({ id: member.id, name: member.name });
        }
      }

      if (toWarn.length || deactivated.length) {
        this.logger.log(
          `Inactivity sweep for ${practiceId}: ${toWarn.length} warned, ${deactivated.length} deactivated.`,
        );
      }
      return { warned: toWarn, deactivated };
    });
  }

  /**
   * Record that somebody signed in. This is what makes the lifecycle mean
   * anything — without it every account looks abandoned.
   */
  async recordSignIn(practiceId: string, keycloakUserId: string, now = new Date()) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const member = await tx.staffMember.findFirst({ where: { keycloakUserId } });
      if (!member) return null;
      await tx.staffMember.update({ where: { id: member.id }, data: { lastSignInAt: now } });
      return { id: member.id };
    });
  }
}

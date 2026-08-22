import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everyone at this practice, with what they may do and how many places are
   * left.
   *
   * THE COUNTS ARE RETURNED, not left for the screen to derive. A limit that a
   * practice discovers by hitting it reads as a bug, and two surfaces counting
   * it differently is how somebody is told there is room when there is not.
   */
  async list(practiceId: string) {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const staff = await tx.staffMember.findMany({
        where: { practiceId },
        orderBy: [{ deactivatedAt: 'asc' }, { name: 'asc' }],
      });
      const locations = await tx.practiceLocation.findMany({ where: { practiceId } });
      const departments = await tx.department.findMany({ where: { practiceId } });

      const users = staff.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        consoleRole: s.consoleRole,
        locationId: s.locationId,
        departmentId: s.departmentId,
        scope: scopeOf(s),
        invitedAt: s.invitedAt,
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

  /** Change what somebody may do. Same caps, same refusals. */
  async changeRole(practiceId: string, staffId: string, consoleRole: string, actor?: Actor) {
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
  async deactivate(practiceId: string, staffId: string, reason: string, actor?: Actor) {
    if (!reason?.trim()) {
      throw new BadRequestException('Say why access is being withdrawn — the practice will read this later.');
    }
    return this.prisma.withPractice(practiceId, async (tx) => {
      const member = await tx.staffMember.findFirst({ where: { id: staffId } });
      if (!member) throw new NotFoundException('That person is not on this practice.');
      if (member.deactivatedAt) return { id: member.id, deactivatedAt: member.deactivatedAt };

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
        },
      });
      return { id: updated.id, deactivatedAt: updated.deactivatedAt };
    });
  }

  /** Give it back. The cap applies again, so this can be refused. */
  async reactivate(practiceId: string, staffId: string, actor?: Actor) {
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
        payload: { reactivatedBy: actor?.name ?? 'practice', onBehalfOfPractice: practiceId },
      });
      return { id: updated.id, deactivatedAt: null };
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

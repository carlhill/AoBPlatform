/**
 * Who a practice may give access to, how many, and what happens when they stop
 * turning up.
 *
 * TWO DIFFERENT QUESTIONS LIVE ON A STAFF RECORD, and conflating them is the
 * mistake this module exists to prevent:
 *
 *   - WHAT THEY DO AT THE PRACTICE — front desk, practice manager, principal.
 *     This already exists, and it feeds the assignor block (REQ-VUL-04):
 *     practice staff cannot be assignors.
 *   - WHAT THEY MAY DO IN AoBPlatform — nothing, or a console role.
 *
 * A principal may have no console access at all, and a receptionist may run
 * every report. Collapsing them into one field would mean granting console
 * access as a side effect of describing somebody's job, which is how access
 * creeps.
 *
 * So `consoleRole` is separate and defaults to NONE. A staff record is not an
 * account until somebody deliberately makes it one.
 */

/** Console roles. Deliberately thin until we know which pages each needs. */
export const CONSOLE_ROLES = ['admin', 'other'] as const;
export type ConsoleRole = (typeof CONSOLE_ROLES)[number];

/**
 * Where a user's access sits.
 *
 * `organisation` reaches the whole practice; `location` and `department` are
 * narrower. The scope is part of the cap, not a label.
 */
export const USER_SCOPES = ['organisation', 'location', 'department'] as const;
export type UserScope = (typeof USER_SCOPES)[number];

/**
 * FIVE PER SCOPE INSTANCE — five for the organisation, five at EACH location,
 * five in EACH department.
 *
 * ⚠ NOTE THE READING. Carl wrote "a max of 5 for each Org, location,
 * department — so 5 x 3 = 15". That arithmetic describes one practice with one
 * location and one department, which is the common case. Implemented per scope
 * INSTANCE rather than per scope LEVEL, because a four-site practice sharing
 * five location-level accounts between all four sites would be unusable, and
 * the plain words "for each ... location" say per location.
 *
 * If the intent was 15 total for any practice however large, this constant and
 * `countsToward` are the whole change.
 */
export const MAX_USERS_PER_SCOPE = 5;

/**
 * EXACTLY ONE ADMIN ACCOUNT PER PRACTICE, and it is not a person.
 *
 * The account belongs to the PRACTICE — `admin.<practiceId>` in Keycloak — so
 * that succession works when an administrator leaves suddenly or was never
 * technical to begin with. A second admin account would mean two accounts able
 * to grant access, and no way to say which one the practice actually controls.
 *
 * The person changes; the account does not. That is what makes handover a
 * credential reset rather than a data migration.
 */
export const MAX_ADMIN_ACCOUNTS = 1;

/**
 * SIX PASSKEYS ON THE ADMIN ACCOUNT.
 *
 * Not a device limit — a CONTAINMENT limit. Anyone who receives the enrolment
 * link can enrol a credential on their own hardware, because the link IS the
 * identity (PASSKEYS.md). Six covers a laptop, an iPhone, an Android and room
 * to replace one, while keeping the number small enough that an unexpected
 * seventh is visible rather than lost in a list.
 */
export const MAX_PASSKEYS_PER_ADMIN = 6;

/** Inactive this long, and we ask them to sign in. */
export const INACTIVITY_WARN_MONTHS = 6;

/** Warned this long ago and still absent, and access is withdrawn. */
export const INACTIVITY_GRACE_MONTHS = 3;

/**
 * What the lifecycle can do to an account.
 *
 * DEACTIVATE, NEVER DELETE. A person who signed, approved or confirmed
 * something must stay identifiable for as long as that record matters, and
 * that is longer than their employment. Deleting the account would leave
 * evidence pointing at nobody — the same rule as acting-as records.
 */
export type LifecycleAction = 'none' | 'warn' | 'deactivate';

export class PracticeUserError extends Error {}

/**
 * Month arithmetic in UTC, deliberately.
 *
 * `setMonth` works in the SERVER'S LOCAL TIME, which made the six-month
 * threshold land at a different instant depending on where the process runs —
 * in Sydney the tests missed by eleven hours. For a rule that withdraws
 * somebody's access, "roughly six months, depending on the host's timezone" is
 * not good enough, and the failure would have been a day either side and
 * completely invisible.
 *
 * `setUTCMonth` also clamps sensibly: 31 August plus one month is 1 October,
 * not an invalid date. That is fine here — the boundary is months-scale and a
 * day's drift at a month end changes nothing about the intent.
 */
function addMonths(from: Date, months: number): Date {
  const out = new Date(from.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

/**
 * Does this user count against the cap for the given scope instance?
 *
 * DEACTIVATED USERS DO NOT COUNT. They keep their record for the audit trail
 * but hold no access, so counting them would let a practice with normal
 * turnover become permanently unable to add anybody — punishing them for the
 * retention rule that exists to protect the evidence.
 */
export function countsToward(
  user: { consoleRole?: string | null; deactivatedAt?: Date | string | null; locationId?: string | null; departmentId?: string | null },
  scope: { locationId?: string | null; departmentId?: string | null },
): boolean {
  if (!user.consoleRole) return false;
  if (user.deactivatedAt) return false;
  /*
   * THE ADMINISTRATOR HAS ITS OWN CAP and does not consume one of the five.
   * It is the practice's own account rather than a person's, so counting it
   * would silently give every practice four ordinary places instead of five —
   * a limit nobody agreed, arrived at by accident.
   */
  if (user.consoleRole === 'admin') return false;
  return (user.locationId ?? null) === (scope.locationId ?? null) &&
    (user.departmentId ?? null) === (scope.departmentId ?? null);
}

/** Which scope a record sits in. Department beats location beats organisation. */
export function scopeOf(user: { locationId?: string | null; departmentId?: string | null }): UserScope {
  if (user.departmentId) return 'department';
  if (user.locationId) return 'location';
  return 'organisation';
}

/**
 * May this practice add another console user here?
 *
 * THROWS RATHER THAN RETURNING FALSE. Every caller is about to create an
 * account and send an invitation to a real inbox; a boolean invites a caller
 * to carry on with a default.
 */
export function assertMayAddUser(input: {
  role: string;
  existing: ReadonlyArray<{
    consoleRole?: string | null;
    deactivatedAt?: Date | string | null;
    locationId?: string | null;
    departmentId?: string | null;
  }>;
  locationId?: string | null;
  departmentId?: string | null;
}): ConsoleRole {
  const role = CONSOLE_ROLES.find((r) => r === input.role);
  if (!role) {
    throw new PracticeUserError(
      `"${input.role}" is not a console role. One of: ${CONSOLE_ROLES.join(', ')}.`,
    );
  }

  if (input.departmentId && !input.locationId) {
    throw new PracticeUserError(
      'A department sits inside a location, so a department-scoped user needs the location too.',
    );
  }

  if (role === 'admin') {
    const admins = input.existing.filter((u) => u.consoleRole === 'admin' && !u.deactivatedAt);
    if (admins.length >= MAX_ADMIN_ACCOUNTS) {
      throw new PracticeUserError(
        'This practice already has its administrator account. There is exactly one, and it belongs ' +
          'to the practice rather than to a person — so when an administrator leaves, the account ' +
          'stays and its passkeys are reset. Adding a second would mean two accounts able to grant ' +
          'access, with no way to say which one the practice controls.',
      );
    }
    // An admin reaches the whole practice; scoping one to a department would
    // be a narrower thing wearing the name of the broadest.
    if (input.locationId || input.departmentId) {
      throw new PracticeUserError('The administrator account covers the whole practice and cannot be scoped to a site.');
    }
    return role;
  }

  const scope = { locationId: input.locationId ?? null, departmentId: input.departmentId ?? null };
  const used = input.existing.filter((u) => countsToward(u, scope)).length;
  if (used >= MAX_USERS_PER_SCOPE) {
    throw new PracticeUserError(
      `That is already ${MAX_USERS_PER_SCOPE} people with access at this ${scopeOf(scope)}, which is the limit. ` +
        'Deactivate somebody who no longer needs it and the place frees up — deactivated accounts are ' +
        'kept for the record but do not count.',
    );
  }
  return role;
}

/**
 * What the lifecycle should do about this account today.
 *
 * WARN FIRST, ALWAYS. Somebody on parental leave, long-term sick, or simply
 * seasonal is indistinguishable from somebody who has left, and the difference
 * matters enormously to them. The warning is what turns a silent withdrawal
 * into something a person can answer.
 *
 * `lastSignInAt` absent means they were invited and never came. That is still
 * inactivity — measured from the invitation, because an unaccepted invitation
 * left open for ever is a credential nobody is watching.
 */
export function inactivityAction(
  user: {
    consoleRole?: string | null;
    deactivatedAt?: Date | string | null;
    lastSignInAt?: Date | string | null;
    invitedAt?: Date | string | null;
    inactivityWarnedAt?: Date | string | null;
  },
  now: Date,
): LifecycleAction {
  if (!user.consoleRole) return 'none';
  if (user.deactivatedAt) return 'none';

  const since = user.lastSignInAt ?? user.invitedAt;
  if (!since) return 'none';
  const last = new Date(since);
  if (Number.isNaN(last.getTime())) return 'none';

  if (user.inactivityWarnedAt) {
    const warned = new Date(user.inactivityWarnedAt);
    /*
     * THE CLOCK RESTARTS ON A SIGN-IN, not on the warning. Somebody who was
     * warned and then came back has answered it, and the grace period must not
     * keep running underneath them towards a deactivation they already
     * prevented.
     */
    if (last > warned) {
      /*
       * THEY ANSWERED IT. A stale warning must not keep counting down towards a
       * deactivation the person already prevented by doing exactly what was
       * asked. Fall through to the ordinary rule, measured from the sign-in —
       * so the cycle can begin again if they drift off a second time.
       *
       * Deliberately handled HERE rather than by clearing the column on
       * sign-in. A rule that depends on some other code path remembering to
       * tidy up is a rule that breaks the first time somebody adds a second
       * sign-in path.
       */
      return now >= addMonths(last, INACTIVITY_WARN_MONTHS) ? 'warn' : 'none';
    }
    return now >= addMonths(warned, INACTIVITY_GRACE_MONTHS) ? 'deactivate' : 'none';
  }

  return now >= addMonths(last, INACTIVITY_WARN_MONTHS) ? 'warn' : 'none';
}

/** How many passkeys the admin account may still enrol. */
export function passkeysRemaining(enrolled: number): number {
  return Math.max(0, MAX_PASSKEYS_PER_ADMIN - enrolled);
}

/**
 * Plain-language state for one row, so every surface says the same thing.
 *
 * Written once here rather than in each screen, because "invited" and "never
 * signed in" and "deactivated" are the states a practice administrator makes
 * decisions from, and three surfaces wording them differently is how somebody
 * deactivates the wrong person.
 */
export function userStatus(user: {
  consoleRole?: string | null;
  deactivatedAt?: Date | string | null;
  lastSignInAt?: Date | string | null;
  invitedAt?: Date | string | null;
  inactivityWarnedAt?: Date | string | null;
}): { key: string; label: string; tone: 'ok' | 'warn' | 'stop' | 'muted' } {
  if (!user.consoleRole) {
    return { key: 'no_access', label: 'No sign-in access', tone: 'muted' };
  }
  if (user.deactivatedAt) {
    return { key: 'deactivated', label: 'Deactivated — can be restored', tone: 'stop' };
  }
  if (user.inactivityWarnedAt && !user.lastSignInAt) {
    return { key: 'warned_never', label: 'Invited, never signed in — asked to', tone: 'warn' };
  }
  if (user.inactivityWarnedAt) {
    return { key: 'warned', label: 'Inactive — asked to sign in', tone: 'warn' };
  }
  /*
   * ADDED IS NOT INVITED, and the difference is not pedantry.
   *
   * This used to read the absence of a sign-in as evidence of an invitation,
   * so somebody who had been added and never written to showed as "Invited —
   * not signed in yet". The practice reads that as "we have done our part and
   * they have not done theirs", goes looking for the person, and the person is
   * waiting for an email that was never sent.
   *
   * Adding somebody and inviting them are separate steps ON PURPOSE — adding
   * five people should not fire five credential links — so the status has to
   * be able to say which of the two has happened.
   */
  if (!user.lastSignInAt) {
    // Nested rather than sequential: somebody who has signed in was plainly
    // invited, whatever the invitedAt column says. Checking invitedAt first
    // would relabel a working account as "added" if that column were ever
    // missing, and a status must not contradict a sign-in that happened.
    return user.invitedAt
      ? { key: 'invited', label: 'Invited — not signed in yet', tone: 'warn' }
      : { key: 'added', label: 'Added — no invitation sent yet', tone: 'muted' };
  }
  return { key: 'active', label: 'Active', tone: 'ok' };
}

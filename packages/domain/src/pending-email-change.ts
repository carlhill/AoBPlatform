/**
 * Changing the administrator's email address, held pending confirmation.
 *
 * WHY THIS IS NOT AN ORDINARY FIELD EDIT.
 *
 * The administrator address is where every message about a practice goes:
 * enrolment links, notices, the things a practice needs in order to notice
 * something is wrong. Whoever holds it can prove they hold it, and proving you
 * hold the address is how you get a credential. So changing it is not editing
 * a contact detail — it is redirecting the channel by which the practice finds
 * out anything, including that its address was redirected.
 *
 * The old behaviour applied the change at once and revoked every passkey in
 * the same breath, on the reasoning that a handover should not leave the
 * previous holder signed in. That reasoning is right and its timing was wrong:
 * one console session was enough to point the address somewhere else AND lock
 * the real administrator out, with nothing sent to anybody. Takeover and
 * denial of service, one save, no trace outside our own logs.
 *
 * So the change is held. Nothing moves until the new address proves itself,
 * the old address keeps working the whole time, and both ends are told.
 *
 * THREE RECIPIENTS, and the third is the one that matters.
 *
 *   - the NEW address, which must confirm — that proves somebody holds it
 *   - the GROUP address, because it outlives whoever is administrator today
 *   - the OLD address, which is the point
 *
 * The new address belongs to whoever asked for the change, so telling them is
 * not a check on anything. The group address may be reachable by the same
 * person if they are inside the practice. The OLD address is the only channel
 * the requester does not control BY HAVING MADE THE REQUEST, which is what
 * makes it the one that can raise the alarm. It is why banks write to the
 * address you are leaving, not just the one you are moving to.
 *
 * If the group address is being changed in the same save, the notice goes to
 * the address it had BEFORE. Otherwise changing both at once silences the
 * warning, which makes changing both at once the obvious move.
 */

export class PendingEmailChangeError extends Error {}

/**
 * Five days, matching the correction window on an emailed amendment link.
 *
 * Not a new number to remember, and the reasoning is the same: a bearer
 * credential sitting in an inbox should not be usable for ever.
 */
export const PENDING_EMAIL_EXPIRY_DAYS = 5;

/**
 * How the request ended. `expired` is a real outcome rather than an absence:
 * an administrator whose change quietly evaporated needs to be told why.
 */
export const PENDING_EMAIL_OUTCOMES = ['confirmed', 'stopped', 'expired', 'superseded'] as const;
export type PendingEmailOutcome = (typeof PENDING_EMAIL_OUTCOMES)[number];

export type PendingEmailRecipient = {
  to: string;
  /** What this address is being told, which is not the same for all three. */
  role: 'confirm' | 'notify_old' | 'notify_group';
};

function normalise(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Who gets told, given what the practice looked like BEFORE the save.
 *
 * Deliberately takes the before-values. Called with the after-state it would
 * write to the new address twice and to the old one never, which is the exact
 * failure this exists to prevent.
 */
export function recipientsFor(input: {
  requestedEmail: string;
  previousAdminEmail: string | null;
  previousGroupEmail: string | null;
}): PendingEmailRecipient[] {
  const requested = normalise(input.requestedEmail);
  const previous = normalise(input.previousAdminEmail);
  const group = normalise(input.previousGroupEmail);

  const out: PendingEmailRecipient[] = [{ to: requested, role: 'confirm' }];

  // Only where it is genuinely a different address. A change of capitalisation
  // is not a handover, and writing "your address was changed" to the address
  // that did not change trains people to ignore the warning.
  if (previous && previous !== requested) out.push({ to: previous, role: 'notify_old' });
  if (group && group !== requested && group !== previous) out.push({ to: group, role: 'notify_group' });

  return out;
}

/**
 * Whether this request may be made at all.
 *
 * A second request replaces the first rather than queueing behind it — but the
 * first is recorded as `superseded` rather than dropped, because two attempts
 * to move the same address inside five days is itself worth a reviewer seeing.
 */
export function assertMayRequest(input: {
  requestedEmail: string;
  currentAdminEmail: string | null;
  otherContactEmails: (string | null)[];
}): void {
  const requested = normalise(input.requestedEmail);

  if (!requested || !requested.includes('@')) {
    throw new PendingEmailChangeError('A new administrator address is needed, and it must be an email address.');
  }

  if (requested === normalise(input.currentAdminEmail)) {
    throw new PendingEmailChangeError('That is already the administrator address, so there is nothing to confirm.');
  }

  /*
   * The same rule the contact-independence check enforces elsewhere, applied
   * here because this path writes the address without going through it. Two
   * roles sharing an inbox means one person can confirm their own change.
   */
  if (input.otherContactEmails.map(normalise).includes(requested)) {
    throw new PendingEmailChangeError(
      'That address already belongs to another contact at this practice. Two contacts sharing an inbox ' +
        'means one person can confirm their own change, so we need a different address.',
    );
  }
}

/**
 * SEVEN DAYS AFTER IT TAKES EFFECT, somebody can still stop it.
 *
 * The request window protects against a change nobody noticed being asked for.
 * This protects against one nobody noticed HAPPENING — and that is the more
 * likely miss, because the warning arrives while somebody is away and the
 * effect arrives while they still are.
 *
 * Google gives seven days for the same reason. It is long enough to survive a
 * week's leave and short enough that a genuine change is not permanently
 * reversible by an address the person no longer uses.
 */
export const COOLING_OFF_DAYS = 7;

export function coolingOffEndsAt(effectiveAt: Date): Date {
  const out = new Date(effectiveAt);
  out.setUTCDate(out.getUTCDate() + COOLING_OFF_DAYS);
  return out;
}

export function withinCoolingOff(effectiveAt: Date | null | undefined, now: Date): boolean {
  if (!effectiveAt) return false;
  return now.getTime() <= coolingOffEndsAt(effectiveAt).getTime();
}

/**
 * A backup address, and why it is what makes the rest workable.
 *
 * The strong-looking design is "the OLD address must authorise the change". It
 * defeats takeover — and breaks the case the feature exists for, because the
 * commonest legitimate reason to change an address is that the old one is gone.
 * Requiring it to authorise means the people who most need this cannot use it.
 *
 * A backup gives a second channel that is NOT the one being changed, so the
 * alarm still reaches somebody when the old address is unreachable. It is the
 * difference between "somebody other than the requester can object" and "the
 * old inbox must consent".
 */
export function assertBackupUsable(input: { backupEmail: string; primaryEmail: string | null }): void {
  const backup = normalise(input.backupEmail);
  const primary = normalise(input.primaryEmail);

  if (!backup || !backup.includes('@')) {
    throw new PendingEmailChangeError('A backup address is needed, and it must be an email address.');
  }

  /*
   * ONE INBOX COVERING BOTH IS ONE COMPROMISE COVERING BOTH, which is the whole
   * thing this defends against. The database enforces it too — the form is not
   * the only caller.
   */
  if (backup === primary) {
    throw new PendingEmailChangeError(
      'Your backup address cannot be the same as your main one. The point of it is to be somewhere we can ' +
        'still reach you if the main one stops working.',
    );
  }
}

/**
 * Who is warned, given a backup may or may not exist.
 *
 * The old address if it is reachable, the backup always. Both get the power to
 * STOP the change — because the address being changed is exactly the one that
 * cannot be trusted to object.
 */
export function warnedAddresses(input: {
  previousEmail: string | null;
  backupEmail: string | null;
  requestedEmail: string;
}): string[] {
  const requested = normalise(input.requestedEmail);
  const out: string[] = [];

  for (const candidate of [input.previousEmail, input.backupEmail]) {
    const value = normalise(candidate);
    // Never the address being changed TO — warning the requester about their
    // own request checks nothing.
    if (value && value !== requested && !out.includes(value)) out.push(value);
  }

  return out;
}

/**
 * How many changes are too many, and over what.
 *
 * Three attempts inside a month is not proof of anything, and it is a pattern
 * worth stopping to look at whatever each one claimed. Refused rather than
 * flagged: the fourth attempt in a month is not a person who keeps changing
 * jobs, and if it is, support can do it with a person watching.
 */
export const MAX_CHANGES_PER_MONTH = 3;

export function assertNotChurning(recentChangeCount: number): void {
  if (recentChangeCount >= MAX_CHANGES_PER_MONTH) {
    throw new PendingEmailChangeError(
      `This address has been changed ${recentChangeCount} times in the last month, so we have stopped and ` +
        'want a person to look. Tell us and somebody here will sort it out.',
    );
  }
}

export function expiresAt(requestedAt: Date): Date {
  const out = new Date(requestedAt);
  out.setUTCDate(out.getUTCDate() + PENDING_EMAIL_EXPIRY_DAYS);
  return out;
}

/**
 * Live means "still awaiting an answer" — not merely "a row exists".
 *
 * Computed from the clock rather than read from a status column, so a request
 * cannot be left looking live because a sweep did not run. Same reasoning as
 * the acting-as session expiry.
 */
export function isLive(pending: { expiresAt: Date; outcome: string | null }, now: Date): boolean {
  if (pending.outcome) return false;
  return pending.expiresAt.getTime() > now.getTime();
}

/**
 * A LINK ALONE IS NOT ENOUGH, which is why there is also a code.
 *
 * Mail scanners, link previews and antivirus gateways all issue GETs, so a
 * scheme where clicking confirms would have addresses confirming themselves
 * with no human ever involved. The link carries the token; the human carries
 * the code. The cap matters more than the length.
 */
export const MAX_CONFIRMATION_ATTEMPTS = 5;

export function mayAttemptConfirmation(pending: { attempts: number }): boolean {
  return pending.attempts < MAX_CONFIRMATION_ATTEMPTS;
}

export function assertConfirmable(
  pending: { expiresAt: Date; outcome: string | null; attempts: number },
  now: Date,
): void {
  if (pending.outcome === 'stopped') {
    throw new PendingEmailChangeError(
      'This change was stopped from the practice’s previous address, so it cannot be confirmed. If the ' +
        'change is genuine, ask for it again from the console.',
    );
  }
  if (pending.outcome) {
    throw new PendingEmailChangeError('This change has already been dealt with.');
  }
  if (!isLive(pending, now)) {
    throw new PendingEmailChangeError(
      'This confirmation has expired. They last ' +
        PENDING_EMAIL_EXPIRY_DAYS +
        ' days — ask for the change again and we will send a fresh one.',
    );
  }
  if (!mayAttemptConfirmation(pending)) {
    throw new PendingEmailChangeError(
      'Too many incorrect codes were entered for this change. Ask for it again from the console.',
    );
  }
}

/**
 * Stopping is allowed for longer than confirming, and after expiry.
 *
 * Somebody reading "your address was changed" a week late must still be able
 * to say no — refusing them because a timer ran out would give the alarm a
 * shorter life than the thing it warns about. Stopping an already-dead request
 * changes nothing on its own; the value is the review task it raises.
 */
export function assertStoppable(pending: { outcome: string | null }): void {
  if (pending.outcome === 'confirmed') {
    throw new PendingEmailChangeError(
      'This change was already confirmed, so it cannot be stopped here. Tell us straight away and we will ' +
        'look at the account.',
    );
  }
  if (pending.outcome === 'stopped') {
    throw new PendingEmailChangeError('This change has already been stopped.');
  }
}

/**
 * What a stop means for the account, which is more than discarding a row.
 *
 * Somebody pressed "this was not me" about a change to the address that holds
 * their credential. Whether or not the change was genuine, a person should
 * look at the account — so this always raises a high-stakes review task, and
 * never an automatically closable one.
 */
export function afterStop(): { raiseTask: true; kind: string; stakes: 'high' } {
  return { raiseTask: true, kind: 'admin_contact_changed', stakes: 'high' };
}

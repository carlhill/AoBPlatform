/**
 * Contact independence for a practice application.
 *
 * An application names two people: the admin who is applying, and their
 * manager. The second contact exists for exactly one reason — it gives the
 * reviewer SOMEBODY TO CALL WHO IS NOT THE PERSON WHO APPLIED. That is the
 * single cheapest anti-fraud control in the whole onboarding flow, and it is
 * worth precisely nothing if both contacts reach the same handset or inbox.
 *
 * So "two contacts" is not a field count, it is a reachability claim, and this
 * module is what makes the claim true. A shared email was already refused; a
 * shared phone was not, which meant one person could name themselves twice by
 * inventing a colleague and reusing their own mobile.
 *
 * Comparison is done on NORMALISED values, because the naive string compare is
 * trivially defeated without even meaning to:
 *
 *     0408 169 971   +61 408 169 971   (04) 0816-9971   0408169971
 *
 * are one telephone, and four different strings. Likewise CARL@x.com and
 * carl@x.com are one mailbox.
 *
 * What this deliberately does NOT do is verify that either contact is real.
 * That is the human reviewer's job and it stays there — this only refuses the
 * cases that are provably not two independent people.
 */

export class ContactError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'ContactError';
  }
}

/**
 * Reduce an Australian telephone number to a comparable form.
 *
 * Rules, in order:
 *   - strip everything that is not a digit or a leading plus
 *   - +61 / 0061 → 0  (the international and national forms of one number)
 *   - collapse a doubled leading zero produced by that rewrite
 *
 * This is for EQUALITY, not for validity. It makes no judgement about whether
 * the number can be dialled — refusing a legitimate but oddly-formatted number
 * would be a worse failure than accepting a duplicate.
 */
export function normalisePhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';

  let digits = trimmed.replace(/[^\d+]/g, '');
  digits = digits.replace(/^\+?61/, '0').replace(/^0061/, '0');
  digits = digits.replace(/^00+/, '0');
  return digits;
}

/** One mailbox, case-insensitively. Local-part case is preserved by the RFC but honoured by nobody. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type ContactClash = 'email' | 'phone' | null;

export interface ApplicationContacts {
  readonly adminEmail: string;
  readonly adminPhone: string;
  readonly managerEmail?: string | null;
  readonly managerPhone?: string | null;
}

/**
 * Which channel, if any, the two contacts share.
 *
 * Email is reported ahead of phone when both clash, because it is the one the
 * applicant is most likely to have filled in by reflex — and reporting one
 * problem at a time reads better than reporting two.
 *
 * A blank manager field is not a clash. Sole traders have no manager, and the
 * form says so; absence is a permitted answer, duplication is not.
 */
export function contactClash(contacts: ApplicationContacts): ContactClash {
  const adminEmail = normaliseEmail(contacts.adminEmail);
  const managerEmail = normaliseEmail(contacts.managerEmail ?? '');
  if (adminEmail.length > 0 && managerEmail.length > 0 && adminEmail === managerEmail) {
    return 'email';
  }

  const adminPhone = normalisePhone(contacts.adminPhone);
  const managerPhone = normalisePhone(contacts.managerPhone ?? '');
  if (adminPhone.length > 0 && managerPhone.length > 0 && adminPhone === managerPhone) {
    return 'phone';
  }

  return null;
}

export const CONTACT_CLASH_MESSAGES: Record<Exclude<ContactClash, null>, string> = {
  email:
    'The manager must be a different person — a second contact with the same email verifies nothing, ' +
    'because both messages arrive in one inbox.',
  phone:
    'The manager must be reachable independently — a second contact on the same number verifies nothing, ' +
    'because both calls reach one handset.',
};

/**
 * Server-side enforcement. The form refuses this too, but the form is not the
 * boundary: an application can be POSTed directly, and a control that only
 * exists in the browser is a suggestion.
 */
export function assertContactsIndependent(contacts: ApplicationContacts): void {
  const clash = contactClash(contacts);
  if (clash) {
    throw new ContactError('FR-1.9', CONTACT_CLASH_MESSAGES[clash]);
  }
}

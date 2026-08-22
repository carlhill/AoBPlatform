/**
 * Which audience may reach which page.
 *
 * WHY THIS EXISTS AT ALL. Until now there was no such map anywhere. Each
 * screen decided for itself, mostly by not deciding: `/practice/users` was
 * reachable by any account with a practice claim, which meant a receptionist
 * could open the page that decides who may reach patient records. The rule was
 * not wrong, it was absent — and an absent rule looks exactly like a permissive
 * one from the outside.
 *
 * A MAP RATHER THAN A DECORATOR PER PAGE. Access spread across twenty-six
 * files cannot be reviewed; you can only audit it by reading all of them and
 * noticing what is missing, which is the thing nobody ever does. Here it is one
 * table somebody can read in a minute and say "that is wrong" about.
 *
 * DEFAULT DENY. A page not in this table is refused, so adding a screen and
 * forgetting to classify it fails closed and loudly rather than quietly
 * shipping an open page. Same reasoning as the RLS policies: the failure that
 * costs you is the one that looks like success.
 *
 * THIS IS NOT THE ONLY CHECK. It answers "may this audience open this page",
 * which is coarse. It does not answer "may this person touch THIS record" —
 * that is RLS for practice data, and for an assignor it is the relationship to
 * a specific patient, which has an expiry and a revocation and cannot be
 * expressed as a role. A role says somebody is a carer; only the relationship
 * says which patient, and until when.
 */

export class PageAccessError extends Error {}

/**
 * WHO somebody is, in the only terms this map cares about.
 *
 * Deliberately not the same list as the Keycloak realm roles. `front_desk`,
 * `practice_manager` and `practice_principal` all describe jobs at a practice
 * and all reach the same pages; what separates them here is whether they hold
 * the practice's single administrator account, which is a column on the staff
 * row rather than a realm role. Roles describe people; audiences describe
 * doors.
 */
export const AUDIENCES = [
  'public',
  'platform',
  'practice',
  'practice_admin',
  'practitioner',
  'patient',
  'assignor',
] as const;
export type Audience = (typeof AUDIENCES)[number];

export type PageRule = {
  /** Any one of these is enough. */
  readonly audiences: readonly Audience[];
  /** Why it is classified this way — read by the next person to change it. */
  readonly why: string;
  /**
   * Matches everything beneath it, for routes with a `[token]` or `[id]`
   * segment.
   *
   * OPT-IN, because making it the default was a bug the tests caught: with
   * blanket prefix matching, a brand new `/practice/anything` inherited
   * `/practice`'s audiences and was allowed. That is precisely the case this
   * table exists to refuse — an unclassified page must fail closed, and it
   * cannot do that if its parent answers for it.
   */
  readonly matchesChildren?: true;
};

/**
 * Every page, and who may open it.
 *
 * Paths with a `[token]` or `[id]` segment are matched by prefix, so the
 * dynamic part never has to appear here.
 */
export const PAGES: Readonly<Record<string, PageRule>> = {
  '/': {
    audiences: ['public'],
    why: 'The landing page. Says what this is and offers the two ways in.',
  },
  '/apply': {
    audiences: ['public'],
    why: 'A practice applying. There is no account yet, by definition.',
  },
  '/callback': {
    audiences: ['public'],
    why: 'The OIDC redirect. Reached mid-sign-in, when there is not yet a session to check.',
  },

  /*
   * TOKEN-BEARING PAGES. Public in the sense that no session is required, and
   * not public in any other sense: the token is the authorisation, it is
   * single-purpose and unguessable, and each of these refuses without one.
   *
   * They must stay reachable without a session because the people answering
   * them are precisely the people who cannot sign in — a practitioner who has
   * not accepted yet, an applicant with no account, somebody proving they hold
   * an address that is not yet the practice's.
   */
  '/invitation': {
    audiences: ['public'],
    why: 'A practitioner accepting an affiliation. They may have no account with us at all yet.',
    matchesChildren: true,
  },
  '/status': {
    audiences: ['public'],
    why: 'An applicant checking progress, and correcting what they told us. No account until approval.',
    matchesChildren: true,
  },
  '/verify': {
    audiences: ['public'],
    why: 'Confirming an email address. Held by whoever received it, which is the whole test.',
    matchesChildren: true,
  },
  '/practice/confirm-email': {
    audiences: ['public'],
    why: 'Confirming a NEW administrator address. Held by somebody who by definition cannot yet sign in as this practice.',
  },
  '/practice/stop-email-change': {
    audiences: ['public'],
    why: 'Stopping that change. Sent to the OLD address, whose holder may be losing access as we speak.',
  },

  /*
   * PLATFORM. Note that three of these sit under /practice/ and are not
   * practice pages at all — they show every practice's work. The path is
   * misleading and the classification is what actually governs, but it is
   * worth moving them.
   */
  '/review': {
    audiences: ['platform'],
    why: 'Reviewer dossiers. Carries applicant evidence across every practice.',
    matchesChildren: true,
  },
  '/practice/reviews': {
    audiences: ['platform'],
    why: 'The review-task queue. Despite the path this spans practices and is ours, not a practice’s.',
  },
  '/practice/queue': {
    audiences: ['platform'],
    why: 'The outbound queue. Every practice’s messages, so not a practice screen despite the path.',
  },
  '/practice/queuebyOrg': {
    audiences: ['platform'],
    why: 'The same queue, grouped. Same reasoning.',
  },
  '/practice/queuebyOrgLocDepartment': {
    audiences: ['platform'],
    why: 'The same queue, grouped further. Same reasoning.',
  },

  /*
   * PRACTICE. A platform operator reaches these by ACTING AS somebody at the
   * practice, which carries a practice claim — so `practice` covers them
   * without naming `platform` here. Naming platform would let an operator open
   * them directly and leave no record of whose behalf they were acting on.
   */
  '/practice': { audiences: ['practice'], why: 'The practice’s hub.' },
  '/practice/setup': { audiences: ['practice'], why: 'Setting the practice up.' },
  '/practice/entity': { audiences: ['practice'], why: 'The practice’s own record.' },
  '/practice/application': { audiences: ['practice'], why: 'What the practice told us, and corrections to it.' },
  '/practice/locations': { audiences: ['practice'], why: 'Sites, and the addresses patients are seen at.' },
  '/practice/channels': { audiences: ['practice'], why: 'How the practice reaches its patients.' },
  '/practice/pms': { audiences: ['practice'], why: 'The practice management system connection.' },
  '/practice/practitioners': { audiences: ['practice'], why: 'Who works here.' },
  '/practice/affiliations': { audiences: ['practice'], why: 'Inviting practitioners, and recording departures.' },

  '/practice/users': {
    audiences: ['practice_admin'],
    why: 'Deciding who may sign in. The administrator’s alone — it decides who can reach patient records.',
  },

  /*
   * PRACTITIONER. Their own affiliations and the notices sent to them, and
   * nothing about a practice's other people. A practitioner works at several
   * practices over time and the platform must never become a directory of who
   * works where — so these pages are scoped to the person, never listed.
   */
  '/practitioner': {
    audiences: ['practitioner'],
    why: 'A practitioner’s own view: where they work, and what was sent to them.',
  },
};

/**
 * What somebody is allowed to be, given what the token and the staff row say.
 *
 * Takes BOTH, because neither is sufficient. The token says which realm roles
 * Keycloak issued; the staff row says whether they hold this practice's single
 * administrator account. Deriving admin from a realm role would be a copy that
 * drifts the moment somebody is promoted in our console without Keycloak being
 * told — and that copy would be the one deciding access.
 */
export function audiencesOf(principal: {
  roles?: readonly string[];
  practiceId?: string | null;
  consoleRole?: string | null;
  deactivatedAt?: Date | string | null;
}): Audience[] {
  const out = new Set<Audience>(['public']);
  const roles = principal.roles ?? [];

  // Withdrawn is withdrawn. Checking the role without checking whether the row
  // is still live would leave a former administrator holding the door.
  if (principal.deactivatedAt) return [...out];

  if (roles.includes('platform_admin')) out.add('platform');

  /*
   * A PRACTICE CLAIM IS WHAT MAKES SOMEBODY A PRACTICE USER, not a realm role.
   * That is deliberate and it is what lets acting-as work: an operator with an
   * open session carries the claim, so they reach practice pages as the
   * practice, with a record of on whose behalf.
   */
  if (principal.practiceId) {
    out.add('practice');
    if (principal.consoleRole === 'admin') out.add('practice_admin');
  }

  if (roles.includes('provider')) out.add('practitioner');
  if (roles.includes('patient')) out.add('patient');
  if (roles.includes('assignor')) out.add('assignor');

  return [...out];
}

/** The rule for a path, matching `/status/abc123` to `/status`. */
export function ruleFor(path: string): PageRule | null {
  const clean = (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
  if (PAGES[clean]) return PAGES[clean];

  /*
   * Only pages that ASKED to match their children do. Longest first, so a
   * child with its own entry still wins over a matching parent.
   */
  const match = Object.keys(PAGES)
    .filter((p) => PAGES[p].matchesChildren && p !== '/' && clean.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];

  return match ? PAGES[match] : null;
}

/**
 * May this audience open this page?
 *
 * An unknown page is REFUSED. A new screen that nobody classified is the exact
 * case this table exists to catch, and answering "yes" to it would make the
 * table decorative.
 */
export function mayReach(path: string, audiences: readonly Audience[]): boolean {
  const rule = ruleFor(path);
  if (!rule) return false;
  return rule.audiences.some((a) => audiences.includes(a));
}

export function assertMayReach(path: string, audiences: readonly Audience[]): void {
  if (mayReach(path, audiences)) return;

  const rule = ruleFor(path);
  if (!rule) {
    throw new PageAccessError(
      `There is no such page here, or nobody has said who may open it. Either way it is refused.`,
    );
  }
  throw new PageAccessError(
    'This page is not one your account can open. If you think it should be, ask your practice’s ' +
      'administrator — or us, if you are the administrator.',
  );
}

/** Every page an audience can open. For building navigation that does not lie. */
export function pagesFor(audiences: readonly Audience[]): string[] {
  return Object.keys(PAGES)
    .filter((p) => PAGES[p].audiences.some((a) => audiences.includes(a)))
    .sort();
}

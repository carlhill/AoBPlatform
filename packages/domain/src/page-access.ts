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
  '/help': {
    audiences: ['public'],
    why: 'Where somebody signed in but unplaceable lands. Public because being unplaceable is the whole point — any audience can arrive here.',
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
  /*
   * THE PATIENT'S PAGES, and they were not here at all — so the guard answered
   * "There is no such page" for the approval screen every patient is sent to.
   * The same omission as `/practice/reconciliation` before it: the page moved
   * under `/patient` and nobody classified it.
   *
   * Public in the token-bearing sense above: no session, and none possible
   * (REQ-PORT-08). Each page refuses without a token, and the server refuses a
   * token whose identity challenge has not passed.
   */
  '/patient': {
    audiences: ['public'],
    why: 'A patient approving from the link they were sent, and their own half of the correspondence log. No account exists to sign in with — the token is the authorisation.',
    matchesChildren: true,
  },
  /*
   * THE KIOSK. Public in exactly the sense the token-bearing pages above are:
   * no session is required, and none is possible.
   *
   * The tablet is trusted because a staff member signed in on it and it is
   * scoped to their practice (Part 6 decision 3) — not because the browser
   * carries a Keycloak session, which it does not and which the Expo build it
   * replaces never had either. Scope reaches the server as `x-practice-id`,
   * where RLS re-checks it: a wrong or absent id yields nothing rather than
   * leaking somebody else's waiting room.
   *
   * There is no `matchesChildren` here, and that is deliberate. The ceremony's
   * steps are component state rather than routes, so there are no children —
   * and if somebody later adds one it must be classified rather than inherit
   * this entry.
   */
  '/kiosk': {
    audiences: ['public'],
    why: 'The waiting-room tablet. A practice-owned device with no sign-in of its own; scope is the practice header, re-checked by RLS. There is deliberately no patient mobile app.',
  },

  '/practice/confirm-email': {
    audiences: ['public'],
    why: 'Confirming a NEW administrator address. Held by somebody who by definition cannot yet sign in as this practice.',
  },
  '/practice/stop-email-change': {
    audiences: ['public'],
    why: 'Stopping that change. Sent to the OLD address, whose holder may be losing access as we speak.',
  },
  '/practice/confirm-backup': {
    audiences: ['public'],
    why: 'A backup address proving it works. Held by somebody who may have no account at all — being reachable is their entire role.',
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
  '/platform/acting-as': {
    audiences: ['platform'],
    why: 'The register of who is acting as which practice. Ours, and the one page that can stop a session early.',
  },
  /*
   * A PRACTICE'S PAGES, REACHED AS THE PLATFORM.
   *
   * Not a crack in the acting-as rule — it is the other half of it. Some work
   * about a practice is OURS: recording what the AHPRA register says is an
   * independent attestation, and doing it from inside the practice's session
   * would record it as theirs and force a reapproval for our own job.
   *
   * So the rule is not "operators reach practice pages only by acting as
   * them". It is "an operator does the PRACTICE's acts by acting as them, and
   * the PLATFORM's acts as themselves". These routes are the second case, and
   * what they expose is narrower than the practice route, not wider.
   */
  '/platform/practices': {
    audiences: ['platform'],
    why: 'A practice’s pages reached as the platform, for work that is ours rather than theirs — the register check above all. Never for the practice’s own acts, which still need acting-as.',
    matchesChildren: true,
  },
  '/platform/acting-as/history': {
    audiences: ['platform'],
    why: 'Every acting-as session there has ever been, with its reason. Asked about months later, so it is a search rather than a dashboard.',
  },

  /*
   * PRACTICE. A platform operator reaches these by ACTING AS somebody at the
   * practice, which carries a practice claim — so `practice` covers them
   * without naming `platform` here. Naming platform would let an operator open
   * them directly and leave no record of whose behalf they were acting on.
   */
  /*
   * THE ORGANISATION LIST, and the one place a platform operator legitimately
   * belongs on a `/practice/...` path without acting as anybody.
   *
   * It was classified `practice` only, which closed it to the exact audience it
   * was written for: the component redirects practice-scoped users away and
   * lists every organisation, so an operator was blocked from the operator's
   * page while a practice user was sent off it — nobody could open it.
   *
   * THIS IS NOT A CRACK IN THE ACTING-AS RULE. Every page BELOW this one stays
   * `practice`-only, so an operator still cannot read one practice's setup,
   * patients or messages without opening a session against it and leaving a
   * record of on whose behalf. This page carries no practice's work — it
   * carries names, ABNs and readiness, which is the directory an operator needs
   * in order to choose which practice to act as at all. Without it the only way
   * to reach a practice is to already know its id.
   */
  '/practice': {
    audiences: ['practice', 'platform'],
    why: 'The practice’s hub, and the platform’s list of every organisation. The list is how an operator finds a practice to act as; everything below it stays practice-only.',
  },
  '/practice/setup': { audiences: ['practice'], why: 'Setting the practice up.' },
  '/practice/entity': { audiences: ['practice'], why: 'The practice’s own record.' },
  '/practice/application': { audiences: ['practice'], why: 'What the practice told us, and corrections to it.' },
  '/practice/locations': { audiences: ['practice'], why: 'Sites, and the addresses patients are seen at.' },
  '/practice/channels': { audiences: ['practice'], why: 'How the practice reaches its patients.' },
  '/practice/pms': { audiences: ['practice'], why: 'The practice management system connection.' },
  '/practice/practitioners': { audiences: ['practice'], why: 'Who works here.' },
  '/practice/affiliations': { audiences: ['practice'], why: 'Inviting practitioners, and recording departures.' },
  '/practice/reconciliation': {
    audiences: ['practice', 'platform'],
    why: 'Services billed without an agreement, ranked by the lodgement window (M7). The practice’s own, scoped by its token; the platform reaches one practice’s through the view-only twin.',
  },
  '/practice/correspondence': {
    audiences: ['practice', 'platform'],
    why: 'Every message sent in the practice’s name (M-1). The practice’s own, scoped by its token; the platform reaches one practice’s through the view-only twin, which shows states and never bodies.',
  },

  '/practice/reports': {
    audiences: ['practice', 'platform'],
    why: 'Counts of what was sent. Named for both audiences because the figures are scoped by the caller’s own token rather than by the page — a practice sees its own, the platform sees across.',
  },

  '/practice/users': {
    audiences: ['practice_admin'],
    why: 'Deciding who may sign in. The administrator’s alone — it decides who can reach patient records.',
  },

  /*
   * THE TABLETS, and the same audience as `/practice/users` for the same
   * reason. Registering a device hands out the credential that lets a screen
   * in a waiting room read the practice's waiting list; revoking one takes it
   * back. That is the same class of decision as deciding who may sign in, not
   * a setting — so it belongs to the administrator rather than to anybody with
   * a practice claim.
   *
   * It is also the ONLY place a device is revoked or rotated. Never on the
   * device: a tablet that can un-pair itself is a tablet a passer-by can
   * un-pair (TODO.md "Zero-footprint kiosk").
   */
  '/practice/devices': {
    audiences: ['practice_admin'],
    why: 'The practice’s paired tablets. Registering one issues the credential that opens the waiting list, and revoking one closes it — the administrator’s alone, and never done on the device.',
  },

  /*
   * SENDING AN AGREEMENT TO A TABLET IS RECEPTION'S JOB, so it is `practice`
   * and NOT `practice_admin` — and the difference from `/practice/devices`
   * just above is the whole reasoning. Registering a device hands out the
   * credential that opens a practice's waiting list; that is a decision about
   * who may reach patient records, and it belongs to the administrator. Using
   * a tablet that is already paired is the ordinary work of the front desk,
   * performed dozens of times a morning by the person standing at it. An
   * administrator-only page here would mean either that reception cannot do
   * its job or that every receptionist is an administrator, and the second is
   * how access controls die.
   *
   * The acts behind it are `@PracticeScoped` on the server, so a platform
   * operator reaches them only by acting as the practice — which leaves a
   * record of on whose behalf, and forces a re-approval by somebody else.
   */
  '/practice/tablet': {
    audiences: ['practice'],
    why: 'Sending a locked agreement to a paired tablet beside reception, and watching what it does. The front desk’s own work — the practice checked the patient across the counter, and the push is what records that.',
  },

  /*
   * PRACTITIONER. Their own affiliations and the notices sent to them, and
   * nothing about a practice's other people. A practitioner works at several
   * practices over time and the platform must never become a directory of who
   * works where — so these pages are scoped to the person, never listed.
   */
  '/practitioner': {
    audiences: ['practitioner'],
    why: 'A practitioner’s own view: where they work, what we hold about them, and what was sent to them.',
    matchesChildren: true,
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
  /**
   * A practitioner's own claim. Carried INSTEAD of a practice claim, so it is
   * checked separately rather than as a fallback — somebody with neither is
   * not a practitioner with a missing value, they are somebody we cannot place.
   */
  practitionerId?: string | null;
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

  /*
   * THE CLAIM, not the role — the same rule as a practice user. `provider` says
   * what kind of person they are; the claim says which person. A role with no
   * claim is an account nothing has been scoped to, and letting it reach a
   * practitioner page would show it somebody else's or refuse and look broken.
   */
  if (principal.practitionerId) out.add('practitioner');
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

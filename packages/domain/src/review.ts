/**
 * What a reviewer must not miss.
 *
 * Gate 3 is a person deciding whether an applicant is entitled to act for an
 * entity. Gates 1 and 2 have already passed by the time an application reaches
 * them — so everything on this screen is, by construction, an application that
 * looks fine. The failure mode is not a reviewer being fooled by something
 * obviously wrong; it is a reviewer skimming twenty tidy applications and
 * approving the twenty-first out of rhythm.
 *
 * So the flags exist to BREAK the rhythm, and they live here rather than in a
 * component for two reasons:
 *
 *   1. The queue sorts by them and the dossier displays them. One definition,
 *      or the list will eventually order by one rule and explain another.
 *   2. They are a policy about what matters, and policy belongs where it can be
 *      tested. Every flag below has a test that says why it fires.
 *
 * A flag is never a refusal. Nothing here blocks an approval — a sole trader
 * with one proof and no manager may be entirely genuine, and refusing them
 * automatically would be a worse system. A flag says LOOK HERE, and then a
 * named human decides.
 */

import { contactClash } from './contacts';

/**
 * Severity orders the queue. It is not a probability of fraud — it is how much
 * of the decision the reviewer is being asked to carry personally.
 *
 * BLOCKING is different in kind from the rest, not merely worse. High, medium
 * and low all say "weigh this". Blocking says the application CANNOT be
 * approved as it stands, because something it depends on is not true — and the
 * approve action is refused while one stands, rather than merely discouraged.
 *
 * The bar for blocking is deliberately high: it must be a defect the applicant
 * can FIX. A blocking flag with no remedy is just a rejection with extra steps,
 * and would push reviewers to approve around it.
 */
export type FlagSeverity = 'blocking' | 'high' | 'medium' | 'low';

export interface ReviewFlag {
  readonly key: string;
  readonly severity: FlagSeverity;
  /** Filled in by the caller from the string table; the domain holds no copy. */
  readonly detail?: string;
}

export interface ReviewableApplication {
  readonly abnVerificationSource?: string | null;
  readonly adminEmail?: string | null;
  readonly adminPhone?: string | null;
  readonly managerName?: string | null;
  readonly managerEmail?: string | null;
  readonly managerPhone?: string | null;
  readonly entityType?: string | null;
  readonly credentialValue?: string | null;
  readonly credentialCount?: number;
  readonly adminEmailVerifiedAt?: string | Date | null;
  /**
   * Whether the checks a reviewer has already recorded would clear the identity
   * threshold. Supplied by the caller because scoring lives in checks.ts and
   * this module must not grow a second implementation of it.
   */
  readonly wouldPassIdentity?: boolean;
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { blocking: 0, high: 1, medium: 2, low: 3 };

/**
 * The flags for one application, worst first.
 *
 * Ordering within a severity is the order written here, which is deliberate:
 * the ABN provenance comes before everything, because it is the only flag that
 * says a gate the screen reports as PASSED was not actually machine-verified.
 */
export function reviewFlags(application: ReviewableApplication): ReviewFlag[] {
  const flags: ReviewFlag[] = [];

  // HIGH. The register gate passed on the applicant's own transcription. Every
  // rule still ran — but against words the applicant typed, so this is the one
  // case where "the ABR says ACTIVE" means "the applicant says the ABR says".
  if (application.abnVerificationSource === 'manual_attestation') {
    flags.push({ key: 'attested', severity: 'high' });
  }

  // BLOCKING. Two contacts reaching one place is one contact, and the second
  // contact is the entire reason a reviewer has somebody to call who is not the
  // applicant. Approving without it is approving on the applicant's own
  // say-so — so this refuses the approval rather than merely warning about it.
  //
  // It qualifies as blocking precisely because it is FIXABLE: the applicant
  // amends the application with a real second contact and it clears. New
  // applications cannot reach this state at all — the service and a trigger
  // both refuse it — so what appears here is history, from before the rule.
  const clash = contactClash({
    adminEmail: application.adminEmail ?? '',
    adminPhone: application.adminPhone ?? '',
    managerEmail: application.managerEmail,
    managerPhone: application.managerPhone,
  });
  if (clash) {
    flags.push({ key: 'contacts_clash', severity: 'blocking', detail: clash });
  }

  // MEDIUM. Not blocking — plenty of people never click the link, and refusing
  // an otherwise sound application on that would be absurd. But an unconfirmed
  // address means every message we have sent about this application may have
  // gone nowhere, including the ones the reviewer is relying on having landed.
  if (!application.adminEmailVerifiedAt) {
    flags.push({ key: 'email_unverified', severity: 'medium' });
  }

  // MEDIUM. Permitted, and it removes the cheapest control there is.
  const hasManager = (application.managerName ?? '').trim().length > 0;
  if (!hasManager) {
    flags.push({ key: 'no_manager', severity: 'medium' });
  }

  // LOW. Context, not concern — a sole trader legitimately has less to show,
  // and the reviewer should read the thin file in that light rather than as a
  // thin file from a company.
  if (application.entityType === 'INDIVIDUAL_SOLE_TRADER') {
    flags.push({ key: 'sole_trader', severity: 'low' });
  }

  /*
   * A thin credential list, but ONLY while it still matters.
   *
   * The flag's own justification is "fewer proofs means more of the decision
   * rests on you". Once the reviewer's recorded checks would clear the identity
   * threshold, that is no longer true — the decision is resting on the checks,
   * which is exactly where it should rest. Leaving the flag up at that point
   * reads as a contradiction against a passing score, and a flag that appears
   * to contradict the screen it is on is a flag people learn to ignore.
   *
   * Note the two are counting different things and neither is the other's
   * proxy: proofs are IDENTIFIERS THE APPLICANT SUPPLIED, the score is CHECKS
   * SOMEBODY HERE PERFORMED. A stack of self-declared numbers is not evidence;
   * that asymmetry is the whole design.
   */
  const proofs = application.credentialCount ?? (application.credentialValue ? 1 : 0);
  if (proofs <= 1 && !application.wouldPassIdentity) {
    flags.push({ key: 'weak_proof', severity: 'low' });
  }

  // Worst first WITHIN an application, not merely between them. The dossier
  // renders these in order and promises the reader that the top one matters
  // most; returning them in the order they happen to be written above would
  // quietly break that promise the moment a severity changed.
  //
  // Stable, so the deliberate ordering within a severity — ABN provenance
  // before the rest, because it is the only flag saying a gate reported as
  // PASSED was not machine-verified — survives the sort.
  return flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/**
 * Whether any flag refuses the approval outright.
 *
 * Separate from severity ordering because the two questions are different: one
 * asks what to look at first, this asks whether the decision may be made at
 * all.
 */
export function blockingFlags(flags: readonly ReviewFlag[]): ReviewFlag[] {
  return flags.filter((flag) => flag.severity === 'blocking');
}

/** The worst flag present, or null. Drives the queue row's mark. */
export function worstSeverity(flags: readonly ReviewFlag[]): FlagSeverity | null {
  if (flags.length === 0) return null;
  return flags.reduce<FlagSeverity>(
    (worst, flag) => (SEVERITY_RANK[flag.severity] < SEVERITY_RANK[worst] ? flag.severity : worst),
    'low',
  );
}

/**
 * Sort comparator: worst first, and oldest first within equal severity.
 *
 * Age breaks the tie rather than being the primary sort, because a queue
 * ordered purely by arrival buries the application that most needs attention
 * under a fortnight of routine ones — while a queue that ignores age entirely
 * lets a quiet application wait forever.
 */
export function compareForReview(
  a: { flags: readonly ReviewFlag[]; createdAt: string | Date },
  b: { flags: readonly ReviewFlag[]; createdAt: string | Date },
): number {
  const rank = (flags: readonly ReviewFlag[]) => {
    const worst = worstSeverity(flags);
    return worst ? SEVERITY_RANK[worst] : SEVERITY_RANK.low + 1;
  };
  const byRank = rank(a.flags) - rank(b.flags);
  if (byRank !== 0) return byRank;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

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
 */
export type FlagSeverity = 'high' | 'medium' | 'low';

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
}

const SEVERITY_RANK: Record<FlagSeverity, number> = { high: 0, medium: 1, low: 2 };

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

  // HIGH. Two contacts reaching one place is one contact. This should now be
  // impossible on new applications — the service and the database both refuse
  // it — but the constraint went on NOT VALID, so applications submitted before
  // the rule existed are still in the queue and must still be caught.
  const clash = contactClash({
    adminEmail: application.adminEmail ?? '',
    adminPhone: application.adminPhone ?? '',
    managerEmail: application.managerEmail,
    managerPhone: application.managerPhone,
  });
  if (clash) {
    flags.push({ key: 'contacts_clash', severity: 'high', detail: clash });
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

  const proofs = application.credentialCount ?? (application.credentialValue ? 1 : 0);
  if (proofs <= 1) {
    flags.push({ key: 'weak_proof', severity: 'low' });
  }

  return flags;
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

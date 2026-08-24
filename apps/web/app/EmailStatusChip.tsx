'use client';

/**
 * The status of an email address under verification — everywhere one is shown.
 *
 * CONVENTIONS.md §9d, Carl's rule verbatim: "need an auto-refresh and a tag to
 * say the email validation is pending or validated. We should do this
 * everywhere we check emails."
 *
 * An address with no tag reads as fine, and "reads as fine" is exactly how an
 * unverified address ends up relied on. So the unverified state is the one
 * required to be loud: a word beside the address, never colour alone — the
 * same rule the rest of this codebase already holds to for every status.
 */

import { useEffect, useRef } from 'react';
import { CheckCircle2, Clock } from 'lucide-react';
import { Chip } from './ui';
import { strings } from './strings';

export type EmailStatus = 'verified' | 'pending' | 'none';

export function EmailStatusChip({ status }: { status: EmailStatus }) {
  if (status === 'none') return null;
  return status === 'verified' ? (
    <Chip tone="ok">
      <CheckCircle2 size={12} aria-hidden="true" /> {strings.emailStatus.verified}
    </Chip>
  ) : (
    <Chip tone="warn">
      <Clock size={12} aria-hidden="true" /> {strings.emailStatus.pending}
    </Chip>
  );
}

/**
 * Reload automatically WHILE something is pending, and only then.
 *
 * The person who confirms an address is usually in another tab, another
 * inbox, another building entirely — the flip from pending to verified
 * happens on the server while this screen sits still. A screen that needs a
 * manual reload to notice teaches people that the tag is stale, and a stale
 * tag is worse than none.
 *
 * Stops the moment nothing is pending, so a settled screen does not poll
 * forever in a forgotten tab.
 */
export function usePendingRefresh(pending: boolean, reload: () => void, intervalMs = 20_000): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => reloadRef.current(), intervalMs);
    return () => clearInterval(timer);
  }, [pending, intervalMs]);
}

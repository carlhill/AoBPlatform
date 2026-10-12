'use client';

/**
 * WHERE A COPY LINK LANDS — W6, REQ-PORT-02, the s 65C copy-on-request
 * obligation automated.
 *
 * IT ASKS FOR NOTHING, and that is a decision rather than an omission. The
 * portal's own copy route asks three identifiers because it opens a WHOLE
 * RECORD; this link was sent to an address the practice already held for the
 * person who signed, and it opens the ONE document that person signed and has
 * already read. Putting a quiz in front of it would make a copy of your own
 * signature harder to get than the signature was.
 *
 * THE BYTES ARE THE SERVER'S, VERIFIED (hard rule 13). This page fetches and
 * hands over what core returns; core re-renders under the renderer version
 * recorded on the agreement and refuses when the hash has moved. Nothing here
 * renders, composes or caches a document — a second render path is exactly
 * what rule 13 forbids.
 *
 * WHY IT FETCHES RATHER THAN LINKING STRAIGHT AT CORE. A bare link would show
 * a patient a raw JSON error when a link has lapsed. Fetching lets every
 * outcome be a sentence: expired, refused, or unreachable, each naming what to
 * do next, which on a patient surface is always the practice
 * ("Shortcuts to the answer", Carl 4 Sep 2026).
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Notice, Shell, ui } from '../../../ui';
import { strings } from '../../../strings';
import styles from '../../../verify/verify.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/** Each maps to copy that names the fix. There is no generic fallback. */
type Outcome = 'invalid' | 'conflict' | 'unreachable';

export function AgreementCopyView({ token }: { token: string }) {
  const [href, setHref] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`${CORE_URL}/agreement-copy/${encodeURIComponent(token)}`).catch(() => null);
    if (!res) return setOutcome('unreachable');
    // 409 is the tamper signal, and it is not the same answer as a lapsed
    // link: the record is intact and the platform is refusing to show bytes
    // whose hash has moved.
    if (res.status === 409) return setOutcome('conflict');
    if (!res.ok) return setOutcome('invalid');
    const blob = await res.blob();
    setHref(URL.createObjectURL(blob));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The object URL is the tab's own; it goes when the tab does. */
  useEffect(() => () => {
    if (href) URL.revokeObjectURL(href);
  }, [href]);

  if (outcome) {
    const o =
      outcome === 'conflict'
        ? {
            title: strings.patientCopy.conflictTitle,
            body: strings.patientCopy.conflictBody,
            tone: 'stop' as const,
          }
        : outcome === 'unreachable'
          ? {
              title: strings.patientCopy.unreachableTitle,
              body: strings.patientCopy.unreachableBody,
              tone: 'warn' as const,
            }
          : {
              title: strings.patientCopy.invalidTitle,
              body: strings.patientCopy.invalidBody,
              tone: 'warn' as const,
            };
    return (
      <Shell>
        <div className={styles.card}>
          <div className={styles.mark}>
            <ShieldCheck size={20} aria-hidden="true" />
            <span className={styles.markText}>{strings.appName}</span>
          </div>
          <Notice tone={o.tone} title={o.title} data-testid={`copy-${outcome}`}>
            {o.body}
          </Notice>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={strings.patientCopy.heading} lead={strings.patientCopy.lede}>
      {href === null ? (
        <p className={ui.hint} data-testid="copy-preparing">
          {strings.patientCopy.preparing}
        </p>
      ) : (
        <p>
          <a
            className={ui.buttonLink}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="copy-open"
          >
            {strings.patientCopy.open}
          </a>
        </p>
      )}
      <p className={ui.hint}>{strings.patientCopy.checked}</p>
    </Shell>
  );
}

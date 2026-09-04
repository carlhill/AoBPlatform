'use client';

/**
 * WHAT HAPPENS TO MY DATA — the card Carl asked for by name (4 Sep 2026: "a
 * patient will want to know what we do with all their data").
 *
 * TWO HALVES, AND THE SECOND IS THE ONE THAT ANSWERS THE QUESTION. Plain
 * language about what is held and why, then WHO HAS LOOKED — every access is
 * already a vault event (FR-8.2), so the timeline is a read of something that
 * exists rather than a new thing to maintain. A collection notice on its own is
 * what every organisation publishes; the timeline is the part that is checkable.
 *
 * THE RETENTION PERIOD IS A PLACEHOLDER ON PURPOSE. The requirements state a
 * period and anchor it to an event this system may not observe directly, so the
 * sentence a patient reads has to be written from the requirement rather than
 * from memory (CLAUDE.md §7 — never invent a regulatory fact). The key exists,
 * it renders visibly as a placeholder, and it is flagged for Carl rather than
 * quietly filled in with a plausible number.
 *
 * AN ACTION KEY WITH NO COPY SHOWS AS ITS CODE. A timeline row that said
 * nothing would be worse than useless on the one card whose job is to be
 * believed — and a visible code is a thing somebody can quote to support
 * ("shortcuts to the answer", Carl 4 Sep 2026).
 */

import type { PortalAccessEntry } from '../api';
import { strings } from '../../../strings';
import { instant } from '../format';
import { Card, CardState, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

export function DataCard({ state }: { state: Loadable<readonly PortalAccessEntry[]> }) {
  return (
    <Card id="portal-data" title={strings.portal.data.heading}>
      <div className={styles.prose}>
        <p>{strings.portal.data.whatWeHold}</p>
        <p>{strings.portal.data.whyWeHold}</p>
        <p>{strings.portal.data.whoSeesIt}</p>
        <p>{strings.portal.data.retentionPeriod}</p>
        <p>{strings.portal.data.yourRights}</p>
      </div>

      <h3 className={styles.groupTitle}>{strings.portal.data.accessLogHeading}</h3>
      <p className={styles.cardLead}>{strings.portal.data.accessLogLead}</p>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.data.accessLogEmpty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.data.accessLogEmpty} />
      ) : (
        <ol className={styles.timeline}>
          {state.data.map((entry, index) => (
            <li className={styles.timelineItem} key={`${entry.at}-${entry.actionKey}-${index}`}>
              <span className={styles.timelineWhen}>{instant(entry.at)}</span>
              <span className={styles.rowValue}>
                {strings.portal.data.actors[entry.actorType] ?? (
                  <code className={styles.unmappedKey}>{entry.actorType}</code>
                )}{' '}
                ·{' '}
                {strings.portal.data.actions[entry.actionKey] ?? (
                  <code className={styles.unmappedKey}>{entry.actionKey}</code>
                )}
              </span>
              <span className={styles.rowMeta}>{entry.practiceName}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

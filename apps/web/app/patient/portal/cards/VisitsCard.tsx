'use client';

/**
 * WHERE I HAVE BEEN — the practices and dates where a bulk-billing agreement
 * was made.
 *
 * IT IS NOT A MEDICAL HISTORY AND THE COPY SAYS SO. This product holds consent
 * records and nothing clinical (CLAUDE.md §8); a list of dates and places, read
 * without that sentence, looks exactly like the beginning of one. The lead is
 * the card's most important line — more so than any row in it.
 */

import type { PortalVisit } from '../api';
import { strings } from '../../../strings';
import { calendarDate } from '../format';
import { Card, CardState, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

export function VisitsCard({ state }: { state: Loadable<readonly PortalVisit[]> }) {
  return (
    <Card id="portal-visits" title={strings.portal.visits.heading} lead={strings.portal.visits.lead}>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.visits.empty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.visits.empty} />
      ) : (
        <ul className={styles.rows}>
          {state.data.map((visit) => (
            <li className={styles.row} key={`${visit.date}-${visit.practiceName}`}>
              <span className={styles.rowMain}>
                <span className={styles.rowValue}>{visit.practiceName}</span>
                <span className={styles.rowMeta}>{visit.locationLine}</span>
              </span>
              <span className={styles.rowMeta}>{calendarDate(visit.date)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

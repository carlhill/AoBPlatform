'use client';

/**
 * MEDICARE CLAIM NOTICES — reg 89AA (REQ-PORT-04, REQ-END-05).
 *
 * THE ONE PLACE IN THIS PRODUCT WHERE AN AMOUNT APPEARS, and it is on its own
 * card for exactly that reason: a benefit amount belongs to the claim
 * notification and to nothing else (hard rule 4, REQ-REG-04). Keeping it here,
 * away from the agreements card, is what stops it drifting onto an agreement
 * artefact one refactor at a time.
 *
 * ONE-WAY, AND THE COPY HAS TO CARRY THAT (hard rule 7, FR-6.3). There is no
 * approve, no decline, no "pending", no "awaiting your response", and nothing
 * on this card is ever chased (REQ-CHASE-02). It says a service WAS billed to
 * Medicare and asks nothing — because non-response never gates payment and a
 * screen that implied otherwise would be inventing an obligation the patient
 * does not have.
 */

import type { PortalNotice } from '../api';
import { strings } from '../../../strings';
import { aud, calendarDate } from '../format';
import { Card, CardState, type Loadable } from '../portal-ui';
import styles from '../portal.module.css';

export function NoticesCard({ state }: { state: Loadable<readonly PortalNotice[]> }) {
  return (
    <Card id="portal-notices" title={strings.portal.notices.heading} lead={strings.portal.notices.lead}>
      {state.status !== 'ready' ? (
        <CardState state={state.status} empty={strings.portal.notices.empty} />
      ) : state.data.length === 0 ? (
        <CardState state="empty" empty={strings.portal.notices.empty} />
      ) : (
        <ul className={styles.rows}>
          {state.data.map((notice) => (
            <li className={styles.row} key={notice.id}>
              <span className={styles.rowMain}>
                <span className={styles.rowValue}>
                  {notice.providerName} — {notice.practiceName}
                </span>
                <span className={styles.rowMeta}>{calendarDate(notice.date)}</span>
              </span>
              <span className={styles.rowValue} data-testid={`notice-amount-${notice.id}`}>
                {aud(notice.benefitAmountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.cardQuiet}>{strings.portal.notices.oneWayNote}</p>
    </Card>
  );
}

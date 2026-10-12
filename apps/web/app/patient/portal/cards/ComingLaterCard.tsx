'use client';

/**
 * COMING LATER — appointments and referrals, named and not built.
 *
 * QUIET, AND LAST. It is on the page because a patient who has just read eight
 * cards about what we hold will reasonably wonder whether the ninth thing they
 * expected is missing or merely absent; saying "not yet" is a shorter answer
 * than letting them look for it.
 *
 * IT PROMISES NOTHING WITH A DATE. Both items are v2/v3 direction (TODO.md
 * "Where this product could go"), recorded as direction and not committed, so
 * the copy names them and stops. A roadmap on a patient-facing page is a
 * promise, and this one is deliberately not making one.
 */

import { strings } from '../../../strings';
import styles from '../portal.module.css';

export function ComingLaterCard() {
  return (
    <section className={styles.quietCard} id="portal-later" aria-labelledby="portal-later-heading">
      <h2 className={styles.cardTitle} id="portal-later-heading">
        {strings.portal.later.heading}
      </h2>
      <p className={styles.cardLead}>{strings.portal.later.lead}</p>
      <ul className={styles.rows}>
        <li className={styles.row}>{strings.portal.later.appointments}</li>
        <li className={styles.row}>{strings.portal.later.referrals}</li>
      </ul>
    </section>
  );
}

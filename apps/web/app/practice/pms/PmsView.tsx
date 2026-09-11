'use client';

/**
 * The PMS connection — deliberately unfinished, and it says so.
 *
 * How results are written back into a practice management system is an OPEN
 * DECISION (D-01). A page that looked complete would be promising something
 * that does not exist, and the practice would find out at the worst moment: the
 * day they expected a consent record to appear in their software and it did
 * not.
 *
 * So this states what the connector does, what it will not do, and what is
 * still undecided. An unfinished page that is honest is worth more than a
 * finished-looking one that is not.
 */

import { Download, Radio, ShieldCheck } from 'lucide-react';
import { Chip, Notice, Shell } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';
import { SessionControl } from '../../SessionControl';

export function PmsView({ pms }: { pms: string }) {
  return (
    <Shell right={<SessionControl audience={strings.pms.audience} />}
      title={strings.pms.title}
      lead={strings.pms.lead}
    >

      <div className={`${styles.card} ${styles.cardNeedsWork}`}>
        <div className={styles.cardHead}>
          <Radio size={18} aria-hidden="true" className={styles.cardIcon} />
          <div className={styles.cardMain}>
            <p className={styles.cardSub}>{strings.pms.systemLabel}</p>
            <p className={styles.cardTitle}>{pms}</p>
            <p className={styles.cardNote}>{strings.pms.stateUnpairedBody}</p>
          </div>
          <div className={styles.cardAside}>
            <Chip tone="warn">{strings.pms.stateUnpaired}</Chip>
          </div>
        </div>
      </div>

      <Notice tone="ok" title={strings.pms.howTitle}>
        {strings.pms.howBody}
      </Notice>

      {/*
        The open decision, named. D-01 is tracked, and a practice reading this
        page should know the difference between "not built yet" and "will never
        work that way".
      */}
      <Notice tone="warn" title={strings.pms.unsettledTitle}>
        {strings.pms.unsettledBody}
      </Notice>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <Download size={18} aria-hidden="true" className={styles.cardIcon} />
          <div className={styles.cardMain}>
            <p className={styles.cardTitle}>{strings.pms.downloadTitle}</p>
            <p className={styles.cardNote}>{strings.pms.downloadBody}</p>
          </div>
          <div className={styles.cardAside}>
            <ShieldCheck size={16} aria-hidden="true" />
          </div>
        </div>
      </div>
    </Shell>
  );
}

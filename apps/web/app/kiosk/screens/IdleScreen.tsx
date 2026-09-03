'use client';

/**
 * K-1 — idle, and the waiting list behind it.
 *
 * WHY THE LIST IS NOT ON THE IDLE SCREEN. The plan's step 1 is "today's list,
 * staff taps the arriving patient" and the handoff's K-1 is a centred
 * invitation with one button. Both are right, and they resolve the same way:
 * the idle state shows the invitation and a COUNT, and the list of names
 * appears only after somebody taps. A tablet sitting on a counter all morning
 * displaying who is in the waiting room is a screen anyone in the room can
 * read — the same exposure the confidentiality flag exists to prevent, made
 * ambient. The count is not identifying; the names are.
 *
 * A FAILED LOAD ENDS AT THE DESK, NOT AT A DEAD END (REQ-REC-04). The error
 * says the appointment is unaffected, offers a retry, and the last good list
 * stays on screen.
 */

import type { ReactNode } from 'react';
import { Blueprint, Screen, Tag } from '../components/Chrome';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import type { KioskWaitingRow } from '../api';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export function IdleScreen({
  practiceName,
  locationLine,
  mode,
  rows,
  error,
  online,
  onStart,
  onBack,
  onPick,
  onRetry,
}: {
  practiceName: string;
  locationLine: string | null;
  mode: 'idle' | 'list';
  rows: readonly KioskWaitingRow[];
  error: string | null;
  online: boolean;
  onStart: () => void;
  onBack: () => void;
  onPick: (row: KioskWaitingRow) => void;
  onRetry: () => void;
}): ReactNode {
  const context = online ? strings.chrome.allSynced : strings.chrome.offline;

  if (mode === 'idle') {
    return (
      <Screen practiceName={practiceName} locationLine={locationLine} context={context}>
        <div className={styles.centred}>
          <h1 className={styles.h1}>{strings.idle.heading}</h1>
          <p className={styles.lede}>{strings.idle.lede}</p>
          <PrimaryButton label={strings.idle.start} onPress={onStart} testId="start-check-in" />
          <p className={styles.muted} data-testid="waiting-count">
            {rows.length > 0 ? strings.idle.waitingCount(rows.length) : strings.idle.nobodyWaiting}
          </p>
          {error ? <p className={styles.error}>{strings.idle.loadFailed}</p> : null}
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.idle.listHeading}
      context={context}
    >
      <div className={styles.listHeader}>
        <h1 className={styles.h2}>{strings.idle.listHeading}</h1>
        <p className={styles.muted}>{strings.idle.listHint}</p>
      </div>
      {error ? (
        <Blueprint className={styles.panel}>
          <p className={styles.body}>{strings.idle.loadFailed}</p>
          <SecondaryButton label={strings.idle.retry} onPress={onRetry} testId="waiting-retry" />
        </Blueprint>
      ) : null}
      <div className={styles.list}>
        {rows.length === 0 ? (
          <p className={styles.muted}>{strings.idle.nobodyWaiting}</p>
        ) : (
          rows.map((row) => (
            <div key={row.captureRequestId} className={styles.rowWrap} data-testid={`waiting-row-${row.captureRequestId}`}>
              <SecondaryButton
                label={row.patientName}
                align="left"
                onPress={() => onPick(row)}
                testId={`pick-${row.captureRequestId}`}
              />
              <div className={styles.rowMeta}>
                <Tag label={row.appointmentTime ?? strings.idle.walkIn} />
                {row.providerName ? <Tag label={row.providerName} /> : null}
              </div>
            </div>
          ))
        )}
      </div>
      <div className={styles.listFooter}>
        <SecondaryButton label={strings.idle.backToIdle} onPress={onBack} testId="back-to-idle" />
      </div>
    </Screen>
  );
}

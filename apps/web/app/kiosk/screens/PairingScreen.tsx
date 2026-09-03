'use client';

/**
 * K-0 — PAIRING. The screen a tablet shows before it is anybody's tablet.
 *
 * WHY IT EXISTS. `/kiosk` is a public URL and its practice scope used to come
 * from a build-time environment variable, so anybody who reached the address
 * saw a practice's waiting list — patient names. Nothing about the ceremony
 * fixed that; a device credential does. This is where the tablet gets one, and
 * it is the only screen in the kiosk that stands between a stranger and a
 * waiting room.
 *
 * IT IS WRITTEN FOR A STAFF MEMBER, and it is the only kiosk screen that is.
 * Nobody hands a patient an unpaired tablet: this is seen once, at a desk, by
 * whoever is setting the device up. So it may say "practice console" and
 * "pairing code" — words the ceremony screens would never use — and it still
 * names no practice, because an unpaired tablet does not know which practice
 * it is and must not guess.
 *
 * THE REFUSAL NEVER EXPLAINS ITSELF. Wrong code, expired code, already-used
 * code and revoked device are one sentence, because telling somebody their
 * code was right but stale is telling them their guess was right. The server
 * takes the same position; this screen shows its own copy either way and never
 * the server's words.
 *
 * BIG KEYS, REAL LABEL, WCAG 2.2 AA. A 72px code field with wide tracking, a
 * visible `<label>` bound by `htmlFor` (a placeholder is not a label), a
 * `GuardedButton` that is genuinely disabled with its reason on it rather than
 * live-and-inert, and an error announced through `role="alert"` rather than by
 * colour alone.
 *
 * ZERO FOOTPRINT HOLDS HERE TOO. This component writes nothing: the credential
 * it earns is handed up to the ceremony, which passes it to `pairing.ts` — the
 * one module in the kiosk permitted to persist anything, and the only key in
 * `PERSISTABLE_KEYS`.
 */

import type { ReactNode } from 'react';
import { isPairingCodeShape } from '@aobplatform/domain';
import { Blueprint, Kicker, Screen } from '../components/Chrome';
import { GuardedButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

/** What happened to the last attempt. One sentence each; neither names a practice. */
export type PairingFailure = 'refused' | 'unreachable';

export interface PairedOutcome {
  readonly practiceName: string;
  /**
   * Whether the browser actually kept the credential. False in a private
   * window or a locked-down profile: the tablet works for the life of the tab
   * and needs pairing again after a restart, which is worth saying at the desk
   * rather than discovering on a Monday morning.
   */
  readonly remembered: boolean;
}

export function PairingScreen({
  code,
  busy,
  failure,
  paired,
  onChangeCode,
  onPair,
  onContinue,
}: {
  code: string;
  busy: boolean;
  failure: PairingFailure | null;
  /** Set once the exchange succeeded. The screen becomes a confirmation. */
  paired: PairedOutcome | null;
  onChangeCode: (next: string) => void;
  onPair: () => void;
  onContinue: () => void;
}): ReactNode {
  if (paired) {
    return (
      <Screen practiceName={strings.appName}>
        <div className={styles.centred}>
          <Blueprint className={styles.panel} accented>
            <h1 className={styles.h2} data-testid="pairing-paired">
              {strings.pairing.paired(paired.practiceName)}
            </h1>
            <p className={styles.body}>{strings.pairing.pairedBody}</p>
            {/*
              THE BROWSER REFUSED TO REMEMBER IT. Not an error — the tablet
              works — but the person standing here is the one who can put the
              browser out of private mode, and they will not be here tomorrow.
            */}
            {!paired.remembered ? (
              <p className={styles.error} role="alert" data-testid="pairing-not-remembered">
                {strings.pairing.notRemembered}
              </p>
            ) : null}
          </Blueprint>
          <PrimaryButton
            label={strings.pairing.continueAction}
            onPress={onContinue}
            testId="pairing-continue"
          />
        </div>
      </Screen>
    );
  }

  /*
   * DISABLED UNTIL THE CODE IS THE RIGHT SHAPE, with the reason on the button
   * (CLAUDE.md §6 — blocked states are unreachable, not merely inert). The
   * shape test is the domain's own `isPairingCodeShape`, so the screen and the
   * server agree about what eight characters means without the alphabet being
   * written down here.
   */
  const ready = isPairingCodeShape(code) && !busy;

  return (
    <Screen practiceName={strings.appName}>
      <div className={styles.centred}>
        <Kicker label={strings.pairing.codeLabel} />
        <h1 className={styles.h1Small}>{strings.pairing.heading}</h1>
        <p className={styles.lede}>{strings.pairing.lede}</p>

        <Blueprint className={styles.panel}>
          <Field
            label={strings.pairing.codeLabel}
            hint={strings.pairing.codeHint}
            placeholder=""
            value={code}
            onChangeText={onChangeCode}
            className={styles.pairingCode}
            autoFocus
            testId="pairing-code"
          />
        </Blueprint>

        {failure ? (
          <p className={styles.error} role="alert" data-testid="pairing-error">
            {failure === 'refused' ? strings.pairing.refused : strings.pairing.unreachable}
          </p>
        ) : null}

        <GuardedButton
          label={busy ? strings.pairing.pairing : strings.pairing.pairAction}
          state={ready ? { disabled: false } : { disabled: true, disabledLabel: strings.pairing.pairBlocked }}
          onPress={onPair}
          testId="pairing-submit"
        />
      </div>
    </Screen>
  );
}

'use client';

/**
 * The three buttons the ceremony uses, and one of them is load-bearing.
 *
 * `GuardedButton` IS THE DISABLED-WITH-A-REASON PRIMITIVE (CLAUDE.md §6 —
 * blocked states are unreachable, not merely inert). Its blocked branch
 * renders a real `button[disabled]` with NO `onClick` at all, so there is
 * genuinely nothing to press: a control that looks live and quietly does
 * nothing teaches people the tablet is broken, and a control that is disabled
 * without saying why sends the patient to a staff member who also cannot see
 * why. The label carries the count; the list beneath carries each reason.
 *
 * The `state` prop is a discriminated union rather than a `disabled` boolean
 * with an optional label, because the two states genuinely carry different
 * data and a boolean lets a caller produce a blocked button with no reason.
 */

import type { ReactNode } from 'react';
import styles from '../kiosk.module.css';

export function PrimaryButton({
  label,
  onPress,
  size = 'large',
  testId,
}: {
  label: string;
  onPress: () => void;
  size?: 'large' | 'standard';
  testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      className={`${styles.button} ${styles.buttonPrimary} ${size === 'standard' ? styles.buttonStandard : ''}`}
      onClick={onPress}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

export function SecondaryButton({
  label,
  onPress,
  align = 'centre',
  selected,
  testId,
}: {
  label: string;
  onPress: () => void;
  align?: 'centre' | 'left';
  /**
   * THE CHOICE MUST BE UNMISTAKABLE (Carl, 3 Sep 2026 live test). Tapping "I am
   * signing for myself" used to change nothing about how either button looked —
   * the tap registered, and there was no way to tell. Selection is shown by
   * fill AND announced through `aria-pressed`, never by colour alone.
   */
  selected?: boolean;
  testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      className={[
        styles.button,
        styles.buttonSecondary,
        align === 'left' ? styles.buttonLeft : '',
        selected ? styles.buttonSelected : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-pressed={selected === undefined ? undefined : selected}
      onClick={onPress}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

export type GuardedState =
  | { readonly disabled: false }
  | { readonly disabled: true; readonly disabledLabel: string; readonly reasons?: readonly string[] };

export function GuardedButton({
  label,
  state,
  onPress,
  testId,
}: {
  /** The ENABLED label. The blocked branch never renders it. */
  label: string;
  state: GuardedState;
  onPress: () => void;
  testId?: string;
}): ReactNode {
  if (state.disabled) {
    return (
      <span className={styles.guarded}>
        {/*
          A REAL `disabled` BUTTON WITH NO HANDLER. Not `aria-disabled` on a
          live control, and not a div: the browser refuses the click, the
          accessibility tree says so, and there is no `onClick` on the element
          for a test — or a mis-fired tap — to reach.
        */}
        <button
          type="button"
          className={`${styles.button} ${styles.buttonBlocked}`}
          disabled
          aria-label={state.disabledLabel}
          data-testid={testId}
        >
          {state.disabledLabel}
        </button>
        {state.reasons && state.reasons.length > 0 ? (
          <ul className={styles.reasons}>
            {state.reasons.map((reason, index) => (
              <li key={reason} className={styles.reasonRow}>
                <span className={styles.reasonOrdinal} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span data-testid={`${testId}-reason-${index}`}>{reason}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.button} ${styles.buttonPrimary}`}
      aria-label={label}
      onClick={onPress}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

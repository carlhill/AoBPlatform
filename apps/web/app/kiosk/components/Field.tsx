'use client';

/**
 * The kiosk's form controls. Three rules hold across all of them.
 *
 * EVERY CONTROL HAS A REAL, VISIBLE `<label>` bound by `htmlFor` (WCAG 2.2 AA).
 * A placeholder is not a label: it disappears the moment somebody types, which
 * is exactly when an unwell person at a tablet most needs to know what the box
 * was for.
 *
 * THE PICKERS ARE NATIVE `<select>`s, deliberately. Radix's Select is for what
 * a native one cannot do — rich options, grouping — and for a day, a month and
 * a year the native control wins on every axis that matters here: keyboard,
 * screen reader, touch, and the OS's own big scrolling wheel on a tablet. Same
 * reasoning as `SelectInput` in `app/ui`.
 *
 * NOTHING PERSISTS. These are controlled inputs over component state that the
 * ceremony drops on reset; no value is written to storage, a cache or a log
 * (REQ-VER-04, and the zero-footprint rule in CLAUDE.md §7). Autofill is turned
 * off for the same reason — the browser must not be the thing that remembers
 * the last patient.
 */

import { useId, type ReactNode } from 'react';
import styles from '../kiosk.module.css';

export interface Option {
  readonly value: string;
  readonly label: string;
}

export function Field({
  label,
  hint,
  placeholder,
  value,
  onChangeText,
  className,
  autoFocus,
  inputMode,
  testId,
}: {
  label: string;
  hint?: string;
  /**
   * Shown inside the box. Defaults to `hint`, which is right for a short one
   * ("Street, suburb and postcode") and wrong for a long one — a sentence of
   * guidance belongs under the field, where it survives the first keystroke.
   */
  placeholder?: string;
  value: string;
  onChangeText: (next: string) => void;
  className?: string;
  autoFocus?: boolean;
  inputMode?: 'text' | 'tel' | 'email';
  testId?: string;
}): ReactNode {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`${styles.field} ${className ?? ''}`}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type={inputMode === 'email' ? 'email' : inputMode === 'tel' ? 'tel' : 'text'}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder ?? hint}
        aria-label={label}
        aria-describedby={hintId}
        // The browser is not allowed to remember the last patient.
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(event) => onChangeText(event.target.value)}
        data-testid={testId}
      />
      {hint ? (
        <p className={styles.fieldHint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  value,
  options,
  placeholder,
  onValueChange,
  className,
  testId,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  /** The empty option, so nothing is pre-chosen on the patient's behalf. */
  placeholder: string;
  onValueChange: (next: string) => void;
  className?: string;
  testId?: string;
}): ReactNode {
  const id = useId();
  return (
    <div className={`${styles.field} ${className ?? ''}`}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value}
        aria-label={label}
        onChange={(event) => onValueChange(event.target.value)}
        data-testid={testId}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onToggle,
  testId,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  testId?: string;
}): ReactNode {
  const id = useId();
  return (
    <div className={styles.checkboxRow}>
      <input
        id={id}
        className={styles.checkbox}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={onToggle}
        data-testid={testId}
      />
      <label className={styles.checkboxLabel} htmlFor={id}>
        {label}
      </label>
    </div>
  );
}

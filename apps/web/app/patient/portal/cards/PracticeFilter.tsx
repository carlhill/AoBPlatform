'use client';

/**
 * SHOWING: ALL PRACTICES, OR ONE OF THEM (Carl, 5 Sep 2026).
 *
 * WHY IT EXISTS. This page is one column of nine cards, each of which lists
 * rows from every practice the account is linked to. For somebody linked to
 * one practice that is the whole page; for somebody linked to three it is three
 * interleaved records, and the question a patient actually arrives with is
 * almost always about ONE of them — "what does Harbourview hold", "did that
 * text come from Wattle Street". The filter answers that question without
 * making them read past the other two.
 *
 * IT DOES NOT RENDER FOR ONE PRACTICE. A control with a single meaningful
 * choice is a control that has to be understood before it can be ignored, and
 * most accounts are linked to one practice. `portal_filter_hidden_for_a_single_practice`
 * holds that.
 *
 * BUTTONS, NOT A `select`. Every option is visible at once, each is its own
 * 44px target (WCAG 2.2 AA, CLAUDE.md §6), and the pressed state is carried by
 * `aria-pressed` rather than by colour alone. They sit in a `role="group"`
 * named by the visible "Showing" label, so a screen reader hears the label
 * once and then each option with its state — which is what a segmented control
 * is, and what a hand-rolled radio group usually gets wrong.
 *
 * NOTHING IS PERSISTED. The choice is component state in `PortalView` and dies
 * with the tab: no storage API is touched here, on a page that touches none.
 */

import type { PortalLink } from '../api';
import { strings } from '../../../strings';
import styles from '../portal.module.css';

const LABEL_ID = 'portal-practice-filter-label';

export function PracticeFilter({
  links,
  selected,
  onSelect,
}: {
  readonly links: readonly PortalLink[];
  /** A practice id, or `null` for all of them. */
  readonly selected: string | null;
  readonly onSelect: (practiceId: string | null) => void;
}) {
  // ONE PRACTICE (or none): there is nothing to choose between.
  if (links.length < 2) return null;

  return (
    <div className={styles.filter} data-testid="portal-practice-filter">
      <span className={styles.filterLabel} id={LABEL_ID}>
        {strings.portal.filter.label}
      </span>
      <div className={styles.filterOptions} role="group" aria-labelledby={LABEL_ID}>
        <FilterOption
          label={strings.portal.filter.all}
          pressed={selected === null}
          onSelect={() => onSelect(null)}
        />
        {links.map((link) => (
          <FilterOption
            key={link.practiceId}
            label={link.practiceName}
            pressed={selected === link.practiceId}
            onSelect={() => onSelect(link.practiceId)}
          />
        ))}
      </div>
    </div>
  );
}

function FilterOption({
  label,
  pressed,
  onSelect,
}: {
  readonly label: string;
  readonly pressed: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.filterOption} ${pressed ? styles.filterOptionOn : ''}`}
      aria-pressed={pressed}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

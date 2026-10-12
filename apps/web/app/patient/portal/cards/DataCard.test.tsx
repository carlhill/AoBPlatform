/**
 * WHAT HAPPENS TO MY DATA — the card that answers Carl's question directly
 * (4 Sep 2026), and the access timeline that makes the answer checkable.
 *
 * `portal_data_retention_is_not_invented` is the important one. The retention
 * period is a regulatory fact and CLAUDE.md §7 forbids inferring one, so this
 * test held a VISIBLE placeholder in place until somebody had read the source.
 * Carl wrote the sentence on 4 September 2026 from REQ-REG-09
 * (aob-requirements.md line 110): two years from the date of the RELATED CLAIM,
 * not the service date. The test now pins that sentence word for word and
 * refuses the placeholder — the same job in the other direction. If the period
 * or the anchor ever changes, this test is what makes the copy change with it
 * rather than drift.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataCard } from './DataCard';
import type { PortalAccessEntry } from '../api';

const log: readonly PortalAccessEntry[] = [
  { at: '2026-09-03T22:06:00.000Z', actorType: 'system', practiceName: 'Wattle Street Medical', actionKey: 'message_sent' },
  { at: '2026-08-18T04:12:00.000Z', actorType: 'practice_staff', practiceName: 'Harbourview Family Practice', actionKey: 'details_corrected' },
  { at: '2026-08-01T00:00:00.000Z', actorType: 'system', practiceName: 'Wattle Street Medical', actionKey: 'retention_clock_started' },
];

const ready = (data: readonly PortalAccessEntry[]) => ({ status: 'ready', data }) as const;

/** The sentence, exactly as Carl wrote it. One copy, compared not paraphrased. */
const RETENTION_SENTENCE =
  'We keep the record of each bulk-billing agreement for two years from the date of the related Medicare claim, ' +
  'as the law requires. After that it is destroyed or de-identified.';

describe('portal_data_retention_is_not_invented', () => {
  it('states the sourced period, and the placeholder is gone', () => {
    render(<DataCard state={ready(log)} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain(RETENTION_SENTENCE);
    expect(text).not.toContain('[retention period — from requirements]');
  });

  it('anchors the clock to the claim rather than to the service date', () => {
    render(<DataCard state={ready(log)} />);
    const text = document.body.textContent ?? '';

    // REQ-REG-09 is explicit that it runs from the related CLAIM. A sentence
    // that said "from your appointment" would be plausible, wrong, and the
    // exact failure the placeholder existed to prevent.
    expect(text).toContain('from the date of the related Medicare claim');
    expect(text).not.toMatch(/from the (date of the )?(service|appointment|visit)/i);
  });

  it('says what is held, why, who sees it, and what the patient can do', () => {
    render(<DataCard state={ready(log)} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('We hold nothing about your health');
    expect(text).toContain('never sell it');
    expect(text).toContain('sees its own record of you and nothing from any other practice');
    expect(text).toContain('you can end an ongoing agreement from this page at any time');
  });
});

describe('who has looked', () => {
  it('names when, who, which practice and what', () => {
    render(<DataCard state={ready(log)} />);
    const text = document.body.textContent ?? '';

    expect(text).toContain('Practice staff');
    expect(text).toContain('AoBPlatform');
    expect(text).toContain('Corrected one of your details');
    expect(text).toContain('Sent you a message');
    expect(text).toContain('Harbourview Family Practice');
  });

  it('shows an action nobody has written copy for as its own code, not as a blank', () => {
    render(<DataCard state={ready(log)} />);
    const code = screen.getByText('retention_clock_started');
    expect(code.tagName).toBe('CODE');
  });

  it('says so when it is loading, when it failed, and when nothing has happened', () => {
    const loading = render(<DataCard state={{ status: 'loading' }} />);
    expect(loading.container.textContent).toContain('Loading');
    loading.unmount();

    const failed = render(<DataCard state={{ status: 'error' }} />);
    expect(failed.container.querySelector('[role="alert"]')).toBeTruthy();
    // The prose still renders — a failed timeline does not take the collection
    // notice down with it.
    expect(failed.container.textContent).toContain(RETENTION_SENTENCE);
    failed.unmount();

    const empty = render(<DataCard state={ready([])} />);
    expect(empty.container.textContent).toContain('Nothing has happened to your record yet');
  });
});

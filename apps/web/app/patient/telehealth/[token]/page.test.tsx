/**
 * The telehealth page's own head: what a link preview shows before anybody
 * opens it. It must stay about the consultation only until G10 is answered
 * (TELEHEALTH-PLAN.md §9), and not inherit the root layout's description,
 * which names Medicare Assignment of Benefit.
 */
import { describe, expect, it } from 'vitest';
import { TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN } from '@aobplatform/domain';
import { metadata } from './page';

describe('the telehealth page head', () => {
  it('telehealth_page_metadata_never_mentions_bulk_billing', () => {
    expect(typeof metadata.title).toBe('string');
    expect(typeof metadata.description).toBe('string');
    expect(String(metadata.description).length).toBeGreaterThan(0);
    expect(String(metadata.title)).not.toMatch(TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN);
    expect(String(metadata.description)).not.toMatch(TELEHEALTH_NEUTRAL_WORDING_FORBIDDEN);
  });
});

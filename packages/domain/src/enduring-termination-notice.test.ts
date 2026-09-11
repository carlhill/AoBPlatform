/**
 * THE TERMINATION NOTICE IS A DRAFT, AND THESE TESTS ARE WHAT MAKE THAT SAFE.
 *
 * Carl asked on 4 September 2026 for placeholder wording ("make something up
 * for now and add it to TODO") rather than another empty file, because an empty
 * notice tells a reviewer nothing about whether the SHAPE is right. That is a
 * reasonable request and it creates one specific risk: draft prose that nobody
 * reads carefully can carry a hard-rule breach into a document with statutory
 * exposure. So the draft is written, and every hard rule it could break is
 * asserted here rather than trusted to a reading.
 *
 * WHAT THE TESTS DO NOT DO is bless the wording. `draft` is still true, the DB
 * CHECK on `portal_termination_notices` still admits only
 * `draft_pending_review`, and the review task raised beside every termination
 * is still the thing that stops a notice going out. A green run here means
 * "this draft breaks no rule we can test for", not "this is the notice".
 */
import {
  ENDURING_TERMINATION_NOTICE,
  ENDURING_TERMINATION_NOTICE_IS_DRAFT,
  ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY,
  ENDURING_TERMINATION_NOTICE_VERSION,
  parseEnduringTerminationNotice,
} from './enduring-termination-notice';

/** Every word of the notice, in document order. The bodies only — notes are for reviewers. */
const bodies = ENDURING_TERMINATION_NOTICE.sections.map((s) => s.body);
const prose = bodies.join('\n');

describe('the termination notice is versioned content that loads', () => {
  it('carries a template key and a version that will travel with every notice', () => {
    expect(ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY).toBe('enduring_termination_notice_v1');
    expect(ENDURING_TERMINATION_NOTICE_VERSION).toMatch(/^enduring-termination-notice-/);
    expect(ENDURING_TERMINATION_NOTICE.sections.length).toBeGreaterThan(0);
  });

  it('termination_notice_stays_a_draft_until_a_human_reviews_it', () => {
    // The one assertion a future edit must think about. Flipping `draft` is the
    // same act as writing the copy and widening the DB CHECK; a change here
    // without those is a notice that looks reviewed and is not.
    expect(ENDURING_TERMINATION_NOTICE_IS_DRAFT).toBe(true);
    expect(bodies[0]).toContain('DRAFT — pending review');
  });

  it('every placeholder used in the prose is declared', () => {
    const used = new Set(Array.from(prose.matchAll(/\{\{(\w+)\}\}/g), (m) => m[1]));
    for (const key of used) {
      expect(ENDURING_TERMINATION_NOTICE.placeholders).toContain(key);
    }
    // And the file holds KEYS, never values. Every date in the finished notice
    // arrives through a placeholder, so no date-shaped string may be typed into
    // a body — a hardcoded one would print the same day on every notice ever
    // sent and nobody would notice until a patient quoted it back.
    expect(prose).not.toMatch(/\d{4}-\d{2}-\d{2}|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
  });
});

describe('the draft breaks no hard rule', () => {
  it('termination_notice_carries_no_benefit_amount', () => {
    // Hard rule 4 — no benefit or dollar amount on any agreement artefact. Reg
    // 89AA notices are the one place an amount belongs, and this is not one.
    expect(prose).not.toMatch(/\$|\bcents?\b|\bdollars?\b|\bbenefit amount\b|\brebate\b|\bfee\b/i);
  });

  it('termination_notice_never_claims_approval', () => {
    // Hard rule 12, REQ-65C-05.
    expect(prose).not.toMatch(/certified|accredited|government-approved/i);
    // "approved" is banned as a claim about our forms; the draft uses none.
    expect(prose).not.toMatch(/\bapproved\b/i);
  });

  it('termination_notice_has_no_practitioner_signature_field', () => {
    // Hard rule 3 — abolished 1 July 2026, and blocked defensively everywhere.
    expect(prose).not.toMatch(/signature|signed by|sign here|signatory/i);
  });

  it('termination_notice_never_says_care_stops', () => {
    // Hard rule 8, REQ-REC-04. The draft says the opposite in as many words.
    expect(prose).toMatch(/Nothing about your care changes/);
  });

  it('cites only the section the requirements gave us', () => {
    // REQ-PORT-05 names 65CA(7)(b). CLAUDE.md §7 forbids inferring any other
    // section number from training data, so exactly one citation may appear —
    // and this test is what stops a well-meaning edit adding "see also s 65D".
    const cited = Array.from(prose.matchAll(/\b\d{2,3}[A-Z]{1,3}\b|\bsections?\s+\d+/gi), (m) => m[0]);
    expect(new Set(cited)).toEqual(new Set(['65CA']));
    expect(prose).toContain('65CA(7)(b)');
  });

  it('uses AU terminology — provider and service, never GP or consult', () => {
    expect(prose).not.toMatch(/\bGP\b|\bconsults?\b|\bconsultations?\b/);
  });
});

describe('the loader still refuses a file that lies about being written', () => {
  it('a file marked ready with nothing in it is rejected', () => {
    expect(() =>
      parseEnduringTerminationNotice({
        templateKey: 'x_notice',
        version: 'v1',
        draft: false,
        placeholders: [],
        sections: [{ key: 'heading', body: '   ', note: 'a reviewer writes this' }],
      }),
    ).toThrow(/every section body is empty/);
  });
});

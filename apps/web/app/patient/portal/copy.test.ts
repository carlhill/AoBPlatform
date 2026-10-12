/**
 * THE WORDS THIS PRODUCT MAY NOT SAY, checked across the whole `portal`
 * namespace rather than one screen at a time.
 *
 * `portal_copy_never_claims_approval` is hard rule 12 (REQ-65C-05,
 * REQ-TEST-08). We are not certified, approved or accredited by anybody, our
 * forms are not government-approved, and saying so on a patient-facing page
 * would be a false claim to a person with no way to check it. "Checked against
 * the s 65C data set" and "self-assessment" are the permitted phrasings, and
 * the agreements card uses the first of them.
 *
 * IT WALKS THE NAMESPACE, INCLUDING THE FUNCTIONS. Half the copy on this
 * surface is composed — `coverage(providerName)`, `signedOn(when)` — so a scan
 * of the literal strings alone would miss exactly the sentences most likely to
 * be rewritten later.
 *
 * The second test is the same discipline for terminology (CLAUDE.md §3):
 * "provider" not "GP", "service" not "consult".
 */
import { describe, expect, it } from 'vitest';
import { strings } from '../../strings';

/** Every sentence in the namespace, functions called with a plausible argument. */
function everySentence(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
  } else if (typeof node === 'function') {
    try {
      // One and two-argument composers both take display strings here.
      out.push(String((node as (...args: unknown[]) => unknown)('Example', 'Example Practice')));
    } catch {
      // A composer that needs something else is not copy this test can read;
      // it is also not copy anybody reads without a screen around it.
    }
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) everySentence(value, out);
  }
  return out;
}

const sentences = everySentence(strings.portal);

describe('portal_copy_never_claims_approval', () => {
  it('has copy to check at all', () => {
    // Guards against the walk silently returning nothing and passing.
    expect(sentences.length).toBeGreaterThan(80);
  });

  it.each(['certified', 'certify', 'approved', 'approval', 'accredited', 'accreditation', 'government-approved'])(
    'never says "%s"',
    (word) => {
      const offenders = sentences.filter((s) => s.toLowerCase().includes(word));
      expect(offenders).toEqual([]);
    },
  );

  it('uses the permitted phrasing where it describes what we do', () => {
    expect(sentences.some((s) => s.includes('checked against the s 65C data set'))).toBe(true);
  });
});

describe('portal_copy_uses_the_domain_terminology', () => {
  it.each(['consult', ' GP', 'GP ', 'doctor'])('never says "%s"', (word) => {
    const offenders = sentences.filter((s) => s.includes(word));
    expect(offenders).toEqual([]);
  });

  it('says "provider"', () => {
    expect(sentences.some((s) => s.toLowerCase().includes('provider'))).toBe(true);
  });

  it('uses UK/AU spelling, not US', () => {
    for (const wrong of ['authorize', 'authorized', 'organize', 'recognize', 'canceled', 'center']) {
      expect(sentences.filter((s) => s.toLowerCase().includes(wrong))).toEqual([]);
    }
  });
});

describe('portal_copy_carries_no_amount_outside_the_89aa_card', () => {
  it('names money nowhere but the notices namespace', () => {
    const { notices, ...everythingElse } = strings.portal;
    const others = everySentence(everythingElse);
    for (const s of others) {
      expect(s).not.toMatch(/\$|\bdollar|\bamount\b|\bfee\b|\brebate\b/i);
    }
    // And the notices card itself never asks for anything (hard rule 7).
    const noticeCopy = everySentence(notices).join(' ').toLowerCase();
    for (const word of ['approve', 'decline', 'accept', 'reject', 'pending', 'chase']) {
      expect(noticeCopy).not.toContain(word);
    }
  });
});

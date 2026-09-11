import {
  containsIdentifier,
  duplicateWarning,
  identifierWarning,
} from './evidence';

describe('duplicateWarning', () => {
  it('says nothing when the file is new', () => {
    expect(duplicateWarning(null)).toBeNull();
    expect(duplicateWarning({ sha256: 'a', filename: 'x.pdf', alreadyCitedFor: [] })).toBeNull();
  });

  it('names the check the identical file is already cited for', () => {
    const w = duplicateWarning({ sha256: 'a', filename: 'x.pdf', alreadyCitedFor: ['Called the practice'] });
    expect(w?.kind).toBe('duplicate');
    expect(w?.message).toContain('Called the practice');
  });

  it('reads properly with several', () => {
    const w = duplicateWarning({
      sha256: 'a',
      filename: 'x.pdf',
      alreadyCitedFor: ['Called the practice', 'ABN is ACTIVE', 'Address confirmed'],
    });
    expect(w?.message).toContain('“Called the practice”, “ABN is ACTIVE” and “Address confirmed”');
  });

  // The position, stated as a test so it cannot be quietly changed: this warns.
  it('does not claim the reuse is wrong — one certificate can evidence two things', () => {
    const w = duplicateWarning({ sha256: 'a', filename: 'x.pdf', alreadyCitedFor: ['A check'] });
    expect(w?.message).toMatch(/sometimes legitimate/i);
  });
});

describe('containsIdentifier', () => {
  // An ABN is printed with spaces on the register and without them everywhere
  // else, so a raw string compare finds nothing and reports a false absence.
  it('matches regardless of how the number is spaced', () => {
    expect(containsIdentifier('ABN 27 734 610 304 is active', '27734610304')).toBe(true);
    expect(containsIdentifier('ABN 27734610304 is active', '27 734 610 304')).toBe(true);
  });

  it('matches across a non-breaking space, as PDFs produce', () => {
    expect(containsIdentifier('ABN 27 734 610 304', '27734610304')).toBe(true);
  });

  it('does not match a different number', () => {
    expect(containsIdentifier('ABN 51 824 753 556', '27734610304')).toBe(false);
  });

  it('refuses to match on something too short to be meaningful', () => {
    expect(containsIdentifier('anything at all 12345', '12345')).toBe(false);
  });

  it('finds it even when digits run into surrounding text', () => {
    expect(containsIdentifier('Reference:27734610304/A', '27734610304')).toBe(true);
  });
});

describe('identifierWarning', () => {
  const base = { identifier: '27734610304', identifierLabel: 'ABN', filename: 'lookup.pdf' };

  it('says nothing when the number is in the file', () => {
    expect(identifierWarning({ ...base, extracted: 'ABN 27 734 610 304 ACTIVE' })).toBeNull();
  });

  it('warns when the number is absent, and says what that means', () => {
    const w = identifierWarning({ ...base, extracted: 'Some entirely different document' });
    expect(w?.kind).toBe('identifier_absent');
    expect(w?.message).toContain('27734610304');
    expect(w?.message).toMatch(/wrong file/i);
  });

  // "We could not check" and "we checked and it was fine" must never look the
  // same — that is the whole reason unreadable is its own outcome.
  it('distinguishes UNREADABLE from absent', () => {
    const w = identifierWarning({ ...base, extracted: null });
    expect(w?.kind).toBe('unreadable');
    expect(w?.message).toMatch(/could not read/i);
  });

  it('names the file so the warning is about something specific', () => {
    expect(identifierWarning({ ...base, extracted: 'nothing' })?.message).toContain('lookup.pdf');
  });

  it('copes with no filename', () => {
    const w = identifierWarning({ ...base, filename: null, extracted: 'nothing' });
    expect(w?.message).toContain('that file');
  });
});

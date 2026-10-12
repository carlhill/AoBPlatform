import { principalDisplayName } from './token-verifier';

/**
 * `??` only falls through on `null`/`undefined`, never on `''`. This is the
 * whole bug: `principal.preferredUsername ?? principal.sub`, written twice
 * across the codebase, looked like a fallback and was not one for a blank
 * claim -- it surfaced as "A change to an approved practice must name the
 * person making it" on a fully signed-in session, because an empty
 * `preferredUsername` satisfied `??` and the real fallback never ran.
 */
describe('principalDisplayName', () => {
  it('uses the preferred username when it is a real one', () => {
    expect(principalDisplayName({ sub: 'abc-123', preferredUsername: 'carl@hillsempire.com' })).toBe(
      'carl@hillsempire.com',
    );
  });

  it('FALLS BACK ON AN EMPTY STRING, which `??` alone would not catch', () => {
    expect(principalDisplayName({ sub: 'abc-123', preferredUsername: '' })).toBe('abc-123');
  });

  it('falls back on whitespace-only', () => {
    expect(principalDisplayName({ sub: 'abc-123', preferredUsername: '   ' })).toBe('abc-123');
  });

  it('falls back when the claim is absent entirely', () => {
    expect(principalDisplayName({ sub: 'abc-123', preferredUsername: undefined })).toBe('abc-123');
  });

  it('never returns an empty string given a real subject', () => {
    for (const preferredUsername of [undefined, '', '   ', 'real-name']) {
      expect(principalDisplayName({ sub: 'abc-123', preferredUsername }).length).toBeGreaterThan(0);
    }
  });
});

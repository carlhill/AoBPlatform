/**
 * THE MARKER AN INVITATION CARRIES HOME (Carl, 12 Sep 2026).
 *
 * Two packages have to agree on this string and a mismatch fails SILENTLY —
 * the email still sends, the passkey still registers, and the person is still
 * told they are not signed in. So the spelling is asserted here rather than
 * trusted.
 */
import { describe, expect, it } from 'vitest';
import {
  SILENT_RESTORE_PARAM,
  isSilentRestoreClient,
  withSilentRestore,
} from './auth';

describe('the silent-restore marker', () => {
  it('is spelled the one way both packages expect', () => {
    expect(SILENT_RESTORE_PARAM).toBe('aob_restore');
  });

  it('names the client on the URL the invitation returns to', () => {
    const url = new URL(withSilentRestore('http://localhost:3100/practice', 'web'));
    expect(url.searchParams.get(SILENT_RESTORE_PARAM)).toBe('web');
    expect(url.pathname).toBe('/practice');
  });

  it('keeps whatever the destination already carried', () => {
    const url = new URL(withSilentRestore('http://localhost:3100/practice?tab=queue', 'console'));
    expect(url.searchParams.get('tab')).toBe('queue');
    expect(url.searchParams.get(SILENT_RESTORE_PARAM)).toBe('console');
  });

  it('applied twice is the same as applied once', () => {
    const once = withSilentRestore('http://localhost:3100/practice', 'web');
    expect(withSilentRestore(once, 'web')).toBe(once);
  });

  /**
   * A CLIENT THAT IS NOT ONE OF OURS IS NOT WRITTEN. The practice console and
   * the platform console are separate Keycloak clients on purpose, and this is
   * the one place a third name could be introduced by accident.
   */
  it('writes nothing for a client that does not exist', () => {
    expect(withSilentRestore('http://localhost:3100/practice', 'wordpress')).toBe(
      'http://localhost:3100/practice',
    );
    expect(isSilentRestoreClient('wordpress')).toBe(false);
    expect(isSilentRestoreClient('web')).toBe(true);
    expect(isSilentRestoreClient(undefined)).toBe(false);
  });

  /**
   * AN UNPARSEABLE DESTINATION IS RETURNED UNTOUCHED RATHER THAN THROWN OVER.
   * A throw here would stop the invitation being sent at all, and an invitation
   * that arrives is worth more than a marker that saves one button press.
   */
  it('never stops an invitation over a URL it cannot parse', () => {
    expect(withSilentRestore('not a url', 'web')).toBe('not a url');
    expect(withSilentRestore('', 'web')).toBe('');
  });
});

/**
 * ZERO FOOTPRINT ON THE TABLET — Carl, 3 Sep 2026, recorded in CLAUDE.md §7:
 * "As we could have 1000's of kiosks/tablets, ensure that nothing gets written
 * to the kiosk/tablet ... We do not want the scenario where a bug is released
 * and all kiosks are not working and the only way to fix it is to go to each
 * device — this will break the bank."
 *
 * THIS IS THE RUNTIME HALF; THE LINT RULE IS THE OTHER. The root ESLint config
 * refuses the NAMES anywhere under `app/kiosk/**`, which catches the ordinary
 * way this gets broken — somebody adds one line. This catches the way a lint
 * rule cannot: a call reached through an alias, a dependency, or anything else
 * that ends up writing during a real render. It stubs every storage surface
 * with a spy and drives the ceremony's screens.
 *
 * THE NAME IS `kiosk_persists_nothing_but_pairing` and it comes from the TODO
 * that asked for it. There is no pairing credential yet, so the exception it
 * names is empty: `PERSISTABLE_KEYS` is `[]` and the assertion is that
 * NOTHING is written. When pairing lands, that constant gains one key and this
 * test gains one permitted write — a narrow relaxation with a name, rather
 * than a deleted test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { IdleScreen } from './screens/IdleScreen';
import { VerifyScreen } from './screens/VerifyScreen';
import { AssignorScreen } from './screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { SignatureScreen } from './screens/SignatureScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import { identifierFieldsFor } from './rules/identifiers';
import { firstAttempt } from './rules/verification';
import { EMPTY_CHOICE } from './rules/assignor';
import { getSession, PERSISTABLE_KEYS, setSession } from './session';
import type { SignatureValidation } from './rules/signature-gate';

const noop = () => undefined;
const CHROME = { practiceName: 'Sample Practice', locationLine: 'NSW' };
const VALID: SignatureValidation = {
  state: 'valid',
  artefactHash: 'b'.repeat(64),
  ruleSetVersion: 'draft-2026-08',
};
const VIEW: ParticularsView = {
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Sample Provider',
  providerAddress: '2 Example Street, Sampletown NSW 2000',
  serviceDate: '2026-09-03',
  agreementDate: '2026-09-03',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  ruleSetVersion: 'draft-2026-08',
  mappingVersion: 'dev-mapping-1',
  artefactHash: 'b'.repeat(64),
};

const writes: string[] = [];

function spyStorage(name: string) {
  return {
    setItem: (key: string) => writes.push(`${name}.setItem:${key}`),
    getItem: () => null,
    removeItem: (key: string) => writes.push(`${name}.removeItem:${key}`),
    clear: () => writes.push(`${name}.clear`),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe('CLAUDE.md §7 — nothing is written to the device', () => {
  let cookieWrites = 0;

  beforeEach(() => {
    writes.length = 0;
    cookieWrites = 0;
    vi.stubGlobal('localStorage', spyStorage('localStorage'));
    vi.stubGlobal('sessionStorage', spyStorage('sessionStorage'));
    vi.stubGlobal('indexedDB', {
      open: () => {
        writes.push('indexedDB.open');
        return {};
      },
    });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => {
        cookieWrites += 1;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('kiosk_persists_nothing_but_pairing', () => {
    /*
     * THE ALLOW-LIST IS EMPTY, AND SAYING SO IS THE POINT. There is no pairing
     * credential yet, so the honest assertion is that NOTHING survives the tab
     * — not "nothing except the things we happen to write".
     */
    expect(PERSISTABLE_KEYS).toEqual([]);

    const fields = identifierFieldsFor(['name', 'date_of_birth', 'address']);
    const screens = [
      <IdleScreen
        key="idle"
        {...CHROME}
        mode="idle"
        rows={[]}
        error={null}
        online
        onStart={noop}
        onBack={noop}
        onPick={noop}
        onRetry={noop}
      />,
      <IdleScreen
        key="list"
        {...CHROME}
        mode="list"
        rows={[]}
        error={null}
        online
        onStart={noop}
        onBack={noop}
        onPick={noop}
        onRetry={noop}
      />,
      <VerifyScreen
        key="verify"
        {...CHROME}
        fields={fields}
        stated={{}}
        state={firstAttempt()}
        busy={false}
        incomplete={false}
        startError={false}
        mismatch={false}
        onChange={noop}
        onContinue={noop}
        onSeeReception={noop}
      />,
      <AssignorScreen
        key="assignor"
        {...CHROME}
        patientName="Jamie Sampleton"
        choice={{ ...EMPTY_CHOICE, assignorIsPatient: false }}
        guard={{ state: 'valid' }}
        saveError={false}
        saving={false}
        particularsLocked={false}
        onChoose={noop}
        onChangeOther={noop}
        onContinue={noop}
        onSeeReception={noop}
      />,
      <ParticularsScreen
        key="particulars"
        {...CHROME}
        view={VIEW}
        validation={VALID}
        onContinue={noop}
        onBack={noop}
        onSeeReception={noop}
      />,
      <SignatureScreen
        key="signature"
        {...CHROME}
        validation={VALID}
        padRef={{ current: null }}
        inkPresent={false}
        submitting={false}
        error={null}
        onInkChange={noop}
        onClear={noop}
        onSignDrawn={noop}
        onSignTap={noop}
        onBack={noop}
        onSeeReception={noop}
      />,
      <CompleteScreen key="complete" {...CHROME} givenName="Jamie" onDone={noop} />,
      <HandoverScreen key="handover" {...CHROME} heading="Heading" body="Body" onDone={noop} />,
    ];

    for (const screen of screens) {
      const view = render(screen);
      view.unmount();
    }

    expect(writes).toEqual([]);
    expect(cookieWrites).toBe(0);
    // And no service worker was registered on the way past.
    expect((navigator as Navigator & { serviceWorker?: unknown }).serviceWorker).toBeUndefined();
  });

  it('the_session_token_is_held_in_memory_only', () => {
    // `app/kiosk/session.ts` is the one module that holds anything resembling a
    // credential, and it holds it in a module-level variable — the same rule
    // `app/auth.ts` keeps for the console's access token (CONVENTIONS.md §9b),
    // and one that is not to be "improved". Setting one writes nothing anywhere.
    setSession({ practiceId: 'practice-1', staffId: 'staff-1', accessToken: 'a-token' });
    expect(getSession().accessToken).toBe('a-token');
    expect(writes).toEqual([]);
    expect(cookieWrites).toBe(0);

    // And a sign-out to an empty scope is equally silent.
    setSession({ practiceId: '', staffId: null, accessToken: null });
    expect(getSession().accessToken).toBeNull();
    expect(writes).toEqual([]);
  });
});

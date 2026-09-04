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
 * THE NAME IS `kiosk_persists_nothing_but_pairing` and it now means both
 * halves of its own sentence. Device pairing landed on 3 September 2026, so
 * `PERSISTABLE_KEYS` holds exactly ONE key — the opaque credential, revocable
 * from the console — and this test asserts three things about it: that the
 * list has one entry and it is that one; that rendering every screen of the
 * ceremony writes nothing at all; and that the pairing module writes that key
 * and no other. The relaxation is narrow and named, rather than a deleted
 * test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { IdleScreen } from './screens/IdleScreen';
import { CheckDetailsScreen } from './screens/CheckDetailsScreen';
import { VerifyScreen } from './screens/VerifyScreen';
import { AssignorScreen } from './screens/AssignorScreen';
import { ParticularsScreen, type ParticularsView } from './screens/ParticularsScreen';
import { SignatureScreen } from './screens/SignatureScreen';
import { CompleteScreen } from './screens/CompleteScreen';
import { HandoverScreen } from './screens/HandoverScreen';
import { identifierFieldsFor } from './rules/identifiers';
import { firstAttempt } from './rules/verification';
import { EMPTY_CHOICE } from './rules/assignor';
import { PairingScreen } from './screens/PairingScreen';
import { UnpairedScreen } from './screens/UnpairedScreen';
import { getSession, PERSISTABLE_KEYS, setSession } from './session';
import {
  PAIRING_CREDENTIAL_KEY,
  clearPairingCredential,
  readPairingCredential,
  writePairingCredential,
} from './pairing';
import type { SignatureValidation } from './rules/signature-gate';
import { strings } from './strings';

const noop = () => undefined;
const CHROME = {
  practiceName: 'Sample Practice',
  locationLine: 'NSW',
  // Only `SignatureScreen` reads this; harmless as an extra prop everywhere else.
  heading: strings.particulars.headingByAgreementType.episodic_pre,
};
const VALID: SignatureValidation = {
  state: 'valid',
  artefactHash: 'b'.repeat(64),
  ruleSetVersion: 'draft-2026-08',
};
const VIEW: ParticularsView = {
  agreementType: 'episodic_pre',
  patientName: 'Jamie Sampleton',
  providerName: 'Dr Sample Provider',
  providerAddress: '2 Example Street, Sampletown NSW 2000',
  serviceDate: '2026-09-03',
  agreementDate: '2026-09-03',
  basicServiceDescription: 'General practitioner attendance',
  assignorIsPatient: true,
  assignorName: null,
  assignorRelationship: null,
  particularsLocked: false,
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
     * EXACTLY ONE KEY, AND IT IS THE PAIRING CREDENTIAL. Asserted as an
     * equality rather than a `toContain`, so a second key cannot be added
     * without changing a test whose name says what it is protecting. Nothing
     * else about a practice, a patient or a ceremony may ever join it.
     */
    expect(PERSISTABLE_KEYS).toEqual([PAIRING_CREDENTIAL_KEY]);
    expect(PERSISTABLE_KEYS).toHaveLength(1);

    const fields = identifierFieldsFor(['name', 'date_of_birth', 'address']);
    const screens = [
      <IdleScreen
        key="idle"
        {...CHROME}
        mode="idle"
        rows={[]}
        error={null}
        online
        testDevice={false}
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
        testDevice
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
      /*
       * K-P1 IS THE SCREEN THIS RULE IS MOST EXPOSED ON (TODO.md "Two front
       * doors", 4 Sep 2026). It is the only screen in the product that renders
       * a patient’s date of birth, address, mobile and email at once, and it
       * is exactly the screen somebody would be tempted to make "resilient" by
       * caching the session so a reload does not lose it. Nothing is written:
       * the payload lives in React state and dies with the session.
       */
      <CheckDetailsScreen
        key="check-details"
        {...CHROME}
        agreementType="episodic_pre"
        rows={[
          { type: 'name', label: 'Name', value: 'Jamie Sampleton' },
          { type: 'date_of_birth', label: 'Date of birth', value: '4 August 1962' },
          { type: 'address', label: 'Address', value: '2 Example Street, Sampletown NSW 2000' },
          { type: 'mobile', label: 'Mobile number', value: '0400 000 000' },
          { type: 'email', label: 'Email address', value: 'jamie@example.invalid' },
        ]}
        ticked={new Set(['name'])}
        saving={false}
        saveError={false}
        onToggle={noop}
        onContinue={noop}
        onSeeReception={noop}
      />,
      <CompleteScreen key="complete" {...CHROME} givenName="Jamie" onDone={noop} />,
      <HandoverScreen key="handover" {...CHROME} heading="Heading" body="Body" onDone={noop} />,
      /*
       * THE TWO PAIRING SCREENS ARE IN THIS LIST DELIBERATELY. They are the
       * screens NEAREST the one permitted write, so they are the ones most
       * likely to acquire a second one — a remembered practice name to show on
       * the next load, a "last paired at" for support. Rendering them here
       * says: still nothing, and the credential is written by `pairing.ts`
       * when the exchange succeeds, not by a screen.
       */
      <PairingScreen
        key="pairing"
        code=""
        busy={false}
        failure={null}
        paired={null}
        onChangeCode={noop}
        onPair={noop}
        onContinue={noop}
      />,
      <PairingScreen
        key="paired"
        code=""
        busy={false}
        failure="refused"
        paired={{ practiceName: 'Sample Practice', remembered: true }}
        onChangeCode={noop}
        onPair={noop}
        onContinue={noop}
      />,
      <UnpairedScreen key="unpaired" onPair={noop} />,
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
    // `app/kiosk/session.ts` holds anything resembling a session in a
    // module-level variable — the same rule `app/auth.ts` keeps for the
    // console's access token (CONVENTIONS.md §9b), and one that is not to be
    // "improved". Setting one writes nothing anywhere.
    setSession({ staffId: 'staff-1', accessToken: 'a-token' });
    expect(getSession().accessToken).toBe('a-token');
    expect(writes).toEqual([]);
    expect(cookieWrites).toBe(0);

    // And a sign-out is equally silent.
    setSession({ staffId: null, accessToken: null });
    expect(getSession().accessToken).toBeNull();
    expect(writes).toEqual([]);
  });

  it('the_pairing_credential_is_the_only_thing_written', () => {
    /*
     * THE ONE SANCTIONED WRITE, and this is the test that keeps it one. If a
     * future change makes `pairing.ts` remember a practice name, a device
     * label or when it last paired, a second entry appears in `writes` and
     * this fails by name.
     */
    const credential = 'opaque.credential-value';
    writePairingCredential(credential);
    expect(writes).toEqual([`localStorage.setItem:${PAIRING_CREDENTIAL_KEY}`]);
    expect(cookieWrites).toBe(0);

    // Clearing touches the same single key and nothing else. This runs only
    // when the SERVER has refused the credential — there is deliberately no
    // un-pair control on the device.
    writes.length = 0;
    clearPairingCredential();
    expect(writes).toEqual([`localStorage.removeItem:${PAIRING_CREDENTIAL_KEY}`]);

    // Every key it touches is on the allow-list, checked rather than assumed.
    for (const write of [
      `localStorage.setItem:${PAIRING_CREDENTIAL_KEY}`,
      `localStorage.removeItem:${PAIRING_CREDENTIAL_KEY}`,
    ]) {
      expect(PERSISTABLE_KEYS).toContain(write.split(':')[1]);
    }
  });

  it('an unreadable store means unpaired, not a broken tablet', () => {
    /*
     * Private browsing, a locked-down kiosk profile, a quota failure: all of
     * them THROW rather than returning null. A tablet that white-screens
     * because storage was disabled is a tablet somebody has to visit, which is
     * the exact expense the zero-footprint rule exists to avoid.
     */
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage is disabled');
      },
      setItem: () => {
        throw new Error('storage is disabled');
      },
      removeItem: () => {
        throw new Error('storage is disabled');
      },
    } as unknown as Storage);

    expect(readPairingCredential()).toBeNull();
    // It reports the failure rather than pretending it worked, so the screen
    // can say the tablet will need pairing again after a restart.
    expect(writePairingCredential('anything')).toBe(false);
    expect(() => clearPairingCredential()).not.toThrow();
  });
});

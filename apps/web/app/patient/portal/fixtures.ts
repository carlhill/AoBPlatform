/**
 * What the portal shows while `apps/core/src/portal` is being built beside it.
 *
 * OBVIOUSLY FAKE IDENTITIES, and no Medicare number of any format anywhere —
 * not even an invalid one, because this surface has no field for one and adding
 * a sample would be the first step towards a field (hard rule 1, REQ-VER-02).
 * No secret, no token, no real address.
 *
 * THIS MODULE IS IMPORTED LAZILY BY `api.ts` so a build with the switch off
 * never ships it. It exists to make the cards, the states and the confirm
 * dialogs testable and viewable today, and it is deleted the day the real
 * endpoints answer — nothing else imports it.
 *
 * IT ALSO HOLDS THE SIGNED-OUT STATE. `fixtureSession` refuses with a 401 until
 * the dev control opens one, so the not-signed-in screen — the state a real
 * patient meets first (REQ-PORT-08) — is the default rather than an afterthought.
 */
import { PortalApiError } from './api';
import type {
  PortalAccessEntry,
  PortalActivationChallenge,
  PortalAgreement,
  PortalAssignors,
  PortalDetails,
  PortalEnduring,
  PortalMessage,
  PortalNotice,
  PortalPasskey,
  PortalSession,
  PortalTermination,
  PortalVisit,
} from './api';

let signedIn = false;

export function openFixtureSession(): void {
  signedIn = true;
}

export function closeFixtureSession(): void {
  signedIn = false;
}

export function fixtureSession(): PortalSession {
  if (!signedIn) throw new PortalApiError('Not signed in', 401);
  return {
    accountId: 'acct-fixture-1',
    links: [
      { practiceId: 'prac-fixture-1', practiceName: 'Wattle Street Medical', patientId: 'pat-fixture-1' },
      { practiceId: 'prac-fixture-2', practiceName: 'Harbourview Family Practice', patientId: 'pat-fixture-2' },
    ],
  };
}

/**
 * Two practices, and they DISAGREE ABOUT THE ADDRESS — which is the point of
 * the card, and now of the reconciliation notice above it (Carl, 5 Sep 2026).
 *
 * THE ADDRESS IS THE ONLY DIFFERENCE, deliberately. The name is spelled the
 * same at both, the mobile is written differently at the two ("0400 000 001"
 * and "0400000001") precisely so the normalisation can be seen NOT firing on
 * it, and the email and date of birth match. So the fixture page shows exactly
 * one line under "Your practices hold different details for you", which is the
 * state worth looking at — a fixture that flagged four details would prove
 * nothing about whether the comparison is any good.
 */
export const fixtureDetails: readonly PortalDetails[] = [
  {
    practiceId: 'prac-fixture-1',
    practiceName: 'Wattle Street Medical',
    familyName: 'Sample',
    givenNames: 'Alex',
    dateOfBirth: '1984-02-29',
    address: '12 Example Street, Testville NSW 2000',
    mobile: '0400 000 001',
    email: 'alex.sample@example.invalid',
    patientRecordNumber: 'WSM-000123',
  },
  {
    practiceId: 'prac-fixture-2',
    practiceName: 'Harbourview Family Practice',
    familyName: 'Sample',
    givenNames: 'Alex',
    dateOfBirth: '1984-02-29',
    address: '3/40 Older Address Road, Testville NSW 2000',
    mobile: '0400000001',
    email: 'alex.sample@example.invalid',
    patientRecordNumber: 'HFP-99001',
  },
];

export const fixtureAgreements: readonly PortalAgreement[] = [
  {
    id: 'agr-fixture-1',
    practiceName: 'Wattle Street Medical',
    providerName: 'Dr Robin Example',
    type: 'enduring',
    status: 'stored',
    serviceDate: null,
    serviceDescription: 'General practice attendances',
    channel: 'in_practice',
    signedAt: '2026-07-14T23:10:00.000Z',
    artefactAvailable: true,
  },
  {
    id: 'agr-fixture-2',
    practiceName: 'Harbourview Family Practice',
    providerName: 'Dr Sam Placeholder',
    type: 'episodic',
    status: 'stored',
    serviceDate: '2026-08-19',
    serviceDescription: 'Standard consultation',
    channel: 'remote_link',
    signedAt: '2026-08-19T02:41:00.000Z',
    artefactAvailable: true,
  },
  {
    id: 'agr-fixture-3',
    practiceName: 'Wattle Street Medical',
    providerName: 'Dr Robin Example',
    type: 'episodic',
    status: 'awaiting_signature',
    serviceDate: '2026-09-03',
    serviceDescription: 'Standard consultation',
    channel: 'remote_link',
    signedAt: null,
    artefactAvailable: false,
  },
];

export const fixtureEnduring: readonly PortalEnduring[] = [
  {
    agreementId: 'agr-fixture-1',
    practiceName: 'Wattle Street Medical',
    providerName: 'Dr Robin Example',
    activeSince: '2026-07-15',
  },
];

export function fixtureTermination(): PortalTermination {
  const effective = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return { noticeId: 'notice-fixture-1', effectiveAt: effective.toISOString() };
}

export const fixtureNotices: readonly PortalNotice[] = [
  {
    id: 'notice-89aa-1',
    date: '2026-08-20',
    providerName: 'Dr Robin Example',
    practiceName: 'Wattle Street Medical',
    benefitAmountCents: 4285,
  },
  {
    id: 'notice-89aa-2',
    date: '2026-07-30',
    providerName: 'Dr Robin Example',
    practiceName: 'Wattle Street Medical',
    benefitAmountCents: 4285,
  },
];

export const fixtureVisits: readonly PortalVisit[] = [
  { date: '2026-08-19', practiceName: 'Harbourview Family Practice', locationLine: 'Harbourview rooms, Testville' },
  { date: '2026-07-14', practiceName: 'Wattle Street Medical', locationLine: 'Wattle Street, Testville' },
];

export const fixtureMessages: readonly PortalMessage[] = [
  {
    id: 'msg-fixture-1',
    channel: 'sms',
    sentAt: '2026-09-03T22:05:00.000Z',
    state: 'delivered',
    purposeKey: 'signature_request',
    practiceName: 'Wattle Street Medical',
    pending: true,
  },
  {
    id: 'msg-fixture-2',
    channel: 'email',
    sentAt: '2026-08-19T02:45:00.000Z',
    state: 'delivered',
    purposeKey: 'agreement_copy',
    practiceName: 'Harbourview Family Practice',
    pending: false,
  },
];

export const fixtureAssignors: PortalAssignors = {
  actsForMe: [
    { assignorId: 'asg-fixture-1', name: 'Kim Sample', relationshipKey: 'spouse', since: '2026-07-15', active: true },
  ],
  iActFor: [
    { patientId: 'pat-fixture-9', practiceName: 'Wattle Street Medical', givenNames: 'Frankie', since: '2026-03-02' },
  ],
};

export const fixtureAccessLog: readonly PortalAccessEntry[] = [
  {
    at: '2026-09-03T22:06:00.000Z',
    actorType: 'system',
    practiceName: 'Wattle Street Medical',
    actionKey: 'message_sent',
  },
  {
    at: '2026-08-19T02:41:00.000Z',
    actorType: 'patient',
    practiceName: 'Harbourview Family Practice',
    actionKey: 'agreement_signed',
  },
  {
    at: '2026-08-18T04:12:00.000Z',
    actorType: 'practice_staff',
    practiceName: 'Harbourview Family Practice',
    actionKey: 'details_corrected',
  },
  // Deliberately unmapped, so the code shows rather than a blank line — the
  // "shortcuts to the answer" principle applied to a key nobody has written
  // copy for yet (Carl, 4 Sep 2026).
  {
    at: '2026-08-01T00:00:00.000Z',
    actorType: 'system',
    practiceName: 'Wattle Street Medical',
    actionKey: 'retention_clock_started',
  },
];

// ---------------------------------------------------------------------------
// FR-8.2 — passkeys
// ---------------------------------------------------------------------------

/**
 * A MUTABLE LIST, unlike everything else in this file.
 *
 * The other fixtures are constants because nothing on the page changes them.
 * Passkeys are the one thing a patient ADDS and REMOVES from this surface, and
 * a fixture that ignored both would make the card look finished while hiding
 * the two states that matter — the empty list somebody sees first, and the
 * warning shown when they are about to remove their last one.
 *
 * No credential id, no public key, no device model. There is nothing here a
 * real payload has that this does not, because the real payload has nothing
 * else either.
 */
let fixturePasskeyList: PortalPasskey[] = [
  {
    id: 'passkey-fixture-1',
    label: 'My phone',
    createdAt: '2026-08-19T02:44:00.000Z',
    lastUsedAt: '2026-09-03T22:01:00.000Z',
  },
];

export function fixturePasskeys(): readonly PortalPasskey[] {
  return fixturePasskeyList;
}

export function addFixturePasskey(label?: string): PortalPasskey {
  const added: PortalPasskey = {
    id: `passkey-fixture-${fixturePasskeyList.length + 1}`,
    label: label?.trim() || null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  fixturePasskeyList = [...fixturePasskeyList, added];
  return added;
}

export function removeFixturePasskey(passkeyId: string): void {
  fixturePasskeyList = fixturePasskeyList.filter((passkey) => passkey.id !== passkeyId);
}

// ---------------------------------------------------------------------------
// FR-1.14 — the activation link
// ---------------------------------------------------------------------------

/**
 * WHAT THE ACTIVATION PAGE ANSWERS FROM WHEN CORE IS NOT RUNNING.
 *
 * THE POINT IS THE SHAPE, NOT THE DATA. Three identifier types, a practice
 * name, an expiry and a count of tries — so every state of that page (the
 * form, a mismatch, the lockout, each dead-link reason) can be seen and tested
 * without a database. The page prints the accepted answers in a
 * development-only note, because a fixture form nobody can pass is a fixture
 * form nobody looks at twice.
 *
 * OBVIOUSLY FAKE, AND NO MEDICARE NUMBER OF ANY FORMAT. Not even an invalid
 * one: this surface has no field for a card number and a sample would be the
 * first step towards one (hard rule 1, REQ-VER-02).
 *
 * THE TOKENS ARE ROUTING, NOT SECRETS. Four reserved words in the path pick a
 * state; anything else is the working link. Nothing here is a credential and
 * nothing here reaches a real server.
 */
export const FIXTURE_ACTIVATION_ANSWERS: Readonly<Record<string, string>> = {
  name: 'Alex Sample',
  date_of_birth: '1962-11-02',
  address: '2 Example Street, Sampletown NSW 2000',
};

/** Which fixture token shows which dead-link reason. `expired` also covers "already used". */
const FIXTURE_REFUSALS: Readonly<Record<string, string>> = {
  unknown: 'token_unknown',
  expired: 'token_expired',
  used: 'token_expired',
  locked: 'token_locked',
};

/** Counted per token, so the lockout after three wrong answers can be walked through. */
const fixtureAttempts = new Map<string, number>();

export function fixtureActivationChallenge(token: string): PortalActivationChallenge {
  const refusal = FIXTURE_REFUSALS[token];
  if (refusal) throw new PortalApiError('This invitation cannot be opened.', 404, refusal);
  return {
    identifierTypes: Object.keys(FIXTURE_ACTIVATION_ANSWERS),
    practiceName: 'Wattle Street Medical',
    expiresAt: '2026-09-30T04:00:00.000Z',
    attemptsRemaining: Math.max(0, 3 - (fixtureAttempts.get(token) ?? 0)),
  };
}

/**
 * The three-identifier check, fixture side — same refusals, same statuses, and
 * the same refusal to say WHICH answer was wrong (REQ-SEC-07).
 */
export function fixtureActivate(token: string, stated: Readonly<Record<string, string>>): void {
  const refusal = FIXTURE_REFUSALS[token];
  if (refusal) {
    throw new PortalApiError('This invitation cannot be opened.', refusal === 'token_locked' ? 423 : 410, refusal);
  }

  const matched = Object.entries(FIXTURE_ACTIVATION_ANSWERS).every(
    ([type, value]) => (stated[type] ?? '').trim().toLowerCase() === value.toLowerCase(),
  );
  if (matched) {
    fixtureAttempts.delete(token);
    openFixtureSession();
    return;
  }

  const attempts = (fixtureAttempts.get(token) ?? 0) + 1;
  fixtureAttempts.set(token, attempts);
  if (attempts >= 3) {
    throw new PortalApiError('This invitation is locked.', 423, 'token_locked');
  }
  throw new PortalApiError('Some of those details do not match.', 401, undefined, 3 - attempts);
}

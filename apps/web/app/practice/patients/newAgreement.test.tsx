/**
 * RECEPTION TYPES AN AGREEMENT BY HAND, RENDERED (Carl, 7 Sep 2026;
 * PMS_to_AoB_Workflow.md case 4, row W2).
 *
 * IT EXISTS BECAUSE THIS SCREEN CANNOT BE SEEN WITHOUT A PASSKEY. The console
 * signs in through Keycloak with WebAuthn (hard rule 15 — there is no password
 * path and never will be), so nobody can open a practice screen in a headless
 * check. Without this, the form's first render would happen in front of a
 * practice whose own software has just gone down.
 *
 * WHAT IT PINS, and none of it is cosmetic:
 *
 *  - NO MEDICARE CARD NUMBER reaches the form or leaves it — no field, no
 *    label, no hint, no key in the body (hard rule 1, REQ-VER-02).
 *  - ONLY SERVICING PROVIDERS ARE OFFERED, and the page invents none of them:
 *    it renders exactly what `GET /arrivals/servicing-providers` returned,
 *    which is the same predicate that refuses an arrival naming a nurse.
 *  - THE POLICY DECIDES, AND THE FORM SHOWS THE ANSWER before Submit rather
 *    than offering a choice (hard rules 6 and 14).
 *  - A DOUBLE-CLICK IS ONE WALK-IN: every attempt carries one idempotency key.
 *  - SOMEBODY SIGNING FOR ANOTHER PERSON IS ASKED ABOUT THEIR AGE — as a
 *    DECLARATION, and never as a date of birth (REQ-AGE-01, REQ-VUL-02) — and
 *    Submit is dead, with the reason on screen, until they have made it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MIN_AGE_ASSIGN_FOR_OTHER } from '@aobplatform/domain';
import { NewAgreementPanel, todayLocal } from './NewAgreementPanel';
import { strings } from '../../strings';

const PRACTICE = 'practice-1';
const GP = 'aaaaaaaa-1111-4000-8000-000000000001';
const ALLIED = 'bbbbbbbb-2222-4000-8000-000000000002';
const PATIENT = 'cccccccc-3333-4000-8000-000000000003';

/**
 * WHO THE SERVER OFFERS. Servicing providers only — the endpoint filters by
 * the same predicate that refuses an arrival, so a nurse never appears in this
 * payload and the page has no way to conjure one.
 */
const CHOICES = [
  { affiliationId: GP, name: 'Dr Sample GP', providerType: 'general_practitioner', locationLabel: 'Main' },
  { affiliationId: ALLIED, name: 'Sam Sample', providerType: 'allied_health', locationLabel: null },
];

const DESCRIPTIONS = {
  version: 'dev-mapping-1',
  descriptions: ['General practitioner attendance', 'Allied health attendance'],
  defaultDescription: 'General practitioner attendance',
};

/** Obviously fake, and deliberately holding no record number — the form asks for one. */
const FOUND = [
  {
    patientId: PATIENT,
    givenNames: 'Jamie',
    familyName: 'Sampleton',
    dateOfBirth: '1957-03-14',
    patientRecordNumber: 'PR-1001',
  },
];

/**
 * WHAT THE PLATFORM ACTUALLY HOLDS ABOUT THE CHOSEN PATIENT, from
 * `GET /patients/:id/details` — the read the search result deliberately does
 * not carry (hard rule 1's minimisation). Obviously fake.
 */
const DETAILS = {
  id: PATIENT,
  givenNames: 'Jamie',
  familyName: 'Sampleton',
  dateOfBirth: '1957-03-14',
  address: '12 Example Parade, Sampletown NSW 2000',
  mobile: '+61400000404',
  email: 'jamie.sampleton@example.invalid',
  detailsCorrectedAt: null,
};

const PREVIEW_ENDURING = {
  decision: { type: 'enduring', reason: 'gp_with_no_active_enduring' },
  policyVersion: 'visit-policy-1',
  providerName: 'Dr Sample GP',
  locationLabel: 'Main',
  coveringAgreementId: null,
  blocked: null,
};

const calls: Array<{ url: string; method: string; body: Record<string, unknown> | undefined }> = [];

function stubFetch(opts: { preview?: unknown; staff?: string[]; descriptions?: unknown } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
      calls.push({ url, method, body });

      if (url.includes('/arrivals/preview')) {
        return {
          ok: true,
          status: 201,
          json: async () => opts.preview ?? PREVIEW_ENDURING,
        } as unknown as Response;
      }
      if (method === 'POST' && url.endsWith('/arrivals')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ patientId: PATIENT, agreementId: 'agreement-1' }),
        } as unknown as Response;
      }

      const payload = url.includes('/arrivals/servicing-providers')
        ? CHOICES
        : url.includes('/service-descriptions/settings')
          ? (opts.descriptions ?? DESCRIPTIONS)
          : url.includes('/practice-users')
            ? { users: (opts.staff ?? ['Mai Frontdesk']).map((name) => ({ name })) }
            : url.includes('/patients/search')
              ? FOUND
              : url.includes('/details')
                ? DETAILS
                : {};
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
  );
}

vi.mock('../../auth', () => ({
  currentSession: () => ({ roles: ['practice_user'], practiceId: PRACTICE }),
  apiHeaders: () => ({ 'x-practice-id': PRACTICE, 'Content-Type': 'application/json' }),
}));

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function open() {
  return render(
    <NewAgreementPanel
      practiceId={PRACTICE}
      canAct
      onCreated={() => undefined}
      onClose={() => undefined}
    />,
  );
}

/**
 * FILL IN ENOUGH FOR A VALID WALK-IN: an existing patient, a provider, and the
 * record number the arrival is matched on. Waits for the DATA each control
 * needs rather than for the control itself (wow.md §2 item 6) — the provider
 * select renders on the panel's first paint and its options arrive on a second,
 * independently-resolving fetch.
 */
async function fillTheBasics() {
  fireEvent.change(screen.getByTestId('new-agreement-find'), { target: { value: 'Sampleton' } });
  const chosen = await screen.findByTestId(`new-agreement-choose-${PATIENT}`);
  fireEvent.click(chosen);

  const provider = screen.getByTestId('new-agreement-provider') as HTMLSelectElement;
  await waitFor(() => expect(provider.options.length).toBeGreaterThan(1));
  fireEvent.change(provider, { target: { value: ALLIED } });

  // The chosen patient carried one; a record without one is typed here.
  const record = screen.getByTestId('new-agreement-record-number') as HTMLInputElement;
  await waitFor(() => expect(record.value).toBe('PR-1001'));

  // AND THE DETAILS READ HAS LANDED. Submit stays dead until it has, because
  // an arrival is a mirror write and a blank address would erase a real one —
  // so waiting for the DATA rather than the control is not optional here
  // (wow.md §2 item 6).
  await waitFor(() =>
    expect(calls.some((c) => c.url.includes(`/patients/${PATIENT}/details`))).toBe(true),
  );
}

// ---------------------------------------------------------------------------

describe('/practice/patients — the "New agreement" form (W2)', () => {
  /**
   * HARD RULE 1 / REQ-VER-02. The Medicare card number is NOT an identity
   * identifier, the exclusion is non-configurable, and this form is a place
   * somebody might reasonably expect to type one — which is exactly why the
   * absence is asserted rather than assumed.
   *
   * BOTH HALVES: nothing on screen invites one, and nothing in the body the
   * form posts carries one. The server refuses any /medicare/i key in the raw
   * body besides (`arrival_rejects_a_medicare_number`), so this is the fence
   * before that one.
   */
  it('new_agreement_form_never_carries_a_medicare_number', async () => {
    stubFetch();
    const { container } = open();

    await fillTheBasics();

    // Nothing on screen asks for one, in a label, a hint, a placeholder or a
    // field name.
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/medicare/i);
    // NO BENEFIT AND NO DOLLAR AMOUNT ON ANY AGREEMENT ARTEFACT (hard rule 4).
    expect(text).not.toMatch(/\$\s?\d/);
    // NOR ANY CLAIM OF CERTIFICATION (hard rule 12, REQ-65C-05).
    expect(text).not.toMatch(/certified|accredited|government-approved/i);
    // AND NOTHING ASKS STAFF TO JUDGE WHETHER A PATIENT CAN CONSENT
    // (REQ-VUL-05) — the absence is the requirement.
    expect(text).not.toMatch(/capacity|competent to consent/i);
    for (const input of Array.from(container.querySelectorAll('input, select, textarea'))) {
      const attrs = [
        input.getAttribute('name'),
        input.getAttribute('id'),
        input.getAttribute('placeholder'),
        input.getAttribute('aria-label'),
        input.getAttribute('data-testid'),
      ].join(' ');
      expect(attrs).not.toMatch(/medicare/i);
    }

    const submit = screen.getByTestId('new-agreement-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    const posted = await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.url.endsWith('/arrivals'));
      expect(call).toBeTruthy();
      return call!;
    });
    // No key, at any depth, with "medicare" in its name — and no value that
    // could be one either.
    expect(JSON.stringify(posted.body)).not.toMatch(/medicare/i);
  });

  /**
   * AN ARRIVAL IS A MIRROR WRITE, SO IT MUST CARRY WHAT WE ALREADY HOLD
   * (REQ-DATA-10; found in review, 7 Sep 2026).
   *
   * THE BUG THIS PINS. `mirrorPatient` brings the patient row up to what the
   * arrival says, field by field. The search result carries four fields on
   * purpose — no address, no contact details (hard rule 1's minimisation) — so
   * a form that posted straight from it would send an EMPTY address and ERASE
   * the real one held for a patient the practice has had for years, on exactly
   * the case W2 exists for. The chosen patient's own details are read
   * separately and travel with the arrival, which makes the mirror write a
   * no-op instead of a loss.
   */
  it('new_agreement_for_a_known_patient_never_blanks_their_held_details', async () => {
    stubFetch();
    open();

    await fillTheBasics();
    const submit = screen.getByTestId('new-agreement-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    const posted = await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.url.endsWith('/arrivals'));
      expect(call).toBeTruthy();
      return call!;
    });

    // The values the platform holds, not blanks.
    expect(posted.body?.address).toBe(DETAILS.address);
    expect(posted.body?.mobile).toBe(DETAILS.mobile);
    expect(posted.body?.email).toBe(DETAILS.email);
  });

  /**
   * AND SUBMIT IS DEAD UNTIL THAT READ HAS LANDED. A details read that fails
   * must not become a blanking write: the control stays disabled and names the
   * missing address rather than posting an arrival that would erase one.
   */
  it('submit stays dead while the chosen patient’s details have not been read', async () => {
    // Every read works except the patient's own details.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method, body: undefined });
        if (url.includes(`/patients/${PATIENT}/details`)) {
          return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
        }
        if (url.includes('/arrivals/preview')) {
          return { ok: true, status: 201, json: async () => PREVIEW_ENDURING } as unknown as Response;
        }
        const payload = url.includes('/arrivals/servicing-providers')
          ? CHOICES
          : url.includes('/service-descriptions/settings')
            ? DESCRIPTIONS
            : url.includes('/practice-users')
              ? { users: [] }
              : url.includes('/patients/search')
                ? FOUND
                : {};
        return { ok: true, status: 200, json: async () => payload } as unknown as Response;
      }),
    );
    open();

    fireEvent.change(screen.getByTestId('new-agreement-find'), { target: { value: 'Sampleton' } });
    fireEvent.click(await screen.findByTestId(`new-agreement-choose-${PATIENT}`));
    const provider = screen.getByTestId('new-agreement-provider') as HTMLSelectElement;
    await waitFor(() => expect(provider.options.length).toBeGreaterThan(1));
    fireEvent.change(provider, { target: { value: ALLIED } });

    // The reason is on screen, and nothing was posted.
    const blocked = await screen.findByTestId('new-agreement-blocked');
    expect(blocked.textContent).toContain(strings.newAgreement.needAddress);
    expect((screen.getByTestId('new-agreement-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/arrivals'))).toBe(false);
  });

  /**
   * THE BANNER TELLS THE TRUTH ABOUT WHAT IT MADE (found in review, 7 Sep
   * 2026; CLAUDE.md §7, "a generic fallback message is a defect").
   *
   * A practice with no default D6a, and no description chosen here, gets a
   * draft the pipeline deliberately does NOT lock — hard rule 2 forbids an
   * unlocked agreement at `awaiting_signature` — so it lands on the queue
   * unsendable, with its own reason and its own fix on the row. Saying "ready
   * to send to a tablet" would be false, and false in the reassuring direction.
   */
  it('the created banner says a draft cannot be sent yet when it cannot', async () => {
    stubFetch({
      descriptions: { version: 'dev-mapping-1', descriptions: [], defaultDescription: null },
      preview: {
        decision: { type: 'episodic_pre', reason: 'enduring_is_gp_only' },
        policyVersion: 'visit-policy-1',
        providerName: 'Sam Sample',
        locationLabel: null,
        coveringAgreementId: null,
        blocked: null,
      },
    });
    open();

    await fillTheBasics();
    const submit = screen.getByTestId('new-agreement-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    const created = await screen.findByTestId('new-agreement-created');
    expect(created.textContent).toContain(strings.newAgreement.createdBlocked('Jamie Sampleton'));
    expect(created.textContent).not.toContain(strings.newAgreement.created('Jamie Sampleton'));
    // And the way to the row that carries the fix is right there.
    expect(screen.getByTestId('new-agreement-created-open')).toBeTruthy();
  });

  /**
   * WHOSE NUMBER THE CLAIM GOES UNDER. Only servicing providers may be the
   * provider on an agreement (hard rule 6's neighbour: the billing role), and
   * the picker is fed by the endpoint that applies that predicate — so the
   * assertion that matters on this side is that the page renders EXACTLY what
   * it was given and asks the right question.
   */
  it('new_agreement_form_offers_only_servicing_providers', async () => {
    stubFetch();
    open();

    const provider = screen.getByTestId('new-agreement-provider') as HTMLSelectElement;
    // Wait for the OPTIONS, not the select: the select is on the first paint
    // and its contents arrive on a second fetch (wow.md §2 item 6).
    await waitFor(() => expect(provider.options.length).toBe(CHOICES.length + 1));

    // The endpoint asked is the one that filters by billing role — not a
    // general list of everybody the practice holds.
    expect(calls.some((c) => c.url.includes('/arrivals/servicing-providers'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/providers'))).toBe(false);

    // Exactly the payload's people, in the payload's order, and the site named
    // where there is one — the same practitioner at two sites is two choices.
    const labels = Array.from(provider.options).slice(1).map((option) => option.textContent);
    expect(labels).toEqual([
      strings.newAgreement.providerAt('Dr Sample GP', 'Main'),
      'Sam Sample',
    ]);

    // And the copy says why a nurse is not here, rather than leaving somebody
    // to hunt for a name that will never appear.
    expect(screen.getByText(strings.newAgreement.providerHint)).toBeTruthy();
  });

  /**
   * WHAT THE VISIT NEEDS IS READ, NOT CHOSEN (hard rules 6 and 14). There is no
   * control on this form that sets an agreement type; the versioned visit
   * policy decides and the form shows the answer — with the version that gave
   * it — before anybody presses Submit.
   */
  it('new_agreement_form_shows_the_policy_decision_before_submit', async () => {
    stubFetch();
    const { container } = open();

    await fillTheBasics();
    fireEvent.change(screen.getByTestId('new-agreement-provider'), { target: { value: GP } });

    // The LINE, not the panel that hosts it: the decision arrives on its own
    // fetch after the panel has already rendered.
    const line = await screen.findByTestId('new-agreement-decision-line');
    expect(line.textContent).toBe(strings.newAgreement.decisionEnduring('Dr Sample GP'));
    // Hard rule 14 — which table gave that answer travels with it.
    expect(screen.getByTestId('new-agreement-decision-version').textContent).toBe(
      strings.newAgreement.decisionVersion('visit-policy-1'),
    );

    // IT IS A READ. Nothing was created to find that out.
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/arrivals'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/arrivals/preview'))).toBe(true);

    // And there is no control anywhere on the form that picks the type.
    expect(container.textContent ?? '').not.toMatch(/choose an agreement type/i);
  });

  /**
   * ONE WALK-IN, ONE AGREEMENT. Two presses of one Submit carry ONE idempotency
   * key, so the server — which is idempotent on (practice, key) — drafts once
   * and one person appears on the queue once.
   */
  it('new_agreement_form_double_submit_drafts_once', async () => {
    stubFetch();
    open();

    await fillTheBasics();
    const submit = await screen.findByTestId('new-agreement-submit');
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/arrivals'))).toBe(true),
    );

    const posts = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/arrivals'));
    const keys = new Set(posts.map((c) => String(c.body?.idempotencyKey)));
    expect(keys.size).toBe(1);
    // The key names the walk-in it is about, so a genuine second visit later in
    // the day (a fresh open of the panel, a fresh nonce) is a different one.
    const key = [...keys][0]!;
    expect(key.startsWith('reception:PR-1001:')).toBe(true);
    expect(key).toContain(todayLocal());
    // And the source says a person typed it, not a connector.
    expect(posts[0]!.body?.source).toBe('reception');
  });

  /**
   * SOMEBODY ELSE IS SIGNING FOR THE PATIENT (D7, hard rule 10).
   *
   * THE FORM ASKS ABOUT THEIR AGE AS A DECLARATION, using the threshold from
   * the domain rather than a literal — it has moved once already. It never
   * asks for their date of birth and stores none (REQ-AGE-01, REQ-VUL-02), and
   * Submit stays dead with the reason on screen until the declaration is made
   * (CLAUDE.md §6: blocked states are unreachable, not merely inert).
   */
  it('new_agreement_for_someone_else_asks_the_assignors_age', async () => {
    // Nobody on the staff list matches the person below, so the staff block is
    // not what is being tested here.
    stubFetch({ staff: ['Mai Frontdesk'] });
    open();

    await fillTheBasics();
    fireEvent.click(screen.getByTestId('new-agreement-who-other'));

    fireEvent.change(screen.getByTestId('new-agreement-who-name'), {
      target: { value: 'Alex Notstaff' },
    });
    const relationship = screen.getByTestId('new-agreement-who-relationship') as HTMLSelectElement;
    await waitFor(() => expect(relationship.options.length).toBeGreaterThan(1));
    fireEvent.change(relationship, { target: { value: 'mother' } });
    fireEvent.change(screen.getByTestId('new-agreement-who-mobile'), {
      target: { value: '0400 000 111' },
    });

    // THE QUESTION IS ASKED, in the domain's words and with the domain's
    // threshold.
    expect(screen.getByText(strings.newAgreement.signingAge(MIN_AGE_ASSIGN_FOR_OTHER))).toBeTruthy();

    // AND NO DATE OF BIRTH IS ASKED FOR. There is no assignor birth-date
    // control anywhere on this form; the three pickers belong to the PATIENT's
    // date of birth and are not rendered for a patient already on record.
    expect(screen.queryByTestId('new-agreement-who-dob')).toBeNull();
    expect(screen.queryByTestId('new-agreement-who-dob-day')).toBeNull();

    // SUBMIT IS DEAD, AND SAYS WHY, until the declaration is made.
    const submit = screen.getByTestId('new-agreement-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(screen.getByTestId('new-agreement-blocked').textContent).toContain(
      strings.tablet.whoBlockedAge,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(submit.disabled).toBe(false));

    fireEvent.click(submit);
    const posted = await waitFor(() => {
      const call = calls.find((c) => c.method === 'POST' && c.url.endsWith('/arrivals'));
      expect(call).toBeTruthy();
      return call!;
    });

    const assignor = posted.body?.assignor as Record<string, unknown>;
    expect(assignor.name).toBe('Alex Notstaff');
    // BOTH ANSWERS GO: the word the person chose, and reg 65CB(5)'s category
    // derived from it through the versioned content file (REQ-VUL-01, rule 14).
    expect(assignor.relationship).toBe(strings.kiosk.assignor.relationshipNames.mother);
    expect(assignor.authorityBasis).toBe('parent');
    expect(assignor.relationshipsVersion).toBeTruthy();
    expect(assignor.declaresEighteenOrOver).toBe(true);
    // A DECLARATION, NOT A BIRTH DATE — nothing about a date of birth for this
    // person is sent, and there is nowhere for one to have come from.
    expect(Object.keys(assignor)).not.toContain('dateOfBirth');
    expect(JSON.stringify(assignor)).not.toMatch(/dateOfBirth/i);
  });

  /**
   * A REFUSAL IS AN ANSWER, WITH THE REASON AND THE FIX ON IT — never a
   * sentence pointing at another screen (CLAUDE.md §7). An unmapped code shows
   * itself so it can be diagnosed rather than disappearing.
   */
  it('a provider the server will refuse is named, with the reason, before Submit', async () => {
    stubFetch({
      preview: {
        decision: null,
        policyVersion: '',
        providerName: 'Kit Practicenurse',
        locationLabel: 'Main',
        coveringAgreementId: null,
        blocked: { reason: 'provider_not_servicing', billingRole: 'works_under_provider' },
      },
    });
    open();

    await fillTheBasics();

    const band = await screen.findByTestId('new-agreement-decision-blocked');
    expect(band.textContent).toContain('Kit Practicenurse');
    expect(band.textContent).toContain('cannot be the provider on an agreement');

    // And Submit is dead, because the server would refuse it.
    const submit = screen.getByTestId('new-agreement-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(screen.getByTestId('new-agreement-blocked').textContent).toContain(
      strings.newAgreement.needProviderUsable,
    );
  });

  /**
   * AN UNMAPPED REASON CODE SHOWS ITSELF. A generic fallback message is a
   * defect (Carl, 4 Sep 2026), so a code this console has never seen is put on
   * screen where somebody can quote it.
   */
  it('an unmapped refusal code is shown rather than swallowed', async () => {
    stubFetch({
      preview: {
        decision: null,
        policyVersion: '',
        providerName: 'Sam Sample',
        locationLabel: null,
        coveringAgreementId: null,
        blocked: { reason: 'something_new_from_the_server', billingRole: null },
      },
    });
    open();

    await fillTheBasics();
    const band = await screen.findByTestId('new-agreement-decision-blocked');
    expect(band.textContent).toContain('something_new_from_the_server');
  });
});

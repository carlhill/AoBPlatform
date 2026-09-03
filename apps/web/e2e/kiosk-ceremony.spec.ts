/**
 * THE CEREMONY, END TO END, AGAINST A REAL CORE.
 *
 * idle → list → K-2 verify → K-5 who is signing → K-3 locked particulars →
 * K-4 sign → done. Nothing here is mocked: the rules engine really validates,
 * the renderer really produces a hash, and RLS really scopes the waiting list.
 * That is the whole reason this suite exists next to the Vitest one — the unit
 * tests prove the screens refuse what they must refuse, and this proves the
 * six steps actually join up.
 *
 * IT STAGES ITS OWN PATIENTS. Every run creates fresh `episodic_pre` drafts
 * and opens a capture request for each, through the same public endpoints the
 * practice uses. Consuming a row that happened to be lying about would make
 * the second run of the day fail for a reason that has nothing to do with the
 * code — the agreement it wanted was already signed.
 *
 * THE FIXTURE IDENTITIES ARE OBVIOUSLY FAKE, and deliberately: "Jamie
 * Sampleton" at "2 Example Street, Sampletown NSW 2000". No Medicare-format
 * number appears anywhere in this file, because there is no Medicare field to
 * put one in (hard rule 1).
 *
 *   npm run dev -w apps/web        # web on 3100
 *   npm run start:dev -w apps/core # core on 3001
 *   npm run e2e:kiosk -w apps/web
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

const CORE = process.env.KIOSK_CORE_URL ?? 'http://localhost:3001';
const PRACTICE_ID = process.env.NEXT_PUBLIC_KIOSK_PRACTICE_ID ?? '821709fb-7f89-4fcf-95c0-27c5eb55cec8';

/** The staged waiting patient, and the three identifiers the practice challenges on. */
const PATIENT = {
  name: 'Jamie Sampleton',
  given: 'Jamie',
  family: 'Sampleton',
  dob: { day: '04', month: '08', year: '1962' },
  address: '2 Example Street, Sampletown NSW 2000',
};

/** On this practice's staff list, so REQ-VUL-04 must refuse them as an assignor. */
const STAFF_MEMBER_NAME = 'Carl Hill';

/**
 * D6a, SUPPLIED BY THE STAFF SIDE — never by the tablet (Carl, 3 Sep 2026).
 *
 * A pre-agreement needs a Basic Service Description drawn from the practice's
 * current mapping, and the rules engine matches it exactly and
 * case-sensitively. It comes from the PMS appointment type
 * (CONSULTATION-CAPTURE-PLAN section 2.4); the kiosk asks for it nowhere and
 * offers the patient no field to type it into. This constant stands in for the
 * PMS in the staging step, which is the staff side of the flow — it is not a
 * mapping in the web app (hard rule 14), it is a fixture in a test.
 */
const STAFF_SIDE_SERVICE_DESCRIPTION = 'General practitioner attendance';

interface WaitingRow {
  captureRequestId: string;
  agreementId: string;
  patientId: string;
  patientName: string;
}

function headers() {
  return { 'content-type': 'application/json', 'x-practice-id': PRACTICE_ID };
}

async function waitingList(api: APIRequestContext): Promise<WaitingRow[]> {
  const res = await api.get(`${CORE}/kiosk/waiting-list`, { headers: headers() });
  expect(res.ok(), 'core must be running on 3001 with a waiting list').toBeTruthy();
  return (await res.json()).waiting as WaitingRow[];
}

/**
 * A fresh draft and an open in-practice capture request for the named patient,
 * built from an existing row so the ids (patient, assignor, provider) are the
 * practice's own rather than invented.
 */
async function stageWaitingPatient(
  api: APIRequestContext,
  patientName: string,
  /**
   * Whether the STAFF SIDE locks the particulars before the tablet sees the
   * row, which is what the intended flow does: "rules engine validates and
   * locks the particulars — a draft can never reach a device" (TODO.md's own
   * diagram, REQ-REG-06). A locked row is what a patient should meet.
   *
   * Left unlocked for the one case that cannot be tested any other way: who
   * signs is one of the locked particulars, so `POST /agreements/:id/assignor`
   * is refused after the lock. The "someone else" branch is therefore only
   * exercisable on a draft — see that test for what it can and cannot prove
   * today.
   */
  options: { lock: boolean },
): Promise<WaitingRow> {
  const rows = await waitingList(api);
  const seed = rows.find((row) => row.patientName === patientName);
  expect(
    seed,
    `no waiting row for ${patientName} to stage from — seed one in ${PRACTICE_ID} first`,
  ).toBeTruthy();

  const existing = await api.get(`${CORE}/agreements/${seed!.agreementId}`, { headers: headers() });
  expect(existing.ok()).toBeTruthy();
  const source = await existing.json();

  const created = await api.post(`${CORE}/agreements`, {
    headers: headers(),
    data: {
      type: 'episodic_pre',
      providerId: source.providerId,
      patientId: source.patientId,
      // The PATIENT'S own assignor record. D7 stays explicit even here.
      assignorId: source.patientAssignorId ?? source.assignorId,
      assignorIsPatient: true,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const agreement = await created.json();

  const capture = await api.post(`${CORE}/capture`, {
    headers: headers(),
    data: { agreementId: agreement.id, channel: 'in_practice' },
  });
  expect(capture.ok(), await capture.text()).toBeTruthy();
  const { captureRequestId } = await capture.json();

  if (options.lock) {
    const moved = await api.post(`${CORE}/agreements/${agreement.id}/transition`, {
      headers: headers(),
      data: { to: 'awaiting_signature' },
    });
    expect(moved.ok(), await moved.text()).toBeTruthy();
    const locked = await api.post(`${CORE}/agreements/${agreement.id}/particulars`, {
      headers: headers(),
      data: { serviceDate: new Date().toISOString().slice(0, 10), basicServiceDescription: STAFF_SIDE_SERVICE_DESCRIPTION },
    });
    expect(locked.ok(), await locked.text()).toBeTruthy();
  }

  return {
    captureRequestId,
    agreementId: agreement.id,
    patientId: agreement.patientId,
    patientName,
  };
}

/** idle → list → the staged patient → K-2, filled in and submitted. */
async function verifyAs(page: Page, row: WaitingRow) {
  await page.goto('/kiosk');
  await page.getByTestId('start-check-in').click();

  const pick = page.getByTestId(`pick-${row.captureRequestId}`);
  await expect(pick).toBeVisible();
  await pick.click();

  // K-2. There is no Medicare card field on this screen and no setting that
  // could add one — asserted rather than assumed (REQ-VER-02).
  await expect(page.getByTestId('identifier-name-given')).toBeVisible();
  await expect(page.locator('text=/medicare/i')).toHaveCount(1); // the REQ-VER-02 panel, which says there is none
  await expect(page.locator('input[type="password"]')).toHaveCount(0);

  await page.getByTestId('identifier-name-given').fill(PATIENT.given);
  await page.getByTestId('identifier-name-family').fill(PATIENT.family);
  await page.getByTestId('identifier-address').fill(PATIENT.address);
  await page.getByTestId('identifier-dob-day').selectOption(PATIENT.dob.day);
  await page.getByTestId('identifier-dob-month').selectOption(PATIENT.dob.month);
  await page.getByTestId('identifier-dob-year').selectOption(PATIENT.dob.year);

  const cont = page.getByTestId('verify-continue');
  await expect(cont).toBeEnabled();
  await cont.click();

  // K-5.
  await expect(page.getByTestId('assignor-self')).toBeVisible({ timeout: 20_000 });
}

test.describe('the kiosk ceremony', () => {
  test('the patient signs for themselves, and the ceremony completes', async ({ page, request }) => {
    // The staff side has already validated and locked the particulars, which
    // is the intended flow: a draft never reaches a device (REQ-REG-06).
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: true });
    await verifyAs(page, row);

    // THE TAP ITSELF ADVANCES — no Continue for the common case.
    await page.getByTestId('assignor-self').click();

    // K-3: locked, versioned, hashed, and offering the patient no field at all.
    await expect(page.getByTestId('artefact-hash')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('versions')).toBeVisible();
    await expect(page.locator('main input, main select, main textarea')).toHaveCount(0);
    // No amount, and no practitioner signature field (rules 3 and 4).
    await expect(page.locator('main')).not.toContainText(/\$\s?\d/);
    await expect(page.getByText('No provider signature field')).toBeVisible();

    // The way out is present and is at least the WCAG floor, measured in a
    // real browser rather than inferred from a class name.
    const exit = page.getByTestId('leave-for-reception');
    const box = await exit.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const toSign = page.getByTestId('continue-to-sign');
    await expect(toSign).toBeEnabled();
    await toSign.click();

    // K-4. Drawing on glass and tapping to approve are both real signatures;
    // this run takes the tap, which is the accessible path.
    await expect(page.getByTestId('signature-pad')).toBeVisible();
    const tap = page.getByTestId('sign-control-tap');
    await expect(tap).toBeEnabled();
    await tap.click();

    // Done — and nothing of this patient is reachable by going back, because
    // there is nowhere to go back to: the steps are state, not routes.
    await expect(page.getByTestId('complete-heading')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('complete-heading')).toContainText(PATIENT.given);
  });

  test('someone else signs, and the agreement is re-pointed at them', async ({ page, request }) => {
    /*
     * ON A DRAFT, NECESSARILY. Who signs is one of the locked particulars, so
     * the server refuses to re-point an agreement once they are locked
     * (REQ-REG-06) — which means this branch can only be exercised before the
     * staff-side lock. What that costs the test is stated plainly below.
     */
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: false });
    await verifyAs(page, row);

    await page.getByTestId('assignor-other').click();
    await expect(page.getByTestId('assignor-other-name')).toBeVisible();

    await page.getByTestId('assignor-other-name').fill('Pat Example');
    // The person is asked what they ARE. The legal authority basis is derived
    // from this through versioned content and is never shown to them.
    await page.getByTestId('assignor-relationship').selectOption('friend');
    await page.getByTestId('assignor-other-of-age').check();
    await page.getByTestId('assignor-mobile').fill('0400 000 000');

    const cont = page.getByTestId('assignor-continue');
    await expect(cont).toBeEnabled();
    await cont.click();

    /*
     * THE WRITE HAPPENED — the gap the Expo build left. It ran these gates and
     * then handed over to the desk, because nothing re-pointed a draft at a new
     * assignor. The server now holds the new party, with BOTH attributes
     * REQ-VUL-01 asks for: the relationship in the words the person chose, and
     * the authority basis derived from it through versioned content.
     */
    await expect(page.getByTestId('assignor-other-name')).toBeHidden({ timeout: 25_000 });

    const after = await request.get(`${CORE}/agreements/${row.agreementId}`, { headers: headers() });
    const agreement = await after.json();
    expect(agreement.assignorIsPatient).toBe(false);
    expect(agreement.particulars?.assignorName ?? 'Pat Example').toContain('Pat Example');

    /*
     * AND THEN IT HANDS OVER, HONESTLY. This draft has no D6a — nothing on the
     * staff side supplied one, because nothing on the staff side can yet: the
     * Basic Service Description comes from the PMS appointment type through the
     * practice's versioned mapping, and that path is not built. So the lock is
     * refused and the tablet says so and stops.
     *
     * WHAT IS BEING ASSERTED IS THE SHAPE OF THE REFUSAL. Not a numbered list
     * of "details still needed" for the patient to fix, not the server's own
     * words, and above all not a field for anybody standing at the tablet to
     * type a validated particular into.
     */
    await expect(page.getByTestId('handover-heading')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('handover-body')).toContainText('see reception');
    await expect(page.locator('main')).not.toContainText(/C6:|D6a|Internal server error/i);
    await expect(page.locator('main input, main select, main textarea')).toHaveCount(0);
  });

  test('a practice staff member is refused, and told which rule refused them', async ({
    page,
    request,
  }) => {
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: false });
    await verifyAs(page, row);

    await page.getByTestId('assignor-other').click();
    await page.getByTestId('assignor-other-name').fill(STAFF_MEMBER_NAME);
    await page.getByTestId('assignor-relationship').selectOption('friend');
    await page.getByTestId('assignor-other-of-age').check();
    await page.getByTestId('assignor-mobile').fill('0400 000 000');

    // REQ-VUL-04. Disabled BEFORE anybody presses it (CLAUDE.md §6), with the
    // reason on screen — and the copy states the match rather than accusing,
    // because the match is name-based and can catch a namesake.
    const cont = page.getByTestId('assignor-continue');
    await expect(cont).toBeDisabled();
    await expect(page.getByTestId('assignor-refusal')).toContainText(
      'matches a member of practice staff',
    );
    await expect(page.getByTestId('assignor-refusal')).toContainText('If that is not you');
    // It never names the person or says how the match was made.
    await expect(page.getByTestId('assignor-refusal')).not.toContainText(STAFF_MEMBER_NAME);
    await expect(page.locator('main')).not.toContainText('REQ-VUL');
  });
});

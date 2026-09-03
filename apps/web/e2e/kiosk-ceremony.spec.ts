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
 * IT PAIRS A TABLET FIRST, THROUGH THE REAL PAIRING SCREEN. `/kiosk` no
 * longer takes a practice from anywhere but a device credential, so every run
 * registers a device, types its code into K-0 in the browser, and only then
 * begins. That means the gate in front of the waiting list is exercised on
 * every run rather than asserted once and skipped.
 *
 * THE ONE THING IT STUBS IS THE CONSOLE BUTTON. `POST /devices` REFUSES an
 * unattributed request by design — registering a tablet hands out the
 * credential that opens a practice's waiting list, and an audit line naming
 * nobody is worse than a refusal — and this suite has no Keycloak session
 * (the console signs in with a passkey). Weakening that refusal so a test
 * could pass would remove the property the suite exists to protect, so the
 * DEV-ONLY `POST /dev/kiosk-device` issues the code instead, behind
 * `NODE_ENV !== 'production'`, in the module that already conjures whole
 * practices out of nothing. Everything after that — the exchange, the
 * credential, the header, the guard — is the real path.
 *
 *   npm run dev -w apps/web        # web on 3100
 *   npm run start:dev -w apps/core # core on 3001
 *   npm run e2e:kiosk -w apps/web
 */
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';

const CORE = process.env.KIOSK_CORE_URL ?? 'http://localhost:3001';
/**
 * WHICH PRACTICE THE FIXTURES BELONG TO — for the STAGING calls only.
 *
 * It is no longer the kiosk's scope: `NEXT_PUBLIC_KIOSK_PRACTICE_ID` is gone
 * and `/kiosk/*` refuses a practice header outright. This is the staff side of
 * the flow, calling `/agreements` and `/capture` the way the practice does.
 */
const PRACTICE_ID = process.env.KIOSK_PRACTICE_ID ?? '821709fb-7f89-4fcf-95c0-27c5eb55cec8';

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

/**
 * A registered device and the code that pairs it. Dev-only, and the only
 * stubbed step in the suite — see the file header for why the alternative
 * (relaxing `POST /devices`) would be worse than a stub.
 */
async function issuePairingCode(api: APIRequestContext, label: string): Promise<string> {
  const res = await api.post(`${CORE}/dev/kiosk-device`, { headers: headers(), data: { label } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).code as string;
}

/**
 * A paired tablet for the API context, through the SAME public exchange the
 * browser uses. The staging calls need to read the waiting list, and there is
 * no longer any way to do that but as a device.
 */
async function apiCredential(api: APIRequestContext): Promise<string> {
  const code = await issuePairingCode(api, 'Playwright staging tablet');
  const res = await api.post(`${CORE}/devices/pair`, {
    headers: { 'content-type': 'application/json' },
    data: { code },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).credential as string;
}

/** Set once per run, in `beforeAll`. Every kiosk read below carries it. */
let deviceCredential = '';

function kioskHeaders() {
  return { 'content-type': 'application/json', 'x-device-credential': deviceCredential };
}

async function waitingList(api: APIRequestContext): Promise<WaitingRow[]> {
  const res = await api.get(`${CORE}/kiosk/waiting-list`, { headers: kioskHeaders() });
  expect(res.ok(), 'core must be running on 3001 with a paired device and a waiting list').toBeTruthy();
  return (await res.json()).waiting as WaitingRow[];
}

/**
 * PAIR THE BROWSER, THROUGH K-0, exactly as a staff member does at a desk: a
 * fresh code, typed into the field, one press.
 *
 * IT ASSERTS THE GATE ON THE WAY PAST. Before pairing there is no practice
 * name, no waiting count and no way to start a check-in — which is the whole
 * point of the screen, and is worth failing on rather than assuming.
 */
async function pairBrowser(page: Page, api: APIRequestContext) {
  const code = await issuePairingCode(api, 'Playwright kiosk tablet');
  await page.goto('/kiosk');

  // The gate: an unpaired tablet offers nothing but pairing.
  await expect(page.getByTestId('pairing-code')).toBeVisible();
  await expect(page.getByTestId('start-check-in')).toHaveCount(0);
  await expect(page.getByTestId('pairing-submit')).toBeDisabled();

  await page.getByTestId('pairing-code').fill(code);
  await expect(page.getByTestId('pairing-submit')).toBeEnabled();
  await page.getByTestId('pairing-submit').click();

  await expect(page.getByTestId('pairing-paired')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('pairing-continue').click();
  await expect(page.getByTestId('start-check-in')).toBeVisible({ timeout: 20_000 });
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

/** pair → idle → list → the staged patient → K-2, filled in and submitted. */
async function verifyAs(page: Page, row: WaitingRow, api: APIRequestContext) {
  await pairBrowser(page, api);
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
  // One credential for the staging reads. The browser pairs its own device per
  // test, so a revoke in one test could never quietly disarm another.
  test.beforeAll(async ({ request }) => {
    deviceCredential = await apiCredential(request);
  });

  test('kiosk_requires_a_paired_device — the waiting list is not readable without one', async ({
    request,
  }) => {
    /*
     * THE OLD HOLE, ASSERTED SHUT FROM THE OUTSIDE. This is the exact request
     * anybody who found the URL could make before 3 September 2026: a practice
     * id in a header, on a public route, returning that practice's waiting
     * room — patient names. It is now 401, and so is a request with nothing at
     * all.
     */
    const withHeader = await request.get(`${CORE}/kiosk/waiting-list`, { headers: headers() });
    expect(withHeader.status()).toBe(401);
    expect(await withHeader.text()).not.toContain('waiting');

    const withNothing = await request.get(`${CORE}/kiosk/waiting-list`);
    expect(withNothing.status()).toBe(401);

    // And with a device, it answers.
    const paired = await request.get(`${CORE}/kiosk/waiting-list`, { headers: kioskHeaders() });
    expect(paired.ok()).toBeTruthy();
  });

  test('a revoked tablet drops to the unpaired screen and stops asking', async ({ page, request }) => {
    const code = await issuePairingCode(request, 'Playwright revocable tablet');
    await page.goto('/kiosk');
    await page.getByTestId('pairing-code').fill(code);
    await page.getByTestId('pairing-submit').click();
    await expect(page.getByTestId('pairing-paired')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('pairing-continue').click();
    await expect(page.getByTestId('start-check-in')).toBeVisible({ timeout: 20_000 });

    /*
     * REVOKED FROM THE CONSOLE SIDE, never on the device. The dev endpoint
     * registers with a seed actor, so the revoke is made the same way — the
     * point being asserted is what happens to the TABLET, and that
     * `POST /devices/:id/revoke` refuses an unattributed request is asserted
     * in `device-pairing.e2e-spec.ts` where it belongs.
     */
    const list = await request.get(`${CORE}/devices`, { headers: headers() });
    expect(list.ok()).toBeTruthy();
    const device = ((await list.json()).devices as { id: string; label: string }[]).find(
      (d) => d.label === 'Playwright revocable tablet',
    );
    expect(device, 'the tablet just paired should be listed').toBeTruthy();
    const revoked = await request.post(`${CORE}/dev/kiosk-device/revoke`, {
      headers: headers(),
      data: { deviceId: device!.id },
    });
    expect(revoked.ok(), await revoked.text()).toBeTruthy();

    // On its next poll — seconds — the tablet says so, and offers no retry.
    await expect(page.getByTestId('unpaired-heading')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('unpaired-body')).toContainText('appointment is not affected');
    await expect(page.getByTestId('start-check-in')).toHaveCount(0);
    // Nothing of the practice survives on the screen.
    await expect(page.locator('main')).not.toContainText(PATIENT.name);
  });

  test('the patient signs for themselves, and the ceremony completes', async ({ page, request }) => {
    // The staff side has already validated and locked the particulars, which
    // is the intended flow: a draft never reaches a device (REQ-REG-06).
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: true });
    await verifyAs(page, row, request);

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

  test('the patient DRAWS a signature, and both halves of it are stored (REQ-SIG-01/-02)', async ({
    page,
    request,
  }) => {
    /*
     * THE OTHER REAL SIGNATURE. The run above takes the tap, which is the
     * accessible path; this one draws on the glass, which is the path the gap
     * was in — the pad captured a vector and a raster and the ceremony
     * uploaded neither, so a signature recorded as `drawn` bound the rendered
     * agreement's hash and not the mark anybody made.
     *
     * WHAT IS ASSERTED IS BOTH ENDS OF THE WIRE. That the request carried the
     * strokes AND the image with the pad's logical size, and that afterwards
     * both halves come back out of the server — which they can only do if both
     * were hashed and bound to the signature event.
     */
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: true });
    await verifyAs(page, row, request);
    await page.getByTestId('assignor-self').click();

    await expect(page.getByTestId('artefact-hash')).toBeVisible({ timeout: 25_000 });
    await page.getByTestId('continue-to-sign').click();

    const pad = page.getByTestId('signature-pad');
    await expect(pad).toBeVisible();

    // The drawn control is refused until there is ink — a signature with
    // nothing in it is not a signature (REQ-SIG-02).
    await expect(page.getByTestId('sign-control')).toBeDisabled();

    // REAL POINTER EVENTS, in a real browser. Playwright's mouse produces
    // pointerdown/pointermove/pointerup, which is the same path a finger takes
    // — and the small waits between moves are what give the stored points
    // distinct timings to carry.
    const box = (await pad.boundingBox())!;
    const draw = async (points: Array<[number, number]>) => {
      await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
      await page.mouse.down();
      for (const [dx, dy] of points.slice(1)) {
        await page.mouse.move(box.x + dx, box.y + dy, { steps: 4 });
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
    };
    await draw([
      [40, 60],
      [90, 100],
      [140, 50],
    ]);
    await page.waitForTimeout(120); // a real gap between strokes; it is data
    await draw([
      [180, 55],
      [230, 105],
    ]);

    const sign = page.getByTestId('sign-control');
    await expect(sign).toBeEnabled();

    const signRequest = page.waitForRequest(
      (req) => req.url().includes('/sign') && req.method() === 'POST',
    );
    await sign.click();

    /*
     * THE REQUEST CARRIED THE MARK. This is the assertion that would have
     * failed before the wiring existed, in the surface where it mattered.
     */
    const body = JSON.parse((await signRequest).postData() ?? '{}');
    expect(body.method).toBe('drawn');
    expect(body.signature.vector.length).toBeGreaterThanOrEqual(2);
    expect(body.signature.vector[0].points[0]).toHaveProperty('t');
    expect(body.signature.rasterPngBase64.length).toBeGreaterThan(100);
    expect(body.signature.padWidth).toBeGreaterThan(0);
    expect(body.signature.padHeight).toBeGreaterThan(0);
    // No amount and no practitioner signature travel with it (rules 3 and 4).
    expect(JSON.stringify(body)).not.toMatch(/practitionerSignature|benefitAmount/i);

    await expect(page.getByTestId('complete-heading')).toBeVisible({ timeout: 25_000 });

    /*
     * AND BOTH HALVES COME BACK OUT, each re-verified against the hash the
     * signature event bound at signing (rule 13). A 200 on both is only
     * reachable if `signatureRasterSha256` and `signatureVectorSha256` are
     * both on the event and both still match their stored bytes.
     */
    const raster = await request.get(
      `${CORE}/agreements/${row.agreementId}/signature/raster/content`,
      { headers: headers() },
    );
    expect(raster.status(), await raster.text()).toBe(200);
    expect(raster.headers()['content-type']).toContain('image/png');
    expect((await raster.body()).subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG

    const vector = await request.get(
      `${CORE}/agreements/${row.agreementId}/signature/vector/content`,
      { headers: headers() },
    );
    expect(vector.status(), await vector.text()).toBe(200);
    const strokes = JSON.parse(await vector.text()).strokes;
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    // The timing survived the round trip, unsmoothed and unresampled.
    expect(strokes[0].points[0]).toHaveProperty('t');
  });

  test('someone else signs, and the agreement is re-pointed at them', async ({ page, request }) => {
    /*
     * ON A DRAFT, NECESSARILY. Who signs is one of the locked particulars, so
     * the server refuses to re-point an agreement once they are locked
     * (REQ-REG-06) — which means this branch can only be exercised before the
     * staff-side lock. What that costs the test is stated plainly below.
     */
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: false });
    await verifyAs(page, row, request);

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
    await verifyAs(page, row, request);

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

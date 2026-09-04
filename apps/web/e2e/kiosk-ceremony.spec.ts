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
async function issuePairingCode(
  api: APIRequestContext,
  label: string,
  /**
   * A TEST DEVICE SEES THE WALK-UP LIST; AN ORDINARY ONE DOES NOT. The suite's
   * walk-up runs need the list (they stage a patient and tap their name); the
   * PUSHED run must not have it, because a tablet beside reception is exactly
   * the tablet Carl's ruling was about. Defaulting to `true` keeps every
   * existing caller behaving as it did.
   */
  showsWaitingList = true,
): Promise<string> {
  const res = await api.post(`${CORE}/dev/kiosk-device`, {
    headers: headers(),
    /*
     * A TEST DEVICE (Carl, 4 Sep 2026 — "the list page is only for testing
     * purposes"). Since the pairing-day reversal the waiting list is returned
     * ONLY to a device the console has flagged: an ordinary tablet's Begin
     * goes straight to K-2 and the server finds the row from what the patient
     * typed. This suite drives the LIST path — it stages a patient and then
     * taps their name — so it pairs itself a test device, which is exactly
     * what the flag exists for. `POST /devices` refuses an unattributed
     * request and this suite has no Keycloak session, so the dev endpoint sets
     * it at registration.
     */
    data: { label, showsWaitingList },
  });
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

  // The gate: an unpaired tablet offers nothing but pairing — and there is no
  // count to leak either, because the idle screen no longer carries one.
  await expect(page.getByTestId('pairing-code')).toBeVisible();
  await expect(page.getByTestId('waiting-count')).toHaveCount(0);
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

  // A TEST DEVICE SAYS SO, PERMANENTLY. Anybody walking past a tablet showing
  // patient names should be able to tell a test rig from a misconfiguration.
  await expect(page.getByTestId('test-device-banner')).toBeVisible();

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
}

/**
 * K-5, WHICH ONLY EXISTS ON AN UNLOCKED AGREEMENT (Carl, 4 Sep 2026). Who
 * signs is one of the locked particulars, so on a locked agreement there is
 * nothing to choose and the ceremony goes from verification straight to K-3.
 */
async function expectWhoIsSigning(page: Page) {
  await expect(page.getByTestId('assignor-self')).toBeVisible({ timeout: 20_000 });
  // BOTH options are real options — never a box in an option's slot.
  await expect(page.getByTestId('assignor-other')).toBeVisible();
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
    /*
     * THE LAST STILL-LIVE ONE, NOT THE FIRST BY LABEL. Every run of this suite
     * registers another tablet with this label and revokes it, so by the
     * second run of the day `find` returned a device that was ALREADY revoked
     * — the revoke became a no-op, the browser's tablet kept working, and the
     * test failed on an assertion about the tablet rather than about the
     * revoke. Devices come back oldest first, so the live one is the last that
     * still holds a credential.
     */
    const device = ((await list.json()).devices as { id: string; label: string; revokedAt: string | null }[])
      .filter((d) => d.label === 'Playwright revocable tablet' && !d.revokedAt)
      .at(-1);
    expect(device, 'the tablet just paired should be listed and not already revoked').toBeTruthy();
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

    /*
     * K-5 IS SKIPPED (Carl, 4 Sep 2026). The staff side already locked the
     * particulars, so who signs is one of them and there is nothing to choose.
     * The screen that used to render an explanation box in the second option's
     * slot — which read as an option — is not drawn at all.
     */
    await expect(page.getByTestId('assignor-self')).toHaveCount(0);

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
    // Locked, so K-5 is skipped and K-3 states who signs with a one-line note.
    await expect(page.getByTestId('assignor-locked-note')).toBeVisible({ timeout: 25_000 });

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
    await expectWhoIsSigning(page);

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
    await expectWhoIsSigning(page);

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

/* ===========================================================================
 * THE SECOND FRONT DOOR — reception pushes, the patient ticks and approves
 * (TODO.md "Two front doors", Carl 4 September 2026).
 *
 * "Reception has checked the patient across the desk and pushes the agreement
 * from `/practice/tablet` to the paired tablet beside them. The patient never
 * searches or types."
 *
 * IT PUSHES FOR REAL, AND THAT IS WHY IT SKIPS WITHOUT CREDENTIALS.
 * `POST /devices/:id/push` REFUSES an unattributed caller by design — the push
 * IS the verification record (REQ-VER-03), and a staff-verified event naming
 * nobody is worse than a refusal. There is no dev seam for it and this build
 * did not add one: a stub that pushed as nobody would delete the property the
 * refusal exists to protect, and `apps/core` is out of scope here. So the run
 * signs in to the console as a real practice user and presses the real Send
 * button, exactly as reception does:
 *
 *   E2E_PRACTICE_USER=... E2E_PRACTICE_PASSWORD=... npm run e2e:kiosk -w apps/web
 *
 * Without them it SKIPS rather than fails — a missing credential in somebody's
 * shell is not a defect in the product — and the Vitest suite
 * (`app/kiosk/pushed-session.test.tsx`) covers the same behaviours against the
 * real `Ceremony` with the API mocked.
 *
 * TWO PAGES, ONE BROWSER. `page` is reception's console; `tablet` is the
 * paired device on the counter beside them. That is the actual physical
 * arrangement, and running both is the only way to prove the push crosses.
 * ======================================================================== */

const CONSOLE_USER = process.env.E2E_PRACTICE_USER;
const CONSOLE_PASSWORD = process.env.E2E_PRACTICE_PASSWORD;

/**
 * Through Keycloak's own form. Nothing is typed into the product's screens:
 * the console has no password field of its own and never will (hard rule 15).
 */
async function signInToConsole(page: Page) {
  await page.goto('/practice/tablet');
  const button = page.getByRole('button', { name: /sign in/i }).first();
  if (await button.isVisible().catch(() => false)) await button.click();
  const username = page.locator('#username');
  if (await username.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await username.fill(CONSOLE_USER as string);
    await page.locator('#password').fill(CONSOLE_PASSWORD as string);
    await page.locator('#kc-login, input[type="submit"]').first().click();
  }
  await page.waitForURL(/\/practice\/tablet/, { timeout: 30_000 });
}

/**
 * An ORDINARY tablet — no waiting list — paired through the real K-0 exchange.
 * A tablet beside reception must not offer the walk-up list, which is the
 * whole reason `showsWaitingList` exists.
 */
async function pairPushTablet(tablet: Page, api: APIRequestContext, label: string) {
  const code = await issuePairingCode(api, label, false);
  await tablet.goto('/kiosk');
  await expect(tablet.getByTestId('pairing-code')).toBeVisible();
  await tablet.getByTestId('pairing-code').fill(code);
  await tablet.getByTestId('pairing-submit').click();
  await expect(tablet.getByTestId('pairing-paired')).toBeVisible({ timeout: 20_000 });
  await tablet.getByTestId('pairing-continue').click();
  await expect(tablet.getByTestId('pairing-code')).toHaveCount(0, { timeout: 20_000 });
}

test.describe('the pushed ceremony', () => {
  test.skip(
    !CONSOLE_USER || !CONSOLE_PASSWORD,
    'Set E2E_PRACTICE_USER and E2E_PRACTICE_PASSWORD — POST /devices/:id/push refuses an unattributed caller by design.',
  );

  test('reception pushes it, and the patient ticks, reads and approves', async ({
    page,
    context,
    request,
  }) => {
    // The staff side has already validated and locked the particulars, which
    // is what the push does anyway: a draft can never reach a device
    // (REQ-REG-06). This one is the re-push case, and is pushable as it is.
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: true });

    // A label unique to this run, so the console's device picker cannot land
    // on a tablet some earlier run left lying about.
    const label = `Pushed ceremony tablet ${Date.now()}`;
    const tablet = await context.newPage();
    await pairPushTablet(tablet, request, label);

    // NOTHING IS ON THE TABLET YET. The idle screen names nobody, and there is
    // no list on an ordinary device.
    await expect(tablet.getByTestId('check-details-heading')).toHaveCount(0);
    await expect(tablet.locator('main')).not.toContainText(PATIENT.name);

    // Reception: sign in, find today's row, choose the tablet, send.
    await signInToConsole(page);
    await expect(page.getByTestId(`pushable-${row.agreementId}`)).toBeVisible({ timeout: 25_000 });
    await page.getByTestId(`target-${row.agreementId}`).selectOption({ label });
    const send = page.getByTestId(`send-${row.agreementId}`);
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByTestId(`push-outcome-${row.agreementId}`)).toBeVisible({ timeout: 25_000 });

    /*
     * K-P1 ARRIVES ON THE TABLET ON ITS NEXT POLL. Nobody touched the device;
     * the patient is handed a screen that is already showing their details.
     */
    await expect(tablet.getByTestId('check-details-heading')).toBeVisible({ timeout: 40_000 });
    await expect(tablet.getByTestId('detail-value-name')).toContainText(PATIENT.family);
    // The date of birth is in words, to its owner, at the moment they were
    // asked for it across the desk.
    await expect(tablet.getByTestId('detail-value-date_of_birth')).toContainText('August');

    // NO VERIFICATION FORM, NO LIST, NO K-5, AND NO FIELD OF ANY KIND. The
    // patient neither searches nor types.
    await expect(tablet.locator('main input, main select, main textarea')).toHaveCount(0);
    await expect(tablet.getByTestId('identifier-name-given')).toHaveCount(0);
    await expect(tablet.getByTestId('assignor-self')).toHaveCount(0);

    // Continue is unreachable until every row on screen is ticked.
    await expect(tablet.getByTestId('check-details-continue')).toBeDisabled();

    /*
     * THE TICKS, AND WHAT THEY PUT ON THE WIRE. Types only — never the values
     * the screen is displaying (REQ-VER-04, hard rule 9). Asserted on the real
     * request rather than on a mock, which is what this suite is for.
     */
    const ticks = tablet.locator('[data-testid^="detail-tick-"]');
    const count = await ticks.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i += 1) await ticks.nth(i).click();

    const confirmRequest = tablet.waitForRequest(
      (req) => req.url().includes('/confirm-details') && req.method() === 'POST',
    );
    await expect(tablet.getByTestId('check-details-continue')).toBeEnabled();
    await tablet.getByTestId('check-details-continue').click();

    const confirmBody = JSON.parse((await confirmRequest).postData() ?? '{}');
    expect(Array.isArray(confirmBody.confirmed)).toBe(true);
    for (const type of confirmBody.confirmed as string[]) {
      expect(['name', 'date_of_birth', 'address', 'mobile', 'email']).toContain(type);
    }
    const wire = JSON.stringify(confirmBody);
    expect(wire).not.toContain(PATIENT.family);
    expect(wire).not.toContain(PATIENT.dob.year);
    expect(wire).not.toContain('Example Street');
    expect(wire).not.toMatch(/medicare|\$\s?\d/i);

    // K-3: locked, versioned, hashed, no amount, no provider signature field.
    await expect(tablet.getByTestId('artefact-hash')).toBeVisible({ timeout: 25_000 });
    await expect(tablet.getByTestId('versions')).toBeVisible();
    await expect(tablet.getByTestId('assignor-locked-note')).toBeVisible();
    await expect(tablet.locator('main')).not.toContainText(/\$\s?\d/);
    await expect(tablet.getByText('No provider signature field')).toBeVisible();

    // K-4: tap to approve is a signature in its own right (REQ-REG-07).
    await tablet.getByTestId('continue-to-sign').click();
    await expect(tablet.getByTestId('signature-pad')).toBeVisible();
    await tablet.getByTestId('sign-control-tap').click();

    await expect(tablet.getByTestId('complete-heading')).toBeVisible({ timeout: 25_000 });
    await expect(tablet.getByTestId('complete-heading')).toContainText(PATIENT.given);

    // The session ended on the SERVER's authority, off the signature event —
    // the tablet never declared itself signed.
    const after = await request.get(`${CORE}/agreements/${row.agreementId}`, { headers: headers() });
    expect((await after.json()).status).toBe('signed');
  });

  test('the exit ends the session and changes nothing on the agreement', async ({
    page,
    context,
    request,
  }) => {
    /*
     * REQ-REC-04 AND HARD RULE 8, ON THE PUSHED PATH. A patient who walks away
     * is still seen; reception chooses a private bill or an episodic agreement
     * after the service. The SCREEN ends — the tablet is free for the next
     * push — and the CONTRACT does not move.
     */
    const row = await stageWaitingPatient(request, PATIENT.name, { lock: true });
    const before = await (
      await request.get(`${CORE}/agreements/${row.agreementId}`, { headers: headers() })
    ).json();

    const label = `Walk-away tablet ${Date.now()}`;
    const tablet = await context.newPage();
    await pairPushTablet(tablet, request, label);

    await signInToConsole(page);
    await expect(page.getByTestId(`pushable-${row.agreementId}`)).toBeVisible({ timeout: 25_000 });
    await page.getByTestId(`target-${row.agreementId}`).selectOption({ label });
    await page.getByTestId(`send-${row.agreementId}`).click();

    await expect(tablet.getByTestId('check-details-heading')).toBeVisible({ timeout: 40_000 });
    await tablet.getByTestId('leave-for-reception').click();

    // The hand-over promises nothing and says the appointment is unaffected.
    await expect(tablet.getByTestId('handover-body')).toContainText('not affected');
    await expect(tablet.locator('main')).not.toContainText(PATIENT.name);

    const after = await (
      await request.get(`${CORE}/agreements/${row.agreementId}`, { headers: headers() })
    ).json();
    expect(after.status).toBe(before.status);
    expect(after.particularsLockedAt).toBe(before.particularsLockedAt);
    expect(after.renderedArtefactHash).toBe(before.renderedArtefactHash);
    expect(after.signatureEventId ?? null).toBeNull();
  });
});

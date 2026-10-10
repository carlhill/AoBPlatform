/**
 * THE CONTROLS FIT ON THE TABLET, WITHOUT SCROLLING (Carl, 10 Oct 2026, from a
 * real Samsung Galaxy Tab S10 Ultra in landscape, in Microsoft Edge).
 *
 * > Step 2 of 3: the last visible line is "Please read and tick each of
 * > these". The tick boxes are below the fold. Step 3 of 3: the action buttons
 * > are cut in half at the bottom.
 *
 * WHAT THIS PINS. At every landscape tablet viewport from 1024x600 to 1500x900
 * (Edge's top address bar AND bottom toolbar both take height, so 650 and 700
 * tall are real), and at one portrait size, each page of step 2 shows its tick
 * boxes and its Continue, and step 3 shows the signature pad with Back, Clear
 * and Sign, all FULLY inside the viewport and not clipped by any scroller,
 * with every scroller at the top — that is, without the patient scrolling.
 * Long read-only text may scroll inside its own region; the controls never do.
 *
 * NO DATABASE, NO CORE. Unlike `kiosk-ceremony.spec.ts` this spec does not
 * need the dev stack's API or Carl's `aobplatform` database: every request
 * that leaves the web server's own origin is answered here by `page.route`,
 * with obviously fake data, and anything it does not recognise is aborted
 * rather than allowed through. It needs only a web dev server:
 *
 *   NEXT_PUBLIC_CORE_URL=http://kiosk-core.invalid npx next dev -p <port>
 *   KIOSK_WEB_URL=http://localhost:<port> npx playwright test kiosk-tablet-fit
 *
 * `KIOSK_FIT_SHOTS=<dir>` additionally saves steps 1, 2 and 3 at 924x1478
 * (portrait, full screen) and 1478x924 (landscape, full screen).
 *
 * PORTRAIT FIRST (Carl, 10 Oct 2026: "yes switch to portrait first"). The 14"
 * tablet is used upright: 924x1478 full screen, 924x1370 with Edge's bars.
 * Landscape must still work — orientation is never locked (WCAG 1.3.4) — and
 * there the width is used rather than stacked ("there is so much white space
 * can we not do a better layout - instead of scrolling"). Step 1's Continue
 * is held to the same rule as steps 2 and 3.
 *
 * ZERO FOOTPRINT. The only thing put into the browser's storage is the fake
 * pairing credential, under the one key the kiosk may persist.
 */
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const WEB = process.env.KIOSK_WEB_URL ?? 'http://localhost:3100';
const WEB_ORIGIN = new URL(WEB).origin;
const SHOTS = process.env.KIOSK_FIT_SHOTS ?? '';
const SHOT_TAG = process.env.KIOSK_FIT_SHOT_TAG ?? 'run';

/** Portrait first — the 14" tablet upright — then the landscape sizes. */
const VIEWPORTS = [
  { width: 924, height: 1478 },
  { width: 924, height: 1370 },
  { width: 800, height: 1280 },
  { width: 1478, height: 924 },
  { width: 960, height: 600 },
  { width: 1024, height: 600 },
  { width: 1280, height: 650 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1478, height: 700 },
  { width: 1478, height: 813 },
  { width: 1500, height: 900 },
] as const;

/**
 * WHERE STEP 1 IS HELD TO "NO SCROLLING" TOO: the tablet upright, and on its
 * side from 1280x800 up. Five rows of two 56px answers, a heading and
 * Continue are taller than a 600-720px landscape screen with the browser's
 * bars; there step 1 scrolls, and steps 2 and 3 are still held to the rule.
 */
const STEP_1_FITS = ['924x1478', '924x1370', '800x1280', '1478x924', '1478x813', '1280x800', '1500x900'];

/** Where the before/after screenshots are taken. */
const SHOT_SIZES = ['924x1478', '1478x924'];

/* --------------------------------------------------------------------------
 * Obviously fake data. No Medicare-format number anywhere: the DB4 view
 * arrives already masked, exactly as the server sends it (hard rule 1).
 * ------------------------------------------------------------------------ */

const SESSION_ID = '00000000-0000-4000-8000-0000000000f1';
const AGREEMENT_ID = '00000000-0000-4000-8000-0000000000a1';
const PATIENT_ID = '00000000-0000-4000-8000-0000000000b1';

const STATEMENTS = [
  {
    key: 'episodic_assign_v1',
    text: 'I assign my right to the Medicare benefit for the service described above to Dr Sam Example.',
  },
  { key: 'episodic_details_correct_v1', text: 'I confirm the details above are correct.' },
];

const DB4 = {
  headingLines: [
    'MEDICARE - ONLINE CLAIMING',
    'BULK BILL ASSIGNMENT OF BENEFIT FORM',
    'This line stands in for the statutory line the practice prints under the title',
  ],
  formCode: 'DB4',
  formReference: 'TST0000012092026120300',
  serviceDate: '2026-10-10',
  servicingLocationName: 'Testville Family Medical Practice',
  servicingLocationAddressLines: ['78 Test Street', 'Testville NSW 2000'],
  patient: {
    givenNames: 'Alex',
    familyName: 'Testpatient',
    dateOfBirth: '1965-10-10',
    address: '18 Example St, Testville NSW 2000',
    patientRecordNumber: '00680',
    irn: '1',
  },
  providers: [{ role: 'servicing', name: 'Dr Sam Example', providerNumber: '0000000T' }],
  services: [
    { serviceDate: '2026-10-10', mbsItemNumber: '23', description: 'Level B Surgery', benefitAssigned: '45.05' },
  ],
  /* Stand-in words of roughly the length a practice's printed notice runs to. */
  privacyNotice: [
    'Stand-in privacy notice. The details on this form are collected so that the practice can make a claim on your behalf and keep a record of that claim. They are held securely and are used only for that purpose unless the law allows or requires otherwise.',
    'Stand-in privacy notice, second paragraph. You can ask the practice to see the details it holds about you, and to correct anything that is wrong. Reception can tell you how to do that and who to contact if you have a concern about how your details were handled.',
  ],
  statements: [
    {
      key: 'assign_to_health_professional',
      text: 'Stand-in assignment statement: I assign my right to benefits to the health professional who rendered the services listed on this form.',
    },
  ],
  sourceSha256: 'e'.repeat(64),
  printJobId: '00000000-0000-4000-8000-0000000000c1',
  parserTemplateVersion: 'test-template-1',
};

const AGREEMENT = {
  id: AGREEMENT_ID,
  type: 'episodic_pre',
  status: 'awaiting_signature',
  patientId: PATIENT_ID,
  assignorId: '00000000-0000-4000-8000-0000000000d1',
  assignorIsPatient: true,
  particulars: { patientName: 'Alex Testpatient', serviceDate: '2026-10-10' },
  ruleSetVersion: 'test-rules-1',
  mappingVersion: 'test-mapping-1',
  renderedArtefactHash: 'd'.repeat(64),
  particularsLockedAt: '2026-10-10T08:30:00.000Z',
  templateVersion: 'episodic-generic-1',
  renderPayload: { template: { statements: STATEMENTS } },
  db4Form: DB4,
};

const SESSION = {
  id: SESSION_ID,
  state: 'pushed',
  agreementType: 'episodic_pre',
  patient: {
    givenNames: 'Alex',
    familyName: 'Testpatient',
    dateOfBirth: '1965-10-10',
    address: '18 Example St, Testville NSW 2000',
    mobile: '0400 000 000',
    email: 'alexandra.testpatient-hyphenated-surname@example-health-services.invalid',
  },
  assignor: { isPatient: true },
  patientId: PATIENT_ID,
  detailsCheck: 'required',
  agreementId: AGREEMENT_ID,
  captureRequestId: '00000000-0000-4000-8000-0000000000e1',
};

const ME: Record<string, unknown> = {
  deviceId: '00000000-0000-4000-8000-000000000011',
  deviceLabel: 'Test tablet',
  practiceId: '00000000-0000-4000-8000-000000000021',
  practiceName: 'Testville Family Medical Practice',
  state: 'NSW',
  identifierTypes: ['name', 'date_of_birth', 'address'],
  showsWaitingList: false,
  acceptsWalkUps: false,
  reload: false,
};

/**
 * The fake core. Anything it does not recognise is refused, never forwarded.
 * `testDevice` turns on the blueprint panels, as a practice's test tablet has.
 */
async function answerCore(route: Route, testDevice: boolean): Promise<void> {
  const request = route.request();
  const cors = {
    'access-control-allow-origin': WEB_ORIGIN,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'access-control-expose-headers': 'etag',
  };
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: cors });
    return;
  }
  const json = (body: unknown, extra: Record<string, string> = {}) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ...cors, ...extra },
      body: JSON.stringify(body),
    });
  const path = new URL(request.url()).pathname;

  if (path === '/kiosk/me') return json({ ...ME, showsWaitingList: testDevice });
  if (path === '/kiosk/heartbeat') return json({ command: null, pollMs: 60_000, outOfUse: false, reload: false });
  if (path === '/kiosk/session') return json({ session: SESSION });
  if (path === `/kiosk/session/${SESSION_ID}/state`) return json({ id: SESSION_ID, state: 'reading' });
  if (path === `/kiosk/session/${SESSION_ID}/confirm-details`)
    return json({ id: SESSION_ID, state: 'details_confirmed' });
  if (path === `/agreements/${AGREEMENT_ID}`) return json(AGREEMENT);
  if (path === '/practice-users') return json({ users: [] });
  if (path === '/kiosk/waiting-list') {
    return json(
      {
        practiceId: ME.practiceId,
        revision: 'rev-1',
        pollMs: 60_000,
        identifierTypes: ME.identifierTypes,
        waiting: [],
        hidden: !testDevice,
        reload: false,
      },
      { etag: '"rev-1"' },
    );
  }
  await route.abort();
}

interface Walk {
  /** A practice's test tablet: the blueprint panels and the rail. */
  testDevice?: boolean;
  /** Android's font-size setting, as a percentage of the root size. */
  fontScale?: number;
}

async function openPairedKiosk(page: Page, walk: Walk): Promise<void> {
  await page.addInitScript((fontScale) => {
    window.localStorage.setItem('aob.kiosk.pairing', 'fake-device-credential');
    if (fontScale) {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = `${fontScale}%`;
      });
    }
  }, walk.fontScale ?? 0);
  await page.route(
    (url) => url.origin !== WEB_ORIGIN,
    (route) => answerCore(route, walk.testDevice === true),
  );
  await page.goto(`${WEB}/kiosk`);
}

/**
 * "WITHOUT SCROLLING" MADE MEASURABLE. Every scroller is put back to the top
 * first, because an earlier click may have scrolled one and the patient
 * arriving at a page has scrolled nothing. Then the control must lie fully
 * inside the viewport AND inside every ancestor that clips its overflow, the
 * window must not be scrollable, and nothing may be drawn over its centre.
 */
async function expectReachableWithoutScrolling(page: Page, control: Locator, name: string): Promise<void> {
  await expect(control, `${name} is rendered`).toBeVisible();
  const verdict = await control.evaluate((element) => {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      if (node.scrollTop !== 0) node.scrollTop = 0;
    }
    window.scrollTo(0, 0);

    const box = element.getBoundingClientRect();
    const problems: string[] = [];
    const describe = (r: DOMRect) =>
      `[${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}]`;
    if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) {
      problems.push(`outside the ${window.innerWidth}x${window.innerHeight} viewport at ${describe(box)}`);
    }
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent);
      // A box with `display: contents` has no box, so it clips nothing.
      if (overflow.display === 'contents') continue;
      if (overflow.overflowY === 'visible' && overflow.overflowX === 'visible') continue;
      const clip = parent.getBoundingClientRect();
      if (
        box.top < clip.top - 0.5 ||
        box.bottom > clip.bottom + 0.5 ||
        box.left < clip.left - 0.5 ||
        box.right > clip.right + 0.5
      ) {
        problems.push(`clipped by a scroller ${describe(clip)} at ${describe(box)}`);
        break;
      }
    }
    const root = document.scrollingElement ?? document.documentElement;
    if (root.scrollHeight > window.innerHeight + 1) problems.push(`the window scrolls (${root.scrollHeight}px tall)`);
    // The centre and four points just inside the corners: an overlap at one
    // edge is still a control the patient cannot see all of.
    const inset = 3;
    const points: Array<[number, number]> = [
      [box.left + box.width / 2, box.top + box.height / 2],
      [box.left + inset, box.top + inset],
      [box.right - inset, box.top + inset],
      [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset],
    ];
    for (const [x, y] of problems.length ? [] : points) {
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== element && !element.contains(hit)) {
        const what = hit.getAttribute('data-testid') ?? `${hit.tagName.toLowerCase()}.${hit.className}`;
        problems.push(`${what} is drawn over it at (${Math.round(x)},${Math.round(y)})`);
        break;
      }
    }
    return problems;
  });
  expect.soft(verdict, `${name} must be fully visible without scrolling`).toEqual([]);
}

/**
 * NOTHING IS WIDER THAN THE SCREEN (Carl, 10 Oct 2026: on the tablet only "Se"
 * of "See reception" showed at the right edge). The page must not scroll
 * sideways, and because the shell clips its own overflow, the page's width is
 * not enough on its own: no element may END past the right edge either. The
 * deepest offenders are named, so a failure says which element forced it.
 * Then the exit itself must be fully on screen.
 */
async function expectNoHorizontalOverflow(page: Page, step: string): Promise<void> {
  const offenders = await page.evaluate(() => {
    const limit = window.innerWidth + 0.5;
    const root = document.scrollingElement ?? document.documentElement;
    const found: string[] = [];
    if (root.scrollWidth > window.innerWidth) found.push(`the page is ${root.scrollWidth}px wide`);
    const visual = window.visualViewport;
    if (visual && (visual.scale !== 1 || visual.width < window.innerWidth - 1)) {
      found.push(`the browser shows ${Math.round(visual.width)}px of a ${window.innerWidth}px layout`);
    }
    const wide = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(
      (el) => el.getClientRects().length > 0 && el.getBoundingClientRect().right > limit,
    );
    for (const el of wide.filter((el) => !wide.some((other) => other !== el && el.contains(other))).slice(0, 3)) {
      const label = el.getAttribute('data-testid') ?? `${el.tagName.toLowerCase()}.${el.className}`;
      found.push(`${label} ends at ${Math.round(el.getBoundingClientRect().right)}px`);
    }
    return found;
  });
  expect.soft(offenders, `${step}: nothing may be wider than the ${page.viewportSize()?.width}px screen`).toEqual([]);
  await expectReachableWithoutScrolling(page, page.getByTestId('leave-for-reception'), `${step} See reception`);
}

/** A tick box is the box AND the words it ticks, so the whole row must show. */
function tickRow(page: Page, key: string): Locator {
  return page.getByTestId(`affirm-${key}`).locator('xpath=..');
}

async function shot(page: Page, size: { width: number; height: number }, label: string): Promise<void> {
  const name = `${size.width}x${size.height}`;
  if (!SHOTS || !SHOT_SIZES.includes(name)) return;
  await page.evaluate(() => {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('*'))) node.scrollTop = 0;
  });
  await page.screenshot({ path: `${SHOTS}/kiosk-fit-${SHOT_TAG}-${label}-${name}.png` });
}

async function walkTheCeremony(page: Page, size: { width: number; height: number }, walk: Walk = {}): Promise<void> {
  const shots = !walk.testDevice && !walk.fontScale;
  await page.setViewportSize(size);
  await openPairedKiosk(page, walk);

  // K-P1, step 1 — every row's two answers and Continue, all on screen.
  await expect(page.getByTestId('check-details-heading')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'K-P1');
  if (shots) await shot(page, size, 'step1');
  const ticks = await page.locator('[data-testid^="detail-tick-"]').all();
  const step1Fits = STEP_1_FITS.includes(`${size.width}x${size.height}`);
  for (const [index, tick] of step1Fits ? ticks.entries() : []) {
    await expectReachableWithoutScrolling(page, tick, `K-P1 "that's right" ${index + 1}`);
  }
  const crosses = step1Fits ? await page.locator('[data-testid^="detail-cross-"]').all() : [];
  for (const [index, cross] of crosses.entries()) {
    await expectReachableWithoutScrolling(page, cross, `K-P1 "that's wrong" ${index + 1}`);
  }
  if (step1Fits) {
    await expectReachableWithoutScrolling(page, page.getByTestId('check-details-continue'), 'K-P1 Continue');
  }
  for (const tick of ticks) await tick.click();
  if (step1Fits) {
    await expectReachableWithoutScrolling(page, page.getByTestId('check-details-continue'), 'K-P1 Continue, ticked');
  }
  await page.getByTestId('check-details-continue').click();

  // 2A — no tick boxes by construction; its Continue must show.
  await expect(page.getByTestId('particulars-heading')).toBeVisible();
  await expect(page.getByTestId('db4-page-of')).toHaveText(/1/);
  await expectNoHorizontalOverflow(page, '2A');
  await expectReachableWithoutScrolling(page, page.getByTestId('db4-page-continue'), '2A Continue');
  await page.getByTestId('db4-page-continue').click();

  // 2B — the services page and its one tick.
  await expect(page.getByTestId('affirm-episodic_details_correct_v1')).toBeVisible();
  await expectNoHorizontalOverflow(page, '2B');
  await expectReachableWithoutScrolling(page, tickRow(page, 'episodic_details_correct_v1'), '2B tick box');
  await expectReachableWithoutScrolling(page, page.getByTestId('db4-page-continue'), '2B Continue');
  await page.getByTestId('affirm-episodic_details_correct_v1').check();
  await page.getByTestId('db4-page-continue').click();

  // 2C — the legal page Carl photographed, its tick and Continue to sign.
  await expect(page.getByTestId('affirm-episodic_assign_v1')).toBeVisible();
  await expectNoHorizontalOverflow(page, '2C');
  if (shots) await shot(page, size, 'step2');
  await expectReachableWithoutScrolling(page, tickRow(page, 'episodic_assign_v1'), '2C tick box');
  await expectReachableWithoutScrolling(page, page.getByTestId('continue-to-sign'), '2C Continue to sign');
  await page.getByTestId('affirm-episodic_assign_v1').check();
  await expect(page.getByTestId('continue-to-sign')).toBeEnabled();
  await page.getByTestId('continue-to-sign').click();

  // Step 3 — the pad, Back, Clear and Sign.
  await expect(page.getByTestId('signature-pad')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'Step 3');
  if (shots) await shot(page, size, 'step3');
  await expectReachableWithoutScrolling(page, page.getByTestId('signature-pad'), 'signature pad');
  await expectReachableWithoutScrolling(page, page.getByTestId('signature-back'), 'Back');
  await expectReachableWithoutScrolling(page, page.getByTestId('signature-clear'), 'Clear');
  await expectReachableWithoutScrolling(page, page.getByTestId('sign-control'), 'Sign');
}

for (const size of VIEWPORTS) {
  test(`kiosk_primary_controls_fit_without_scrolling_at_${size.width}x${size.height}`, async ({ page }) => {
    await walkTheCeremony(page, size);
  });
}

/*
 * AND AS AN ANDROID TABLET. `isMobile` makes Chromium honour the viewport
 * meta tag and lay out against a mobile layout viewport, which is where a
 * page that is a few pixels too wide stops being a scroll bar and becomes a
 * shell drawn wider than the glass, with "See reception" cut off at the edge.
 */
test.describe('as an Android tablet', () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const size of [
    { width: 960, height: 600 },
    { width: 1280, height: 720 },
    { width: 1478, height: 700 },
  ]) {
    test(`kiosk_is_never_wider_than_an_android_tablet_at_${size.width}x${size.height}`, async ({ page }) => {
      await walkTheCeremony(page, size);
    });
  }
});

/*
 * A PRACTICE'S TEST TABLET draws the blueprint panels and puts the actions in
 * a rail. Side by side it must fit like any other; stacked (under 1024px) the
 * document must not be squeezed into a few-line box of its own.
 */
test.describe('on a test device', () => {
  for (const size of [
    { width: 1478, height: 924 },
    { width: 1280, height: 800 },
  ]) {
    test(`kiosk_test_device_controls_fit_at_${size.width}x${size.height}`, async ({ page }) => {
      await walkTheCeremony(page, size, { testDevice: true });
    });
  }

  test('kiosk_test_device_stacked_never_squeezes_the_document_text', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await openPairedKiosk(page, { testDevice: true });
    await expect(page.getByTestId('check-details-heading')).toBeVisible();
    for (const tick of await page.locator('[data-testid^="detail-tick-"]').all()) await tick.click();
    await page.getByTestId('check-details-continue').click();
    const region = page.getByTestId('particulars-scroll');
    await expect(region).toBeVisible();
    const trapped = await region.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
    expect(trapped, 'stacked, the document text scrolls with the step, not in a box of its own').toBe(false);
    await expectNoHorizontalOverflow(page, '2A stacked');
  });
});

/*
 * ANDROID'S FONT-SIZE SETTING. The kiosk's type is in rem, so a patient's
 * larger text setting enlarges everything. Upright and full screen the
 * controls must still fit, and nothing may be pushed off the right edge.
 */
test('kiosk_fits_with_android_text_at_130_percent_at_924x1478', async ({ page }) => {
  await walkTheCeremony(page, { width: 924, height: 1478 }, { fontScale: 130 });
});

/*
 * REFLOW AT 400% (WCAG 2.2 SC 1.4.10): a 1280x800 screen zoomed to 400% is a
 * 320x200 CSS viewport. One column, no sideways scrolling, and every control
 * — the exit included — can be scrolled into view: nothing is trapped outside
 * every scroller.
 */
test('kiosk_reflows_at_400_percent_zoom', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 200 });
  await openPairedKiosk(page, {});
  const reachable = async (control: Locator, name: string) => {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect.soft(box, `${name} is laid out`).not.toBeNull();
    if (!box) return;
    const inView = box.y >= -0.5 && box.y + box.height <= 200.5 && box.x >= -0.5 && box.x + box.width <= 320.5;
    expect.soft(inView, `${name} can be scrolled fully into view at 400%`).toBe(true);
  };
  const noSideways = async (step: string) => {
    const wide = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth > window.innerWidth;
    });
    expect.soft(wide, `${step}: no sideways scrolling at 400%`).toBe(false);
  };
  await expect(page.getByTestId('check-details-heading')).toBeAttached();
  await noSideways('K-P1');
  await reachable(page.getByTestId('leave-for-reception'), 'K-P1 See reception');
  for (const tick of await page.locator('[data-testid^="detail-tick-"]').all()) await tick.click();
  await reachable(page.getByTestId('check-details-continue'), 'K-P1 Continue');
  await page.getByTestId('check-details-continue').click();
  await expect(page.getByTestId('particulars-heading')).toBeAttached();
  await noSideways('2A');
  await reachable(page.getByTestId('db4-page-continue'), '2A Continue');
  await page.getByTestId('db4-page-continue').click();
  await page.getByTestId('affirm-episodic_details_correct_v1').check();
  await page.getByTestId('db4-page-continue').click();
  // The box itself: at 320px its sentence may be taller than the screen.
  await reachable(page.getByTestId('affirm-episodic_assign_v1'), '2C tick box');
  await page.getByTestId('affirm-episodic_assign_v1').check();
  await reachable(page.getByTestId('continue-to-sign'), '2C Continue to sign');
  await page.getByTestId('continue-to-sign').click();
  await expect(page.getByTestId('signature-pad')).toBeAttached();
  await noSideways('Step 3');
  await reachable(page.getByTestId('signature-pad'), 'signature pad');
  await reachable(page.getByTestId('sign-control'), 'Sign');
  await reachable(page.getByTestId('leave-for-reception'), 'Step 3 See reception');
});

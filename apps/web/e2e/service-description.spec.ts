/**
 * D6a ON THE STAFF SURFACE, END TO END, AGAINST A REAL CORE.
 *
 * The kiosk spec next door proves the ceremony joins up. This proves the OTHER
 * half of the same ruling: when a pre-agreement reaches the tablet without a
 * Basic Service Description, the tablet hands over and staff fix it on a staff
 * screen, "where their identity is recorded" (Carl, 3 Sep 2026). This drives
 * that screen.
 *
 * IT NEEDS A SIGNED-IN PRACTICE SESSION AND CANNOT FAKE ONE, and that is the
 * point rather than an inconvenience. `POST /service-descriptions/agreements/:id`
 * REFUSES a request carrying no signed-in user — an audit line naming nobody is
 * worse than a refusal — so a spec that ran without one would be proving the
 * refusal, not the feature. Supply the dev realm's practice account:
 *
 *   E2E_PRACTICE_USER=... E2E_PRACTICE_PASSWORD=... npm run e2e:service-description -w apps/web
 *
 * Without them the suite SKIPS with this reason rather than failing, because a
 * missing credential in somebody's shell is not a defect in the product.
 *
 *   npm run dev -w apps/web        # web on 3100
 *   npm run start:dev -w apps/core # core on 3001
 *
 * IT STAGES ITS OWN DRAFT, like the kiosk spec, so the second run of the day
 * does not fail because the first consumed the row it wanted.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const CORE = process.env.KIOSK_CORE_URL ?? 'http://localhost:3001';
const PRACTICE_ID = process.env.NEXT_PUBLIC_KIOSK_PRACTICE_ID ?? '821709fb-7f89-4fcf-95c0-27c5eb55cec8';
const USER = process.env.E2E_PRACTICE_USER;
const PASSWORD = process.env.E2E_PRACTICE_PASSWORD;

/** The exact words the mapping holds. Chosen through the UI, never typed. */
const DESCRIPTION = 'General practitioner attendance';

function headers() {
  return { 'content-type': 'application/json', 'x-practice-id': PRACTICE_ID };
}

/**
 * A fresh `episodic_pre` draft with no description, built from a waiting row so
 * the patient, provider and assignor ids are the practice's own rather than
 * invented. Morgan Placeholder is the seeded patient whose pre-agreement lacks
 * D6a; any waiting row will do.
 */
async function stageDraftWithoutDescription(api: APIRequestContext): Promise<string> {
  const list = await api.get(`${CORE}/kiosk/waiting-list`, { headers: headers() });
  expect(list.ok(), 'core must be running on 3001 with a waiting list').toBeTruthy();
  const rows = (await list.json()).waiting as { agreementId: string }[];
  expect(rows.length, `seed a waiting patient in ${PRACTICE_ID} first`).toBeGreaterThan(0);

  const existing = await api.get(`${CORE}/agreements/${rows[0].agreementId}`, { headers: headers() });
  expect(existing.ok()).toBeTruthy();
  const source = await existing.json();

  const created = await api.post(`${CORE}/agreements`, {
    headers: headers(),
    data: {
      type: 'episodic_pre',
      providerId: source.providerId,
      patientId: source.patientId,
      assignorId: source.patientAssignorId ?? source.assignorId,
      assignorIsPatient: true,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  return (await created.json()).id as string;
}

/**
 * Through Keycloak's own form, with credentials from the environment. Nothing
 * is typed into the product's screens: the console has no password field of
 * its own and never will (hard rule 15).
 */
async function signIn(page: Page) {
  await page.goto('/practice/reconciliation');
  const signIn = page.getByRole('button', { name: /sign in/i }).first();
  if (await signIn.isVisible().catch(() => false)) await signIn.click();

  const username = page.locator('#username');
  if (await username.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await username.fill(USER as string);
    await page.locator('#password').fill(PASSWORD as string);
    await page.locator('#kc-login, input[type="submit"]').first().click();
  }
  await page.waitForURL(/\/practice\/reconciliation/, { timeout: 30_000 });
}

test.describe('the practice sets D6a where the PMS could not', () => {
  test.skip(
    !USER || !PASSWORD,
    'Set E2E_PRACTICE_USER and E2E_PRACTICE_PASSWORD — the endpoint refuses an unattributed request by design.',
  );

  test('a draft without a description shows a select, and choosing one clears the row', async ({
    page,
    request,
  }) => {
    const agreementId = await stageDraftWithoutDescription(request);

    await signIn(page);

    const row = page.getByTestId(`sd-row-${agreementId}`);
    await expect(row).toBeVisible({ timeout: 20_000 });

    /*
     * THE OPTIONS CAME FROM THE SERVER. If somebody ever hardcodes the list in
     * the component this still passes — the Vitest suite is what catches that.
     * What this asserts is the pairing: the exact string the rules engine
     * matches is choosable here, so the two really are in step on a live stack.
     */
    const select = page.getByTestId(`sd-select-${agreementId}`);
    await expect(select).toBeEnabled();
    await select.selectOption(DESCRIPTION);

    await page.getByTestId(`sd-set-${agreementId}`).click();

    // The row leaves the "needed" state because the SERVER stops returning it.
    await expect(page.getByTestId(`sd-row-${agreementId}`)).toHaveCount(0, { timeout: 20_000 });

    // And the description really is on the agreement, ready for the lock the
    // tablet will do — with no description of its own to send.
    const after = await request.get(`${CORE}/agreements/${agreementId}`, { headers: headers() });
    expect(after.ok()).toBeTruthy();
    const agreement = await after.json();
    expect(agreement.serviceDescription).toBe(DESCRIPTION);
    expect(agreement.serviceDescriptionSetBy, 'the acting staff member is recorded').toBeTruthy();
    // Setting a particular is not locking one: the assignor can still be
    // re-pointed at the tablet.
    expect(agreement.particularsLockedAt).toBeNull();
  });

  test('the screen never shows an amount and never claims the form is approved', async ({ page, request }) => {
    await stageDraftWithoutDescription(request);
    await signIn(page);

    const section = page.getByTestId('service-descriptions-needed');
    await expect(section).toBeVisible({ timeout: 20_000 });
    const text = (await section.innerText()).toLowerCase();
    expect(text).not.toMatch(/\$|certified|accredited|government-approved/);
  });
});

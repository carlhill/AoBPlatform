/**
 * E2E RUNS OFFLINE AGAINST THE AUSTRALIAN BUSINESS REGISTER. Always, unless
 * asked otherwise in as many words.
 *
 * The moment a GUID landed in `apps/core/.env` (4 September 2026), every e2e
 * suite that registers an organisation quietly changed behaviour: `ConfigModule`
 * loads that file, so the onboarding suites stopped exercising the offline
 * fixtures and started making real requests to a Commonwealth service — with
 * ABNs invented for tests, at whatever rate CI happens to run.
 *
 * Two things wrong with that, and they compound. The tests become
 * NON-DETERMINISTIC: `53004085616` is a real, active ABN belonging to a real
 * company, so a suite that expects the attestation path gets a live answer and
 * a name-match failure instead — a red build caused by nothing in the diff. And
 * it is DISCOURTEOUS AT BEST: our GUID is a registered consumer's credential,
 * and spending it on a test loop is how it stops being ours.
 *
 * So this clears the GUID before any suite builds a Nest application, which
 * puts the ABR client back on `OfflineAbrClient` and its three fixtures.
 *
 * THE ONE EXIT IS EXPLICIT: `ABR_LIVE_TEST=1` leaves the environment alone, so
 * `abr.live.e2e-spec.ts` — the only suite that means to call the real service —
 * can run on a laptop, deliberately, one command at a time.
 */
/*
 * SET TO EMPTY, NOT DELETED, and the difference is the whole trick.
 * `ConfigModule` merges `.env` into `process.env` with "only if not already
 * present", so a deleted key is simply re-read from the file a moment later
 * and the guard achieves nothing. A key that is present and empty survives the
 * merge, and the client factory treats empty as unconfigured.
 */
if (process.env.ABR_LIVE_TEST !== '1') {
  process.env.ABR_API_GUID = '';
  process.env.ABR_GUID = '';
}

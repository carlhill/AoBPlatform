import { AbrWebServicesClient } from '../src/organisations/abr';

/**
 * THE ONE TEST IN THIS REPO THAT TOUCHES THE REAL AUSTRALIAN BUSINESS REGISTER.
 *
 * It is opt-in twice over — a GUID must be configured AND `ABR_LIVE_TEST=1`
 * must be set — so it does not run in CI and does not run by accident on a
 * laptop that happens to have credentials in its environment. Both conditions,
 * because either one alone is something a person could have set for an
 * unrelated reason.
 *
 * WHY IT EXISTS WHEN THE MAPPER IS ALREADY TESTED. The mapper is tested
 * against a RECORDING, which proves we parse what the service sent in
 * September 2026 and proves nothing about what it sends today. This is the
 * check that the endpoint still exists, that our GUID is still recognised, and
 * that the shape has not moved under us. Run it before a release, and after
 * any change to the client.
 *
 *   ABR_LIVE_TEST=1 npm run test:e2e -w apps/core -- abr.live
 *
 * WHAT IT ASSERTS is deliberately thin: an ACTIVE status and a non-empty legal
 * name for a well-known public body. Asserting the exact name or address would
 * make a test that fails when the ABR corrects a record, which is the register
 * doing its job.
 *
 * THE SUBJECT IS THE AUSTRALIAN TAXATION OFFICE'S OWN ABN — a public entity,
 * chosen so that a live test never queries a person.
 */

const GUID = (process.env.ABR_API_GUID ?? process.env.ABR_GUID ?? '').trim();
const ENABLED = GUID.length > 0 && process.env.ABR_LIVE_TEST === '1';

/** ABN 51 824 753 556 — the Australian Taxation Office. */
const ATO_ABN = '51824753556';

const suite = ENABLED ? describe : describe.skip;

suite('the live ABN Lookup service', () => {
  // Ten seconds: this is a real network call to a service we do not run, and
  // a flake here should be a slow answer, not a five-second client timeout.
  const client = new AbrWebServicesClient(GUID, process.env.ABR_BASE_URL ?? 'https://abr.business.gov.au/json', 10_000);

  it('answers for a well-known public ABN', async () => {
    const probe = await client.probe(ATO_ABN);

    if (probe.status !== 'found') {
      // Name the fault rather than a bare boolean. `register_refused` means our
      // GUID; `timeout` and `network` mean theirs or the network's.
      throw new Error(`The register did not answer: ${probe.status} (${probe.reason}).`);
    }

    expect(probe.lookup.abn).toBe(ATO_ABN);
    expect(probe.lookup.abnStatus).toBe('ACTIVE');
    expect(probe.lookup.legalName.length).toBeGreaterThan(0);
    // Never assert on the payload beyond this, and never print it: a live
    // response is real register data, and a CI log is not where it belongs.
  }, 30_000);

  it('reports a checksum-valid but unissued ABN as absent, not as unreachable', async () => {
    const probe = await client.probe('13824753558');
    expect(probe.status).toBe('not_found');
  }, 30_000);
});

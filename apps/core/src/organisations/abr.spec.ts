import { AbrWebServicesClient, OfflineAbrClient, mapAbnDetails, mapEntityType, unwrapJsonp } from './abr';
import recorded from './__fixtures__/abr-ato.json';

/**
 * The mapper, tested against ONE REAL RECORDED RESPONSE.
 *
 * The fixture in `__fixtures__/abr-ato.json` is the Australian Taxation
 * Office's own ABN, fetched from the live service on 4 September 2026 with the
 * GUID stripped from the recorded URL. A public body was chosen deliberately:
 * recording a real response means recording a real entity, and this one is
 * nobody's personal information.
 *
 * WHY A RECORDING RATHER THAN A HAND-WRITTEN FIXTURE. The previous version of
 * this client was written from documentation and carried a comment admitting
 * its field names were a hypothesis. Two of them would have been wrong in
 * ways no unit test built on the same hypothesis could catch: the body is
 * JSONP rather than JSON, and `Gst` is a DATE, so `Boolean(data.Gst)` was
 * accidentally right and `data.Gst === true` would have been silently false
 * for every GST-registered practice in the country.
 */
describe('the ABN Lookup response mapper', () => {
  const body = recorded.body as string;
  const payload = JSON.parse(unwrapJsonp(body));

  it('strips the JSONP padding the JSON endpoints answer with', () => {
    expect(body.startsWith('callback(')).toBe(true);
    expect(() => JSON.parse(body)).toThrow();
    expect(payload.Abn).toBe('51824753556');
  });

  it('maps a recorded live response onto our vocabulary', () => {
    const mapped = mapAbnDetails(payload);
    expect(mapped).not.toBeNull();
    expect(mapped!.abn).toBe('51824753556');
    expect(mapped!.abnStatus).toBe('ACTIVE');
    expect(mapped!.legalName).toBe('AUSTRALIAN TAXATION OFFICE');
    expect(mapped!.abnStatusEffectiveFrom).toBe('1999-11-01');
    expect(mapped!.mainBusinessState).toBe('NSW');
    expect(mapped!.mainBusinessPostcode).toBe('2640');
  });

  it('reads GST registration from a DATE, not a boolean', () => {
    expect(payload.Gst).toBe('2000-07-01');
    expect(mapAbnDetails(payload)!.gstRegistered).toBe(true);
    expect(mapAbnDetails({ ...payload, Gst: null })!.gstRegistered).toBe(false);
    expect(mapAbnDetails({ ...payload, Gst: '' })!.gstRegistered).toBe(false);
  });

  it('reports no ACN for an entity that has none, rather than an empty string', () => {
    expect(payload.Acn).toBe('');
    expect(mapAbnDetails(payload)!.acn).toBeUndefined();
    expect(mapAbnDetails({ ...payload, Acn: '004085616' })!.acn).toBe('004085616');
  });

  /**
   * THE TRADING-NAME RULE, as a test.
   *
   * The ABR stopped collecting trading names in May 2012. `BusinessName` on
   * this method carries registered business names, which are current; there is
   * no second array here and there must never be one, because a name somebody
   * last used in 2011 is not evidence that a typed practice name identifies
   * this entity.
   */
  it('takes registered business names only', () => {
    const withNames = mapAbnDetails({
      ...payload,
      BusinessName: ['Sampletown Family Practice', '  Sampletown Skin Clinic  ', ''],
    });
    expect(withNames!.businessNames).toEqual(['Sampletown Family Practice', 'Sampletown Skin Clinic']);
  });

  it('maps entity-type descriptions conservatively, and unknown ones to OTHER', () => {
    expect(mapEntityType('Australian Private Company')).toBe('PTY_LTD');
    expect(mapEntityType('Australian Public Company')).toBe('PUBLIC_COMPANY');
    expect(mapEntityType('Individual/Sole Trader')).toBe('INDIVIDUAL_SOLE_TRADER');
    expect(mapEntityType('Discretionary Trading Trust')).toBe('TRUST');
    // The recorded response: a Commonwealth Government Entity is not one of
    // ours, and lands in human validation rather than being guessed at.
    expect(mapEntityType(payload.EntityTypeName)).toBe('OTHER');
  });

  /**
   * Every refusal the register makes arrives as HTTP 200 with a `Message`.
   * Mapping one of these would produce a nameless ACTIVE entity — which is
   * exactly the shape a gate would wave through.
   */
  it.each([
    ['No record found'],
    ['Search text is not a valid ABN or ACN'],
    ['The GUID entered is not recognised as a Registered Party'],
  ])('refuses to map a response carrying the message %s', (message) => {
    expect(mapAbnDetails({ ...payload, Message: message })).toBeNull();
  });
});

/**
 * The live client's behaviour on every unhappy path, with `fetch` stubbed.
 * No network is touched here; the guarded smoke test in
 * `test/abr.live.e2e-spec.ts` is the only thing in the repo that calls the
 * real service.
 */
describe('the live ABN Lookup client', () => {
  const realFetch = global.fetch;
  const client = new AbrWebServicesClient('not-a-real-guid');

  const answer = (body: string, status = 200) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }) as unknown as typeof fetch;
  };

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('finds an entity from a JSONP body', async () => {
    answer(recorded.body as string);
    const probe = await client.probe('51 824 753 556');
    expect(probe.status).toBe('found');
    expect(probe.status === 'found' && probe.lookup.legalName).toBe('AUSTRALIAN TAXATION OFFICE');
  });

  it('sends the ABN with spaces and punctuation stripped', async () => {
    answer(recorded.body as string);
    await client.lookup('51 824 753 556');
    const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('abn=51824753556');
  });

  /**
   * "The register has no record" and "we could not reach the register" are
   * different answers with different next steps for the applicant. Collapsing
   * them is the generic-message defect (Carl, 4 September 2026).
   */
  it('separates a register that answered NO from a register that did not answer', async () => {
    answer('callback({"Abn":"13824753558","Message":"No record found"})');
    expect(await client.probe('13824753558')).toEqual({ status: 'not_found', reason: 'no_record' });

    answer('callback({"Abn":"","Message":"Search text is not a valid ABN or ACN"})');
    expect(await client.probe('12345678901')).toEqual({ status: 'not_found', reason: 'invalid_search_text' });
  });

  /**
   * OUR credential being refused must never present as the applicant's ABN
   * being wrong. It is unreachable, so they get the attestation path and an
   * operator gets the log line.
   */
  it('treats a rejected GUID as unreachable, not as a bad ABN', async () => {
    answer('callback({"Abn":"","Message":"The GUID entered is not recognised as a Registered Party"})');
    expect(await client.probe('51824753556')).toEqual({ status: 'unreachable', reason: 'register_refused' });
  });

  it('treats an unrecognised message as unreachable rather than as absence', async () => {
    answer('callback({"Abn":"","Message":"Service temporarily unavailable"})');
    expect((await client.probe('51824753556')).status).toBe('unreachable');
  });

  it.each([
    ['an HTTP error', () => answer('', 503), 'http_error'],
    ['an unparseable body', () => answer('<html>maintenance</html>'), 'unparseable'],
  ])('returns unreachable for %s', async (_label, arrange, reason) => {
    arrange();
    expect(await client.probe('51824753556')).toEqual({ status: 'unreachable', reason });
  });

  it('never throws into onboarding when the network fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(client.lookup('51824753556')).resolves.toBeNull();
    expect(await client.probe('51824753556')).toEqual({ status: 'unreachable', reason: 'network' });
  });

  it('gives up after the timeout rather than holding the applicant', async () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    global.fetch = jest.fn().mockRejectedValue(aborted) as unknown as typeof fetch;
    expect(await client.probe('51824753556')).toEqual({ status: 'unreachable', reason: 'timeout' });
  });
});

describe('the offline client', () => {
  const offline = new OfflineAbrClient();

  /**
   * A fixture miss is not "the register has no record" — this client never
   * asked the register anything. Saying otherwise would tell an applicant
   * their ABN does not exist on the strength of a lookup that never happened.
   */
  it('reports an unconfigured environment, never an absent entity', async () => {
    expect(await offline.probe('51824753556')).toEqual({
      status: 'found',
      lookup: expect.objectContaining({ abnStatus: 'ACTIVE' }),
    });
    expect(await offline.probe('99999999999')).toEqual({ status: 'unreachable', reason: 'not_configured' });
  });
});

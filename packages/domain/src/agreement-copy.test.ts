
import {
  AGREEMENT_COPY_TEMPLATE_KEY,
  COPY_DELIVERY_CONTENT,
  COPY_DELIVERY_VERSION,
  copyDeliveryOption,
  copyDestinationFor,
  copyOfferFor,
  maskEmail,
  maskMobile,
  parseCopyDeliveryContent,
} from './agreement-copy';
import { renderPatientMessage } from './patient-message-templates';

/*
 * W6 "send me a copy" — REQ-PORT-02, the s 65C copy-on-request obligation.
 *
 * The hard rules this module touches each have a test named after them, per
 * CLAUDE.md §6. The rest is the behaviour D-2026-09-11-03 settled.
 */

const PATIENT = { email: 'jo.sample@example.com', mobile: '0400 000 111' };
const CARER = { email: 'carer.sample@example.net', mobile: '0400 000 222' };

const COPY_VALUES = {
  givenNames: 'Jo',
  practiceName: 'Sample Family Practice',
  copyUrl: 'https://example.invalid/agreement-copy/abc.def',
  expiresOn: '18 September 2026',
  signedOn: '11 September 2026',
};

describe('the copy delivery channel list is content, not code', () => {
  it('travels with a version so a record says what it was offered from', () => {
    expect(COPY_DELIVERY_VERSION).toBe(COPY_DELIVERY_CONTENT.version);
    expect(COPY_DELIVERY_VERSION.length).toBeGreaterThan(0);
  });

  it('is rendered in file order, and the file is the screen', () => {
    expect(COPY_DELIVERY_CONTENT.options.map((o) => o.key)).toEqual(['email', 'sms', 'not_now']);
  });

  it('refuses a channel the platform cannot send on', () => {
    expect(() =>
      parseCopyDeliveryContent({
        version: 'x',
        options: [{ key: 'pigeon', channel: 'pigeon', note: 'no' }],
      }),
    ).toThrow(/channel must be one of/);
  });

  it('refuses a list with no way to say no', () => {
    expect(() =>
      parseCopyDeliveryContent({
        version: 'x',
        options: [{ key: 'email', channel: 'email', note: 'only yes' }],
      }),
    ).toThrow(/no option sends nothing/);
  });

  it('carries no display words — those are the string table, keyed by key', () => {
    for (const option of COPY_DELIVERY_CONTENT.options) {
      expect(Object.keys(option).sort()).toEqual(['channel', 'key', 'note']);
    }
  });
});

describe('hard rule 4 — no benefit or dollar amount on any agreement artefact or message about one', () => {
  it('no_dollar_amount_in_the_copy_message', () => {
    const rendered = renderPatientMessage(AGREEMENT_COPY_TEMPLATE_KEY, COPY_VALUES);
    const everything = [
      rendered.subject ?? '',
      ...rendered.paragraphs,
      ...rendered.smallPrint,
      rendered.actionLabel ?? '',
      rendered.sms ?? '',
    ].join(' ');
    expect(everything).not.toMatch(/\$|\bAUD\b|\bdollars?\b|\brebate\b|\bbenefit amount\b/i);
  });
});

describe('hard rule 12 — never certified, approved, accredited or government-approved', () => {
  it('the_copy_message_never_claims_certification_or_approval', () => {
    const rendered = renderPatientMessage(AGREEMENT_COPY_TEMPLATE_KEY, COPY_VALUES);
    const everything = [
      rendered.subject ?? '',
      ...rendered.paragraphs,
      ...rendered.smallPrint,
      rendered.actionLabel ?? '',
      rendered.sms ?? '',
    ].join(' ');
    expect(everything).not.toMatch(/\b(certified|approved|accredited|government-approved)\b/i);
    // The permitted form, and the message uses it.
    expect(everything).toMatch(/checked against the s 65C data set/);
  });
});

describe('whose contact the copy goes to (ASSIGNOR-RULES rules 5–6)', () => {
  it('the_copy_offer_uses_the_signers_own_contact_not_the_patients', () => {
    const offer = copyOfferFor({ assignorIsPatient: false, patient: PATIENT, assignor: CARER });
    const email = offer.channels.find((c) => c.channel === 'email');
    const sms = offer.channels.find((c) => c.channel === 'sms');
    // The carer's, masked — and nothing derived from the patient's.
    expect(email?.masked).toBe(maskEmail(CARER.email));
    expect(sms?.masked).toBe(maskMobile(CARER.mobile));
    expect(email?.masked).not.toBe(maskEmail(PATIENT.email));
    expect(sms?.masked).not.toBe(maskMobile(PATIENT.mobile));
  });

  it('never fills a blank assignor contact in from the patient record', () => {
    const offer = copyOfferFor({
      assignorIsPatient: false,
      patient: PATIENT,
      assignor: { email: null, mobile: '0400 000 222' },
    });
    expect(offer.channels.map((c) => c.channel)).toEqual(['sms']);
    expect(copyDestinationFor({ assignorIsPatient: false, patient: PATIENT, assignor: {} }, 'email')).toBeNull();
  });

  it('reads the patient record when the patient signed for themselves', () => {
    const offer = copyOfferFor({ assignorIsPatient: true, patient: PATIENT, assignor: CARER });
    expect(offer.channels.find((c) => c.channel === 'email')?.masked).toBe(maskEmail(PATIENT.email));
  });
});

describe('D-2026-09-11-03 — a contact address is never typed on the tablet', () => {
  it('a_missing_contact_offers_no_channel_and_no_way_to_type_one', () => {
    const offer = copyOfferFor({ assignorIsPatient: true, patient: {} });
    expect(offer.channels).toEqual([]);
    // A reason code the client maps to copy and a destination — reception —
    // rather than a box. There is no third branch.
    expect(offer.unavailable).toBe('no_contact_on_file');
  });

  it('the offer a tablet receives has no field a real address could sit in', () => {
    const offer = copyOfferFor({ assignorIsPatient: true, patient: PATIENT });
    for (const channel of offer.channels) {
      expect(Object.keys(channel).sort()).toEqual(['channel', 'key', 'masked']);
      expect(channel.masked).toContain('•');
      expect(JSON.stringify(offer)).not.toContain('jo.sample@example.com');
      expect(JSON.stringify(offer)).not.toContain('0400000111');
    }
  });
});

describe('masking — enough to recognise, not enough to read', () => {
  it('a_masked_contact_never_reveals_the_whole_address', () => {
    expect(maskEmail('jo.sample@example.com')).toBe('j•••@e•••.com');
    expect(maskEmail('JO.SAMPLE@Example.COM')).toBe('j•••@e•••.com');
    expect(maskMobile('0400 000 111')).toBe('•••••• 111');
    expect(maskMobile('+61 400 000 111')).toBe('•••••• 111');
    expect(maskEmail(null)).toBeNull();
    expect(maskMobile('')).toBeNull();
  });

  it('masks at a fixed width, so the mask does not leak the length', () => {
    expect(maskEmail('a@b.com')).toBe('a•••@b•••.com');
    expect(maskEmail('averyverylonglocalpart@b.com')).toBe('a•••@b•••.com');
    expect(maskMobile('0400000111')).toHaveLength(maskMobile('0298765432')!.length);
  });

  it('masks whole anything it cannot recognise — a malformed value is still somebody data', () => {
    expect(maskEmail('not-an-address')).toBe('•••');
  });
});

describe('the destination never travels to a screen', () => {
  it('resolves the real address only through the server-side helper', () => {
    const resolved = copyDestinationFor({ assignorIsPatient: true, patient: PATIENT }, 'email');
    expect(resolved).toEqual({ channel: 'email', destination: PATIENT.email });
  });

  it('the decline option sends nothing', () => {
    expect(copyDeliveryOption('not_now')?.channel).toBeNull();
    expect(copyDestinationFor({ assignorIsPatient: true, patient: PATIENT }, 'not_now')).toBeNull();
    expect(copyDestinationFor({ assignorIsPatient: true, patient: PATIENT }, 'carrier_pigeon')).toBeNull();
  });
});

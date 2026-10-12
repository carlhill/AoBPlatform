import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { SIGNED_DB4_CONTENT, type RenderedAgreementTemplate } from '@aobplatform/domain';
import { SignedDb4Renderer } from './signed-db4-renderer';
import { assertSignedDb4Renderable, type SignedDb4Document } from './signed-db4-document';
import { assertRenderable, letterheadHashOf, type AgreementDocument } from './agreement-document';
import { RendererRegistry } from './renderer-registry';
import { AgreementPdfRenderer } from './agreement-pdf-renderer';
import type { LogoLoader } from './logo-loader';
import { extractText } from '../artefacts/extract-text';

/**
 * THE SIGNED-DB4 — AoB's reproduction of the practice's own printed DB4, with
 * the cost on it, the Medicare card number in full and the patient's signature
 * at the bottom (D-2026-09-14-02/-03).
 *
 * THE TWO `an_ordinary_agreement_…` TESTS AT THE BOTTOM ARE THE POINT OF THE
 * WHOLE DESIGN, and they are in this file deliberately rather than in
 * `renderer.spec.ts`. The Signed-DB4 was made its own artefact kind, with its
 * own renderer and its own narrow guards, so that nothing about it could
 * weaken the guards protecting every ORDINARY agreement — no exemption branch,
 * no shared regex with a condition in front of it, no flag. Those two tests
 * stand next to the feature that could have weakened them and fail the moment
 * it does. Do not move them, and do not relax them.
 */

const PRACTICE_ID = '00000000-0000-4000-8000-00000000ffff';
const AGREEMENT_ID = '11111111-1111-4111-8111-111111111111';
const PRINT_JOB_ID = '22222222-2222-4222-8222-222222222222';

/**
 * A REAL PNG, built here rather than checked in. pdfkit decodes the image
 * properly, so a plausible-looking byte string is not enough.
 *
 * DELIBERATELY A SECOND COPY of the generator in `renderer.spec.ts`. The
 * original lives inside a spec file, and importing it would execute that
 * file's whole suite inside this one; hoisting it into `src/` would ship a
 * test fixture in the build output. Twenty lines of PNG header is the cheaper
 * of the three (wow.md §10 — a new thing is fine, an unexplained one is not).
 */
function greyPng(size: number, shade: number): Buffer {
  const raw = Buffer.alloc(size * (size + 1), shade);
  for (let row = 0; row < size; row += 1) raw[row * (size + 1)] = 0; // filter: none
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const MARK = greyPng(48, 0x20);
const MARK_SHA = createHash('sha256').update(MARK).digest('hex');
const OTHER_MARK = greyPng(48, 0xd0);
const OTHER_MARK_SHA = createHash('sha256').update(OTHER_MARK).digest('hex');

const asked: string[] = [];
const artefacts: LogoLoader = {
  load: async (_practiceId: string, sha256: string) => {
    asked.push(sha256);
    if (sha256 === MARK_SHA) return MARK;
    if (sha256 === OTHER_MARK_SHA) return OTHER_MARK;
    return null;
  },
};

/**
 * THE FORM, AS THE DRIVER READ IT. Shaped on `DB4-print.example.json`, which
 * is the authority, with OBVIOUSLY FAKE identities and a Medicare card number
 * whose check digit is deliberately wrong (CLAUDE.md §7c).
 *
 * `2999 99999 9`: the weighted check over the first eight digits gives 3, so
 * the printed 9 can never be a real card. It is still drawn in full, because
 * that is what D-2026-09-14-03 decided and what this file has to prove.
 */
const FAKE_MEDICARE_CARD = '2999 99999 9';
const BENEFITS = ['45.05', '22.40'] as const;
const HEADING_LINE_3 =
  'This form is the approved form as prescribed under section 20A of the Health Insurance Act 1973';

function printRecord(): SignedDb4Document['printRecord'] {
  return {
    heading: {
      lines: [
        'MEDICARE - ONLINE CLAIMING',
        'BULK BILL ASSIGNMENT OF BENEFIT FORM',
        HEADING_LINE_3,
        'Bulk bill claim for assessment by Services Australia',
      ],
    },
    form: {
      formCode: 'DB4',
      formReference: 'TEST0610012092026120300',
      locationId: 'TEST0610',
      claimStatus: 'STORED FOR LATER TRANSMISSION',
      signedOnPaper: false,
      serviceDate: '2026-09-12',
      currency: 'AUD',
    },
    servicingLocation: {
      name: 'Testville Family Medical',
      addressLines: ['1 Test Street'],
      suburb: 'Testville',
      state: 'NSW',
      postcode: '2000',
    },
    patient: {
      pmsLinkageKey: 'chart:00001',
      patientRecordNumber: '00001',
      // eslint-disable-next-line no-restricted-syntax
      medicareCardNumber: FAKE_MEDICARE_CARD,
      irn: '9',
      givenNames: 'Alex',
      familyName: 'Testpatient',
      dateOfBirth: '1965-10-10',
      address: '1 Test Street, Testville NSW 2000',
      mobile: '0400000000',
    },
    providers: [
      { role: 'servicing', pmsProviderKey: 'provider:0000000T', name: 'Dr Sam Example', providerNumber: '0000000T' },
      { role: 'payee', pmsProviderKey: 'provider:0000001W', name: 'Dr Robin Example', providerNumber: '0000001W' },
    ],
    services: [
      { serviceDate: '2026-09-12', time: '12:03', mbsItemNumber: '23', description: 'Level B Surgery', benefitAssigned: BENEFITS[0] },
      {
        serviceDate: '2026-09-12',
        time: '12:03',
        mbsItemNumber: '75870',
        description: 'Professional attendance by a general practitioner',
        benefitAssigned: BENEFITS[1],
      },
    ],
    assignment: {
      privacyNotice: ['Your personal information is protected by law, including the Privacy Act 1988.'],
      statementsJoinedBy: 'or',
      statements: [
        {
          key: 'assign_to_health_professional',
          text: 'I assign my right to benefits to the health professional who rendered the services.',
          ticked: true,
          inScope: true,
        },
        {
          key: 'offer_to_assign_to_pathology_practitioner',
          text: 'I offer to assign my right to benefits to the Approved Pathology Practitioner who will render the requested pathology services.',
          ticked: true,
          inScope: false,
        },
      ],
    },
    referral: {
      acrf: '102368',
      lspn: null,
      requestingProviderName: null,
      requestingProviderNumber: null,
      dateOfRequest: null,
      periodOfReferral: null,
    },
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    capturedAt: '2026-09-12T02:03:41.000Z',
    sourceSha256: '0'.repeat(64),
  };
}

function documentFor(overrides: Partial<SignedDb4Document> = {}): SignedDb4Document {
  return {
    kind: 'signed_db4',
    practiceId: PRACTICE_ID,
    agreementId: AGREEMENT_ID,
    sourcePrintJobId: PRINT_JOB_ID,
    content: SIGNED_DB4_CONTENT,
    printRecord: printRecord(),
    signature: {
      rasterSha256: MARK_SHA,
      signedAt: '2026-09-12T02:10:00.000Z',
      method: 'drawn',
      channel: 'in_practice',
    },
    ...overrides,
  };
}

const asPayload = (document: SignedDb4Document): Record<string, unknown> =>
  document as unknown as Record<string, unknown>;

function pageTextOf(bytes: Buffer): string {
  const text = extractText(new Uint8Array(bytes), 'application/pdf');
  expect(text).not.toBeNull();
  return (text ?? '').replace(/\s+/g, ' ');
}

beforeEach(() => {
  asked.length = 0;
});

describe('two_renders_of_one_signed_db4_are_byte_identical', () => {
  /**
   * HARD RULE 13, AND IT IS THE REASON THIS IS EVIDENCE RATHER THAN A
   * PHOTOCOPY. If two renders could differ, a Signed-DB4 pulled back into the
   * chart folder could not be checked against the hash recorded when it was
   * made, and the practice would be keeping a picture of a form rather than a
   * provable one.
   */
  it('renders the same form byte-identically, twice, and independently of the clock', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const first = await renderer.render(asPayload(documentFor()), ['en']);
    const second = await renderer.render(structuredClone(asPayload(documentFor())), ['en']);

    expect(first.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(first.mediaType).toBe('application/pdf');
    expect(first.rendererVersion).toBe('signed-db4-1');
    expect(second.sha256).toBe(first.sha256);
    expect(second.bytes.equals(first.bytes)).toBe(true);

    // A second and a bit later, so a wall-clock CreationDate would show.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const later = await renderer.render(asPayload(documentFor()), ['en']);
    expect(later.sha256).toBe(first.sha256);
  });

  it('a change to any reproduced value moves the bytes', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const base = await renderer.render(asPayload(documentFor()), ['en']);

    const record = printRecord();
    const movedAmount = documentFor({
      printRecord: {
        ...record,
        services: [{ ...record.services![0], benefitAssigned: '45.06' }, record.services![1]],
      },
    });
    expect((await renderer.render(asPayload(movedAmount), ['en'])).sha256).not.toBe(base.sha256);

    const movedTick = documentFor({
      printRecord: {
        ...record,
        assignment: {
          ...record.assignment,
          statements: [
            { ...record.assignment!.statements![0] },
            { ...record.assignment!.statements![1], ticked: false },
          ],
        },
      },
    });
    expect((await renderer.render(asPayload(movedTick), ['en'])).sha256).not.toBe(base.sha256);
  });

  /**
   * THE CONTENT IS CARRIED, NOT LOOKED UP. Editing `content/signed-db4.json`
   * must never move the bytes of a page that already exists, which is only
   * true because the resolved content travels inside the stored payload.
   */
  it('a different content version renders a different page', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const base = await renderer.render(asPayload(documentFor()), ['en']);
    const edited = documentFor({
      content: {
        ...SIGNED_DB4_CONTENT,
        version: 'signed-db4-test-2',
        labels: { ...SIGNED_DB4_CONTENT.labels, patient: 'Person' },
      },
    });
    expect((await renderer.render(asPayload(edited), ['en'])).sha256).not.toBe(base.sha256);
  });

  it('is registered so an old Signed-DB4 can always be re-rendered', () => {
    const registry = new RendererRegistry(artefacts);
    expect(registry.get(SignedDb4Renderer.VERSION)).toBeDefined();
    // And it is NOT what an ordinary agreement locks under.
    expect(registry.currentVersion).toBe(AgreementPdfRenderer.VERSION);
    expect(registry.currentVersion).not.toBe(SignedDb4Renderer.VERSION);
  });
});

describe('a_signed_db4_carries_the_signature_the_patient_made', () => {
  /**
   * THE WHOLE REQUIREMENT, in the practice's own words: the exact same form
   * with the patient's signature at the bottom, one document in the folder.
   * The agreement's own PDF deliberately does NOT carry the mark — it was
   * hashed before anybody signed — which is why this page exists at all.
   */
  it('asks for the mark bound on the signature event and draws it', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const signed = await renderer.render(asPayload(documentFor()), ['en']);

    expect(asked).toEqual([MARK_SHA]);

    const withAnotherHand = await renderer.render(
      asPayload(documentFor({ signature: { ...documentFor().signature, rasterSha256: OTHER_MARK_SHA } })),
      ['en'],
    );
    // A different mark is a different page. If the image were not drawn, these
    // two would be identical.
    expect(withAnotherHand.sha256).not.toBe(signed.sha256);
  });

  it('refuses rather than producing an unsigned "Signed-DB4"', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    await expect(
      renderer.render(
        asPayload(documentFor({ signature: { ...documentFor().signature, rasterSha256: 'f'.repeat(64) } })),
        ['en'],
      ),
    ).rejects.toThrow(/could not be produced/);
  });

  it('prints when it was signed, from the event and never from the clock', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const { bytes } = await renderer.render(asPayload(documentFor()), ['en']);
    const page = pageTextOf(bytes);
    expect(page).toContain(SIGNED_DB4_CONTENT.labels.signature);
    expect(page).toContain('2026-09-12T02:10:00.000Z');
  });
});

describe('the_signed_db4_prints_the_medicare_number_and_the_cost', () => {
  /**
   * D-2026-09-14-03 (the card number and IRN in full, no masking) and
   * D-2026-09-14-02 (the amounts, reproduced verbatim from what the practice's
   * billing software printed). Both are on the government's own approved form
   * and both are what the practice asked to see back in the chart folder.
   *
   * HARD RULE 1 IS UNTOUCHED BY THIS. It is a rule about VERIFICATION — the
   * card number is never used to prove who somebody is, never to find or match
   * a patient, never in a log or an event, never sent to the rules service.
   * Printing it as content on a reproduction of the form it is printed on is
   * none of those things.
   */
  it('draws the card number and the IRN in full, unmasked', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const { bytes } = await renderer.render(asPayload(documentFor()), ['en']);
    const page = pageTextOf(bytes);

    expect(page).toContain(FAKE_MEDICARE_CARD);
    expect(page).toContain(SIGNED_DB4_CONTENT.labels.medicareCard);
    expect(page).toContain(`${SIGNED_DB4_CONTENT.labels.irn}: 9`);
    // Not a mask, not a last-three, not a redaction.
    expect(page).not.toContain('****');
    expect(page).not.toContain('•••');
  });

  it('draws every benefit exactly as the practice printed it, and totals nothing', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const { bytes } = await renderer.render(asPayload(documentFor()), ['en']);
    const page = pageTextOf(bytes);

    expect(page).toContain(SIGNED_DB4_CONTENT.labels.columnBenefit);
    for (const benefit of BENEFITS) expect(page).toContain(benefit);
    /*
     * AND NOTHING WE WORKED OUT. 45.05 + 22.40 = 67.45. A total would be AoB
     * ORIGINATING a figure, which is the thing hard rule 4 actually forbids
     * and which D-2026-09-14-02 explicitly did not license.
     */
    expect(page).not.toContain('67.45');
  });

  it('db4_amount_keeps_the_dollar_exactly_as_printed', async () => {
    /*
     * CARL, 10 OCTOBER 2026 (D-2026-10-10-08): "go ahead and keep the $".
     * Template pracsoft3-db4-2026-10-1 carries `$45.05` as PracSoft printed it,
     * and the Signed-DB4 draws that string and nothing else: no second symbol
     * of ours, no parsing, no total (hard rule 4 as narrowed by D-2026-09-14-02).
     */
    const renderer = new SignedDb4Renderer(artefacts);
    const record = printRecord();
    const withSymbol = documentFor({
      printRecord: {
        ...record,
        parserTemplateVersion: 'pracsoft3-db4-2026-10-1',
        services: [
          { ...record.services![0], benefitAssigned: '$45.05' },
          { ...record.services![1], benefitAssigned: '$1,045.05' },
        ],
      },
    });
    const first = await renderer.render(asPayload(withSymbol), ['en']);
    const page = pageTextOf(first.bytes);

    expect(page).toContain('$45.05');
    expect(page).toContain('$1,045.05');
    expect(page).not.toContain('$$');
    expect(page).not.toContain('1090.10');
    expect(page).not.toContain('1,090.10');
    // Rule 13 holds with the symbol too: the same input, the same bytes.
    expect((await renderer.render(asPayload(withSymbol), ['en'])).sha256).toBe(first.sha256);
  });

  it('draws the whole form — location, both providers, items, privacy notice, referral', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const { bytes } = await renderer.render(asPayload(documentFor()), ['en']);
    const page = pageTextOf(bytes);

    expect(page).toContain('Testville Family Medical');
    expect(page).toContain('Alex Testpatient');
    expect(page).toContain('Dr Sam Example');
    expect(page).toContain('Dr Robin Example');
    expect(page).toContain('0000001W');
    expect(page).toContain('75870');
    expect(page).toContain('Privacy Act 1988');
    expect(page).toContain('TEST0610012092026120300');
    expect(page).toContain('102368');
    // The heading lines, verbatim and in order.
    expect(page).toContain('BULK BILL ASSIGNMENT OF BENEFIT FORM');
  });

  /*
   * THE PATHOLOGY STATEMENT IS CARRIED AS DATA AND NEVER DRAWN.
   *
   * D-2026-09-14-02: "The pathology tick box stays on the practice's paper
   * (out of scope)." s 65C(4) items 1-4 are out of this product's scope
   * (CLAUDE.md section 8).
   *
   * Reproducing a page and acting on a statement are different things, and
   * that distinction is what lets this renderer print the government's own
   * "approved form" heading verbatim. It does not stretch to this: the patient
   * signs OUR page, and a ticked s 65C(4) assignment above their mark would be
   * an assignment we do not validate, do not store as one and do not write
   * back as one.
   *
   * This test asserted the opposite until 27 September 2026, because the build
   * brief said to draw it - the brief had believed DB4-AND-AOBL.md section 10
   * item 0, which still listed this as unruled, over DECISIONS.md, which had
   * ruled it thirteen days earlier. The assertion is inverted here as a
   * visible change with its reason, not quietly relaxed.
   */
  it('a_statement_out_of_scope_is_carried_as_data_and_never_drawn', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const document = documentFor();
    const { bytes } = await renderer.render(asPayload(document), ['en']);
    const page = pageTextOf(bytes);

    // The in-scope assignment is the one the patient signs under.
    expect(page).toContain('I assign my right to benefits to the health professional');

    // The pathology offer is not on the page at all - nor the "or" that joined them.
    expect(page).not.toContain('Approved Pathology Practitioner');
    expect(page).not.toMatch(/services\. or I offer to assign/);

    // But it is still in the record, untouched, for the write-back and any later reader.
    const statements = document.printRecord.assignment?.statements ?? [];
    expect(statements.some((s) => s.inScope === false)).toBe(true);
  });
});

describe('the_signed_db4_never_claims_our_reproduction_is_approved', () => {
  /**
   * HARD RULE 12, SPLIT THE ONLY WAY IT CAN BE SPLIT HERE. The government may
   * say its form is approved; we may not say it of ours. So heading line 3 is
   * reproduced verbatim as DATA read from the print record — altering somebody
   * else's form's own words would be the stranger act — and the footer carries
   * the provenance line that stops a reader taking it as a claim about this
   * page (D-2026-09-14-02).
   */
  it('reproduces the government\'s own heading line and answers it in the footer', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const { bytes } = await renderer.render(asPayload(documentFor()), ['en']);
    const page = pageTextOf(bytes);

    expect(page).toContain(HEADING_LINE_3);
    expect(page).toContain(SIGNED_DB4_CONTENT.footer.provenance);
    // The permitted wording, and nothing stronger (REQ-65C-05).
    expect(page).toContain('self-assessment');
  });

  it('refuses when OUR OWN words would make the claim', () => {
    const claiming = documentFor({
      content: {
        ...SIGNED_DB4_CONTENT,
        footer: {
          ...SIGNED_DB4_CONTENT.footer,
          lines: ['This reproduction is an approved form.'],
        },
      },
    });
    expect(() => assertSignedDb4Renderable(claiming)).toThrow(/HARD-12/);
  });

  it('refuses a page with no provenance line at all', () => {
    const bare = documentFor({
      content: { ...SIGNED_DB4_CONTENT, footer: { provenance: '   ', lines: [] } },
    });
    expect(() => assertSignedDb4Renderable(bare)).toThrow(/HARD-12/);
  });

  /**
   * AND THE CONTENT FILE THAT SHIPS TODAY PASSES ITS OWN GUARD. A content edit
   * that put the claim in the footer would fail at load; this says the one in
   * the repo does not.
   */
  it('the shipped content makes no such claim', () => {
    expect(() => assertSignedDb4Renderable(documentFor())).not.toThrow();
    for (const line of [SIGNED_DB4_CONTENT.footer.provenance, ...SIGNED_DB4_CONTENT.footer.lines]) {
      expect(line).not.toMatch(/\b(certified|accredited|approved)\b/i);
    }
  });
});

describe('no_practitioner_signature_field_on_a_signed_db4', () => {
  /**
   * HARD RULE 3 — abolished 1 July 2026, blocked defensively. Checked over
   * EVERY string, ours and the reproduced ones alike: a practice whose
   * software still prints the pre-July form would otherwise have us reproduce
   * an abolished field onto stored evidence, and a faithful reproduction of a
   * wrong form is still a wrong form (DB4-AND-AOBL.md §1d).
   */
  it('refuses a form that still prints one', () => {
    const record = printRecord();
    const oldForm = documentFor({
      printRecord: {
        ...record,
        assignment: {
          ...record.assignment,
          statements: [
            ...record.assignment!.statements!,
            { key: 'practitioner', text: 'Signature of the practitioner', ticked: false, inScope: true },
          ],
        },
      },
    });
    expect(() => assertSignedDb4Renderable(oldForm)).toThrow(/HARD-03/);
  });

  it('refuses one in a heading line too', () => {
    const record = printRecord();
    const oldHeading = documentFor({
      printRecord: { ...record, heading: { lines: [...record.heading!.lines!, "Provider's signature"] } },
    });
    expect(() => assertSignedDb4Renderable(oldHeading)).toThrow(/HARD-03/);
  });

  it('refuses one we authored ourselves', () => {
    const ourFault = documentFor({
      content: {
        ...SIGNED_DB4_CONTENT,
        labels: { ...SIGNED_DB4_CONTENT.labels, signedAt: 'Signed by the doctor' },
      },
    });
    expect(() => assertSignedDb4Renderable(ourFault)).toThrow(/HARD-03/);
  });

  it('and the shipped page carries only the assignor\'s signature block', async () => {
    const renderer = new SignedDb4Renderer(artefacts);
    const { bytes } = await renderer.render(asPayload(documentFor()), ['en']);
    const page = pageTextOf(bytes);
    expect(page).toContain('Signature of the person assigning benefits');
    expect(page).not.toMatch(/signature of the (practitioner|provider|doctor)/i);
  });
});

/* ===========================================================================
 * THE GUARDS ON THE ORDINARY AGREEMENT PATH, UNCHANGED.
 *
 * The Signed-DB4 is its own artefact kind for exactly one reason: so that a
 * page which legitimately carries a dollar amount, and which legitimately
 * reproduces somebody else's "approved form" heading, could be built WITHOUT
 * putting a condition in front of the controls that protect every ordinary
 * agreement. A hole in a shared guard is only ever as good as the condition
 * guarding it, and a future bug in that condition drops an amount onto an
 * instrument with criminal exposure.
 *
 * These two tests are the receipt. They exercise `assertRenderable` — the
 * shared render-time guard in `agreement-document.ts`, untouched by this build
 * and with no exemption branch in it — and they must never be deleted,
 * skipped, or relaxed.
 * ======================================================================== */

function agreementTemplate(overrides: Partial<RenderedAgreementTemplate> = {}): RenderedAgreementTemplate {
  return {
    templateId: 'generic-episodic',
    templateVersion: 'episodic-test-1',
    status: 'active_generic',
    title: 'Assignment of Benefit',
    sections: [{ key: 'what', heading: 'What this is', paragraphs: ['You assign your right to the Medicare benefit.'] }],
    statements: [{ key: 'understood', text: 'I have read this agreement.' }],
    footer: ['s 65C, Health Insurance Regulations 2018.'],
    ...overrides,
  };
}

function ordinaryAgreement(overrides: Partial<AgreementDocument> = {}): AgreementDocument {
  const letterhead = { legalName: 'Testville Family Medical Pty Ltd' };
  return {
    practiceId: PRACTICE_ID,
    particulars: { patientName: 'Alex Testpatient', serviceDate: '2026-09-01' },
    letterhead,
    letterheadHash: letterheadHashOf(letterhead),
    template: agreementTemplate(),
    draftMarker: false,
    ...overrides,
  };
}

describe('an_ordinary_agreement_artefact_still_refuses_a_dollar_amount', () => {
  it('in the words of the template', () => {
    const withAmount = ordinaryAgreement({
      template: agreementTemplate({
        sections: [{ key: 'what', heading: 'Cost', paragraphs: ['The benefit is $45.05.'] }],
      }),
    });
    expect(() => assertRenderable(withAmount)).toThrow(/HARD-04/);
  });

  it('and in a value that came from the practice records', () => {
    const withAmount = ordinaryAgreement({
      particulars: { patientName: 'Alex Testpatient', basicServiceDescription: 'Attendance, 45.05' },
    });
    expect(() => assertRenderable(withAmount)).toThrow(/HARD-04/);
  });

  it('the clean agreement still renders — the guard is not refusing everything', () => {
    expect(() => assertRenderable(ordinaryAgreement())).not.toThrow();
  });
});

describe('an_ordinary_agreement_artefact_still_refuses_the_word_approved', () => {
  it('in the words of the template', () => {
    const claiming = ordinaryAgreement({
      template: agreementTemplate({ footer: ['This is the approved form.'] }),
    });
    expect(() => assertRenderable(claiming)).toThrow(/HARD-12/);
  });

  it('and refuses "certified" and "accredited" with it', () => {
    for (const word of ['certified', 'accredited', 'government-approved']) {
      const claiming = ordinaryAgreement({
        template: agreementTemplate({ title: `A ${word} Assignment of Benefit` }),
      });
      expect(() => assertRenderable(claiming)).toThrow(/HARD-12/);
    }
  });

  /**
   * THE LINE THE SIGNED-DB4 REPRODUCES, PUT ON AN ORDINARY AGREEMENT. It is
   * refused there, and that is the whole difference between the two artefact
   * kinds stated as a test.
   */
  it('including the DB4 heading line, which is only allowed on the reproduction', () => {
    const claiming = ordinaryAgreement({
      template: agreementTemplate({ sections: [{ key: 'h', heading: 'Form', paragraphs: [HEADING_LINE_3] }] }),
    });
    expect(() => assertRenderable(claiming)).toThrow(/HARD-12/);
  });
});

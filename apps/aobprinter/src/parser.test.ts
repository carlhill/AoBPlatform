/**
 * The parser, against a REAL PRINTED PDF.
 *
 * `test-fixtures/pracsoft3-db4-probe.pdf` was printed to AOBPRINTER on this
 * machine on 17 September 2026 — `Get-Content probe-db4.txt | Out-Printer -Name
 * AOBPRINTER` through the "Microsoft Print To PDF" driver on a file-path port —
 * and the source page is beside it. NOTHING HERE IS HAND-WRITTEN TEXT. A
 * hand-written fixture tests the regexes against the regexes' own author; a
 * printed one tests them against a print driver, which is the thing that will
 * actually break them.
 *
 * WHAT THE FIXTURE IS NOT: PracSoft's output. It is a plain-text page laid out
 * like the scanned DB4, so it proves the mechanism and the template's shape,
 * not the template's patterns against the real form. The first real print from
 * the practice needs these checked line by line (said again in the content
 * file, because that is where somebody will be standing when it matters).
 *
 * The identities are obviously fake and the Medicare number's checksum is
 * INVALID by construction: 2999 88887 1 weights to 333, so the ninth digit
 * should be 3 and is 7 (CLAUDE.md §7).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDb4 } from './parser';
import { readPdfText } from './pdf-text';
import { sha256Hex } from './outbox';
import { DEFAULT_TEMPLATE_VERSION, parseTemplate, templateFor } from './template';

const FIXTURE = join(__dirname, '..', 'test-fixtures', 'pracsoft3-db4-probe.pdf');
const CAPTURED_AT = '2026-09-17T00:00:00.000Z';

/** The template every earlier record was stamped with; it stays loadable (hard rule 14). */
const SEPTEMBER_TEMPLATE_VERSION = 'pracsoft3-db4-2026-09-1';

function parseFixture(version: string = DEFAULT_TEMPLATE_VERSION) {
  const bytes = readFileSync(FIXTURE);
  const text = readPdfText(bytes);
  if (!text) throw new Error('the fixture has no readable text layer');
  const template = templateFor(version);
  if (!template) throw new Error(`the template ${version} is missing`);
  return parseDb4(template, { lines: text.lines, sourceSha256: sha256Hex(bytes), capturedAt: CAPTURED_AT });
}

describe('the DB4 parser, over a page actually printed to AOBPRINTER', () => {
  it('reads the printed page back as a DB4 Print Record', () => {
    const record = parseFixture();
    expect(record).not.toBeNull();
    expect(record!.documentType).toBe('db4_assignment');
    expect(record!.parserTemplateVersion).toBe(DEFAULT_TEMPLATE_VERSION);
    expect(record!.pms).toBe('pracsoft3');
    expect(record!.capturedAt).toBe(CAPTURED_AT);
  });

  it('reads the form block, including the amounts PracSoft printed', () => {
    const record = parseFixture(SEPTEMBER_TEMPLATE_VERSION)!;
    expect(record.form).toEqual({
      formCode: 'DB4',
      currency: 'AUD',
      formReference: 'HSS0610012092026120300',
      locationId: 'HSS06100',
      claimStatus: 'STORED FOR LATER TRANSMISSION',
      signedOnPaper: false,
      serviceDate: '2026-09-12',
    });
    // The amount is reproduced exactly as printed and never computed
    // (hard rule 4 as narrowed by D-2026-09-14-02).
    expect(record.services).toEqual([
      {
        serviceDate: '2026-09-12',
        time: '12:03',
        mbsItemNumber: '23',
        description: 'Level B Surgery',
        benefitAssigned: '45.05',
      },
      {
        serviceDate: '2026-09-12',
        time: '12:03',
        mbsItemNumber: '75870',
        description: 'Professional attendance',
        benefitAssigned: '22.40',
      },
    ]);
  });

  it('db4_amount_keeps_the_dollar_exactly_as_printed (D-2026-10-10-08)', () => {
    // Carl, 10 Oct 2026: "yes 45.05 no $ - go ahead and keep the $". The page
    // prints `$45.05`; the default template now carries those characters,
    // symbol included, and the screen and the Signed-DB4 reproduce them.
    // Nothing is parsed to a number (hard rule 4 as narrowed by D-2026-09-14-02).
    const record = parseFixture()!;
    expect(record.parserTemplateVersion).toBe('pracsoft3-db4-2026-10-1');
    expect(record.services?.map((s) => s.benefitAssigned)).toEqual(['$45.05', '$22.40']);
    // Everything else on the row is unchanged from the September template.
    const september = parseFixture(SEPTEMBER_TEMPLATE_VERSION)!;
    expect(record.services?.map(({ benefitAssigned: _b, ...rest }) => rest)).toEqual(
      september.services?.map(({ benefitAssigned: _b, ...rest }) => rest),
    );
  });

  it('the -10-1 template keeps grouping commas and collapses stray spaces, and adds nothing', () => {
    const template = templateFor('pracsoft3-db4-2026-10-1')!;
    const record = parseDb4(template, {
      lines: [
        'Form Reference: HSS0610099099099099099',
        '12/09/2026 12:03   14206   Iron infusion        $1,045.05',
        '12/09/2026 12:03   23      Level B Surgery      $  45.05',
        '12/09/2026 12:03   10990   Incentive            7.15',
        '[X] I assign my right to benefits to the health professional who rendered the services.',
      ],
      sourceSha256: 'c'.repeat(64),
      capturedAt: CAPTURED_AT,
    })!;
    expect(record.services?.map((s) => s.benefitAssigned)).toEqual(['$1,045.05', '$ 45.05', '7.15']);
    // With a space after the `$`, -09-1 left the `$` on the end of the
    // description; -10-1 takes it into the amount, so the description is clean.
    expect(record.services?.[1]?.description).toBe('Level B Surgery');
  });

  it('the two templates differ ONLY in how the amount is carried', () => {
    const september = templateFor(SEPTEMBER_TEMPLATE_VERSION)!;
    const october = templateFor('pracsoft3-db4-2026-10-1')!;
    const services = (t: typeof september) =>
      t.extractors.findIndex((e) => e.kind === 'rows' && e.path === 'services');
    const strip = (t: typeof september) =>
      JSON.stringify(
        t.extractors.filter((_, i) => i !== services(t)),
        (_k, v: unknown) => (v instanceof RegExp ? v.source : v),
      );
    expect(services(october)).toBe(services(september));
    expect(strip(october)).toBe(strip(september));
    expect(october.constants).toEqual(september.constants);
    expect(october.pms).toBe(september.pms);
    expect(october.documentType).toBe(september.documentType);
  });

  it('reads the four heading lines in order, rejoining the one that wrapped', () => {
    const record = parseFixture()!;
    expect(record.heading?.lines).toEqual([
      'MEDICARE - ONLINE CLAIMING',
      'BULK BILL ASSIGNMENT OF BENEFIT FORM',
      'This form is the approved form as prescribed under section 20A of the Health Insurance Act 1973',
      'Bulk bill claim for assessment by Services Australia',
    ]);
  });

  it('reads both providers with their roles and derives the PMS keys from the page', () => {
    const record = parseFixture()!;
    expect(record.providers).toEqual([
      { role: 'servicing', name: 'Dr Ficticia Nonperson', providerNumber: '9999999X', pmsProviderKey: 'provider:9999999X' },
      { role: 'payee', name: 'Dr Madeup Notreal', providerNumber: '8888888Y', pmsProviderKey: 'provider:8888888Y' },
    ]);
  });

  it('joins the patient on the chart number, and nothing else', () => {
    const record = parseFixture()!;
    // pmsLinkageKey is derived from the practice's own record number. The
    // Medicare number is content on a form and is never a join key
    // (hard rule 1; D-2026-09-14-03 changed what travels, not what identifies).
    expect(record.patient?.pmsLinkageKey).toBe('chart:09911');
    expect(record.patient?.patientRecordNumber).toBe('09911');
    expect(record.patient?.familyName).toBe('Fakesurname');
    expect(record.patient?.givenNames).toBe('Testalina');
    expect(record.patient?.dateOfBirth).toBe('1972-02-02');
  });

  it('carries the Medicare card number and IRN as printed, unmasked', () => {
    // D-2026-09-14-03: no masking. The Signed-DB4 reproduces the form, the
    // patient recognises their own number, and the auditor links the form to
    // the claim by it. Bracket access, because an identifier by that name is
    // banned repo-wide and the ban is right everywhere except the one field.
    const patient = parseFixture()!.patient!;
    expect(patient['medicareCardNumber']).toBe('2999 88887 1');
    expect(patient.irn).toBe('4');
  });

  it('carries the pathology statement as data, marked out of scope', () => {
    const record = parseFixture()!;
    expect(record.assignment?.statementsJoinedBy).toBe('or');
    expect(record.assignment?.statements).toEqual([
      {
        key: 'assign_to_health_professional',
        inScope: true,
        ticked: true,
        text: 'I assign my right to benefits to the health professional who rendered the services.',
      },
      {
        // s 65C(4) items 1-4 are out of scope (CLAUDE.md §8): carried, never acted on.
        key: 'offer_to_assign_to_pathology_practitioner',
        inScope: false,
        ticked: true,
        text: 'I offer to assign my right to benefits to the Approved Pathology Practitioner.',
      },
    ]);
  });

  it('a_field_the_parser_cannot_find_is_absent_not_guessed', () => {
    const record = parseFixture()!;

    // The probe page prints an ACRF and no other referral particular. The four
    // the template also looks for are ABSENT — not null, not '', not a default.
    expect(record.referral).toEqual({ acrf: '102368' });
    expect(Object.keys(record.referral!)).toEqual(['acrf']);
    expect('lspn' in record.referral!).toBe(false);
    expect('dateOfRequest' in record.referral!).toBe(false);
    expect('requestingProviderNumber' in record.referral!).toBe(false);

    // And the same rule one level up: a page that prints no patient block at
    // all yields no patient, rather than an object full of empty strings.
    const template = templateFor(DEFAULT_TEMPLATE_VERSION)!;
    const bare = parseDb4(template, {
      lines: [
        'Form Reference: HSS0610099099099099099',
        '[X] I assign my right to benefits to the health professional who rendered the services.',
      ],
      sourceSha256: 'a'.repeat(64),
      capturedAt: CAPTURED_AT,
    });
    expect(bare).not.toBeNull();
    expect(bare!.patient).toBeUndefined();
    expect(bare!.providers).toBeUndefined();
    expect(bare!.services).toBeUndefined();
    // The one field that IS written without a match, because its absence is the
    // answer: a declared boolean is false when we looked and it was not there.
    expect(bare!.form?.signedOnPaper).toBe(false);
  });

  it('is deterministic — the same bytes give byte-identical JSON', () => {
    // The property the Signed-DB4 rests on. Two parses of one print must not
    // differ by so much as a key order.
    expect(JSON.stringify(parseFixture())).toBe(JSON.stringify(parseFixture()));
  });

  it('returns null for a page that is not this form, rather than a near-empty record', () => {
    const template = templateFor(DEFAULT_TEMPLATE_VERSION)!;
    const notADb4 = parseDb4(template, {
      lines: ['PATIENT ARRIVAL SLIP', 'Chart Number: 09911', 'Dr Ficticia Nonperson', '10:30 Consultation'],
      sourceSha256: 'b'.repeat(64),
      capturedAt: CAPTURED_AT,
    });
    expect(notADb4).toBeNull();
  });
});

/*
 * A SERVICE LINE THE ROW PATTERN DOES NOT READ IS COUNTED, NEVER DROPPED
 * SILENTLY (Opus review, 10 Oct 2026; D-2026-10-11-01).
 *
 * `runRows` skips a line its pattern does not match. For most of the page
 * that is right — a line that is not a service is not a service — but a line
 * inside the services block that LOOKS like a service and is not read is a row
 * missing from the patient's copy of their form. Core's amount check only asks
 * whether ANY row has an amount, so one lost row among several reached the
 * tablet and the Signed-DB4 without anybody noticing.
 *
 * Each shape below vanishes under BOTH shipped templates. The tests assert
 * that it still vanishes from `services` (widening the pattern is a new
 * template version, proposed to Carl rather than done here) AND that the
 * record now says one line was not read. Hand-written lines, deliberately: the
 * printed fixture has no such row, and these are about the counting, not
 * about a print driver.
 */
describe('unparsed_service_lines_are_counted_not_silently_dropped', () => {
  const READ_ROW = '12/09/2026 12:03   23      Level B Surgery      $45.05';
  const SHAPES: readonly (readonly [string, string])[] = [
    ['a credit with a minus sign', '12/09/2026 12:03   23      Reversal             -$10.00'],
    ['a credit in brackets', '12/09/2026 12:03   23      Reversal             ($10.00)'],
    ['a whole-dollar amount with no cents', '12/09/2026 12:03   23      Level B Surgery      $45'],
    ['a date-led service line with no amount', '12/09/2026 12:03   23      Level B Surgery'],
  ];

  function parseWith(version: string, lines: readonly string[]) {
    return parseDb4(templateFor(version)!, {
      lines: [
        'Form Reference: HSS0610099099099099099',
        'Date       Time    Item    Description                      Benefit Assigned',
        ...lines,
        '[X] I assign my right to benefits to the health professional who rendered the services.',
      ],
      sourceSha256: 'd'.repeat(64),
      capturedAt: CAPTURED_AT,
    })!;
  }

  for (const version of [SEPTEMBER_TEMPLATE_VERSION, 'pracsoft3-db4-2026-10-1']) {
    for (const [shape, line] of SHAPES) {
      it(`${version}: ${shape} is not read as a row, and is counted`, () => {
        const record = parseWith(version, [READ_ROW, line]);
        // Still dropped from the rows: the pattern is template content (hard rule 14).
        expect(record.services).toHaveLength(1);
        expect(record.services?.[0]?.mbsItemNumber).toBe('23');
        // And no longer silently: the record says a service line went unread.
        expect(record.unparsedServiceLines).toBe(1);
      });
    }

    it(`${version}: every unread line is counted, not just the first`, () => {
      const record = parseWith(version, [READ_ROW, ...SHAPES.map(([, line]) => line)]);
      expect(record.services).toHaveLength(1);
      expect(record.unparsedServiceLines).toBe(SHAPES.length);
    });

    it(`${version}: a page whose service lines were all read says so with a zero`, () => {
      // A determination, like a flag: we looked and there was nothing unread.
      expect(parseWith(version, [READ_ROW]).unparsedServiceLines).toBe(0);
    });
  }

  it('lines that are not date-led are not service lines and are not counted', () => {
    const record = parseWith(DEFAULT_TEMPLATE_VERSION, [
      READ_ROW,
      'Date of Birth: 02/02/1972',
      'Signature: ______________________   Date: ____/____/________',
      'Level B Surgery continued',
    ]);
    expect(record.unparsedServiceLines).toBe(0);
  });

  it('the printed probe reads every service line it prints', () => {
    expect(parseFixture()!.unparsedServiceLines).toBe(0);
    expect(parseFixture(SEPTEMBER_TEMPLATE_VERSION)!.unparsedServiceLines).toBe(0);
  });

  it('carries a count and never the content of the line it could not read', () => {
    // No PII and no amount leaves the parser through this field: it is a
    // number, so neither the description nor the figure can ride on it.
    const record = parseWith(DEFAULT_TEMPLATE_VERSION, [READ_ROW, SHAPES[0]![1]]);
    expect(typeof record.unparsedServiceLines).toBe('number');
    expect(JSON.stringify(record)).not.toContain('Reversal');
    expect(JSON.stringify(record)).not.toContain('10.00');
  });
});

describe('the template is content, and a bad edit fails loudly', () => {
  it('refuses a pattern it cannot compile', () => {
    expect(() =>
      parseTemplate({
        version: 'v1',
        pms: 'pracsoft3',
        documentType: 'db4_assignment',
        extractors: [{ kind: 'line', pattern: '^(?<a>[unclosed', paths: { a: 'form.formCode' } }],
      }),
    ).toThrow(/not a valid regular expression/);
  });

  it('refuses a path mapped to a group the pattern does not capture', () => {
    expect(() =>
      parseTemplate({
        version: 'v1',
        pms: 'pracsoft3',
        documentType: 'db4_assignment',
        extractors: [{ kind: 'line', pattern: '^Chart: (?<chart>\\d+)$', paths: { chartNo: 'patient.patientRecordNumber' } }],
      }),
    ).toThrow(/which the pattern does not capture/);
  });

  it('refuses an unknown extractor kind — the vocabulary is code, not content', () => {
    expect(() =>
      parseTemplate({
        version: 'v1',
        pms: 'pracsoft3',
        documentType: 'db4_assignment',
        extractors: [{ kind: 'eval', pattern: '.*' }],
      }),
    ).toThrow(/kind must be one of/);
  });

  it('the shipped template declares the version that travels on every record', () => {
    const template = templateFor(DEFAULT_TEMPLATE_VERSION)!;
    expect(template.version).toBe('pracsoft3-db4-2026-10-1');
    // The superseded version stays built in, so a record stamped with it can
    // still be re-read against the template that made it (hard rule 14).
    expect(templateFor(SEPTEMBER_TEMPLATE_VERSION)?.version).toBe(SEPTEMBER_TEMPLATE_VERSION);
    expect(templateFor('pracsoft3-db4-2099-12-9')).toBeNull();
  });
});

/**
 * THE SHAPES A DB4 COMES OFF A PRINTER IN — the starting points the AOBPrinter
 * test tool offers, so a tester picks a fault rather than typing one.
 *
 * WHY THESE AND NOT OTHERS. Each preset is a fault that has actually been seen
 * or is actually reachable. Three of the six print-record checks are backstops
 * gated at ingest (`DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST`), so a preset for
 * them would produce a job that never becomes an agreement and never reaches
 * the desk — the tool offers those under "refused at the door" instead, which
 * is a different and equally worth-seeing outcome.
 *
 * FAKE IDENTITIES THROUGHOUT, and the Medicare numbers FAIL THEIR OWN CHECKSUM
 * on purpose. No real number appears here or may ever be typed into a preset
 * (CLAUDE.md §7c). The card number rides on a DB4 only because the practice's
 * own form prints it (D-2026-09-14-03); it identifies nobody (hard rule 1).
 *
 * NOTHING HERE ORIGINATES AN AMOUNT. `benefitAssigned` is a STRING in every
 * preset, reproduced as a practice's software would have printed it — whole
 * dollars, a currency symbol, a grouping comma, one decimal or three. The
 * platform never parses, sums, rounds or reformats one (hard rule 4,
 * D-2026-09-14-02), and the ragged presets exist precisely to prove the screen
 * does not either.
 *
 * THE `$` IS PART OF THE STRING SINCE 10 OCTOBER 2026 (D-2026-10-10-08). A real
 * PracSoft DB4 prints `$45.05`, and AOBPRINTER's template
 * `pracsoft3-db4-2026-10-1` now carries it that way, so this tool, which stands
 * in for AOBPRINTER, sends `$45.05` too. The -09-1 template stripped the
 * symbol; the ragged preset keeps one row in that older shape.
 */

export interface ServiceRow {
  serviceDate: string;
  time: string;
  mbsItemNumber: string;
  description: string;
  /** THE STRING THE PRACTICE PRINTED. Empty means the template read nothing. */
  benefitAssigned: string;
}

export interface ProviderRow {
  role: 'servicing' | 'payee';
  name: string;
  providerNumber: string;
}

export interface Draft {
  practiceId: string;
  formReference: string;
  serviceDate: string;
  locationId: string;
  claimStatus: string;
  headingLines: string;
  /** Patient. `patientRecordNumber` is the chart number a DB4 is matched on. */
  patientRecordNumber: string;
  givenNames: string;
  familyName: string;
  dateOfBirth: string;
  address: string;
  mobile: string;
  // eslint-disable-next-line no-restricted-syntax -- the DB4's own decided exception (D-2026-09-14-03): the practice's form prints it, so the envelope carries it. Composed and posted, never used to identify anybody (hard rule 1).
  medicareCardNumber: string;
  irn: string;
  /**
   * THE PLACE THAT PRINTED THE FORM — 2A's left column, between the date of
   * service and the agreement's own facts.
   *
   * IT WAS MISSING FROM THIS TOOL UNTIL 28 SEPTEMBER 2026, and the absence
   * was invisible until Carl moved the agreement facts to the foot of that
   * column and the move appeared to do nothing: with no location there was
   * nothing for them to sit below. Every DB4 off a real printer carries a
   * place of practice, so a bench instrument that cannot compose one cannot
   * reproduce the page it is imitating.
   */
  locationName: string;
  /** One address line per line, as the form prints them. */
  locationAddressLines: string;
  locationSuburb: string;
  locationState: string;
  locationPostcode: string;
  providers: ProviderRow[];
  services: ServiceRow[];
  queueName: string;
  queueLabel: string;
  parserTemplateVersion: string;
  capturedAt: string;
}

const HEADING = [
  'MEDICARE - ONLINE CLAIMING',
  'BULK BILL ASSIGNMENT OF BENEFIT FORM',
  'This form is the approved form as prescribed under section 20A of the Health Insurance Act 1973',
  'Bulk bill claim for assessment by Services Australia',
].join('\n');

const SERVICING: ProviderRow = {
  role: 'servicing',
  name: 'Dr Ficticia Nonperson',
  providerNumber: '9999999X',
};
const PAYEE: ProviderRow = {
  role: 'payee',
  name: 'Dr Madeup Notreal',
  providerNumber: '8888888Y',
};

function row(mbsItemNumber: string, description: string, benefitAssigned: string): ServiceRow {
  return { serviceDate: '2026-09-12', time: '09:00', mbsItemNumber, description, benefitAssigned };
}

/** The practice every seeding script this session has used. */
export const DEV_PRACTICE = '821709fb-7f89-4fcf-95c0-27c5eb55cec8';

export const BLANK: Draft = {
  practiceId: DEV_PRACTICE,
  formReference: '',
  serviceDate: '2026-09-12',
  locationId: 'HSS06100',
  claimStatus: 'STORED FOR LATER TRANSMISSION',
  headingLines: HEADING,
  patientRecordNumber: '',
  givenNames: '',
  familyName: '',
  dateOfBirth: '1980-01-01',
  address: '2 Example Street, Sampletown NSW 2000',
  mobile: '0400 000 000',
  // INVALID BY CONSTRUCTION — this fails its own checksum (CLAUDE.md §7c).
  // eslint-disable-next-line no-restricted-syntax -- the DB4's own decided exception (D-2026-09-14-03): the practice's form prints it, so the envelope carries it. Composed and posted, never used to identify anybody (hard rule 1).
  medicareCardNumber: '2999 88886 5',
  irn: '1',
  locationName: 'Fakevale Family Medical Practice',
  locationAddressLines: '14 NOWHERE STREET',
  locationSuburb: 'Fakevale',
  locationState: 'NSW',
  locationPostcode: '2999',
  providers: [{ ...SERVICING }, { ...PAYEE }],
  services: [row('23', 'Level B Surgery', '$45.05')],
  queueName: 'default',
  queueLabel: 'Front desk printer',
  // What AOBPRINTER stamps by default (DEFAULT_TEMPLATE_VERSION in apps/aobprinter/src/template.ts).
  parserTemplateVersion: 'pracsoft3-db4-2026-10-1',
  capturedAt: '',
};

export interface Preset {
  readonly key: string;
  readonly label: string;
  /** What this is for, in the words the tester needs. */
  readonly why: string;
  readonly apply: (base: Draft) => Draft;
}

export const PRESETS: readonly Preset[] = [
  {
    key: 'clean',
    label: 'A clean form',
    why: 'Everything read. Places, and sends to a tablet with no band at all.',
    apply: (d) => ({
      ...d,
      services: [row('23', 'Level B Surgery', '$45.05'), row('10990', 'Bulk billing incentive', '$7.15')],
    }),
  },
  {
    key: 'no-amount',
    label: 'No amount on any row',
    why: 'The one genuinely new check — nothing upstream reads an amount. One red bullet.',
    apply: (d) => ({
      ...d,
      services: [row('23', 'Level B Surgery', ''), row('10990', 'Bulk billing incentive', '')],
    }),
  },
  {
    key: 'no-irn',
    label: 'A card number with no IRN',
    why: 'The half-read card. The tablet would show a masked number and ask for an IRN it has not drawn.',
    apply: (d) => ({ ...d, irn: '' }),
  },
  {
    key: 'no-provider-name',
    label: 'A servicing provider with no name',
    why: 'Empty, not absent: the DTO requires the field, so a template that emitted the line without reading it.',
    apply: (d) => ({
      ...d,
      providers: [{ ...SERVICING, name: '' }, { ...PAYEE }],
    }),
  },
  {
    key: 'three-faults',
    label: 'Every live check at once',
    why: 'No IRN, no provider name, no amount — the three that can actually fire, in one band.',
    apply: (d) => ({
      ...d,
      irn: '',
      providers: [{ ...SERVICING, name: '' }, { ...PAYEE }],
      services: [row('23', 'Level B Surgery', '')],
    }),
  },
  {
    key: 'ragged-amounts',
    label: 'Ragged amounts',
    why: 'Whole dollars, no symbol (the -09-1 shape), one decimal, a grouping comma and a zero — reproduced exactly, aligned on the point.',
    apply: (d) => ({
      ...d,
      services: [
        row('23', 'Level B, whole dollars', '$45'),
        row('36', 'Level C, no symbol (a -09-1 record)', '45.05'),
        row('75870', 'Attendance, one decimal', '$1234.5'),
        row('14206', 'Iron infusion, grouped', '$1,234.55'),
        row('10990', 'Incentive, nothing charged', '$0.00'),
      ],
    }),
  },
  {
    key: 'no-card-at-all',
    label: 'No card number at all',
    why: 'NOT a fault — the IRN check is conditional on a card number. This should send cleanly.',
    // eslint-disable-next-line no-restricted-syntax -- clearing the field, which is the fault being seeded.
    apply: (d) => ({ ...d, medicareCardNumber: '', irn: '' }),
  },
  {
    key: 'no-location',
    label: 'A form with no place of practice',
    why: 'NOT a check — 2A simply loses its servicing-location block. Shows what the left column looks like without it.',
    apply: (d) => ({
      ...d,
      locationName: '',
      locationAddressLines: '',
      locationSuburb: '',
      locationState: '',
      locationPostcode: '',
    }),
  },
  {
    key: 'refused-no-chart',
    label: 'Refused at the door: no chart number',
    why: 'Never becomes an agreement. The job row records `no_chart_number` and nothing reaches the desk.',
    apply: (d) => ({ ...d, patientRecordNumber: '' }),
  },
  {
    key: 'refused-no-items',
    label: 'Refused at the door: no service items',
    why: 'Also a backstop check, and this is the door that actually holds it — `no_service_items`.',
    apply: (d) => ({ ...d, services: [] }),
  },
];

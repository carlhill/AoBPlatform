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

/**
 * ONE STATEMENT PRINTED UNDER THE PRIVACY NOTICE, as AOBPRINTER reads it
 * (`assignment.statements` in `pracsoft3-db4-2026-10-1`). `inScope: false` is
 * the pathology offer — s 65C(4) items 1-4, out of scope (CLAUDE.md §8) —
 * carried as data and never drawn for a patient (`statementsOf` in
 * `db4-form-view.ts`). The two flags are optional because a template may not
 * read them, and a reprint has to send back exactly what came in.
 */
export interface AssignmentStatement {
  key: string;
  text: string;
  ticked?: boolean;
  inScope?: boolean;
}

/**
 * THE PRIVACY NOTICE AND THE ASSIGNMENT STATEMENTS ARE PRINTED-FORM DATA, NOT
 * VERSIONED CONTENT. AOBPRINTER reads them off the page into `assignment`, and
 * `buildDb4FormView` draws the tablet's legal page (2C) from there. Until 11
 * October 2026 this tool could not send them at all, so no form it composed
 * had a privacy notice on 2C — and a form with no privacy notice cannot show
 * how long 2C really is.
 */
export interface PrintedAssignment {
  /** One entry per printed paragraph, in order. */
  privacyNotice: string[];
  /** The word printed between the two statements. */
  statementsJoinedBy?: string;
  statements: AssignmentStatement[];
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
  /**
   * NULL SENDS NO `assignment` BLOCK, which is what every preset except
   * `long-form` does, so their 2C shows the affirmations and no notice.
   */
  assignment: PrintedAssignment | null;
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
  assignment: null,
  queueName: 'default',
  queueLabel: 'Front desk printer',
  // What AOBPRINTER stamps by default (DEFAULT_TEMPLATE_VERSION in apps/aobprinter/src/template.ts).
  parserTemplateVersion: 'pracsoft3-db4-2026-10-1',
  capturedAt: '',
};

/**
 * THE PRIVACY NOTICE AND STATEMENTS A PRACSOFT DB4 PRINTS, word for word as
 * `DB4-print.example.json` records them off the scanned form. The government's
 * wording on the government's page, reproduced, not ours (D-2026-09-14-02).
 */
export const PRINTED_ASSIGNMENT: PrintedAssignment = {
  privacyNotice: [
    'Privacy Notice: Your personal information is protected by law, including the Privacy Act 1988, and is collected by Services Australia for the assessment and administration of payments and services. This information is required to process your application or claim.',
    'Your information may be used by the agency or given to other parties for the purposes of research, investigation or where you have agreed or it is required or authorised by law.',
    'You can get more information about the way in which the Services Australia will manage your personal information, including our privacy policy at servicesaustralia.gov.au/privacy or by requesting a copy from the agency.',
    'Information about medical/dental expenses for people under the age of 18 may also be disclosed to adults on the same Medicare card, through taxation statements.',
    'To be completed by the person assigning benefits for the services stated on this form.',
  ],
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
};

/**
 * THE LONGEST SERVICE DESCRIPTION ON FILE — PracSoft's own wording for 75870
 * off the scanned form in `DB4-print.example.json`. A row this long wraps to
 * several lines in the 2B table.
 */
const LONGEST_DESCRIPTION =
  'Professional attendance (the attendance service) by a general practitioner, a medical practitioner or a prescribed medical practitioner, at which a general practice support service is provided';

export interface Preset {
  readonly key: string;
  readonly label: string;
  /** What this is for, in the words the tester needs. */
  readonly why: string;
  readonly apply: (base: Draft) => Draft;
}

/**
 * WHAT A PRESET STARTS FROM: the blank draft, plus the patient the tester is
 * pointing at.
 *
 * THE NAME TRAVELS WITH THE CHART NUMBER (11 October 2026). It used to be the
 * chart number alone, so picking a preset blanked the Given names and Family
 * name the tester had typed — and a DB4 with no printed name makes
 * `buildDb4FormView` return no form at all (its guard wants a name and a
 * service row), so the tablet fell back to the plain particulars, which name
 * the patient from the MATCHED RECORD. A name typed before picking a preset
 * then appeared nowhere on the tablet. The chart number and the name are one
 * patient on the page; a preset keeps both.
 */
export function startFromPreset(preset: Preset, current: Draft): Draft {
  return preset.apply({
    ...BLANK,
    practiceId: current.practiceId,
    patientRecordNumber: current.patientRecordNumber,
    givenNames: current.givenNames,
    familyName: current.familyName,
  });
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
        row('36', 'Level C, printed without a symbol', '45.05'),
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
    key: 'long-form',
    label: 'The longest form: twelve rows and the privacy notice',
    why: 'Reproduces the overflow (D-2026-10-10-10): a long place of practice and patient address on 2A, two long provider names and twelve rows, one wrapping, on 2B, the full printed privacy notice on 2C. No box may scroll; every page must still fit.',
    apply: (d) => ({
      ...d,
      // The tester's name wins; a blank one gets a long fake.
      givenNames: d.givenNames || 'Maximiliana Seraphina Josephine',
      familyName: d.familyName || 'Fictitious-Placeholderington',
      address: 'Unit 1207, Level 12, The Imaginary Towers, 1432-1440 Nowhere Boulevard, Fakevale Heights North NSW 2999',
      locationName: 'Fakevale Heights and District Family Medical Practice and Skin Cancer Clinic',
      locationAddressLines: [
        'SUITE 14, LEVEL 3, FAKEVALE MEDICAL AND PROFESSIONAL CENTRE',
        'CORNER OF NOWHERE STREET AND IMAGINARY PARADE',
        'ENTRY VIA SHOP 2-4, PLACEHOLDER ARCADE',
      ].join('\n'),
      locationSuburb: 'Fakevale Heights North',
      providers: [
        // The NUMBER is the dev practice's anchor and must stay; names are never checked (D-2026-09-28-01).
        { ...SERVICING, name: 'Dr Ficticia Annabella Nonperson-Placeholderington' },
        { ...PAYEE, name: 'Dr Madeup Bartholomew Notreal-Imaginarius' },
      ],
      // Plausible items in PracSoft's style with FAKE amounts — not a fee schedule.
      services: [
        row('23', 'Level B Surgery', '$45.05'),
        row('10990', 'Bulk billing incentive', '$7.15'),
        row('75870', LONGEST_DESCRIPTION, '$22.40'),
        row('11700', 'Twelve-lead electrocardiography, tracing and report', '$34.40'),
        row('30071', 'Diagnostic biopsy of skin or mucous membrane', '$55.10'),
        row('30026', 'Repair of wound on face or neck, superficial, not more than 7 cm long', '$70.35'),
        row('10997', 'Chronic disease service by a practice nurse on behalf of a medical practitioner', '$14.25'),
        row('73806', 'Pregnancy test by one or more immunochemical methods', '$10.15'),
        row('16500', 'Antenatal attendance', '$46.20'),
        row('14206', 'Hormone or living tissue implant, insertion by cannula', '$41.75'),
        row('2713', 'GP mental health treatment consultation, at least 20 minutes', '$78.95'),
        row('30216', 'Aspiration of haematoma', '$24.20'),
      ],
      assignment: PRINTED_ASSIGNMENT,
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

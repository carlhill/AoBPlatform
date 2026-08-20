/**
 * Mock PMS adapter — the ONLY adapter implementation until decision D-01
 * (Medtech write-back mechanism) resolves. Do not guess Medtech's API
 * (CLAUDE.md §5); build core behaviour against this mock behind the FR-9.1
 * interface, then implement the real MedtechEvolutionAdapter once the
 * mechanism is proven in the Phase 0 spike.
 *
 * Fixture rule (CLAUDE.md §7): sample data uses obviously fake identities and
 * NEVER real Medicare-format numbers — and per HARD-03 this mock has no
 * Medicare-number field at all.
 */
import type {
  PmsAdapter,
  PmsAdapterCapabilities,
  PmsAppointment,
  PmsInvoice,
  PmsPatientRecord,
  PmsProvider,
  WriteArtefactRequest,
  WriteResult,
} from '@aobplatform/contracts';
import type { IsoDate } from '@aobplatform/domain';

const CAPABILITIES: PmsAdapterCapabilities = {
  readPatient: true,
  readAppointments: true,
  readProviders: true,
  readInvoices: true,
  writeArtefact: true,
  writeNote: true,
  claimEvents: false, // conservative default: retention clock falls back per REQ-INT-04
};

const FIXTURE_PATIENTS: PmsPatientRecord[] = [
  {
    pmsLinkageKey: 'mock-pat-001',
    familyName: 'Testpatient',
    givenNames: 'Alex',
    dateOfBirth: '1957-03-14',
    genderAsIdentified: 'male',
    address: '1 Example Street, Sampletown NSW 2000',
    patientRecordNumber: 'MOCK-0001',
    preferredLanguage: 'en',
    mobile: '+61400000000',
    email: 'alex.testpatient@example.invalid',
  },
];

export class MockPmsAdapter implements PmsAdapter {
  readonly pms = 'mock' as const;
  readonly capabilities = CAPABILITIES;

  private writtenArtefacts = new Map<string, WriteArtefactRequest>();

  async readPatient(pmsLinkageKey: string): Promise<PmsPatientRecord | null> {
    return FIXTURE_PATIENTS.find((p) => p.pmsLinkageKey === pmsLinkageKey) ?? null;
  }

  async findPatient(query: {
    familyName?: string;
    dateOfBirth?: string;
    patientRecordNumber?: string;
  }): Promise<readonly PmsPatientRecord[]> {
    return FIXTURE_PATIENTS.filter(
      (p) =>
        (query.familyName === undefined || p.familyName.toLowerCase() === query.familyName.toLowerCase()) &&
        (query.dateOfBirth === undefined || p.dateOfBirth === query.dateOfBirth) &&
        (query.patientRecordNumber === undefined || p.patientRecordNumber === query.patientRecordNumber),
    );
  }

  async readAppointments(_date: IsoDate): Promise<readonly PmsAppointment[]> {
    return [];
  }

  async readProviders(): Promise<readonly PmsProvider[]> {
    return [
      {
        pmsProviderKey: 'mock-prov-001',
        name: 'Dr Example Provider',
        locationAddress: '1 Example Street, Sampletown NSW 2000',
      },
    ];
  }

  /**
   * Fixture invoices spanning the chase bands (REQ-CHASE-05): one recent
   * (standard band), one ~10 months old (urgent), one just inside the last
   * seven days of the 12-month lodgement window (last chance). Dates are
   * derived from "now" so the fixtures stay in-band forever.
   */
  async readInvoices(_since: IsoDate): Promise<readonly PmsInvoice[]> {
    const daysAgo = (days: number): IsoDate =>
      new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) as IsoDate;
    return [
      {
        pmsInvoiceKey: 'mock-inv-001',
        patientLinkageKey: 'mock-pat-001',
        providerLinkageKey: 'mock-prov-001',
        serviceDate: daysAgo(14),
        mbsItemNumbers: ['23'],
      },
      {
        pmsInvoiceKey: 'mock-inv-002',
        patientLinkageKey: 'mock-pat-001',
        providerLinkageKey: 'mock-prov-001',
        serviceDate: daysAgo(300),
        mbsItemNumbers: ['36'],
      },
      {
        pmsInvoiceKey: 'mock-inv-003',
        patientLinkageKey: 'mock-pat-001',
        providerLinkageKey: 'mock-prov-001',
        serviceDate: daysAgo(360),
        mbsItemNumbers: ['23', '10990'],
      },
    ];
  }

  /** Idempotent by artefact hash (FR-9.3). */
  async writeArtefact(request: WriteArtefactRequest): Promise<WriteResult> {
    if (this.writtenArtefacts.has(request.artefactSha256)) {
      return { written: false, pmsDocumentKey: `mock-doc-${request.artefactSha256.slice(0, 8)}` };
    }
    this.writtenArtefacts.set(request.artefactSha256, request);
    return { written: true, pmsDocumentKey: `mock-doc-${request.artefactSha256.slice(0, 8)}` };
  }

  async writeNote(_patientLinkageKey: string, _note: string): Promise<WriteResult> {
    return { written: true };
  }
}

import {
  INBOUND_LANES,
  LANE_POLICIES,
  PRINT_DOCUMENT_LANES,
  PRINT_DOCUMENT_TYPES,
  isPrintDocumentType,
  laneFor,
} from './inbound-lanes';

describe('inbound lanes — Carl: "having multiple queues is important"', () => {
  it('puts the patient at the desk, and the invoice the practice is not paid without, on the critical lane', () => {
    expect(laneFor('arrival_slip')).toBe('critical');
    expect(laneFor('invoice')).toBe('critical');
  });

  it('puts the morning list — pre-staging, hours ahead — on the standard lane', () => {
    expect(laneFor('appointment_list')).toBe('standard');
  });

  it('gives every document type a lane, and every lane a bounded SLO', () => {
    for (const type of PRINT_DOCUMENT_TYPES) {
      expect(INBOUND_LANES).toContain(PRINT_DOCUMENT_LANES[type]);
    }
    for (const lane of INBOUND_LANES) {
      expect(LANE_POLICIES[lane].sloSeconds).toBeGreaterThan(0);
      expect(LANE_POLICIES[lane].pollMs).toBeGreaterThan(0);
    }
  });

  it('orders the lanes: critical is looked at most often and promises the least wait', () => {
    expect(LANE_POLICIES.critical.pollMs).toBeLessThan(LANE_POLICIES.standard.pollMs);
    expect(LANE_POLICIES.standard.pollMs).toBeLessThan(LANE_POLICIES.fyi.pollMs);
    expect(LANE_POLICIES.critical.sloSeconds).toBeLessThan(LANE_POLICIES.standard.sloSeconds);
    expect(LANE_POLICIES.standard.sloSeconds).toBeLessThan(LANE_POLICIES.fyi.sloSeconds);
  });

  it('the critical lane worker hop fits inside its own SLO', () => {
    expect(LANE_POLICIES.critical.pollMs / 1000).toBeLessThan(LANE_POLICIES.critical.sloSeconds);
  });

  it('recognises only the declared document types', () => {
    expect(isPrintDocumentType('invoice')).toBe(true);
    expect(isPrintDocumentType('clinical_notes')).toBe(false);
  });
});

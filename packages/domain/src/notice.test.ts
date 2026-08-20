import {
  assertMethodFidelity,
  assertNoticeContentComplete,
  COMPLIANCE_BEARING_STATES,
  dispatchedWithinWindow,
  escalationLevel,
  isComplianceBearing,
  isWithinNoticeWindow,
  MethodFidelityError,
  noticeDeadline,
  NoticeContentError,
  NOTICE_DELIVERY_STATES,
} from './notice';

const CLAIM_LODGED = new Date('2026-09-01T09:00:00Z');

describe('notice_carries_four_mandatory_elements (reg 89AA)', () => {
  const complete = {
    practitionerName: 'Dr Example Provider',
    patientName: 'Alex Testpatient',
    serviceDate: '2026-09-01',
    benefitAmountCents: 6570,
  };

  it('accepts a complete notice', () => {
    expect(() => assertNoticeContentComplete(complete)).not.toThrow();
  });

  it.each(['practitionerName', 'patientName', 'serviceDate', 'benefitAmountCents'] as const)(
    'refuses a notice missing %s — the obligation was not correctly formed',
    (field) => {
      const partial = { ...complete } as Record<string, unknown>;
      delete partial[field];
      expect(() => assertNoticeContentComplete(partial)).toThrow(NoticeContentError);
    },
  );

  it('the benefit amount is REQUIRED here — the one place in the product it appears', () => {
    expect(() => assertNoticeContentComplete({ ...complete, benefitAmountCents: undefined })).toThrow(
      /benefitAmountCents/,
    );
  });
});

describe('method_fidelity_blocks_channel_mismatch (REQ-DEL-02)', () => {
  it('blocks sending by SMS when the agreement names email — a breach even if it arrives', () => {
    expect(() => assertMethodFidelity('email', 'sms')).toThrow(MethodFidelityError);
    expect(() => assertMethodFidelity('email', 'sms')).toThrow(/REQ-DEL-02/);
  });
  it('permits the method the agreement names', () => {
    expect(() => assertMethodFidelity('email', 'email')).not.toThrow();
  });
});

describe('five_delivery_states_never_collapse (REQ-DEL-01)', () => {
  it('has exactly the five states', () => {
    expect(NOTICE_DELIVERY_STATES).toEqual(['composed', 'dispatched', 'delivered', 'read', 'failed']);
  });

  it('read_is_never_compliance_bearing (REQ-DEL-07)', () => {
    expect(isComplianceBearing('read')).toBe(false);
    expect(COMPLIANCE_BEARING_STATES).not.toContain('read');
    expect(isComplianceBearing('dispatched')).toBe(true);
    expect(isComplianceBearing('delivered')).toBe(true);
  });
});

describe('twenty_four_hour_clock_runs_from_claim_lodgement (REQ-END-05, REQ-DEL-03)', () => {
  it('deadline is 24h after the CLAIM, not the service', () => {
    expect(noticeDeadline(CLAIM_LODGED).toISOString()).toBe('2026-09-02T09:00:00.000Z');
  });

  it('escalates at 12 and 18 hours, before the window closes', () => {
    expect(escalationLevel(CLAIM_LODGED, new Date('2026-09-01T18:00:00Z'))).toBe(null);
    expect(escalationLevel(CLAIM_LODGED, new Date('2026-09-01T21:00:00Z'))).toBe(12);
    expect(escalationLevel(CLAIM_LODGED, new Date('2026-09-02T03:30:00Z'))).toBe(18);
  });

  it('is absolute-time based — a Perth practice three hours behind Sydney gets the same deadline', () => {
    expect(isWithinNoticeWindow(CLAIM_LODGED, new Date('2026-09-02T08:59:00Z'))).toBe(true);
    expect(isWithinNoticeWindow(CLAIM_LODGED, new Date('2026-09-02T09:01:00Z'))).toBe(false);
  });

  it('compliance is DISPATCH within the window — never whether it was read or answered', () => {
    expect(dispatchedWithinWindow(CLAIM_LODGED, new Date('2026-09-02T08:00:00Z'))).toBe(true);
    expect(dispatchedWithinWindow(CLAIM_LODGED, new Date('2026-09-02T10:00:00Z'))).toBe(false);
    expect(dispatchedWithinWindow(CLAIM_LODGED, null)).toBe(false);
  });
});

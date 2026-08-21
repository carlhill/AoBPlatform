import {
  AMENDABLE_FIELDS,
  AmendmentError,
  assertAmendmentAllowed,
  checksAffectedBy,
  diffApplication,
  isAmendable,
} from './amendment';

const submitted = {
  name: 'Riverbank Family Practice',
  abn: '53004085616',
  adminName: 'Marta Ellis',
  adminEmail: 'marta@riverbank.invalid',
  adminPhone: '0298765432',
  managerName: 'Ilya Petrov',
  headOfficeSuburb: 'Riverbank',
  headOfficeState: 'NSW',
};

describe('what may be amended', () => {
  // The rule that matters most: everything hangs off the ABN, so moving it
  // would carry a clean entity's passed checks onto a different entity.
  it('REFUSES the ABN — a different ABN is a different application', () => {
    expect(isAmendable('abn')).toBe(false);
    expect(() =>
      assertAmendmentAllowed({
        validationState: 'pending',
        changes: [{ field: 'abn', from: '53004085616', to: '51824753556' }],
      }),
    ).toThrow(/different application/);
  });

  it('refuses every value that comes from the register, not the applicant', () => {
    for (const field of ['legalName', 'entityType', 'abnStatus', 'acn']) {
      expect(isAmendable(field)).toBe(false);
      expect(() =>
        assertAmendmentAllowed({ validationState: 'pending', changes: [{ field, from: 'a', to: 'b' }] }),
      ).toThrow(AmendmentError);
    }
  });

  it('refuses the decision itself', () => {
    expect(() =>
      assertAmendmentAllowed({
        validationState: 'pending',
        changes: [{ field: 'validationState', from: 'pending', to: 'validated' }],
      }),
    ).toThrow(/Only a reviewer decides/);
  });

  it('allows the contact details and address where typos live', () => {
    for (const field of ['adminPhone', 'adminEmail', 'managerName', 'headOfficeSuburb', 'name']) {
      expect(isAmendable(field)).toBe(true);
    }
  });

  it('refuses an unknown field outright rather than ignoring it', () => {
    expect(() =>
      assertAmendmentAllowed({ validationState: 'pending', changes: [{ field: 'nonsense', from: null, to: 'x' }] }),
    ).toThrow(/not a field an applicant can amend/);
  });
});

describe('when it may be amended', () => {
  const change = [{ field: 'adminPhone', from: '0298765432', to: '0298765499' }];

  it('allows a pending application', () => {
    expect(() => assertAmendmentAllowed({ validationState: 'pending', changes: change })).not.toThrow();
  });

  it('refuses an approved practice — that is the console, with a named admin', () => {
    expect(() => assertAmendmentAllowed({ validationState: 'validated', changes: change })).toThrow(/console/);
  });

  it('refuses a rejected application — the decision is closed', () => {
    expect(() => assertAmendmentAllowed({ validationState: 'rejected', changes: change })).toThrow(/already been decided/);
  });

  it('refuses an empty amendment rather than recording a no-op', () => {
    expect(() => assertAmendmentAllowed({ validationState: 'pending', changes: [] })).toThrow(/nothing to submit/);
  });
});

describe('diffApplication', () => {
  it('returns only what actually moved', () => {
    const changes = diffApplication(submitted, { ...submitted, adminPhone: '0298765499' });
    expect(changes).toEqual([{ field: 'adminPhone', from: '0298765432', to: '0298765499' }]);
  });

  it('does not report a resubmitted identical form as sixteen changes', () => {
    expect(diffApplication(submitted, { ...submitted })).toEqual([]);
  });

  it('treats blank and absent as the same — neither is a value', () => {
    expect(diffApplication({ website: '' }, { website: '   ' })).toEqual([]);
    expect(diffApplication({ website: null }, { website: '' })).toEqual([]);
  });

  it('records a value being cleared', () => {
    expect(diffApplication({ managerPhone: '0298765433' }, { managerPhone: '' })).toEqual([
      { field: 'managerPhone', from: '0298765433', to: null },
    ]);
  });

  it('ignores fields the applicant did not send', () => {
    expect(diffApplication(submitted, { adminPhone: '0298765499' })).toHaveLength(1);
  });

  /*
   * The regression that destroyed a live application.
   *
   * A DTO instance carries every declared optional property as `undefined`, so
   * spreading one produces an object where all sixteen fields are PRESENT and
   * undefined. Reading that as "cleared" meant a request changing one field
   * wiped the other fifteen — name, both contacts, the whole address.
   */
  it('treats an ABSENT field as untouched, not as cleared', () => {
    const dtoShaped = {
      name: undefined,
      website: undefined,
      adminName: undefined,
      adminEmail: undefined,
      adminPhone: '0298765499',
      adminPosition: undefined,
      managerName: undefined,
      managerEmail: undefined,
      managerPhone: undefined,
      managerPosition: undefined,
      headOfficeLine1: undefined,
      headOfficeLine2: undefined,
      headOfficeSuburb: undefined,
      headOfficeState: undefined,
      headOfficePostcode: undefined,
      statedPractitionerCount: undefined,
    };
    expect(diffApplication(submitted, dtoShaped)).toEqual([
      { field: 'adminPhone', from: '0298765432', to: '0298765499' },
    ]);
  });

  it('still allows an EXPLICIT clear, which is a different intention', () => {
    expect(diffApplication({ managerPhone: '0298765433' }, { managerPhone: '' })).toEqual([
      { field: 'managerPhone', from: '0298765433', to: null },
    ]);
  });

  it('never reports a locked field, even if one is posted', () => {
    const changes = diffApplication(submitted, { ...submitted, abn: '51824753556' });
    expect(changes.map((c) => c.field)).not.toContain('abn');
  });
});

describe('checksAffectedBy', () => {
  it('flags a phone change against a recorded phone call', () => {
    const changes = [{ field: 'adminPhone', from: '0298765432', to: '0298765499' }];
    expect(checksAffectedBy(changes, ['entitlement.phone_call'])).toEqual(['entitlement.phone_call']);
  });

  it('says nothing when the check was never recorded', () => {
    const changes = [{ field: 'adminPhone', from: '0298765432', to: '0298765499' }];
    expect(checksAffectedBy(changes, [])).toEqual([]);
  });

  it('says nothing when the field bears on no recorded check', () => {
    const changes = [{ field: 'adminPosition', from: 'Manager', to: 'Practice Manager' }];
    expect(checksAffectedBy(changes, ['entitlement.phone_call'])).toEqual([]);
  });

  it('flags an address change against a locality check', () => {
    const changes = [{ field: 'headOfficeSuburb', from: 'Riverbank', to: 'Riverview' }];
    expect(checksAffectedBy(changes, ['address.ahpra_locality_match', 'entitlement.phone_call'])).toEqual([
      'address.ahpra_locality_match',
    ]);
  });

  it('does not report the same check twice when two fields bear on it', () => {
    const changes = [
      { field: 'headOfficeSuburb', from: 'A', to: 'B' },
      { field: 'headOfficePostcode', from: '2000', to: '2444' },
    ];
    expect(checksAffectedBy(changes, ['address.confirmed'])).toEqual(['address.confirmed']);
  });
});

describe('the amendable list itself', () => {
  it('contains no register-derived field', () => {
    for (const forbidden of ['abn', 'acn', 'legalName', 'entityType', 'abnStatus', 'nameMatchTier']) {
      expect(AMENDABLE_FIELDS as readonly string[]).not.toContain(forbidden);
    }
  });
});

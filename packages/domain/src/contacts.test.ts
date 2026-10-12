import {
  ContactError,
  assertContactsIndependent,
  contactClash,
  normaliseEmail,
  normalisePhone,
} from './contacts';

describe('normalisePhone', () => {
  it('reduces the four ways one mobile gets typed to one value', () => {
    const forms = ['0408169971', '0408 169 971', '+61 408 169 971', '(04) 0816-9971'];
    const normalised = forms.map(normalisePhone);
    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe('0408169971');
  });

  it('treats the international and national forms as one number', () => {
    expect(normalisePhone('+61408169971')).toBe(normalisePhone('0408169971'));
    expect(normalisePhone('0061408169971')).toBe(normalisePhone('0408169971'));
  });

  it('keeps distinct numbers distinct', () => {
    expect(normalisePhone('0408169971')).not.toBe(normalisePhone('0408169972'));
  });

  it('returns empty for blank, so absence is never a clash', () => {
    expect(normalisePhone('')).toBe('');
    expect(normalisePhone('   ')).toBe('');
  });
});

describe('normaliseEmail', () => {
  it('folds case', () => {
    expect(normaliseEmail('Carl@Hillsempire.com')).toBe('carl@hillsempire.com');
  });
});

describe('contactClash', () => {
  const independent = {
    adminEmail: 'carl@example.invalid',
    adminPhone: '0408169971',
    managerEmail: 'audrey@example.invalid',
    managerPhone: '0408169972',
  };

  it('passes two genuinely independent contacts', () => {
    expect(contactClash(independent)).toBeNull();
  });

  it('catches a shared email regardless of case', () => {
    expect(contactClash({ ...independent, managerEmail: 'CARL@example.invalid' })).toBe('email');
  });

  // The bug this module was written for: one person, named twice, one handset.
  it('catches a shared phone', () => {
    expect(contactClash({ ...independent, managerPhone: '0408169971' })).toBe('phone');
  });

  it('catches a shared phone typed in a different format', () => {
    expect(contactClash({ ...independent, managerPhone: '+61 408 169 971' })).toBe('phone');
  });

  it('reports email first when both clash', () => {
    expect(
      contactClash({ ...independent, managerEmail: 'carl@example.invalid', managerPhone: '0408169971' }),
    ).toBe('email');
  });

  it('permits an absent manager — a sole trader has none', () => {
    expect(contactClash({ adminEmail: 'carl@example.invalid', adminPhone: '0408169971' })).toBeNull();
    expect(
      contactClash({ ...independent, managerEmail: '', managerPhone: '' }),
    ).toBeNull();
    expect(
      contactClash({ ...independent, managerEmail: null, managerPhone: null }),
    ).toBeNull();
  });

  it('does not treat two blank manager fields as matching each other', () => {
    expect(contactClash({ adminEmail: '', adminPhone: '', managerEmail: '', managerPhone: '' })).toBeNull();
  });
});

describe('assertContactsIndependent', () => {
  it('throws on a shared phone, carrying the rule reference', () => {
    expect(() =>
      assertContactsIndependent({
        adminEmail: 'carl@example.invalid',
        adminPhone: '0408169971',
        managerEmail: 'audrey@example.invalid',
        managerPhone: '0408 169 971',
      }),
    ).toThrow(ContactError);
    expect(() =>
      assertContactsIndependent({
        adminEmail: 'carl@example.invalid',
        adminPhone: '0408169971',
        managerEmail: 'audrey@example.invalid',
        managerPhone: '0408 169 971',
      }),
    ).toThrow(/FR-1\.9/);
  });

  it('says why, in terms of what the control is for', () => {
    expect(() =>
      assertContactsIndependent({
        adminEmail: 'carl@example.invalid',
        adminPhone: '0408169971',
        managerEmail: 'audrey@example.invalid',
        managerPhone: '0408169971',
      }),
    ).toThrow(/one handset/);
  });

  it('is silent when the contacts are independent', () => {
    expect(() =>
      assertContactsIndependent({
        adminEmail: 'carl@example.invalid',
        adminPhone: '0408169971',
        managerEmail: 'audrey@example.invalid',
        managerPhone: '0298765432',
      }),
    ).not.toThrow();
  });
});

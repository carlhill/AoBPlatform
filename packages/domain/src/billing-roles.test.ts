import {
  BILLING_ROLES,
  BILLING_ROLES_VERSION,
  BILLING_ROLE_KEYS,
  DEFAULT_BILLING_ROLE,
  isBillingRole,
  mayBeProviderOnAgreement,
  parseBillingRoleContent,
  providerIsGpFor,
} from './billing-roles';
import { assertCanBeProviderOnAgreement, canOfferEnduring, HardRuleViolation } from './guards';
import { decideVisitAgreement } from './visit-policy';

describe('billing roles — who may be the provider on an agreement', () => {
  it('is versioned content, in file order, and the version travels', () => {
    expect(BILLING_ROLES_VERSION).toMatch(/^billing-roles-/);
    expect(BILLING_ROLE_KEYS).toEqual(['servicing_provider', 'works_under_provider', 'not_billable']);
    expect(BILLING_ROLES[0]?.key).toBe(DEFAULT_BILLING_ROLE);
  });

  it('carries no display words — those are the string table’s, keyed by role', () => {
    for (const option of BILLING_ROLES) {
      expect(Object.keys(option).sort()).toEqual(['key', 'mayBeProviderOnAgreement']);
    }
  });

  /**
   * THE NAMED TEST FOR CARL'S RULE. A practice nurse on a "for and on behalf
   * of" item delivers the service and bills nothing under their own number:
   * the claim goes under the GP, so the assignment does too.
   */
  it('nurse_cannot_be_the_provider_on_an_agreement', () => {
    expect(mayBeProviderOnAgreement('works_under_provider')).toBe(false);
    expect(() => assertCanBeProviderOnAgreement('works_under_provider', 'Nurse Example')).toThrow(
      HardRuleViolation,
    );
    // And the same for somebody who generates no Medicare claim at all.
    expect(mayBeProviderOnAgreement('not_billable')).toBe(false);
    expect(() => assertCanBeProviderOnAgreement('not_billable', 'Sam Phlebotomy')).toThrow(HardRuleViolation);

    // A servicing provider passes, which is the other half of the rule.
    expect(() => assertCanBeProviderOnAgreement('servicing_provider', 'Dr Sample')).not.toThrow();
  });

  /**
   * A NURSE PRACTITIONER IS AN ELIGIBLE PROVIDER IN THEIR OWN RIGHT — and is
   * still not a GP, so no enduring agreement (hard rule 6, REQ-END-01a). The
   * two facts are separate and this test exists because collapsing them is the
   * obvious mistake.
   */
  it('nurse_practitioner_is_a_servicing_provider', () => {
    expect(mayBeProviderOnAgreement('servicing_provider')).toBe(true);
    expect(() => assertCanBeProviderOnAgreement('servicing_provider', 'NP Example')).not.toThrow();

    expect(
      providerIsGpFor({ billingRole: 'servicing_provider', providerType: 'nurse_practitioner' }),
    ).toBe(false);
    expect(canOfferEnduring('nurse_practitioner')).toBe(false);

    // So the visit policy never offers them an enduring agreement.
    const decision = decideVisitAgreement({
      providerIsGp: providerIsGpFor({ billingRole: 'servicing_provider', providerType: 'nurse_practitioner' }),
      activeEnduringForProviderAndPatient: false,
      practiceOffersEnduringByDefault: true,
      patientDeclinedEnduring: false,
    });
    expect(decision.type).not.toBe('enduring');
  });

  it('providerIsGpFor needs BOTH halves — a GP working under another provider is not one here', () => {
    expect(providerIsGpFor({ billingRole: 'servicing_provider', providerType: 'general_practitioner' })).toBe(
      true,
    );
    expect(providerIsGpFor({ billingRole: 'works_under_provider', providerType: 'general_practitioner' })).toBe(
      false,
    );
    expect(providerIsGpFor({ billingRole: 'not_billable', providerType: 'general_practitioner' })).toBe(false);
  });

  it('an unrecognised role answers no, rather than being waved through', () => {
    expect(isBillingRole('locum_maybe')).toBe(false);
    expect(mayBeProviderOnAgreement('locum_maybe')).toBe(false);
    expect(providerIsGpFor({ billingRole: 'locum_maybe', providerType: 'general_practitioner' })).toBe(false);
  });

  it('carries no benefit or amount anywhere (hard rule 4)', () => {
    expect(JSON.stringify(BILLING_ROLES)).not.toMatch(/amount|benefit|fee|rebate|\$/i);
  });
});

describe('billing roles — the content file is validated at load', () => {
  const good = {
    version: 'test-1',
    options: [
      { key: 'servicing_provider', mayBeProviderOnAgreement: true },
      { key: 'works_under_provider', mayBeProviderOnAgreement: false },
    ],
  };

  it('accepts the good shape', () => {
    expect(parseBillingRoleContent(good).options).toHaveLength(2);
  });

  it('refuses a list with no servicing_provider — it is the column default', () => {
    expect(() =>
      parseBillingRoleContent({ ...good, options: [{ key: 'not_billable', mayBeProviderOnAgreement: false }] }),
    ).toThrow(/servicing_provider/);
  });

  it('refuses a servicing_provider that cannot be the provider on an agreement', () => {
    expect(() =>
      parseBillingRoleContent({
        ...good,
        options: [
          { key: 'servicing_provider', mayBeProviderOnAgreement: false },
          { key: 'not_billable', mayBeProviderOnAgreement: false },
        ],
      }),
    ).toThrow(/must be able to be the provider/);
  });

  /** A file where nobody is ever refused has turned the rule off, silently. */
  it('refuses a list where every role is permissive', () => {
    expect(() =>
      parseBillingRoleContent({
        ...good,
        options: [
          { key: 'servicing_provider', mayBeProviderOnAgreement: true },
          { key: 'works_under_provider', mayBeProviderOnAgreement: true },
        ],
      }),
    ).toThrow(/at least one role must be unable/);
  });

  it('refuses duplicates, bad keys, a missing version and a missing flag', () => {
    expect(() => parseBillingRoleContent({ ...good, version: '' })).toThrow(/version/);
    expect(() =>
      parseBillingRoleContent({ ...good, options: [...good.options, good.options[0]] }),
    ).toThrow(/appears twice/);
    expect(() =>
      parseBillingRoleContent({ ...good, options: [{ key: 'Servicing Provider', mayBeProviderOnAgreement: true }] }),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      parseBillingRoleContent({ ...good, options: [{ key: 'servicing_provider' }] }),
    ).toThrow(/mayBeProviderOnAgreement/);
  });
});

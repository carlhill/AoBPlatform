import {
  BILLING_ROLES,
  BILLING_ROLES_VERSION,
  BILLING_ROLE_KEYS,
  DEFAULT_BILLING_ROLE,
  isBillingRole,
  mayBeProviderOnAgreement,
  parseBillingRoleContent,
  providerIsGpFor,
  servicesNeedABillingProvider,
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
      expect(Object.keys(option).sort()).toEqual([
        'key',
        'mayBeProviderOnAgreement',
        'servicesNeedABillingProvider',
      ]);
    }
  });

  /**
   * THE NAMED TEST FOR CARL'S RULE. A practice nurse on a "for and on behalf
   * of" item delivers the service and bills nothing under their own number:
   * the claim goes under the GP, so the assignment does too.
   */
  it('a_nurse_still_cannot_be_the_provider_on_an_agreement', () => {
    /*
     * RE-ASSERTED AFTER THE 12 SEP 2026 ARRIVAL CHANGE (ARRIVAL-WHO-IS-SEEN.md
     * §4.1). That work made a nurse ARRIVABLE — the arrival now records who the
     * patient came to see instead of throwing it away — and it must not have
     * widened by one inch who may be named on a contract. Same predicate, same
     * guard, same answer.
     */
    expect(mayBeProviderOnAgreement('works_under_provider')).toBe(false);
    expect(mayBeProviderOnAgreement('not_billable')).toBe(false);
    expect(() => assertCanBeProviderOnAgreement('works_under_provider', 'Nurse Example')).toThrow(
      HardRuleViolation,
    );
    /*
     * AND BEING SEEN CANNOT MAKE IT TRUE. `servicesNeedABillingProvider` is the
     * flag the arrival change added, and it answers a different question: a
     * nurse's visit still needs somebody else's provider number, and a
     * phlebotomist's needs none at all. Neither value touches who may be named.
     */
    expect(servicesNeedABillingProvider('works_under_provider')).toBe(true);
    expect(servicesNeedABillingProvider('not_billable')).toBe(false);
    expect(mayBeProviderOnAgreement('works_under_provider')).toBe(false);
    expect(mayBeProviderOnAgreement('not_billable')).toBe(false);
  });

  /**
   * CARL'S BLOOD-TEST CASE, AT THE DOMAIN LAYER (12 Sep 2026). Somebody who
   * generates no Medicare claim from the practice needs no billing provider,
   * so their visit produces no agreement — and that is a complete answer, not
   * a missing one.
   */
  it('a phlebotomist needs no billing provider, and is still never one', () => {
    expect(servicesNeedABillingProvider('not_billable')).toBe(false);
    expect(mayBeProviderOnAgreement('not_billable')).toBe(false);
    // A servicing provider needs one and IS one; the two answers are separate.
    expect(servicesNeedABillingProvider('servicing_provider')).toBe(true);
    expect(mayBeProviderOnAgreement('servicing_provider')).toBe(true);
    /*
     * AN UNRECOGNISED ROLE FAILS CLOSED IN THE SAFE DIRECTION, which for this
     * flag is YES. "We do not know this role" must never come out as "nothing
     * needs signing"; it comes out as "somebody still has to be named", and the
     * arrival pipeline refuses it before a patient is affected.
     */
    expect(servicesNeedABillingProvider('locum_maybe')).toBe(true);
  });

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
      // A nurse practitioner bills under their own number, so this is an
      // ordinary visit in both of the "who was seen" senses.
      visitNeedsABillingProvider: servicesNeedABillingProvider('servicing_provider'),
      billingProviderIsNamed: mayBeProviderOnAgreement('servicing_provider'),
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
      { key: 'servicing_provider', mayBeProviderOnAgreement: true, servicesNeedABillingProvider: true },
      { key: 'works_under_provider', mayBeProviderOnAgreement: false, servicesNeedABillingProvider: true },
    ],
  };

  it('accepts the good shape', () => {
    expect(parseBillingRoleContent(good).options).toHaveLength(2);
  });

  it('refuses a list with no servicing_provider — it is the column default', () => {
    expect(() =>
      parseBillingRoleContent({
        ...good,
        options: [{ key: 'not_billable', mayBeProviderOnAgreement: false, servicesNeedABillingProvider: false }],
      }),
    ).toThrow(/servicing_provider/);
  });

  it('refuses a servicing_provider that cannot be the provider on an agreement', () => {
    expect(() =>
      parseBillingRoleContent({
        ...good,
        options: [
          { key: 'servicing_provider', mayBeProviderOnAgreement: false, servicesNeedABillingProvider: true },
          { key: 'not_billable', mayBeProviderOnAgreement: false, servicesNeedABillingProvider: false },
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
          { key: 'servicing_provider', mayBeProviderOnAgreement: true, servicesNeedABillingProvider: true },
          { key: 'works_under_provider', mayBeProviderOnAgreement: true, servicesNeedABillingProvider: true },
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
      parseBillingRoleContent({
        ...good,
        options: [{ key: 'Servicing Provider', mayBeProviderOnAgreement: true, servicesNeedABillingProvider: true }],
      }),
    ).toThrow(/lower_snake_case/);
    expect(() =>
      parseBillingRoleContent({ ...good, options: [{ key: 'servicing_provider' }] }),
    ).toThrow(/mayBeProviderOnAgreement/);
    expect(() =>
      parseBillingRoleContent({
        ...good,
        options: [{ key: 'servicing_provider', mayBeProviderOnAgreement: true }],
      }),
    ).toThrow(/servicesNeedABillingProvider/);
  });

  /**
   * THE EDIT THAT WOULD SILENTLY STOP A PRACTICE CAPTURING CONSENT: a role that
   * may be the provider on an agreement while claiming its services need no
   * billing provider. Every ordinary GP arrival would fall down the
   * phlebotomist's path and draft nothing. Refused at load.
   */
  it('refuses a role that may be the provider yet needs none', () => {
    expect(() =>
      parseBillingRoleContent({
        ...good,
        options: [
          { key: 'servicing_provider', mayBeProviderOnAgreement: true, servicesNeedABillingProvider: false },
          { key: 'not_billable', mayBeProviderOnAgreement: false, servicesNeedABillingProvider: false },
        ],
      }),
    ).toThrow(/needs one — itself/);
  });
});

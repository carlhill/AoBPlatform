import {
  AccountNameError,
  adminUsername,
  assertPracticeCode,
  extendPracticeCode,
  generatePracticeCode,
  isGeneratedPracticeCode,
  personUsername,
  practiceDisplayLabel,
  practiceNameForCode,
  PRACTICE_CODE_MAX_LENGTH,
  proposePracticeCode,
  webAuthnDisplayName,
} from './account-naming';

describe('the practice code', () => {
  it('the_slug_is_made_from_the_trading_name_and_strips_everything_but_letters_and_digits', () => {
    // PRACTICE-SCOPED-LOGIN.md §3b, the two worked examples in the document.
    expect(proposePracticeCode({ name: 'Powell St. Practice' })).toBe('powellstpractice');
    expect(proposePracticeCode({ name: "O'Brien & Sons Medical" })).toBe('obriensonsmedical');

    // The TRADING name wins over the practice name, and neither is the legal
    // name — XLEVELUP Medical's legal name is "The trustee for Hillsempire
    // Family Trust", which nobody would recognise. There is deliberately
    // nowhere in the parameter type to pass one.
    expect(proposePracticeCode({ name: 'XLEVELUP Medical', tradingNames: ['XLEVELUP'] })).toBe('xlevelup');
    expect(practiceNameForCode({ name: 'XLEVELUP Medical', tradingNames: ['XLEVELUP'] })).toBe('XLEVELUP');

    // A blank trading name is not a trading name.
    expect(proposePracticeCode({ name: 'Powell St. Practice', tradingNames: ['', '  '] })).toBe('powellstpractice');

    // Truncated to 24 (rule 3), and truncation happens AFTER stripping so the
    // limit counts characters that survive rather than spaces that do not.
    const long = proposePracticeCode({ name: 'The Very Long Named Family Medical Centre of Sampletown' });
    expect(long).toHaveLength(PRACTICE_CODE_MAX_LENGTH);
    expect(long).toBe('theverylongnamedfamilyme');
  });

  it('a_practice_whose_name_yields_no_usable_slug_gets_a_generated_code_marked_as_generated', () => {
    // §3b rule 4 — a practice named in a non-Latin script, or one whose name
    // is punctuation, strips to nothing. A mangled code is worse than an
    // honest generated one.
    expect(proposePracticeCode({ name: '診療所' })).toBeNull();
    expect(proposePracticeCode({ name: '&&&' })).toBeNull();
    expect(proposePracticeCode({ name: 'A1' })).toBeNull(); // two characters is under the floor
    expect(proposePracticeCode({ name: '' })).toBeNull();

    const generated = generatePracticeCode(() => 'a1b2c3d4e5f6');
    expect(generated).toBe('pa1b2c3d4e5f6');

    // MARKED AS GENERATED, and the mark is derivable from the code itself so a
    // stored flag and the value it describes can never disagree.
    expect(isGeneratedPracticeCode(generated)).toBe(true);
    expect(isGeneratedPracticeCode('xlevelup')).toBe(false);
    // A slug can never be mistaken for a generated code: 'p' + 12 hex exactly.
    expect(isGeneratedPracticeCode('powellstpractice')).toBe(false);
  });

  it('a_collision_is_extended_deterministically_and_never_randomly', () => {
    // §5 rule 3. Predictable beats random: two people working out what the
    // second `xlevelup` becomes must get the same answer.
    expect(extendPracticeCode('xlevelup', 1)).toBe('xlevelup');
    expect(extendPracticeCode('xlevelup', 2)).toBe('xlevelup2');
    expect(extendPracticeCode('xlevelup', 11)).toBe('xlevelup11');
    expect(() => extendPracticeCode('xlevelup', 0)).toThrow(RangeError);
  });

  it('a_malformed_code_is_refused_before_it_reaches_an_account_key', () => {
    expect(() => assertPracticeCode('xlevelup')).not.toThrow();
    expect(() => assertPracticeCode('x')).toThrow(AccountNameError);
    expect(() => assertPracticeCode('X-Level-Up')).toThrow(AccountNameError);
    expect(() => assertPracticeCode('xlevel up')).toThrow(AccountNameError);
    expect(() => assertPracticeCode('')).toThrow(AccountNameError);
  });
});

describe('the two username shapes', () => {
  it('a_practices_admin_account_is_named_for_the_practice_and_never_for_a_person', () => {
    // §3a — the admin account has NO email in its username, and that is the
    // point. It belongs to the practice, is pointed at a shared mailbox, and
    // naming it after whoever set it up is what the shared-mailbox rule
    // (ROLES.md rule 3) exists to prevent.
    expect(adminUsername('xlevelup')).toBe('admin.xlevelup');
    expect(adminUsername('powellstpractice')).toBe('admin.powellstpractice');

    expect(adminUsername('xlevelup')).not.toContain('@');
    // Nor the person who set it up, under any spelling.
    expect(adminUsername('xlevelup')).not.toContain('audrey');
    // Nor a practice id: the code is readable and allocated, not a UUID slice.
    expect(adminUsername('xlevelup')).not.toMatch(/[0-9a-f]{8}-/);
  });

  it('a_person_is_named_by_their_whole_email_then_the_code', () => {
    // §3 — the FULL email, unchanged. Unique by construction, so no second
    // collision rule and no `jsmith2` ever.
    expect(personUsername('audrey@hillsempire.com', 'xlevelup')).toBe('audrey@hillsempire.com.xlevelup');
    expect(personUsername('audrey@hillsempire.com', 'powellstpractice')).toBe(
      'audrey@hillsempire.com.powellstpractice',
    );

    // Two people sharing a local part at one practice both get an account,
    // because the whole address is in the name (named test, §7).
    expect(personUsername('jo@a.example', 'xlevelup')).not.toBe(personUsername('jo@b.example', 'xlevelup'));

    // The address is not mangled to satisfy the naming rule.
    expect(personUsername('  Audrey@Hillsempire.com  ', 'xlevelup')).toBe('Audrey@Hillsempire.com.xlevelup');

    // No address, no account name. Refused rather than guessed at.
    expect(() => personUsername('', 'xlevelup')).toThrow(AccountNameError);
    expect(() => personUsername('audrey', 'xlevelup')).toThrow(AccountNameError);
  });

  it('two_practices_can_never_be_issued_the_same_username_for_one_person', () => {
    // The half that is guaranteed here rather than by the database: given two
    // DIFFERENT codes the same person's two accounts cannot collide. The
    // database guarantees the other half — that two practices never hold the
    // same code (see practice-code.e2e-spec.ts).
    const audrey = 'audrey@hillsempire.com';
    expect(personUsername(audrey, 'xlevelup')).not.toBe(personUsername(audrey, 'powellstpractice'));
  });
});

describe('the passkey display name', () => {
  it('the_passkey_display_name_leads_with_the_practice', () => {
    // §3c — the distinguishing part must not be at the end of a string a
    // chooser will truncate.
    const label = webAuthnDisplayName('XLEVELUP Medical', 'Audrey Hill');
    expect(label).toBe('XLEVELUP Medical — Audrey Hill');
    expect(label.startsWith('XLEVELUP Medical')).toBe(true);

    // Audrey at two practices: the two labels differ in their FIRST word, not
    // their last. Asserted on the prefix, because that is the whole claim.
    const atPowell = webAuthnDisplayName('Powell St. Practice', 'Audrey Hill');
    expect(label.slice(0, 8)).not.toBe(atPowell.slice(0, 8));
    // Whereas the usernames do not differ until character 23.
    const u1 = personUsername('audrey@hillsempire.com', 'xlevelup');
    const u2 = personUsername('audrey@hillsempire.com', 'powellstpractice');
    expect(u1.slice(0, 23)).toBe(u2.slice(0, 23));
  });

  it('a_missing_half_never_leaves_a_dangling_separator', () => {
    expect(webAuthnDisplayName('XLEVELUP Medical', '')).toBe('XLEVELUP Medical');
    expect(webAuthnDisplayName('', 'Audrey Hill')).toBe('Audrey Hill');
  });

  it('the_practice_half_of_the_label_is_the_trading_name_not_the_code', () => {
    expect(practiceDisplayLabel({ name: 'XLEVELUP Medical', tradingNames: ['XLEVELUP'] })).toBe('XLEVELUP');
    expect(practiceDisplayLabel({ name: 'Powell St. Practice' })).toBe('Powell St. Practice');
  });
});

import { ValidationPipe } from '@nestjs/common';
import { AMENDABLE_FIELDS } from '@aobplatform/domain';
import { AmendPracticeDto } from './organisations.controller';

/**
 * THE DTO MUST COVER EVERY FIELD THE DOMAIN SAYS IS AMENDABLE.
 *
 * Two lists have to agree and nothing made them. `AMENDABLE_FIELDS` says what a
 * practice may correct about itself; `AmendPracticeDto` says what the wire will
 * carry. `whitelist: true` strips anything the DTO does not declare — silently,
 * with no error — so a field present in one list and absent from the other does
 * not fail loudly. It arrives as nothing, and the service answers "Nothing was
 * changed, so there is nothing to record."
 *
 * That is precisely what happened to `groupEmail`: added to the domain's list,
 * never added to the DTO. A practice administrator typed their shared address,
 * pressed save, and was told they had changed nothing.
 *
 * The interesting part is that the failure was PREDICTED. The DTO carries a
 * comment explaining that an undeclared property is stripped silently and that
 * the locked fields are declared by name for exactly that reason. The reasoning
 * was right and written down, and the next field still slipped through — because
 * a comment cannot check anything. This test is what the comment was hoping for.
 */
describe('the amendment DTO and the domain agree on what may be amended', () => {
  it('carries every AMENDABLE_FIELD through the whitelist', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    /*
     * A plausible value per field, because validation must PASS — a value the
     * validators reject would be stripped for the right reason and hide the
     * wrong one.
     */
    const sample: Record<string, unknown> = {};
    for (const field of AMENDABLE_FIELDS) {
      if (field === 'statedPractitionerCount') sample[field] = 3;
      else if (field.toLowerCase().includes('email')) sample[field] = `${field}@example.invalid`;
      else sample[field] = `value-for-${field}`;
    }

    const result = (await pipe.transform(
      { ...sample, reason: 'Testing that nothing is dropped.' },
      { type: 'body', metatype: AmendPracticeDto },
    )) as Record<string, unknown>;

    const dropped = AMENDABLE_FIELDS.filter((field) => result[field] === undefined);

    expect(dropped).toEqual([]);
  });

  it('still strips something the domain does NOT allow', () => {
    /*
     * The other half. If the whitelist had simply been turned off, the test
     * above would pass and the protection it is guarding would be gone — so
     * this pins that an unknown property is still refused entry.
     */
    const pipe = new ValidationPipe({ whitelist: true, transform: true });

    return pipe
      .transform(
        { name: 'A Practice', reason: 'Testing.', somethingInvented: 'should not survive' },
        { type: 'body', metatype: AmendPracticeDto },
      )
      .then((result) => {
        expect((result as Record<string, unknown>).somethingInvented).toBeUndefined();
        expect((result as Record<string, unknown>).name).toBe('A Practice');
      });
  });
});

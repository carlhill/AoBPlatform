/**
 * THE LOCK ON K-P1's ANSWERS, TESTED WHERE IT CAN BE (review, 7 Sep 2026).
 *
 * WHY THIS FILE EXISTS RATHER THAN AN ASSERTION IN THE COMPONENT SUITE. The
 * refusal is the belt-and-braces half of the Continue lock, and the screen
 * already renders a real `button[disabled]` in both locked states — so the only
 * control a patient can reach while locked is the one that already matches
 * their own answer, and a click on it would be a no-op with or without the
 * guard. The guard is genuinely unreachable through the DOM, which is exactly
 * what makes it the kind of code a refactor deletes without anything going red.
 * `nextAnswers` is that guard, out where a test can actually change an answer.
 *
 * WHAT IT PROTECTS. An answer that has left this device — sent to reception as
 * a dispute, or posted by Continue — must not be editable, because the tablet
 * would otherwise be able to post a DIFFERENT set against the same session
 * after reception has already been shown the first one.
 */
import { describe, expect, it } from 'vitest';
import { nextAnswers, type DetailAnswers } from './pushed-details';

describe('locked_answers_cannot_be_changed', () => {
  const ANSWERED: DetailAnswers = { name: 'right', address: 'right' };

  it('refuses a changed answer while locked, and returns the set untouched', () => {
    // The change that matters: a tick becoming a cross after the set has gone.
    expect(nextAnswers(ANSWERED, 'name', 'wrong', true)).toBe(ANSWERED);
    // And a brand new answer for a row that had none.
    expect(nextAnswers(ANSWERED, 'email', 'right', true)).toBe(ANSWERED);
    // THE SAME OBJECT, not an equal one — nothing re-renders and, more to the
    // point, `answerSignature` cannot differ and re-post an identical set.
    expect(nextAnswers(ANSWERED, 'name', 'wrong', true)).toEqual(ANSWERED);
  });

  it('takes the change while unlocked, and leaves the other rows alone', () => {
    const changed = nextAnswers(ANSWERED, 'name', 'wrong', false);
    expect(changed).toEqual({ name: 'wrong', address: 'right' });
    // Changing your mind means pressing the OTHER button — the set is replaced,
    // never mutated, so nothing else on the screen moves.
    expect(ANSWERED).toEqual({ name: 'right', address: 'right' });
  });

  it('is a no-op when the answer is the one already showing, locked or not', () => {
    /*
     * A DOUBLE TAP ON THE BUTTON A ROW IS ALREADY SHOWING. It must not produce
     * a new object: `answerSignature` is what decides whether the set has
     * changed, and a re-post of an identical answer set would write a second
     * vault event for one act.
     */
    expect(nextAnswers(ANSWERED, 'name', 'right', false)).toBe(ANSWERED);
    expect(nextAnswers(ANSWERED, 'name', 'right', true)).toBe(ANSWERED);
  });
});

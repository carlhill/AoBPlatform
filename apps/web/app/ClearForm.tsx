'use client';

/**
 * "Clear the form" — the pattern, once.
 *
 * WHY EVERY FORM WANTS THIS. The moment somebody needs it is right after a
 * refusal: they picked a practitioner and a location, were told the pair
 * already exists, and now want to try a different pair. Without a clear they
 * reset each field by hand, and the field they forget is the one that produces
 * the same refusal again.
 *
 * CLEARING IS NOT CANCELLING, and the word matters. "Cancel" says you are
 * leaving; this empties the fields and leaves you exactly where you are, which
 * is what somebody wants when they intend to answer a refusal by starting over.
 *
 * IT CLEARS THE REFUSAL TOO. A form that empties its fields but keeps the red
 * box above them is telling somebody they are still wrong about something they
 * have just deleted. `onClear` is expected to reset the error as well as the
 * values — the callers pass one function that does both.
 *
 * DISABLED WHEN THERE IS NOTHING TO CLEAR, so it never offers to undo nothing.
 * `dirty` is the caller's judgement, because only the caller knows what its
 * empty state looks like — a select defaulting to the first option is empty,
 * and a component here could not tell.
 */

import { Eraser } from 'lucide-react';
import { Button } from './ui';
import { strings } from './strings';

export function ClearForm({
  onClear,
  dirty = true,
  disabled = false,
  label,
  testId,
}: {
  onClear: () => void;
  /** Whether anything has been entered. Only the caller can say. */
  dirty?: boolean;
  /** Held while the form is submitting, so it cannot be cleared mid-flight. */
  disabled?: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <Button
      variant="subtle"
      type="button"
      onClick={onClear}
      disabled={disabled || !dirty}
      data-testid={testId ?? 'clear-form'}
    >
      <Eraser size={14} aria-hidden="true" />
      {label ?? strings.form.clear}
    </Button>
  );
}

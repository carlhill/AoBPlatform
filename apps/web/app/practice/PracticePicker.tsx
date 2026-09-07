'use client';

/**
 * "Which practice?" — for screens a platform operator can reach without one.
 *
 * WHY THIS EXISTS. `usePractice()` answers from the token's practice claim. A
 * practice user always has one; a PLATFORM operator has none, and every screen
 * that quietly did `if (!practiceId) return` rendered an empty page with no
 * error, no explanation and no way forward. The reviews screen showed
 * "0 waiting" while four tasks sat in the database — which is the worst kind of
 * empty state, because it looks like an answer.
 *
 * A blank list is a claim about the world. Making one without a scope is
 * making it up.
 */

import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { Field, Notice, SelectInput, ui } from '../ui';
import { apiHeaders } from '../auth';
import { strings } from '../strings';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export function PracticePicker({
  value,
  onChange,
  isOperator,
}: {
  value: string;
  onChange: (practiceId: string) => void;
  isOperator: boolean;
}) {
  const [practices, setPractices] = useState<{ id: string; name: string }[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isOperator) return;
    fetch(`${CORE_URL}/outbound/practices`, { headers: apiHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((b) => setPractices(b.practices ?? []))
      // Both branches land here: a refused connection and a 5xx are the same
      // fact to somebody looking at this screen.
      .catch(() => setFailed(true));
  }, [isOperator]);

  /*
   * A PRACTICE USER SEEING THIS AT ALL IS A PROBLEM, not a choice to offer.
   * Their token should carry a practice claim; if it does not, something is
   * wrong with their session and a dropdown of other people's practices is the
   * last thing to hand them.
   */
  if (!isOperator) {
    return (
      <Notice tone="warn" title={strings.picker.noPracticeTitle}>
        {strings.picker.noPracticeBody}
      </Notice>
    );
  }

  /*
   * A CHOOSER WITH NOTHING IN IT IS NOT A CHOOSER.
   *
   * When the server cannot be reached this used to render the dropdown anyway,
   * empty, under a line suggesting you "reach a practice from the practice
   * list" — a list served by the same server that just failed. Three controls,
   * none of which could work, and no statement of the one fact that mattered.
   *
   * Not being able to reach the server is a different situation from there
   * being nothing to show, and showing the same furniture for both is what
   * makes an outage look like an empty account.
   */
  if (failed) {
    return (
      <Notice tone="stop" title={strings.picker.unreachableTitle}>
        {strings.picker.unreachableBody}
      </Notice>
    );
  }

  return (
    <div className={ui.rowActions}>
      <Field label={strings.picker.label} hint={strings.picker.hint}>
        {(props) => (
          <SelectInput {...props} value={value} onChange={(e) => onChange(e.target.value)} data-testid="practice-picker">
            <option value="">{strings.picker.choose}</option>
            {practices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectInput>
        )}
      </Field>
      {practices.length === 0 && (
        <p className={ui.hint}>
          <Building2 size={13} aria-hidden="true" /> {strings.picker.loading}
        </p>
      )}
    </div>
  );
}

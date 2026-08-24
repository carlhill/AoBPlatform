'use client';

/**
 * The practice's own application, filled in.
 *
 * WHAT CARL ASKED FOR: "the filled out version of /apply". Not a summary and
 * not a dossier — the same form, in the same order, with their answers in it.
 *
 * WHY THAT SHAPE RATHER THAN A READ-ONLY VIEW. `/practice/entity` already
 * shows the record as a dossier, and it is the right thing for reading. This
 * answers a different question: "what did we actually submit, and what can I
 * change?" A person checking their own application is comparing it against
 * what they meant to say, and they do that far more easily against the form
 * they filled in than against a re-presentation of it.
 *
 * WHAT IS EDITABLE IS NOT A UI CHOICE. It is `AMENDABLE_FIELDS` from the
 * domain — sixteen fields covering contacts, the head office and the practice
 * name. Everything else is shown and locked, and the screen says why rather
 * than simply disabling a box:
 *
 *   THE ABN AND THE LEGAL NAME ARE IDENTITY EVIDENCE. They were checked
 *   against the ABR and a person recorded that check. Letting the practice
 *   edit them afterwards would let a practice change what was verified while
 *   keeping the verification — which is the same defect as a practice
 *   confirming its own address, arriving through a different door.
 */

import { useCallback, useEffect, useState } from 'react';
import { Lock, Save } from 'lucide-react';
import { AMENDABLE_FIELDS } from '@aobplatform/domain';
import { Button, Field, Notice, Shell, TextInput, ui } from '../../ui';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';
import { useRefreshable } from '../../refresh';
import { strings } from '../../strings';
import { usePractice } from '../usePractice';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Practice = Record<string, unknown> & { id: string };

/** The form, in the order /apply asks it. */
const SECTIONS: { heading: string; note?: string; fields: { key: string; label: string; hint?: string }[] }[] = [
  {
    heading: 'The practice',
    fields: [
      { key: 'name', label: 'Practice name' },
      { key: 'abn', label: 'ABN' },
      { key: 'website', label: 'Website' },
      { key: 'statedPractitionerCount', label: 'How many practitioners' },
    ],
  },
  {
    heading: 'Head office',
    note: 'Where the entity is run from. Not necessarily where patients are seen — those are locations.',
    fields: [
      { key: 'headOfficeLine1', label: 'Street address' },
      { key: 'headOfficeLine2', label: 'Level, unit or suite' },
      { key: 'headOfficeSuburb', label: 'Suburb' },
      { key: 'headOfficeState', label: 'State' },
      { key: 'headOfficePostcode', label: 'Postcode' },
    ],
  },
  {
    heading: 'The administrator',
    note: 'The person who runs AoBPlatform for this practice.',
    fields: [
      { key: 'adminName', label: 'Full name' },
      { key: 'adminEmail', label: 'Email' },
      { key: 'adminPhone', label: 'Phone' },
      { key: 'adminPosition', label: 'Position' },
      {
        key: 'groupEmail',
        label: 'Shared practice email address',
        hint:
          'Where we send anything meant for the practice rather than for one person. Use an address that ' +
          'outlives whoever holds the job.',
      },
    ],
  },
  {
    heading: 'The practice manager',
    note: 'A second, independent contact. FR-1.9 requires the two to be reachable on different channels.',
    fields: [
      { key: 'managerName', label: 'Full name' },
      { key: 'managerEmail', label: 'Email' },
      { key: 'managerPhone', label: 'Phone' },
      { key: 'managerPosition', label: 'Position' },
    ],
  },
  {
    heading: 'What the ABR said',
    note:
      'Recorded when the application was checked. Locked because it is identity evidence — a person ' +
      'looked this up and their name is against it.',
    fields: [
      { key: 'legalName', label: 'Legal name' },
      { key: 'entityType', label: 'Entity type' },
      { key: 'abnStatus', label: 'ABN status' },
      { key: 'acn', label: 'ACN' },
    ],
  },
];

const AMENDABLE = new Set<string>(AMENDABLE_FIELDS as unknown as string[]);

export function ApplicationView() {
  const { practiceId, checked } = usePractice();
  const [practice, setPractice] = useState<Practice | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  /*
   * WHICH FAILURE IT WAS. One `error` string served both loading and saving,
   * under a notice headed "Your application could not be loaded" -- so a save
   * refused with "Nothing was changed, so there is nothing to record" was
   * presented as a failure to LOAD a page that was plainly on the screen. Two
   * different problems wearing one label sends people to look in the wrong
   * place entirely.
   */
  const [errorKind, setErrorKind] = useState<'load' | 'save'>('load');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  /*
   * REQUIRED, and the server says so too. A change to an approved record
   * with no stated reason is indistinguishable from a mistake — and this
   * record is what the practice was approved on.
   */
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!practiceId) return;
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practices/${practiceId}`, { headers: apiHeaders(practiceId) });
      if (!res.ok) throw new Error(`That could not be loaded (${res.status}).`);
      const body = (await res.json()) as Practice;
      setPractice(body);
      const next: Record<string, string> = {};
      for (const section of SECTIONS) {
        for (const f of section.fields) {
          const value = body[f.key];
          next[f.key] = value === null || value === undefined ? '' : String(value);
        }
      }
      setDraft(next);
    } catch (e) {
      setErrorKind('load');
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * REGISTERED WITH THE TOP-BAR REFRESH. The token is held in memory only, so
   * a browser reload throws the session away and asks for a passkey again --
   * this is the way to re-read without paying that.
   */
  useRefreshable(load);

  /*
   * Only what has actually changed, and only from the amendable set. Sending
   * the whole form would mean an amendment record showing sixteen fields
   * "changed" every time somebody fixed a phone number — and an audit trail
   * that cries wolf is one nobody reads.
   */
  const changed = Object.keys(draft).filter(
    (key) => AMENDABLE.has(key) && draft[key] !== (practice?.[key] === null || practice?.[key] === undefined ? '' : String(practice[key])),
  );

  async function save() {
    if (!practiceId || changed.length === 0 || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, string> = {};
      for (const key of changed) patch[key] = draft[key];
      patch.reason = reason.trim();
      const res = await fetch(`${CORE_URL}/organisations/${practiceId}`, {
        method: 'PATCH',
        headers: apiHeaders(practiceId),
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
        throw new Error(message ?? `That could not be saved (${res.status}).`);
      }
      setSaved(true);
      setReason('');
      await load();
    } catch (e) {
      setErrorKind('save');
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return null;

  if (!practiceId) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}>
        <h1 className={ui.pageTitle}>{strings.application.title}</h1>
        <Notice tone="warn" title={strings.setup.noPracticeTitle}>
          {strings.setup.noPracticeBody}
        </Notice>
      </Shell>
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>
      <h1 className={ui.pageTitle}>{strings.application.title}</h1>
      <p className={ui.pageLead}>{strings.application.lead}</p>

      {error && (
        <Notice tone="stop" title={errorKind === 'save' ? strings.application.notSaved : strings.application.notLoaded}>
          {error}
        </Notice>
      )}
      {saved && changed.length === 0 && (
        <Notice tone="ok" title={strings.application.savedTitle}>
          {strings.application.savedBody}
        </Notice>
      )}

      {SECTIONS.map((section) => (
        <section key={section.heading} className={styles.applicationSection}>
          <h2 className={styles.applicationHeading}>{section.heading}</h2>
          {section.note && <p className={ui.hint}>{section.note}</p>}
          <div className={styles.applicationFields}>
            {section.fields.map((f) => {
              const editable = AMENDABLE.has(f.key);
              return (
                <Field
                  key={f.key}
                  label={f.label}
                  hint={editable ? f.hint : strings.application.lockedHint}
                >
                  {(props) =>
                    editable ? (
                      <TextInput
                        {...props}
                        value={draft[f.key] ?? ''}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        data-testid={`app-${f.key}`}
                      />
                    ) : (
                      /*
                       * Rendered as text, not a disabled input. A greyed-out box
                       * invites somebody to keep clicking it; a value with a
                       * padlock says the answer is "no", once.
                       */
                      <p className={styles.applicationLocked} data-testid={`app-${f.key}`}>
                        <Lock size={13} aria-hidden="true" />
                        {draft[f.key] || strings.application.notRecorded}
                      </p>
                    )
                  }
                </Field>
              );
            })}
          </div>
        </section>
      ))}

      {/*
        THE CONSEQUENCE, BEFORE THE BUTTON. Changing adminEmail revokes every
        passkey on the practice account — correct, because the account belongs
        to the practice and a new address means a new person. But Carl changed
        his own address and locked himself out with no warning at all, which
        is a control doing its job badly.
      */}
      {changed.includes('adminEmail') && (
        <Notice tone="stop" title={strings.application.handoverWarnTitle}>
          {strings.application.handoverWarnBody}
        </Notice>
      )}

      {/* Asked only once something has changed — before that there is
          nothing to explain. */}
      {changed.length > 0 && (
        <div className={styles.amendReason}>
          <Field label={strings.application.reasonLabel} hint={strings.application.reasonHint} required>
            {(props) => (
              <TextInput
                {...props}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="application-reason"
              />
            )}
          </Field>
        </div>
      )}

      <div className={ui.rowActions}>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={busy || changed.length === 0 || !reason.trim()}
          data-testid="application-save"
        >
          <Save size={15} aria-hidden="true" />
          {busy
            ? strings.application.saving
            : changed.length > 0
              ? `${strings.application.save} (${changed.length})`
              : strings.application.nothingChanged}
        </Button>
      </div>

      <Notice tone="warn" title={strings.application.lockedTitle}>
        {strings.application.lockedBody}
      </Notice>
    </Shell>
  );
}

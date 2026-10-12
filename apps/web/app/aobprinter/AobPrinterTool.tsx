'use client';

/**
 * THE AOBPRINTER TEST TOOL — a stand-in for the practice's print driver
 * (Carl, 28 September 2026: *"I need a test tool for the AOBPrinter. I should
 * be able to correct the missing data (as though corrected from the PMS) and
 * reprint to AOBPrinter and resend to AOB for reprocessing."*).
 *
 * STANDALONE, ON CARL'S RULING, and not a page of the console. It is not the
 * practice's software and it is not ours-for-a-practice: it is a bench
 * instrument that pretends to be a Windows service sitting beside PracSoft.
 * Putting it in the console would put a "make up a print job" button one click
 * from a receptionist's real work.
 *
 * ── WHAT IT IS FOR ──
 *
 * Every DB4 in this dev database so far arrived from a Python script, which
 * means every fault has had to be described in code before it could be seen
 * on a screen, and every OUTCOME has had to be read out of Postgres by hand.
 * This does both in the browser: compose a form, send it, and read back what
 * became of it.
 *
 * AND IT IS THE FIRST HALF OF REPROCESSING. Correcting a field and sending
 * again is exactly the *"corrected from the PMS and reprinted"* case — the
 * hash moves because the content moved, so it arrives as a NEW print job
 * against the SAME form reference. What core then does with it is the second
 * half, and it now does the three-way rule Carl approved on 28 September
 * 2026: REPOINT when only the reproduction improved, SUPERSEDE when a
 * particular changed, REFUSE under a signature (`db4-reprint.ts`). Which of
 * the three happened is the single most useful thing this tool can tell a
 * tester, so the outcome panel says it in words.
 *
 * ── WHAT IT IS NOT ──
 *
 * NOT A WAY TO WRITE AN AGREEMENT. Everything goes through
 * `POST /inbound/print-jobs`, the same door with the same DTOs and the same
 * `whitelist: true` stripping. A field this tool invents is dropped before it
 * is stored, exactly as it would be from a real driver — which is the point:
 * a bench instrument that could reach further than the thing it imitates
 * would prove nothing about the thing it imitates.
 *
 * NOT A SOURCE OF TRUTH ABOUT AMOUNTS. `benefitAssigned` is typed as text and
 * posted as text. Nothing here parses, totals, rounds or reformats one, and
 * the ragged preset exists to prove the tablet does not either (hard rule 4,
 * D-2026-09-14-02).
 *
 * FAKE IDENTITIES ONLY. The presets carry invalid-checksum Medicare numbers
 * and obviously fictional names (CLAUDE.md §7c). Nothing stops a tester
 * typing something real, and nothing should be typed that is.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BLANK, PRESETS, startFromPreset, type Draft, type ProviderRow, type ServiceRow } from './presets';
import { buildEnvelope, draftFromEnvelope, envelopeWithHash, sha256Hex } from './envelope';
import styles from './aobprinter.module.css';

function coreBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
}

/** A row of the picker. Dev-only on the server, which is why it may carry a name. */
interface ExistingForm {
  readonly id: string;
  readonly formReference: string | null;
  readonly patientRecordNumber: string | null;
  readonly patientName: string | null;
  readonly serviceDate: string | null;
  readonly placed: boolean | null;
  readonly reason: string | null;
}

interface Sent {
  readonly at: string;
  readonly formReference: string;
  readonly jobId: string | null;
  readonly sourceSha256: string;
  readonly httpStatus: number;
  readonly duplicate: boolean;
  /** The placement outcome, once the handler has run. */
  outcome?: unknown;
  state?: string;
  error?: string;
}

/**
 * THE TESTER'S WALL CLOCK, not UTC — and it says which, because a bench
 * instrument whose times cannot be compared with a screenshot is worth less
 * than one that prints an extra four characters.
 */
function localStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  /* The zone abbreviation the browser itself would print, e.g. AEST. */
  const zone =
    new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'local';
  return `${date} ${time} ${zone}`;
}

/* ---------------------------------------------------------------------------
 * WHAT BECAME OF IT, IN WORDS (Carl, 28 September 2026, shown the raw job
 * outcome: *"what is this showing me"*).
 *
 * THE JSON WAS NOT WRONG, IT WAS UNREADABLE. Everything a tester needs is in
 * that object, and the part that matters — `reprint.action` — sits eleven
 * keys in, between a null and an empty array. A tool exists to make an
 * outcome legible; printing the wire format is the one thing that guarantees
 * it is not.
 *
 * SO THE PANEL LEADS WITH THE ANSWER and keeps the object underneath, folded.
 * The raw form still matters when something is wrong in a way these sentences
 * do not cover, and dropping it would trade one blindness for another.
 *
 * TYPES, NEVER VALUES, exactly as the wire carries them (hard rule 9). A
 * changed particular is named as `service date`, never as the date.
 * ------------------------------------------------------------------------ */

interface Db4Part {
  placed?: boolean;
  reason?: string | null;
  repeat?: boolean;
  agreementId?: string | null;
  decision?: string | null;
  serviceRecordId?: string | null;
  patientMatched?: boolean;
  reprint?: { action?: string; changed?: string[]; supersededBy?: string | null } | null;
}

/** The reprint rule's five answers, said as a sentence a tester can act on. */
const REPRINT_IN_WORDS: Record<string, string> = {
  linked:
    'FIRST FORM. Nothing was pointing anywhere, so the agreement now reproduces this print record.',
  already_linked:
    'ALREADY THIS ONE. The agreement was already pointing at this very job, so nothing was done twice.',
  repointed:
    'REPOINTED. No particular changed — only the reproduction improved — so the agreement is untouched and now reproduces this better page.',
  supersede:
    'SUPERSEDED. A locked particular changed, which is a different agreement and not a better picture of the same one, so a replacement was drafted.',
  refused_signed:
    'REFUSED — SOMEBODY HAS SIGNED. A signed agreement reproduces the page that was in front of the person, so the pointer was not moved and nothing was superseded. Correcting this one needs a human.',
};

const CHANGED_IN_WORDS: Record<string, string> = {
  patient: 'the patient',
  servicing_provider: 'the servicing provider',
  service_date: 'the date of service',
  service_items: 'the service items',
};

/** An action this tool has not been taught yet SHOWS ITS CODE (CLAUDE.md §7c). */
function unmappedReprint(action: string): string {
  return `The reprint rule answered "${action}", which this tool has no sentence for yet.`;
}

function Db4OutcomeSummary({ outcome }: { outcome: unknown }) {
  const db4 = ((outcome as Record<string, unknown> | null)?.db4 ?? null) as Db4Part | null;
  if (!db4) {
    // A job that carried no DB4 at all — an invoice or appointment mirror.
    return <p className={styles.outcomeLead}>No DB4 on this job.</p>;
  }

  const action = db4.reprint?.action ?? null;
  const changed = (db4.reprint?.changed ?? []).map((c) => CHANGED_IN_WORDS[c] ?? c);

  return (
    <div className={styles.outcome}>
      <p className={db4.placed ? styles.outcomeLead : styles.outcomeLeadBad}>
        {db4.placed
          ? db4.repeat
            ? 'This form had already been processed — a reprint, not a second visit.'
            : 'An agreement was placed off this form.'
          : `Nothing was placed${db4.reason ? ` — ${db4.reason}.` : '.'}`}
      </p>

      {action ? (
        <p className={action === 'refused_signed' ? styles.outcomeLeadBad : styles.outcomeLead}>
          {REPRINT_IN_WORDS[action] ?? unmappedReprint(action)}
        </p>
      ) : null}

      {changed.length > 0 ? (
        <p className={styles.outcomeNote}>What moved: {changed.join(', ')}.</p>
      ) : null}

      <dl className={styles.sentFacts}>
        {db4.reprint?.supersededBy ? (
          <>
            <dt>Replacement</dt>
            <dd>
              <code>{db4.reprint.supersededBy}</code>
            </dd>
          </>
        ) : null}
        {db4.agreementId ? (
          <>
            <dt>Agreement</dt>
            <dd>
              <code>{db4.agreementId}</code>
            </dd>
          </>
        ) : null}
        {db4.decision ? (
          <>
            <dt>Decision</dt>
            <dd>{db4.decision}</dd>
          </>
        ) : null}
        <dt>PMS patient ID matched a patient</dt>
        <dd>{db4.patientMatched ? 'yes' : 'no'}</dd>
      </dl>

      <details className={styles.outcomeRaw}>
        <summary>The outcome as it came off the wire</summary>
        <code>{JSON.stringify(outcome)}</code>
      </details>
    </div>
  );
}

const EMPTY_SERVICE: ServiceRow = {
  serviceDate: '2026-09-12',
  time: '09:00',
  mbsItemNumber: '',
  description: '',
  benefitAssigned: '',
};

/* ---------------------------------------------------------------------------
 * LOAD TEST AGREEMENTS (Carl, 12 October 2026: *"put a button at the top of
 * the test tool for me to load test agreements"*).
 *
 * ONE PRESS, FIVE DB4s, FIVE AGREEMENTS ON THE DESK — and still through the
 * one door. Core's dev-only `POST /dev/aobprinter-test-patients` ensures the
 * five fake patients exist (a DB4 matches a patient and never creates one)
 * and says which servicing provider numbers the practice knows; everything
 * after that is this tool printing forms exactly as a tester would, through
 * `postDraft` — the same `envelopeWithHash` and the same
 * `POST /inbound/print-jobs` the Print to AoB button uses.
 *
 * ONLY PRESETS THAT PLACE. Each shape below becomes an agreement; the
 * "refused at the door" presets do not, and a button called "load test
 * agreements" that loaded refusals would be lying about its own name. The
 * shapes that fire a band (no amount, no IRN) still place — the band is on
 * the agreement, which is the point of loading them.
 * ------------------------------------------------------------------------ */
const LOAD_TEST_PRESET_KEYS = ['clean', 'ragged-amounts', 'long-form', 'no-amount', 'no-irn'] as const;

/** What the endpoint answers. Dev only, which is why it may carry names. */
interface TestPatients {
  readonly patients: ReadonlyArray<{
    patientRecordNumber: string;
    givenNames: string;
    familyName: string;
    dateOfBirth: string;
  }>;
  readonly servicingProviderNumbers: readonly string[];
  readonly created: number;
}

/** One form of a press, and what became of it. */
interface LoadRow {
  readonly formReference: string;
  readonly patientName: string;
  readonly presetLabel: string;
  readonly httpStatus: number;
  readonly error?: string;
  readonly state?: string;
  readonly placed?: boolean;
  readonly reason?: string | null;
}

type LoadResult =
  | { readonly kind: 'refused'; readonly text: string }
  | { readonly kind: 'done'; readonly created: number; readonly providerNumber: string; readonly rows: LoadRow[] };

/** The tester's local date, YYYY-MM-DD — the desk reads today's visits. */
function localDate(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** How many times a press reads a job back, and how long between reads. */
const LOAD_POLLS = 10;
const LOAD_POLL_MS = 700;

/** One line per form, worded from the outcome core actually recorded. */
function loadRowInWords(row: LoadRow): string {
  if (row.error !== undefined) return `refused at the door, HTTP ${row.httpStatus}: ${row.error}`;
  if (row.placed === true) return 'placed — an agreement is on the desk.';
  if (row.placed === false) return `nothing was placed — ${row.reason ?? 'core recorded no reason code'}.`;
  return `core had not finished with it after ${LOAD_POLLS} reads (state: ${row.state ?? 'unknown'}). Use Check again on its row below.`;
}

export function AobPrinterTool() {
  const [draft, setDraft] = useState<Draft>({ ...BLANK, formReference: '', patientRecordNumber: '' });
  const [sent, setSent] = useState<Sent[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [preview, setPreview] = useState(false);
  /*
   * THE FORMS ALREADY SENT (Carl, 28 September 2026: *"we need a drop down of
   * the list of test cases we have already used. Saves typing"*). Loading one
   * is also the honest way to CORRECT it: the stored record goes back on the
   * screen whole, so fixing one field leaves the rest exactly as it arrived —
   * and a partial reprint would read as a CHANGED form and supersede an
   * agreement that only needed repointing.
   */
  const [existing, setExisting] = useState<ExistingForm[]>([]);
  const [loadedFrom, setLoadedFrom] = useState<string>('');
  /*
   * NARROWING THE PICKER (Carl, 28 September 2026: *"in choose a form, can we
   * search by any part of the string e.g. Ada DummyField"*). A `select` can
   * only be typed at by its option's FIRST characters, and every option here
   * begins with a form reference — so the one thing a tester actually knows
   * the form by, the patient's name, is the one thing they cannot type.
   */
  const [existingFilter, setExistingFilter] = useState('');

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const loadList = useCallback(async (practiceId: string) => {
    try {
      const res = await fetch(`${coreBaseUrl()}/inbound/print-jobs/recent`, {
        headers: { 'x-practice-id': practiceId },
      });
      if (!res.ok) return;
      setExisting((await res.json()) as ExistingForm[]);
    } catch {
      /* A bench instrument with no list is still a bench instrument. */
    }
  }, []);

  useEffect(() => {
    void loadList(draft.practiceId);
    // The list is fetched per practice, not per keystroke on every field.
  }, [loadList, draft.practiceId]);

  /** Put a stored record back on the screen, whole. */
  const loadForm = useCallback(
    async (jobId: string) => {
      setLoadedFrom(jobId);
      if (!jobId) return;
      try {
        const res = await fetch(`${coreBaseUrl()}/inbound/print-jobs/${jobId}/envelope`, {
          headers: { 'x-practice-id': draft.practiceId },
        });
        if (!res.ok) return;
        const row = (await res.json()) as { payload?: Record<string, unknown> } | null;
        if (!row?.payload) return;
        setDraft((d) => draftFromEnvelope(d.practiceId, row.payload as Record<string, unknown>, BLANK));
      } catch {
        /* Nothing loaded, nothing changed — the form on screen is untouched. */
      }
    },
    [draft.practiceId],
  );

  const envelope = useMemo(() => buildEnvelope(draft), [draft]);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setDraft((d) => {
      // The chart number AND the name carry over — see `startFromPreset`.
      const next = startFromPreset(preset, d);
      /*
       * THE FORM REFERENCE IS STAMPED, NOT CARRIED. Two presets sharing one
       * reference would be the same FORM to `db4-assignment.handler.ts` —
       * idempotency is on `db4:<formReference>`, not on the bytes — so the
       * second would place nothing and the tester would be looking at the
       * first preset's agreement wondering why it had not changed.
       */
      return { ...next, formReference: `TOOL-${key.toUpperCase()}-${Date.now().toString(36).toUpperCase()}` };
    });
  }, []);

  /** What became of it — state and CODES, never the stored envelope. Null when it could not be read. */
  const readOutcome = useCallback(async (jobId: string, practiceId: string) => {
    try {
      const res = await fetch(`${coreBaseUrl()}/inbound/print-jobs/${jobId}`, {
        headers: { 'x-practice-id': practiceId },
      });
      if (!res.ok) return null;
      return (await res.json()) as { state?: string; outcome?: unknown };
    } catch {
      /* The tool is a bench instrument; a failed poll is not worth a banner. */
      return null;
    }
  }, []);

  const refreshOutcome = useCallback(
    async (jobId: string, practiceId: string) => {
      const row = await readOutcome(jobId, practiceId);
      if (!row) return;
      setSent((rows) =>
        rows.map((r) => (r.jobId === jobId ? { ...r, state: row.state, outcome: row.outcome } : r)),
      );
    },
    [readOutcome],
  );

  /**
   * THE ONE SEND PATH: a draft becomes an envelope, is hashed, and goes through
   * `POST /inbound/print-jobs`. Print to AoB, Reprint as a correction and Load
   * test agreements all come through here, so none of them can reach further
   * than a real driver does.
   */
  const postDraft = useCallback(async (outgoing: Draft): Promise<Sent> => {
    const body = await envelopeWithHash(outgoing);
    const res = await fetch(`${coreBaseUrl()}/inbound/print-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-practice-id': outgoing.practiceId },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: { id?: string; duplicate?: boolean; message?: unknown } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      parsed = { message: text.slice(0, 400) };
    }
    return {
      /*
       * THE TESTER'S OWN CLOCK (Carl, 28 September 2026: *"what date is on
       * the top right. My PC says 6:25 PM AEST"*). `toISOString` is UTC, so
       * a Sydney afternoon read back as a morning and every row looked ten
       * hours stale. The instant was always right; only the zone was wrong.
       * A bench instrument is read next to a wall clock, so it shows the
       * wall clock's time.
       */
      at: localStamp(),
      formReference: outgoing.formReference,
      jobId: parsed.id ?? null,
      sourceSha256: String(body.sourceSha256),
      httpStatus: res.status,
      duplicate: Boolean(parsed.duplicate),
      error: res.ok ? undefined : JSON.stringify(parsed.message ?? parsed).slice(0, 400),
    };
  }, []);

  /**
   * SEND, OPTIONALLY OVERRIDING A FIELD OF THE DRAFT.
   *
   * THE OVERRIDE IS WHY THIS PARAMETER EXISTS, and it is not a convenience.
   * `reprint` has to force the previous row's FORM REFERENCE, and the first
   * version did that with `setDraft` followed by a zero-delay `setTimeout`,
   * hoping the state write landed first. It does not: the `send` that timer
   * calls is the one captured on the render BEFORE the write, so the forced
   * reference was silently dropped and the tool sent whatever reference
   * happened to be in the field. Harmless while they matched, and wrong the
   * moment a tester loaded a different preset in between — the correction
   * would have arrived as a brand-new form rather than a reprint of that one.
   * Passing the value beats racing the state.
   */
  const send = useCallback(async (override?: Partial<Draft>) => {
    const outgoing: Draft = override ? { ...draft, ...override } : draft;
    setBusy(true);
    try {
      const record = await postDraft(outgoing);
      setSent((rows) => [record, ...rows]);
      /*
       * THE HANDLER RUNS AFTER THE 202. A single delayed read is enough on a
       * dev box and costs nothing; a poll loop would be a background timer in
       * a tool that is open for minutes at a time.
       */
      if (record.jobId) {
        const id = record.jobId;
        window.setTimeout(() => {
          void refreshOutcome(id, outgoing.practiceId);
          void loadList(outgoing.practiceId);
        }, 1200);
      }
    } finally {
      setBusy(false);
    }
  }, [draft, postDraft, refreshOutcome, loadList]);

  /**
   * CORRECTED FROM THE PMS AND REPRINTED — Carl's second half, as one button.
   *
   * IT KEEPS THE FORM REFERENCE AND NOTHING ELSE IS FORCED. The reference is
   * what makes this the SAME FORM (`db4:<formReference>` is the service
   * record's idempotency key); the corrected fields are whatever is on the
   * screen. The hash moves because the content moved, so it arrives as a new
   * print job rather than a duplicate — which is precisely what a reprint off
   * a corrected PMS record looks like from this side of the wire.
   */
  const reprint = useCallback(
    async (previous: Sent) => {
      // The field on screen catches up for the tester's benefit; the SEND
      // carries the reference itself, so it cannot depend on that landing.
      setDraft((d) => ({ ...d, formReference: previous.formReference }));
      await send({ formReference: previous.formReference });
    },
    [send],
  );

  /**
   * LOAD TEST AGREEMENTS — see the block above `AobPrinterTool`.
   *
   * A FRESH FORM REFERENCE PER FORM PER PRESS. The reference is what makes a
   * DB4 the same form (`db4:<formReference>`), so reusing one would reprint
   * the last batch rather than load a new one.
   *
   * THE SUMMARY SAYS WHAT CORE RECORDED, per form: placed, the reason code it
   * gave for placing nothing, the door's own refusal, or that it had not
   * finished yet. Never a guess about why.
   */
  const loadTestAgreements = useCallback(async () => {
    const practiceId = draft.practiceId.trim();
    setLoading(true);
    setLoadResult(null);
    try {
      let res: Response;
      try {
        res = await fetch(`${coreBaseUrl()}/dev/aobprinter-test-patients`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-practice-id': practiceId },
          body: '{}',
        });
      } catch (err) {
        setLoadResult({
          kind: 'refused',
          text: `Could not reach core at ${coreBaseUrl()} (${err instanceof Error ? err.message : String(err)}). Nothing was sent.`,
        });
        return;
      }
      const answer = (await res.json().catch(() => ({}))) as Partial<TestPatients> & {
        reason?: string;
        message?: unknown;
      };
      if (!res.ok) {
        const said = typeof answer.message === 'string' ? answer.message : JSON.stringify(answer.message ?? answer);
        setLoadResult({
          kind: 'refused',
          text: `Core refused to set up the test patients (HTTP ${res.status}${answer.reason ? `, ${answer.reason}` : ''}): ${said} Nothing was sent.`,
        });
        return;
      }
      const patients = answer.patients ?? [];
      const numbers = answer.servicingProviderNumbers ?? [];
      // The presets' own servicing number when the practice knows it, so the page matches the presets.
      const servicing = PRESETS[0]!.apply(BLANK).providers.find((p) => p.role === 'servicing')?.providerNumber;
      const providerNumber = servicing && numbers.includes(servicing) ? servicing : numbers[0];
      if (!providerNumber || patients.length === 0) {
        setLoadResult({
          kind: 'refused',
          text: `Core answered with ${patients.length} test patient(s) and ${numbers.length} servicing provider number(s), so there was nothing to print. Nothing was sent.`,
        });
        return;
      }

      const today = localDate();
      const stamp = Date.now().toString(36).toUpperCase();
      const forms = patients.map((p, i) => {
        const preset =
          PRESETS.find((x) => x.key === LOAD_TEST_PRESET_KEYS[i % LOAD_TEST_PRESET_KEYS.length]) ?? PRESETS[0]!;
        const started = startFromPreset(preset, {
          ...BLANK,
          practiceId,
          patientRecordNumber: p.patientRecordNumber,
          givenNames: p.givenNames,
          familyName: p.familyName,
        });
        const outgoing: Draft = {
          ...started,
          dateOfBirth: p.dateOfBirth,
          formReference: `LOAD-${stamp}-${String(i + 1).padStart(2, '0')}`,
          serviceDate: today,
          services: started.services.map((s) => ({ ...s, serviceDate: today })),
          providers: started.providers.map((pr) => (pr.role === 'servicing' ? { ...pr, providerNumber } : pr)),
        };
        return { outgoing, patientName: `${p.givenNames} ${p.familyName}`, presetLabel: preset.label };
      });

      const posted: Array<{ form: (typeof forms)[number]; record: Sent | null; failure?: string }> = [];
      for (const form of forms) {
        try {
          posted.push({ form, record: await postDraft(form.outgoing) });
        } catch (err) {
          posted.push({ form, record: null, failure: err instanceof Error ? err.message : String(err) });
        }
      }
      setSent((rows) => [
        ...posted.flatMap((p) => (p.record ? [p.record] : [])).reverse(),
        ...rows,
      ]);

      /* The handler runs after the 202, so read each job back until core has finished with it. */
      const finished = new Map<string, { state?: string; outcome?: unknown }>();
      const lastState = new Map<string, string | undefined>();
      const pending = () =>
        posted.flatMap((p) => (p.record?.jobId && !finished.has(p.record.jobId) ? [p.record.jobId] : []));
      for (let attempt = 0; attempt < LOAD_POLLS && pending().length > 0; attempt++) {
        if (attempt > 0) await new Promise((r) => window.setTimeout(r, LOAD_POLL_MS));
        for (const id of pending()) {
          const row = await readOutcome(id, practiceId);
          if (!row) continue;
          if (row.state === 'done' || row.state === 'dead') finished.set(id, row);
          else lastState.set(id, row.state);
        }
      }
      setSent((rows) =>
        rows.map((r) => {
          const row = r.jobId ? finished.get(r.jobId) : undefined;
          return row ? { ...r, state: row.state, outcome: row.outcome } : r;
        }),
      );

      const rows: LoadRow[] = posted.map(({ form, record, failure }) => {
        const base = {
          formReference: form.outgoing.formReference,
          patientName: form.patientName,
          presetLabel: form.presetLabel,
        };
        if (!record) return { ...base, httpStatus: 0, error: `the request did not complete (${failure})` };
        if (record.error !== undefined) return { ...base, httpStatus: record.httpStatus, error: record.error };
        const row = record.jobId ? finished.get(record.jobId) : undefined;
        if (!row) {
          return { ...base, httpStatus: record.httpStatus, state: record.jobId ? lastState.get(record.jobId) : undefined };
        }
        const db4 = ((row.outcome as Record<string, unknown> | null)?.db4 ?? null) as Db4Part | null;
        return {
          ...base,
          httpStatus: record.httpStatus,
          state: row.state,
          placed: db4?.placed === true,
          reason: db4 ? (db4.reason ?? null) : `job ${row.state} with no DB4 outcome`,
        };
      });
      setLoadResult({ kind: 'done', created: answer.created ?? 0, providerNumber, rows });
      void loadList(practiceId);
    } finally {
      setLoading(false);
    }
  }, [draft.practiceId, postDraft, readOutcome, loadList]);

  /** One line per stored form — and the same text the filter matches on. */
  const existingLabel = useCallback(
    (row: ExistingForm) =>
      [
        row.formReference ?? '(no reference)',
        row.patientName ?? row.patientRecordNumber ?? '(no patient)',
        row.patientRecordNumber ?? '',
        row.serviceDate ?? '',
        row.placed === false ? `refused: ${row.reason ?? 'unknown'}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    [],
  );

  /*
   * EVERY WORD OF THE QUERY, ANYWHERE IN THE LINE, case-insensitively — so
   * "ada dummy", "dummyfield ada" and "00681" all find the same row. AND and
   * not OR: adding a word must narrow, or a two-word query returns more than
   * a one-word one and the box stops feeling like a search.
   */
  const existingShown = useMemo(() => {
    const words = existingFilter.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return existing;
    return existing.filter((row) => {
      const haystack = existingLabel(row).toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [existing, existingFilter, existingLabel]);

  const setService = (index: number, patch: Partial<ServiceRow>) =>
    setDraft((d) => ({
      ...d,
      services: d.services.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));

  const setProvider = (index: number, patch: Partial<ProviderRow>) =>
    setDraft((d) => ({
      ...d,
      providers: d.providers.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>AOBPrinter test tool</h1>
        <div className={styles.panel} role="region" aria-labelledby="load-h">
          <h2 id="load-h" className={styles.h2}>
            Load test agreements
          </h2>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => void loadTestAgreements()}
              disabled={loading || busy}
            >
              {loading ? 'Loading test agreements…' : 'Load test agreements'}
            </button>
          </div>
          <p className={styles.actionsNote}>
            Prints five DB4s for practice <code>{draft.practiceId || '(none set)'}</code>, one per fake test
            patient (PMS patient IDs <code>DB4TEST-01</code> to <code>DB4TEST-05</code>, created by core the first
            time and reused after), through the same <code>/inbound/print-jobs</code> door as Print to AoB. The
            five shapes are ones that place: {LOAD_TEST_PRESET_KEYS.map((k) => PRESETS.find((p) => p.key === k)?.label ?? k).join('; ')}. Each press uses new form references and today&rsquo;s date, so it adds five
            new agreements rather than reprinting the last five.
          </p>
          <div aria-live="polite">
            {loadResult?.kind === 'refused' ? <p className={styles.outcomeLeadBad}>{loadResult.text}</p> : null}
            {loadResult?.kind === 'done' ? (
              <div className={styles.outcome}>
                <p
                  className={
                    loadResult.rows.every((r) => r.placed === true) ? styles.outcomeLead : styles.outcomeLeadBad
                  }
                >
                  {`Sent ${loadResult.rows.filter((r) => r.error === undefined).length} of ${loadResult.rows.length} to core; ${loadResult.rows.filter((r) => r.placed === true).length} placed an agreement.`}
                </p>
                <p className={styles.outcomeNote}>
                  {`Servicing provider number ${loadResult.providerNumber}. ${loadResult.created === 0 ? 'The test patients were already on file.' : `Core created ${loadResult.created} test patient(s) first.`}`}
                </p>
                <ul className={styles.outcomeNote}>
                  {loadResult.rows.map((r) => (
                    <li key={r.formReference}>
                      <code>{r.formReference}</code> · {r.patientName} · {r.presetLabel}:{' '}
                      <span className={r.placed === true ? styles.ok : styles.bad}>{loadRowInWords(r)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
        <p className={styles.lead}>
          Stands in for the practice&rsquo;s print driver. Composes a DB4 print record and posts it to{' '}
          <code>{coreBaseUrl()}/inbound/print-jobs</code> — the same door, the same DTOs. Dev only:
          use fake identities, and never a real Medicare number.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="existing-h">
        <h2 id="existing-h" className={styles.h2}>
          Correct a form already sent
        </h2>
        <p className={styles.hint}>
          Loads the stored record whole. Fix the field the practice fixed, then press{' '}
          <strong>Print to AoB</strong> — the form reference stays the same, so it arrives as a
          correction of that form rather than a new one.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="existing-filter">
            Search
          </label>
          <input
            id="existing-filter"
            type="search"
            className={styles.input}
            value={existingFilter}
            onChange={(e) => setExistingFilter(e.target.value)}
            placeholder="Any part of a name, a PMS patient ID, a form reference or a date"
          />
          <p className={styles.hint} aria-live="polite">
            {existingFilter.trim()
              ? `${existingShown.length} of ${existing.length} forms match.`
              : `The ${existing.length} most recent forms.`}
          </p>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="existing-pick">
            A form already sent
          </label>
          <select
            id="existing-pick"
            className={styles.input}
            value={loadedFrom}
            onChange={(e) => void loadForm(e.target.value)}
          >
            {/*
              THE CHOSEN FORM STAYS IN THE LIST even when the filter no longer
              matches it. A `select` whose `value` is not among its options
              silently shows the first one instead, so narrowing the search
              after loading would make the picker claim a form nobody chose.
            */}
            <option value="">
              {existingShown.length === 0 && existingFilter.trim()
                ? 'Nothing matches that search'
                : 'Choose a form…'}
            </option>
            {existing
              .filter((row) => row.id === loadedFrom || existingShown.includes(row))
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {existingLabel(row)}
                </option>
              ))}
          </select>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="presets-h">
        <h2 id="presets-h" className={styles.h2}>
          Start from a shape
        </h2>
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={styles.preset}
              onClick={() => applyPreset(p.key)}
              title={p.why}
            >
              <span className={styles.presetLabel}>{p.label}</span>
              <span className={styles.presetWhy}>{p.why}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="form-h">
        <h2 id="form-h" className={styles.h2}>
          The form
        </h2>
        <div className={styles.grid}>
          <Field label="Practice id" value={draft.practiceId} onChange={(v) => set('practiceId', v)} mono />
          <Field
            label="Form reference"
            value={draft.formReference}
            onChange={(v) => set('formReference', v)}
            mono
            hint="What makes this the same form. Reuse it to reprint a correction."
          />
          <Field
            label="PMS patient ID"
            value={draft.patientRecordNumber}
            onChange={(v) => set('patientRecordNumber', v)}
            mono
            hint="Must already exist — a DB4 matches a patient and never creates one."
          />
          <Field label="Given names" value={draft.givenNames} onChange={(v) => set('givenNames', v)} />
          <Field label="Family name" value={draft.familyName} onChange={(v) => set('familyName', v)} />
          <Field label="Date of birth" value={draft.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} />
          <Field label="Address" value={draft.address} onChange={(v) => set('address', v)} />
          <Field label="Mobile" value={draft.mobile} onChange={(v) => set('mobile', v)} />
          <Field
            label="Medicare card number"
            // eslint-disable-next-line no-restricted-syntax -- the DB4's decided exception (D-2026-09-14-03); a bench field that composes what the practice's form prints, never an identity check.
            value={draft.medicareCardNumber}
            onChange={(v) => set('medicareCardNumber', v)}
            mono
            hint="Fake only. Rides on a DB4 because the form prints it — it identifies nobody."
          />
          <Field label="IRN" value={draft.irn} onChange={(v) => set('irn', v)} mono />
          <Field label="Service date" value={draft.serviceDate} onChange={(v) => set('serviceDate', v)} />
          {/*
            THE PLACE THAT PRINTED THE FORM — missing from this tool until 28
            September 2026, which is why moving 2A's agreement facts to the
            foot of the left column appeared to change nothing: there was no
            location block for them to sit below. Clear all five and the block
            disappears from the tablet, which the `no-location` preset does in
            one press.
          */}
          <Field
            label="Practice name"
            value={draft.locationName}
            onChange={(v) => set('locationName', v)}
            hint="The servicing location, as 2A's left column prints it."
          />
          <Area
            label="Practice address"
            value={draft.locationAddressLines}
            onChange={(v) => set('locationAddressLines', v)}
            rows={2}
            hint="One line per address line, as the form prints them. Blank means the template read none."
          />
          <Field label="Suburb" value={draft.locationSuburb} onChange={(v) => set('locationSuburb', v)} />
          <Field label="State" value={draft.locationState} onChange={(v) => set('locationState', v)} />
          <Field
            label="Postcode"
            value={draft.locationPostcode}
            onChange={(v) => set('locationPostcode', v)}
            mono
          />
          <Field label="Print queue" value={draft.queueLabel} onChange={(v) => set('queueLabel', v)} />
          <Field
            label="Parser template"
            value={draft.parserTemplateVersion}
            onChange={(v) => set('parserTemplateVersion', v)}
            mono
          />
          <Field
            label="Captured at"
            value={draft.capturedAt}
            onChange={(v) => set('capturedAt', v)}
            mono
            hint="Required at the door. Blank means now."
          />
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="providers-h">
        <h2 id="providers-h" className={styles.h2}>
          Providers
        </h2>
        {draft.providers.map((p, i) => (
          <div key={`${p.role}-${i}`} className={styles.row}>
            <span className={styles.rowRole}>{p.role}</span>
            <Field label="Name" value={p.name} onChange={(v) => setProvider(i, { name: v })} />
            <Field
              label="Provider number"
              value={p.providerNumber}
              onChange={(v) => setProvider(i, { providerNumber: v })}
              mono
            />
          </div>
        ))}
      </section>

      <section className={styles.panel} aria-labelledby="services-h">
        <h2 id="services-h" className={styles.h2}>
          Services
        </h2>
        {draft.services.map((s, i) => (
          <div key={`service-${i}`} className={styles.row}>
            <Field label="Item" value={s.mbsItemNumber} onChange={(v) => setService(i, { mbsItemNumber: v })} mono />
            <Field label="Description" value={s.description} onChange={(v) => setService(i, { description: v })} />
            <Field
              label="Benefit assigned"
              value={s.benefitAssigned}
              onChange={(v) => setService(i, { benefitAssigned: v })}
              mono
              hint="Text, exactly as printed. Blank means the template read nothing."
            />
            <button
              type="button"
              className={styles.remove}
              onClick={() => setDraft((d) => ({ ...d, services: d.services.filter((_, j) => j !== i) }))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.secondary}
          onClick={() => setDraft((d) => ({ ...d, services: [...d.services, { ...EMPTY_SERVICE }] }))}
        >
          Add a service row
        </button>
      </section>

      <section className={styles.panel}>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void send()} disabled={busy}>
            {busy ? 'Sending…' : 'Print to AoB'}
          </button>
          <button type="button" className={styles.secondary} onClick={() => setPreview((p) => !p)}>
            {preview ? 'Hide the envelope' : 'Show the envelope'}
          </button>
        </div>
        {preview ? <pre className={styles.pre}>{JSON.stringify(envelope, null, 2)}</pre> : null}
      </section>

      {sent.length > 0 ? (
        <section className={styles.panel} aria-labelledby="sent-h">
          <h2 id="sent-h" className={styles.h2}>
            What was sent
          </h2>
          <ul className={styles.sent}>
            {sent.map((s, i) => (
              <li key={`${s.sourceSha256}-${i}`} className={styles.sentRow}>
                <div className={styles.sentHead}>
                  <code>{s.formReference || '(no form reference)'}</code>
                  <span className={s.httpStatus === 202 ? styles.ok : styles.bad}>HTTP {s.httpStatus}</span>
                  {s.duplicate ? <span className={styles.dup}>duplicate — same bytes</span> : null}
                  <span className={styles.when}>{s.at}</span>
                </div>
                <dl className={styles.sentFacts}>
                  <dt>Source hash</dt>
                  <dd>
                    <code>{s.sourceSha256.slice(0, 16)}…</code>
                  </dd>
                  {s.jobId ? (
                    <>
                      <dt>Print job</dt>
                      <dd>
                        <code>{s.jobId}</code>
                      </dd>
                    </>
                  ) : null}
                  {s.state ? (
                    <>
                      <dt>State</dt>
                      <dd>{s.state}</dd>
                    </>
                  ) : null}
                  {s.outcome ? (
                    <>
                      <dt>Outcome</dt>
                      <dd>
                        <Db4OutcomeSummary outcome={s.outcome} />
                      </dd>
                    </>
                  ) : null}
                  {s.error ? (
                    <>
                      <dt>Refused</dt>
                      <dd className={styles.bad}>{s.error}</dd>
                    </>
                  ) : null}
                </dl>
                <div className={styles.actions}>
                  {s.jobId ? (
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => void refreshOutcome(s.jobId as string, draft.practiceId)}
                    >
                      Check again
                    </button>
                  ) : null}
                  <button type="button" className={styles.secondary} onClick={() => void reprint(s)}>
                    Reprint as a correction
                  </button>
                </div>
                {/*
                  WHAT THE TWO BUTTONS DO, BESIDE THEM (Carl, 28 September
                  2026: *"what are these two buttons supposed to do"*). The
                  handler runs after the 202, so the first row a send produces
                  is often stamped before there is an outcome to stamp it
                  with; and "reprint" is a word with two meanings here, only
                  one of which this button has.
                */}
                <p className={styles.actionsNote}>
                  <strong>Check again</strong> re-reads this job&rsquo;s outcome from core — the handler
                  runs just after the send, so a row that showed nothing a moment ago will have an
                  answer now. <strong>Reprint as a correction</strong> sends the form on screen again
                  under <em>this row&rsquo;s</em> form reference: same form, new content, so it arrives
                  as a new print job and core applies the reprint rule to it. Change a field first —
                  sending it back unchanged is the same bytes and is deduplicated at the door.
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  mono,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={mono ? `${styles.input} ${styles.mono}` : styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

/**
 * A FIELD THAT IS GENUINELY LINES, AND SO IS A TEXTAREA.
 *
 * AN ADDRESS ON A DB4 IS PRINTED AS LINES, and a single-line input cannot
 * hold them: loading a two-line address back would join it with a newline the
 * input renders as nothing, and resending would collapse two printed lines
 * into one. `draftFromEnvelope` exists precisely so a correction reprints
 * everything else exactly as it arrived, and quietly flattening the practice's
 * address would break that for the one field most likely to have two lines.
 */
function Area({
  label,
  value,
  onChange,
  hint,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={styles.input}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

export { sha256Hex };

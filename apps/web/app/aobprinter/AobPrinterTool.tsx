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
 * half, and today it does nothing (`linkToPrintJob` filters on
 * `sourcePrintJobId IS NULL`, so the agreement keeps pointing at the original
 * broken record). The tool makes that gap visible rather than papering it.
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
import { useCallback, useMemo, useState } from 'react';
import { BLANK, PRESETS, type Draft, type ProviderRow, type ServiceRow } from './presets';
import { buildEnvelope, envelopeWithHash, sha256Hex } from './envelope';
import styles from './aobprinter.module.css';

function coreBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
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

const EMPTY_SERVICE: ServiceRow = {
  serviceDate: '2026-09-12',
  time: '09:00',
  mbsItemNumber: '',
  description: '',
  benefitAssigned: '',
};

export function AobPrinterTool() {
  const [draft, setDraft] = useState<Draft>({ ...BLANK, formReference: '', patientRecordNumber: '' });
  const [sent, setSent] = useState<Sent[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const envelope = useMemo(() => buildEnvelope(draft), [draft]);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setDraft((d) => {
      const next = preset.apply({ ...BLANK, practiceId: d.practiceId, patientRecordNumber: d.patientRecordNumber });
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

  /** What became of it — state and CODES, never the stored envelope. */
  const refreshOutcome = useCallback(
    async (jobId: string, practiceId: string) => {
      try {
        const res = await fetch(`${coreBaseUrl()}/inbound/print-jobs/${jobId}`, {
          headers: { 'x-practice-id': practiceId },
        });
        if (!res.ok) return;
        const row = (await res.json()) as { state?: string; outcome?: unknown };
        setSent((rows) =>
          rows.map((r) => (r.jobId === jobId ? { ...r, state: row.state, outcome: row.outcome } : r)),
        );
      } catch {
        /* The tool is a bench instrument; a failed poll is not worth a banner. */
      }
    },
    [],
  );

  const send = useCallback(async () => {
    setBusy(true);
    try {
      const body = await envelopeWithHash(draft);
      const res = await fetch(`${coreBaseUrl()}/inbound/print-jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-practice-id': draft.practiceId },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let parsed: { id?: string; duplicate?: boolean; message?: unknown } = {};
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        parsed = { message: text.slice(0, 400) };
      }
      const record: Sent = {
        at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        formReference: draft.formReference,
        jobId: parsed.id ?? null,
        sourceSha256: String(body.sourceSha256),
        httpStatus: res.status,
        duplicate: Boolean(parsed.duplicate),
        error: res.ok ? undefined : JSON.stringify(parsed.message ?? parsed).slice(0, 400),
      };
      setSent((rows) => [record, ...rows]);
      /*
       * THE HANDLER RUNS AFTER THE 202. A single delayed read is enough on a
       * dev box and costs nothing; a poll loop would be a background timer in
       * a tool that is open for minutes at a time.
       */
      if (record.jobId) {
        const id = record.jobId;
        window.setTimeout(() => void refreshOutcome(id, draft.practiceId), 1200);
      }
    } finally {
      setBusy(false);
    }
  }, [draft, refreshOutcome]);

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
      setDraft((d) => ({ ...d, formReference: previous.formReference }));
      // The send below reads `draft`, so it is deferred a tick past the state
      // write rather than racing it.
      window.setTimeout(() => void send(), 0);
    },
    [send],
  );

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
        <p className={styles.lead}>
          Stands in for the practice&rsquo;s print driver. Composes a DB4 print record and posts it to{' '}
          <code>{coreBaseUrl()}/inbound/print-jobs</code> — the same door, the same DTOs. Dev only:
          use fake identities, and never a real Medicare number.
        </p>
      </header>

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
            label="Chart number"
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
                        <code>{JSON.stringify(s.outcome)}</code>
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
                      Read the outcome again
                    </button>
                  ) : null}
                  <button type="button" className={styles.secondary} onClick={() => void reprint(s)}>
                    Reprint this form reference with what is on screen
                  </button>
                </div>
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

export { sha256Hex };

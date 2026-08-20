'use client';

import { useCallback, useEffect, useState } from 'react';
import { strings } from './strings';
import { apiHeaders, beginLogin, clearSession, currentSession, type Session } from './auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:3001';
const RULES_URL = process.env.NEXT_PUBLIC_RULES_URL ?? 'http://localhost:3002';
const VAULT_URL = process.env.NEXT_PUBLIC_VAULT_URL ?? 'http://localhost:3003';

const SERVICES = [
  { name: 'core', url: CORE_URL },
  { name: 'rules', url: RULES_URL },
  { name: 'vault', url: VAULT_URL },
] as const;

interface SeedContext {
  practiceId: string;
  providerId: string;
  patientId: string;
  assignorId: string;
}

interface AgreementRow {
  id: string;
  type: string;
  status: string;
  createdAt: string;
}

interface OutstandingRow {
  serviceRecordId: string;
  serviceDate: string;
  mbsItemNumbers: string[];
  daysRemaining: number;
  band: string;
  agreementId: string | null;
  needsAgreement: boolean;
  outboundChaseSuppressed: boolean;
  revenueForgone: boolean;
}

const BAND_COLOURS: Record<string, string> = {
  standard: '#1a7f37',
  compressed: '#9a6700',
  urgent: '#bc4c00',
  last_chance: '#cf222e',
  expired: '#57606a',
};

type HealthState = Record<string, boolean>;

const card: React.CSSProperties = {
  border: '1px solid #d0d7de',
  borderRadius: 8,
  padding: '0.75rem 1rem',
  minWidth: 140,
};

export function ConsoleDashboard() {
  const [health, setHealth] = useState<HealthState>({});
  const [seed, setSeed] = useState<SeedContext | null>(null);
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [journey, setJourney] = useState<string[]>([]);
  const [chain, setChain] = useState<{ valid: boolean; length: number } | null>(null);
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([]);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(currentSession());
  }, []);

  const checkHealth = useCallback(async () => {
    const next: HealthState = {};
    await Promise.all(
      SERVICES.map(async (svc) => {
        try {
          const res = await fetch(`${svc.url}/health`, { cache: 'no-store' });
          next[svc.name] = res.ok;
        } catch {
          next[svc.name] = false;
        }
      }),
    );
    setHealth(next);
  }, []);

  const loadAgreements = useCallback(async (practiceId: string) => {
    const res = await fetch(`${CORE_URL}/agreements`, {
      headers: apiHeaders(practiceId),
      cache: 'no-store',
    });
    if (res.ok) setAgreements((await res.json()) as AgreementRow[]);
  }, []);

  useEffect(() => {
    void checkHealth();
    const timer = setInterval(() => void checkHealth(), 10_000);
    return () => clearInterval(timer);
  }, [checkHealth]);

  const createSample = async () => {
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/dev/seed`, { method: 'POST' });
      if (!res.ok) throw new Error(`seed returned ${res.status}`);
      const context = (await res.json()) as SeedContext;
      setSeed(context);
      await loadAgreements(context.practiceId);
    } catch (err) {
      setError(String(err));
    }
  };

  const loadChain = useCallback(async () => {
    try {
      const res = await fetch(`${VAULT_URL}/chain/verify`, { cache: 'no-store' });
      if (res.ok) setChain((await res.json()) as { valid: boolean; length: number });
    } catch {
      setChain(null);
    }
  }, []);

  useEffect(() => {
    void loadChain();
    const timer = setInterval(() => void loadChain(), 10_000);
    return () => clearInterval(timer);
  }, [loadChain]);

  /**
   * Drives the real remote-capture journey end to end against the live
   * services. The lock step will report the rules service's 501 until the
   * human-authored s 65C rule set is registered — that is the guard working,
   * not a bug (signing an unvalidated payload must be unreachable).
   */
  const runJourney = async () => {
    if (!seed) return;
    setError(null);
    const log: string[] = [];
    const push = (line: string) => {
      log.push(line);
      setJourney([...log]);
    };
    const headers = apiHeaders(seed.practiceId);
    try {
      const draftRes = await fetch(`${CORE_URL}/agreements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'episodic_pre',
          providerId: seed.providerId,
          patientId: seed.patientId,
          assignorId: seed.assignorId,
          assignorIsPatient: true,
        }),
      });
      const draft = await draftRes.json();
      push(`Draft created (${String(draft.id).slice(0, 8)}…)`);

      const captureRes = await fetch(`${CORE_URL}/capture`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ agreementId: draft.id, channel: 'sms_link' }),
      });
      const capture = await captureRes.json();
      push('Remote link minted (single-use token, hash-only at rest)');

      await fetch(`${CORE_URL}/capture/link/${capture.token}`);
      push('Landing opened — content-blind challenge issued');

      const verifyRes = await fetch(`${CORE_URL}/capture/link/${capture.token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stated: {
            name: 'Testpatient Alex',
            date_of_birth: '1957-03-14',
            address: '1 Example Street, Sampletown NSW 2000',
          },
        }),
      });
      const verify = await verifyRes.json();
      push(`Verification: ${verify.outcome} (three stated identifiers, constant-time match)`);

      // The client supplies only what the server cannot know — every other
      // particular is snapshotted server-side from platform records.
      const lockRes = await fetch(`${CORE_URL}/agreements/${draft.id}/particulars`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          serviceDate: new Date().toISOString().slice(0, 10),
          basicServiceDescription: 'General practitioner attendance',
        }),
      });
      if (lockRes.status === 501) {
        push('Lock blocked (501): no s 65C rule set registered — human-authored zone. Signature stays unreachable.');
      } else if (lockRes.ok) {
        const locked = await lockRes.json();
        push(`Particulars locked; artefact hashed ${String(locked.renderedArtefactHash).slice(0, 12)}…`);
        const signRes = await fetch(`${CORE_URL}/agreements/${draft.id}/sign`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            method: 'tap_to_approve',
            channel: 'sms_link',
            captureRequestId: capture.captureRequestId,
          }),
        });
        push(signRes.ok ? 'Signed → validated → stored, evidence vaulted' : `Sign failed (${signRes.status})`);
      } else {
        push(`Lock failed (${lockRes.status})`);
      }

      await loadAgreements(seed.practiceId);
      await loadChain();
    } catch (err) {
      setError(String(err));
    }
  };

  const loadOutstanding = useCallback(async (practiceId: string) => {
    const res = await fetch(`${CORE_URL}/reconciliation/outstanding`, {
      headers: apiHeaders(practiceId),
      cache: 'no-store',
    });
    if (res.ok) setOutstanding((await res.json()) as OutstandingRow[]);
  }, []);

  const syncPms = async () => {
    if (!seed) return;
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/pms/sync`, {
        method: 'POST',
        headers: apiHeaders(seed.practiceId),
      });
      if (!res.ok) throw new Error(`sync returned ${res.status}`);
      await loadOutstanding(seed.practiceId);
    } catch (err) {
      setError(String(err));
    }
  };

  const resend = async (serviceRecordId: string) => {
    if (!seed) return;
    setError(null);
    const res = await fetch(`${CORE_URL}/reconciliation/${serviceRecordId}/resend`, {
      method: 'POST',
      headers: apiHeaders(seed.practiceId),
      body: JSON.stringify({ channel: 'sms_link' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(String(body.message ?? `resend returned ${res.status}`));
    }
    await loadOutstanding(seed.practiceId);
  };

  const createDraft = async () => {
    if (!seed) return;
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/agreements`, {
        method: 'POST',
        headers: apiHeaders(seed.practiceId),
        body: JSON.stringify({
          type: 'episodic_pre',
          providerId: seed.providerId,
          patientId: seed.patientId,
          assignorId: seed.assignorId,
          assignorIsPatient: true,
        }),
      });
      if (!res.ok) throw new Error(`create returned ${res.status}`);
      await loadAgreements(seed.practiceId);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div>
      <section aria-label="Sign in" style={{ marginBottom: '1.5rem' }}>
        {session ? (
          <p>
            {strings.auth.signedInAs} <strong data-testid="signed-in-as">{session.username}</strong>{' '}
            <button
              onClick={() => {
                clearSession();
                setSession(null);
              }}
            >
              {strings.auth.signOut}
            </button>
          </p>
        ) : (
          <p>
            <button onClick={() => void beginLogin()} data-testid="sign-in">
              {strings.auth.signIn}
            </button>{' '}
            <span style={{ color: '#57606a' }}>{strings.auth.passkeyNote}</span>
          </p>
        )}
      </section>

      <section aria-label={strings.console.services}>
        <h2>{strings.console.services}</h2>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {SERVICES.map((svc) => {
            const up = health[svc.name];
            return (
              <div key={svc.name} style={card} data-testid={`service-${svc.name}`}>
                <strong>{svc.name}</strong>
                <div style={{ color: up ? '#1a7f37' : '#cf222e' }}>
                  {up === undefined ? '…' : up ? strings.console.serviceUp : strings.console.serviceDown}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label={strings.console.agreements} style={{ marginTop: '1.5rem' }}>
        <h2>{strings.console.agreements}</h2>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button onClick={() => void createSample()}>{strings.console.seedButton}</button>
          <button onClick={() => void createDraft()} disabled={!seed}>
            {strings.console.draftButton}
          </button>
          <button onClick={() => void runJourney()} disabled={!seed}>
            {strings.console.journeyButton}
          </button>
          <button onClick={() => void syncPms()} disabled={!seed}>
            {strings.console.syncButton}
          </button>
          <button
            onClick={() => {
              if (!seed) return;
              void loadAgreements(seed.practiceId);
              void loadOutstanding(seed.practiceId);
            }}
            disabled={!seed}
          >
            {strings.console.refresh}
          </button>
        </div>
        {chain && (
          <p data-testid="chain-status">
            {strings.console.chainLabel}:{' '}
            <span style={{ color: chain.valid ? '#1a7f37' : '#cf222e' }}>
              {chain.valid ? strings.console.chainValid : strings.console.chainInvalid}
            </span>{' '}
            · {chain.length} events
          </p>
        )}
        {journey.length > 0 && (
          <div style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: '0.75rem 1rem', margin: '0.75rem 0' }}>
            <strong>{strings.console.journeyLog}</strong>
            <ol style={{ margin: '0.5rem 0 0 1.25rem' }}>
              {journey.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </div>
        )}
        {seed ? (
          <p>
            {strings.console.practiceLabel}: <code data-testid="practice-id">{seed.practiceId}</code>
          </p>
        ) : (
          <p>{strings.console.noPractice}</p>
        )}
        {error && <p style={{ color: '#cf222e' }}>{`${strings.console.errorPrefix} ${error}`}</p>}
        {agreements.length === 0 ? (
          <p>{strings.console.noAgreements}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse' }} data-testid="agreements-table">
            <thead>
              <tr>
                {[strings.console.typeLabel, strings.console.statusLabel, strings.console.createdLabel].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.25rem 1rem 0.25rem 0' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agreements.map((a) => (
                <tr key={a.id}>
                  <td style={{ padding: '0.25rem 1rem 0.25rem 0' }}>{a.type}</td>
                  <td style={{ padding: '0.25rem 1rem 0.25rem 0' }}>{a.status}</td>
                  <td style={{ padding: '0.25rem 1rem 0.25rem 0' }}>{new Date(a.createdAt).toLocaleString('en-AU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label={strings.console.outstanding} style={{ marginTop: '1.5rem' }}>
        <h2>{strings.console.outstanding}</h2>
        {outstanding.length === 0 ? (
          <p>{strings.console.noOutstanding}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse' }} data-testid="outstanding-table">
            <thead>
              <tr>
                {[
                  strings.console.serviceDateLabel,
                  strings.console.itemsLabel,
                  strings.console.daysRemainingLabel,
                  strings.console.bandLabel,
                  '',
                ].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '0.25rem 1rem 0.25rem 0' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {outstanding.map((row) => (
                <tr key={row.serviceRecordId}>
                  <td style={{ padding: '0.25rem 1rem 0.25rem 0' }}>{row.serviceDate}</td>
                  <td style={{ padding: '0.25rem 1rem 0.25rem 0' }}>{row.mbsItemNumbers.join(', ')}</td>
                  <td style={{ padding: '0.25rem 1rem 0.25rem 0' }}>{row.daysRemaining}</td>
                  <td style={{ padding: '0.25rem 1rem 0.25rem 0', color: BAND_COLOURS[row.band] ?? 'inherit' }}>
                    {row.band}
                    {row.revenueForgone ? ` — ${strings.console.revenueForgoneLabel}` : ''}
                    {row.outboundChaseSuppressed ? ` — ${strings.console.chaseSuppressedLabel}` : ''}
                  </td>
                  <td style={{ padding: '0.25rem 0' }}>
                    <button
                      onClick={() => void resend(row.serviceRecordId)}
                      disabled={row.revenueForgone || row.outboundChaseSuppressed || row.needsAgreement}
                    >
                      {strings.console.resendLabel}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

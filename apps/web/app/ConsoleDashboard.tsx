'use client';

import { useCallback, useEffect, useState } from 'react';
import { strings } from './strings';

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
      headers: { 'x-practice-id': practiceId },
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

  const createDraft = async () => {
    if (!seed) return;
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/agreements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-practice-id': seed.practiceId },
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
          <button onClick={() => seed && void loadAgreements(seed.practiceId)} disabled={!seed}>
            {strings.console.refresh}
          </button>
        </div>
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
    </div>
  );
}

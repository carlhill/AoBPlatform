'use client';

/**
 * The applicant's status page.
 *
 * Reached with a bearer token in the URL and no sign-in, which shapes
 * everything it may say. The token is 256 bits, so guessing is not the threat —
 * FORWARDING is. An applicant forwards the acknowledgement email and whoever
 * receives it sees this page.
 *
 * So it shows what the applicant themselves submitted, plus which of the three
 * gates has been reached, and nothing further. Specifically not: the reviewer's
 * name, their note, the checklist, any check outcome, the identity score, or
 * whether an ABN is already registered here. That last one would turn a status
 * query into a way to enumerate our customers.
 *
 * Deliberately the SAME three-row ledger they saw when they submitted. Somebody
 * anxious about a delay should recognise the screen, not have to learn a second
 * vocabulary for the same three facts.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PencilLine } from 'lucide-react';
import { Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import { GateLedger, type GateState } from '../../apply/GateLedger';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface StatusPayload {
  reference: string;
  name: string;
  submittedAt: string;
  amendmentCount: number;
  state: string;
  gates: { checksum: GateState; register: GateState; human: GateState };
  amendable: boolean;
  correctionExpiresAt: string | null;
  correctionReason: string | null;
}

export function StatusView({ token }: { token: string }) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`${CORE_URL}/applications/${token}/status`)
      .then((r) => {
        if (r.status === 404) {
          setMissing(true);
          return null;
        }
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((data: StatusPayload | null) => data && setStatus(data))
      .catch((e: Error) => setError(e instanceof TypeError ? strings.status.unreachable : e.message));
  }, [token]);

  if (missing) {
    return (
      <Shell right={strings.status.audience}>
        <h1 className={ui.pageTitle}>{strings.status.notFound}</h1>
        <p className={ui.pageLead}>{strings.status.notFoundBody}</p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell right={strings.status.audience}>
        <Notice tone="stop" title={strings.status.notLoaded}>
          {error}
        </Notice>
      </Shell>
    );
  }

  if (!status) {
    return (
      <Shell right={strings.status.audience}>
        <p className={ui.hint}>{strings.review.loading}</p>
      </Shell>
    );
  }

  const decided = status.state !== 'pending';

  return (
    <Shell right={strings.status.audience}>
      <h1 className={ui.pageTitle}>{status.name}</h1>
      <p className={ui.pageLead}>
        {decided
          ? status.state === 'validated'
            ? strings.status.leadApproved
            : strings.status.leadDecided
          : strings.status.leadPending}
      </p>

      <GateLedger
        state={{
          checksum: status.gates.checksum,
          register: status.gates.register,
          human: status.gates.human,
          humanDetail: decided ? strings.status.humanDecided : strings.status.humanWaiting,
        }}
      />

      <p className={ui.hint}>
        {strings.status.reference} <span className={ui.mono}>{status.reference}</span>
      </p>
      {status.amendmentCount > 0 && (
        <p className={ui.hint}>
          {strings.status.amendedTimes.replace('{n}', String(status.amendmentCount))}
        </p>
      )}

      {status.amendable ? (
        <div style={{ marginTop: 'var(--s5)' }}>
          <Link href={`/status/${token}/correct`} className={ui.buttonLink} data-testid="status-correct">
            <PencilLine size={15} aria-hidden="true" />
            {strings.status.correct}
          </Link>
          <p className={ui.hint} style={{ marginTop: 'var(--s2)' }}>
            {strings.status.correctHint}
          </p>
        </div>
      ) : decided ? (
        <Notice tone="warn" title={strings.status.closedTitle}>
          {strings.status.closedBody}
        </Notice>
      ) : (
        // Pending with no open window. NOT an error and not a closure — this is
        // the ordinary state of an application nobody has asked anything about.
        <Notice tone="ok" title={strings.status.notOpenTitle}>
          {strings.status.notOpenBody}
        </Notice>
      )}
    </Shell>
  );
}

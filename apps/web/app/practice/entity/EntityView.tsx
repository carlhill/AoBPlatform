'use client';

/**
 * The entity, read-only.
 *
 * READ-ONLY IS THE DESIGN, not an unfinished form. The ABN is a LOCKED field
 * (packages/domain/src/amendment.ts): a different ABN is a different legal
 * entity, and a different legal entity is a NEW APPLICATION rather than a
 * correction. Every consent record captured here names this entity, so letting
 * it be edited would silently re-point evidence at somebody else.
 *
 * The page says that out loud. A screen full of facts with no edit control and
 * no explanation reads as unfinished, and somebody will eventually ask for the
 * button to be added.
 *
 * IT ALSO SAYS HOW THE ABN WAS ESTABLISHED. "Attested" and "checked against the
 * register" are different strengths of the same claim, and the difference is
 * invisible unless it is stated — which is the same rule the credential score
 * rests on.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, CheckCircle2 } from 'lucide-react';
import { Chip, Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Practice {
  id: string;
  name: string;
  legalName: string | null;
  tradingNames: string[] | null;
  abn: string | null;
  acn: string | null;
  abnStatus: string | null;
  entityType: string | null;
  abnVerificationSource: string | null;
  abnSightedByName: string | null;
  validationState: string;
  validatedByName: string | null;
  validatedAt: string | null;
  headOfficeAddress: string | null;
  adminEmailVerifiedAt: string | null;
}

function when(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function EntityView({ practiceId }: { practiceId: string }) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${CORE_URL}/practices/${practiceId}`, { headers: { 'x-practice-id': practiceId } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Practice) => live && setPractice(data))
      .catch((e: Error) => live && setError(e instanceof TypeError ? strings.review.unreachableBody : e.message));
    return () => {
      live = false;
    };
  }, [practiceId]);

  if (error) {
    return (
      <Shell right={strings.entity.audience}>
        <Notice tone="stop" title={strings.entity.notLoaded}>
          {error}
        </Notice>
      </Shell>
    );
  }

  const attested = practice?.abnVerificationSource === 'manual_attestation';

  return (
    <Shell right={strings.entity.audience}>
      <Link href="/practice/setup" className={styles.crumb} data-testid="entity-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.entity.backToSetup}
      </Link>

      <h1 className={ui.pageTitle}>{strings.entity.title}</h1>
      <p className={ui.pageLead}>{strings.entity.lead}</p>

      {practice === null && <p className={ui.hint}>{strings.entity.loading}</p>}

      {practice && (
        <>
          <div className={`${styles.card} ${attested ? styles.cardNeedsWork : styles.cardOk}`}>
            <div className={styles.cardHead}>
              <Building2 size={18} aria-hidden="true" className={styles.cardIcon} />
              <div className={styles.cardMain}>
                <p className={styles.cardTitle}>{practice.legalName ?? practice.name}</p>
                <p className={styles.cardSub}>
                  {strings.entity.abn} {practice.abn ?? '—'}
                  {practice.acn ? ` · ${strings.entity.acn} ${practice.acn}` : ''}
                  {practice.entityType ? ` · ${practice.entityType}` : ''}
                </p>
                {practice.tradingNames && practice.tradingNames.length > 0 && (
                  <p className={styles.cardNote}>
                    {strings.entity.tradingAs} {practice.tradingNames.join(', ')}
                  </p>
                )}
                {practice.headOfficeAddress && (
                  <p className={styles.cardNote}>
                    {strings.entity.headOffice}: {practice.headOfficeAddress}
                  </p>
                )}
                <p className={styles.cardNote}>
                  {practice.validationState === 'validated'
                    ? `${strings.entity.approvedBy} ${practice.validatedByName ?? '—'} ${strings.entity.approvedOn} ${when(practice.validatedAt)}`
                    : strings.entity.notApproved}
                </p>
              </div>
              <div className={styles.cardAside}>
                {practice.abnStatus && (
                  <Chip tone={practice.abnStatus === 'ACTIVE' ? 'ok' : 'stop'}>{practice.abnStatus}</Chip>
                )}
              </div>
            </div>
          </div>

          {/*
            HOW the ABN was established. Attested and checked are different
            strengths of the same claim, and the difference is invisible unless
            it is said.
          */}
          <Notice tone={attested ? 'warn' : 'ok'} title={strings.entity.verifiedHow}>
            {attested
              ? strings.entity.verifiedAttested.replace('{who}', practice.abnSightedByName ?? 'The applicant')
              : strings.entity.verifiedAbr}
          </Notice>

          {practice.adminEmailVerifiedAt ? (
            <p className={styles.tally}>
              <Chip tone="ok">
                <CheckCircle2 size={13} aria-hidden="true" />
                {strings.entity.emailVerified}
              </Chip>
            </p>
          ) : (
            <Notice tone="warn" title={strings.entity.emailUnverified}>
              {strings.entity.emailUnverifiedBody}
            </Notice>
          )}

          {/* Why there is no edit control, said rather than left to be inferred. */}
          <Notice tone="ok" title={strings.entity.lockedTitle}>
            {strings.entity.lockedBody}
          </Notice>
        </>
      )}
    </Shell>
  );
}

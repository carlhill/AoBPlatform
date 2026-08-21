'use client';

/**
 * How consent requests reach patients, and what patients are asked.
 *
 * THE SENDER ID IS ONBOARDING, NOT SETTINGS, which is why it leads. Registering
 * one with ACMA has a lead time measured in weeks. Until it is done every
 * message shows to patients as coming from an "Unverified" sender and handsets
 * group those with scams — so a practice that discovers this after going live
 * has already taught its patients to ignore it. Nothing is broken; the response
 * rate is simply destroyed, quietly, and it cannot be hurried afterwards.
 *
 * TICKING IT IS AN ASSERTION, AND SAYS SO. We cannot check ACMA's register, so
 * the box records what the practice claims rather than what we verified. That
 * is the same distinction the credential score rests on — entering a thing
 * scores nothing, checking it is what counts — and the copy makes it explicit
 * rather than letting a tick look like proof.
 *
 * THE IDENTIFIER SET IS HERE BECAUSE IT HAS NOWHERE ELSE TO BE, and it belongs
 * with the channel: it is what the patient at the other end of the message is
 * asked. The Medicare card number is absent, permanently, and the page says so
 * out loud instead of leaving its absence to look like an oversight.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, MessageSquare, Monitor, ShieldQuestion, Timer } from 'lucide-react';
import {
  APPROVED_IDENTIFIER_TYPES,
  IDENTIFIER_COUNT_FLOOR,
} from '@aobplatform/domain';
import { Button, Checkbox, Chip, Field, Notice, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Practice {
  id: string;
  senderIdRegistered: boolean;
  linkExpiryHours: number;
  identifierTypes: string[];
}

async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

export function ChannelsView({ practiceId }: { practiceId: string }) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [senderId, setSenderId] = useState(false);
  const [expiry, setExpiry] = useState('24');
  const [identifiers, setIdentifiers] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/practices/${practiceId}`, {
        headers: { 'x-practice-id': practiceId },
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const data = (await res.json()) as Practice;
      setPractice(data);
      setSenderId(Boolean(data.senderIdRegistered));
      setExpiry(String(data.linkExpiryHours ?? 24));
      setIdentifiers(data.identifierTypes ?? []);
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <Shell right={strings.setup.audience}>
        <Notice tone="stop" title={strings.channels.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  const hours = Number(expiry);
  // DEAD UNTIL VALID. The floor is REQ-VER-06 and the server enforces it too;
  // the button simply does not pretend a set of two could be saved.
  const valid =
    identifiers.length >= IDENTIFIER_COUNT_FLOOR &&
    Number.isFinite(hours) &&
    hours >= 1 &&
    hours <= 168;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${CORE_URL}/practices/${practiceId}/config`, {
        method: 'PATCH',
        headers: { 'x-practice-id': practiceId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderIdRegistered: senderId,
          linkExpiryHours: hours,
          identifierTypes: identifiers,
        }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      setSaved(true);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(type: string, on: boolean) {
    setSaved(false);
    setIdentifiers((current) =>
      on ? [...current, type] : current.filter((t) => t !== type),
    );
  }

  return (
    <Shell right={strings.setup.audience}>
      <Link href="/practice/setup" className={styles.crumb} data-testid="channels-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.channels.backToSetup}
      </Link>

      <h1 className={ui.pageTitle}>{strings.channels.title}</h1>
      <p className={ui.pageLead}>{strings.channels.lead}</p>

      {practice === null && <p className={ui.hint}>{strings.channels.loading}</p>}

      {practice !== null && (
        <>
          {/* --- SMS sender ID: first, because it has a lead time --- */}
          <div className={`${styles.card} ${senderId ? styles.cardOk : styles.cardNeedsWork}`}>
            <div className={styles.cardHead}>
              <MessageSquare size={18} aria-hidden="true" className={styles.cardIcon} />
              <div className={styles.cardMain}>
                <p className={styles.cardTitle}>{strings.channels.smsTitle}</p>
                <p className={styles.cardNote}>{strings.channels.smsLead}</p>
                <p className={styles.cardNote}>{strings.channels.smsWhy}</p>
              </div>
              <div className={styles.cardAside}>
                <Chip tone={senderId ? 'ok' : 'warn'}>
                  {senderId && <CheckCircle2 size={13} aria-hidden="true" />}
                  {senderId ? strings.channels.smsRegistered : strings.channels.smsUnregistered}
                </Chip>
              </div>
            </div>
            <div className={styles.cardBody}>
              <Checkbox
                checked={senderId}
                onCheckedChange={(v) => {
                  setSenderId(v);
                  setSaved(false);
                }}
                label={strings.channels.smsMark}
                hint={strings.channels.smsMarkHint}
              />
            </div>
          </div>

          {/* --- How long a link lives --- */}
          <div className={styles.card} style={{ marginTop: 'var(--s3)' }}>
            <div className={styles.cardHead}>
              <Timer size={18} aria-hidden="true" className={styles.cardIcon} />
              <div className={styles.cardMain}>
                <p className={styles.cardTitle}>{strings.channels.expiryTitle}</p>
                <p className={styles.cardNote}>{strings.channels.expiryLead}</p>
              </div>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.inlineForm}>
                <Field label={strings.channels.expiryLabel} hint={strings.channels.expiryHint}>
                  {(props) => (
                    <TextInput
                      {...props}
                      type="number"
                      min={1}
                      max={168}
                      value={expiry}
                      onChange={(e) => {
                        setExpiry(e.target.value);
                        setSaved(false);
                      }}
                      data-testid="channels-expiry"
                    />
                  )}
                </Field>
              </div>
            </div>
          </div>

          {/* --- What the patient is asked --- */}
          <div
            className={`${styles.card} ${identifiers.length < IDENTIFIER_COUNT_FLOOR ? styles.cardNeedsWork : ''}`}
            style={{ marginTop: 'var(--s3)' }}
          >
            <div className={styles.cardHead}>
              <ShieldQuestion size={18} aria-hidden="true" className={styles.cardIcon} />
              <div className={styles.cardMain}>
                <p className={styles.cardTitle}>{strings.channels.identifiersTitle}</p>
                <p className={styles.cardNote}>{strings.channels.identifiersLead}</p>
              </div>
              <div className={styles.cardAside}>
                <Chip tone={identifiers.length < IDENTIFIER_COUNT_FLOOR ? 'warn' : 'ok'}>
                  {identifiers.length} / {IDENTIFIER_COUNT_FLOOR}
                </Chip>
              </div>
            </div>
            <div className={styles.cardBody}>
              {APPROVED_IDENTIFIER_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  checked={identifiers.includes(type)}
                  onCheckedChange={(v) => toggle(type, v)}
                  label={strings.channels.identifierNames[type] ?? type}
                  hint={strings.channels.identifierNotes[type] || undefined}
                />
              ))}

              {identifiers.length < IDENTIFIER_COUNT_FLOOR && (
                <Notice tone="warn">{strings.channels.identifiersFloor}</Notice>
              )}

              {/*
                Said out loud, rather than left as an absence somebody reads as
                an oversight and asks us to fix. It is HARD-03, it is enforced
                in the domain, in the lint config and in the database, and it is
                not configurable.
              */}
              <Notice tone="ok">{strings.channels.identifiersNever}</Notice>
            </div>
          </div>

          {/* --- Kiosk: listed so the card is honest about what exists --- */}
          <div className={styles.card} style={{ marginTop: 'var(--s3)' }}>
            <div className={styles.cardHead}>
              <Monitor size={18} aria-hidden="true" className={styles.cardIcon} />
              <div className={styles.cardMain}>
                <p className={styles.cardTitle}>{strings.channels.kioskTitle}</p>
                <p className={styles.cardNote}>{strings.channels.kioskBody}</p>
              </div>
              <div className={styles.cardAside}>
                <Chip tone="neutral">{strings.channels.kioskState}</Chip>
              </div>
            </div>
          </div>

          <div className={styles.formActions}>
            <Button variant="primary" onClick={() => void save()} disabled={!valid || busy} data-testid="channels-save">
              {busy ? strings.channels.saving : strings.channels.save}
            </Button>
          </div>

          {error && (
            <Notice tone="stop" title={strings.channels.saveFailed}>
              {error}
            </Notice>
          )}
          {saved && !error && <Notice tone="ok">{strings.channels.saved}</Notice>}
        </>
      )}
    </Shell>
  );
}

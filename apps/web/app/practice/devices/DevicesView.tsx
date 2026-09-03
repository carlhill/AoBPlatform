'use client';

/**
 * THE PRACTICE'S TABLETS — where a waiting-room device is given its one
 * credential, and where that credential is taken back.
 *
 * WHY THIS PAGE IS THE WHOLE SECURITY STORY. `/kiosk` is a public URL, and its
 * practice scope used to come from a build-time environment variable: anybody
 * who reached the address saw a practice's waiting list, which is a list of
 * patient names. A tablet now holds one opaque credential and the server
 * resolves the practice from it. This page is the only place that credential
 * is issued, and the only place it is revoked.
 *
 * NEVER ON THE DEVICE, and that is the load-bearing half. A tablet that can
 * un-pair itself is a tablet a passer-by can un-pair, and a tablet that can
 * re-pair itself only needs a code somebody left on a screen. So the tablet
 * has no control of its own: it types a code once and, from then on, everything
 * that happens to it happens here.
 *
 * THE CODE IS SHOWN ONCE AND THE SCREEN SAYS SO. It is not stored, emailed or
 * fetchable — a code that could be retrieved later would be a password with a
 * nicer name. The way out of having lost one is Rotate, which is named on the
 * screen rather than left to be discovered.
 *
 * THE BUILD FLOOR IS ON THIS PAGE AND NOT IN A SETTINGS DRAWER. It is the
 * rollback mechanism the zero-footprint decision depends on ("a bad release is
 * fixed by a deploy and a rollback, never by visiting a device"), and the
 * person who needs it is the person already looking at a list of tablets
 * wondering which of them is broken.
 *
 * REVOKING NEVER BLOCKS CARE (hard rule 8). The confirmation says so in
 * words, because the instinct when a tablet goes missing is to hesitate — and
 * hesitating is the wrong answer. Reception carries on; capture falls back to
 * post-service or paper.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RotateCw, ShieldOff, Tablet } from 'lucide-react';
import { formatPairingCode, type DeviceRow } from '@aobplatform/domain';
import { Button, Chip, Field, Notice, Section, Shell, TextInput, ui, type Tone } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders } from '../../auth';
import { SessionControl } from '../../SessionControl';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface DevicesResponse {
  devices: DeviceRow[];
  minimumKioskBuild: string | null;
}

/** A freshly issued code. Held in memory for as long as the panel is open, and never re-fetched. */
interface IssuedCode {
  deviceId: string;
  label: string;
  code: string;
  expiresAt: string;
}

const STATE_TONE: Record<string, Tone> = {
  awaiting_pairing: 'warn',
  paired: 'ok',
  revoked: 'stop',
};

async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

function when(iso: string | null): string {
  if (!iso) return strings.devices.neverSeen;
  return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function minutesUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000);
}

export function DevicesView({ practiceId }: { practiceId: string }) {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState('');
  const [issued, setIssued] = useState<IssuedCode | null>(null);

  /** Which device a confirmation is open for, and which act it confirms. */
  const [confirming, setConfirming] = useState<{ device: DeviceRow; act: 'revoke' | 'rotate' } | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const [buildFloor, setBuildFloor] = useState('');
  const [buildSaved, setBuildSaved] = useState<'saved' | 'cleared' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/devices`, { headers: apiHeaders(practiceId) });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const body = (await res.json()) as DevicesResponse;
      setData(body);
      setBuildFloor(body.minimumKioskBuild ?? '');
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post<T>(path: string, body: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
    const res = await fetch(`${CORE_URL}${path}`, {
      method,
      headers: apiHeaders(practiceId),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await refusalMessage(res));
    return (await res.json()) as T;
  }

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
    } catch (e) {
      setError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const addDevice = () =>
    act(async () => {
      const created = await post<IssuedCode>('/devices', { label: label.trim() });
      // The ONE time the code exists outside a hash. Straight onto the screen,
      // never into state that outlives the panel and never back to the server.
      setIssued(created);
      setLabel('');
    });

  const revoke = (device: DeviceRow) =>
    act(async () => {
      await post(`/devices/${device.id}/revoke`, { reason: revokeReason.trim() || undefined });
      setConfirming(null);
      setRevokeReason('');
    });

  const rotate = (device: DeviceRow) =>
    act(async () => {
      const next = await post<IssuedCode>(`/devices/${device.id}/rotate`, {});
      setConfirming(null);
      setIssued(next);
    });

  const saveBuildFloor = () =>
    act(async () => {
      const value = buildFloor.trim();
      await post('/devices/minimum-build', { build: value.length > 0 ? value : null }, 'PUT');
      setBuildSaved(value.length > 0 ? 'saved' : 'cleared');
    });

  if (loadError) {
    return (
      <Shell
        right={<SessionControl audience={strings.devices.audience} />}
        title={strings.devices.title}
        lead={strings.devices.lead}
      >
        <Notice tone="stop" title={strings.devices.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  const devices = data?.devices ?? [];

  return (
    <Shell
      right={<SessionControl audience={strings.devices.audience} />}
      title={strings.devices.title}
      lead={strings.devices.lead}
    >
      {/*
        THE THREAT MODEL, ON THE SCREEN. The person reading this page decides
        what to do when a tablet goes missing, and the answer — one revocable
        credential, nothing else on the device — is worth them knowing before
        it happens rather than during.
      */}
      <Notice tone="ok" title={strings.devices.title} data-testid="devices-threat-note">
        {strings.devices.threatNote}
      </Notice>

      {error && (
        <Notice tone="stop" title={strings.devices.notLoaded}>
          {error}
        </Notice>
      )}

      {/*
        THE CODE PANEL. Above the list because it is the only thing on this
        page with a clock on it: ten minutes, and it is never shown again.
      */}
      {issued && (
        <Notice tone="warn" title={strings.devices.codeHeading} data-testid="devices-code">
          <p className={ui.pageTitle} data-testid="devices-code-value" style={{ letterSpacing: '0.2em' }}>
            {formatPairingCode(issued.code)}
          </p>
          <p>{strings.devices.codeWhere}</p>
          <p className={ui.hint}>{strings.devices.codeExpires(minutesUntil(issued.expiresAt))}</p>
          <p className={ui.hint}>{strings.devices.codeShownOnce}</p>
          <div className={styles.formActions}>
            <Button onClick={() => setIssued(null)} data-testid="devices-code-done">
              {strings.devices.codeDone}
            </Button>
          </div>
        </Notice>
      )}

      <Section number={1} title={strings.devices.title}>
        {data === null && <p className={ui.hint}>{strings.devices.loading}</p>}

        {data !== null && devices.length === 0 && (
          <div className={styles.empty}>
            <Tablet size={22} aria-hidden="true" />
            <p className={styles.emptyTitle}>{strings.devices.none}</p>
            <p className={ui.hint}>{strings.devices.noneHint}</p>
          </div>
        )}

        <ul className={styles.list}>
          {devices.map((device) => (
            <li key={device.id} className={styles.card} data-testid={`device-${device.id}`}>
              <div className={styles.cardHead}>
                <span className={styles.cardIcon}>
                  <Tablet size={18} aria-hidden="true" />
                </span>
                <div className={styles.cardMain}>
                  <p className={styles.cardTitle}>{device.label}</p>
                  <p className={styles.cardSub}>
                    {strings.devices.addedBy(device.createdBy, when(device.createdAt))}
                  </p>
                  {device.revokedAt ? (
                    <p className={styles.cardSub}>
                      {strings.devices.revokedAt(device.revokedBy ?? '—', when(device.revokedAt))}
                    </p>
                  ) : device.pairedAt ? (
                    <p className={styles.cardSub}>{strings.devices.pairedAt(when(device.pairedAt))}</p>
                  ) : device.pairingExpiresAt ? (
                    <p className={styles.cardSub}>
                      {strings.devices.codeOutstanding(when(device.pairingExpiresAt))}
                    </p>
                  ) : null}
                </div>
                <div className={styles.cardAside}>
                  {/* The WORD is the state; the colour only reinforces it. */}
                  <Chip tone={STATE_TONE[device.state] ?? 'neutral'}>
                    {strings.devices.states[device.state] ?? device.state}
                  </Chip>
                  <span className={ui.hint}>
                    {strings.devices.columnLastSeen}: {when(device.lastSeenAt)}
                  </span>
                  {/*
                    THE BUILD, READ BACK WITHOUT TOUCHING THE DEVICE. The first
                    question on a support call is which build that tablet is
                    running, and the alternative is talking somebody through a
                    browser menu on a device in a waiting room.
                  */}
                  <span className={ui.mono} data-testid={`device-build-${device.id}`}>
                    {device.lastKioskBuild ?? strings.devices.noBuild}
                  </span>
                </div>
              </div>

              {confirming?.device.id === device.id ? (
                <div className={styles.cardBody}>
                  <p>
                    {confirming.act === 'revoke'
                      ? strings.devices.revokeConfirm(device.label)
                      : strings.devices.rotateConfirm(device.label)}
                  </p>
                  {confirming.act === 'revoke' && (
                    <Field label={strings.devices.revokeReasonLabel} hint={strings.devices.revokeReasonHint}>
                      {(p) => (
                        <TextInput
                          {...p}
                          value={revokeReason}
                          maxLength={200}
                          onChange={(e) => setRevokeReason(e.target.value)}
                          data-testid="device-revoke-reason"
                        />
                      )}
                    </Field>
                  )}
                  <div className={styles.formActions}>
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => void (confirming.act === 'revoke' ? revoke(device) : rotate(device))}
                      data-testid="device-confirm"
                    >
                      {busy
                        ? confirming.act === 'revoke'
                          ? strings.devices.revoking
                          : strings.devices.rotating
                        : confirming.act === 'revoke'
                          ? strings.devices.revokeConfirmAction
                          : strings.devices.rotateConfirmAction}
                    </Button>
                    <Button
                      variant="subtle"
                      onClick={() => {
                        setConfirming(null);
                        setRevokeReason('');
                      }}
                    >
                      {strings.devices.cancelAction}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.cardActions}>
                  {/*
                    REVOKE IS OFFERED ONLY WHERE IT MEANS SOMETHING. A revoked
                    device already holds no credential, so a second Revoke would
                    be a control that can only tell somebody it did nothing.
                  */}
                  {!device.revokedAt && (
                    <Button onClick={() => setConfirming({ device, act: 'revoke' })} data-testid={`revoke-${device.id}`}>
                      <ShieldOff size={14} aria-hidden="true" /> {strings.devices.revokeAction}
                    </Button>
                  )}
                  {/*
                    ROTATE STAYS OFFERED ON A REVOKED DEVICE, deliberately: it
                    is how a practice brings a tablet back, and the alternative
                    — registering a second row for the same physical device —
                    would break the history that REQ-SIG-02's device
                    fingerprint depends on.
                  */}
                  <Button onClick={() => setConfirming({ device, act: 'rotate' })} data-testid={`rotate-${device.id}`}>
                    <RotateCw size={14} aria-hidden="true" /> {strings.devices.rotateAction}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/*
        THE ADD FORM AT THE FOOT, not the head: what already exists is what the
        reader came to check, and the form is what they do next. The same
        judgement every other practice list on this console makes.
      */}
      <Section number={2} title={strings.devices.addTitle}>
        <div className={styles.addPanel}>
          <p className={ui.hint}>{strings.devices.addHint}</p>
          <div className={styles.addGrid}>
            <Field label={strings.devices.labelLabel} required>
              {(p) => (
                <TextInput
                  {...p}
                  value={label}
                  maxLength={60}
                  placeholder="Reception tablet 1"
                  onChange={(e) => setLabel(e.target.value)}
                  data-testid="device-label"
                />
              )}
            </Field>
          </div>
          <div className={styles.formActions}>
            {/*
              DEAD UNTIL VALID. The button does not pretend a nameless tablet
              could be added — the server refuses one, and a control that can
              only fail is a control that teaches people the page is broken.
            */}
            <Button
              variant="primary"
              disabled={busy || label.trim().length === 0}
              onClick={() => void addDevice()}
              data-testid="device-add"
            >
              {busy ? strings.devices.adding : label.trim().length === 0 ? strings.devices.addBlocked : strings.devices.addAction}
            </Button>
          </div>
        </div>
      </Section>

      <Section number={3} title={strings.devices.buildTitle}>
        <p className={ui.hint}>{strings.devices.buildLead}</p>
        <div className={styles.addPanel}>
          <div className={styles.addGrid}>
            <Field label={strings.devices.buildLabel} hint={strings.devices.buildHint}>
              {(p) => (
                <TextInput
                  {...p}
                  value={buildFloor}
                  maxLength={40}
                  className={styles.narrow}
                  placeholder="2026.09.03-2"
                  onChange={(e) => {
                    setBuildSaved(null);
                    setBuildFloor(e.target.value);
                  }}
                  data-testid="device-build-floor"
                />
              )}
            </Field>
          </div>
          <div className={styles.formActions}>
            <Button disabled={busy} onClick={() => void saveBuildFloor()} data-testid="device-build-save">
              <AlertTriangle size={14} aria-hidden="true" />{' '}
              {busy ? strings.devices.buildSaving : strings.devices.buildSave}
            </Button>
            {buildSaved && (
              <span className={ui.hint} data-testid="device-build-saved">
                {buildSaved === 'saved' ? strings.devices.buildSaved : strings.devices.buildCleared}
              </span>
            )}
          </div>
        </div>
      </Section>
    </Shell>
  );
}

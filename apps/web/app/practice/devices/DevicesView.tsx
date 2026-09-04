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
 * fetchable from the server — a code that could be retrieved later would be a
 * password with a nicer name. It lives ON THE ROW it belongs to for as long as
 * THIS page has held it in memory (Carl, 4 Sep 2026 — "how do I pair these
 * tablets?"): large, monospaced, copyable, with its expiry beside it. Reload
 * the page, or lose the code before it is typed in, and the way out is New
 * code — the same rotate underneath, named for what it is at the point
 * someone has never paired at all.
 *
 * THE BUILD FLOOR IS ON THIS PAGE AND NOT IN A SETTINGS DRAWER. It is the
 * rollback mechanism the zero-footprint decision depends on ("a bad release is
 * fixed by a deploy and a rollback, never by visiting a device"), and the
 * person who needs it is the person already looking at a list of tablets
 * wondering which of them is broken.
 *
 * THE TEST-DEVICE TOGGLE IS ON THIS PAGE FOR THE SAME REASON REVOKE IS (Carl,
 * 4 Sep 2026). Turning it on makes one tablet display other patients' names —
 * a disclosure, not a preference — so it lives where a practice's device acts
 * live, behind a signed-in staff member, and never as a tick-box on the tablet
 * itself. A device that can widen its own disclosure is a device a passer-by
 * can widen. It reaches the tablet on its next poll: no re-pairing, no reload,
 * nobody walking over to it.
 *
 * REVOKING NEVER BLOCKS CARE (hard rule 8). The confirmation says so in
 * words, because the instinct when a tablet goes missing is to hesitate — and
 * hesitating is the wrong answer. Reception carries on; capture falls back to
 * post-service or paper.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RotateCw, ShieldOff, Tablet } from 'lucide-react';
import { formatPairingCode, type DeviceRow } from '@aobplatform/domain';
import { Button, Checkbox, Chip, Field, Notice, Section, Shell, TextInput, ui, type Tone } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders } from '../../auth';
import { SessionControl } from '../../SessionControl';
import styles from '../manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface DevicesResponse {
  devices: DeviceRow[];
  minimumKioskBuild: string | null;
}

/**
 * A freshly issued code, keyed by device id. Held in memory for as long as
 * this page is open, and never re-fetched — the server does not hold the
 * value either (see the file banner). A page reload forgets it exactly like
 * the server does; New code is the way back either way.
 */
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

  /*
   * "ADD A TABLET" IS A BUTTON AT THE TOP, NOT A SECTION AT THE FOOT (Carl, 4
   * Sep 2026 — "Add a tablet is buried"). Closed by default for the same
   * reason the list stays the thing a reader sees first; opening it reveals
   * the same one-field form inline.
   */
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState('');
  /** Every code this page has been shown this session, by device id. */
  const [issuedCodes, setIssuedCodes] = useState<Record<string, IssuedCode>>({});

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

  async function post<T>(path: string, body: unknown, method: 'POST' | 'PUT' | 'PATCH' = 'POST'): Promise<T> {
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
      // Onto the new row, not into a top-of-page panel: the code lives beside
      // the tablet it belongs to, never into state that survives a hash.
      setIssuedCodes((prev) => ({ ...prev, [created.deviceId]: created }));
      setLabel('');
      setAddOpen(false);
    });

  const revoke = (device: DeviceRow) =>
    act(async () => {
      await post(`/devices/${device.id}/revoke`, { reason: revokeReason.trim() || undefined });
      setConfirming(null);
      setRevokeReason('');
    });

  /**
   * ONE TABLET'S DISCLOSURE SETTING. Optimistic nothing: the checkbox reflects
   * the SERVER's answer, so a refused write leaves the control where it was
   * rather than showing a state the tablet is not in.
   */
  const setTestDevice = (device: DeviceRow, showsWaitingList: boolean) =>
    act(async () => {
      await post(`/devices/${device.id}`, { showsWaitingList }, 'PATCH');
    });

  const rotate = (device: DeviceRow) =>
    act(async () => {
      const next = await post<IssuedCode>(`/devices/${device.id}/rotate`, {});
      setConfirming(null);
      setIssuedCodes((prev) => ({ ...prev, [next.deviceId]: next }));
    });

  /**
   * NEW CODE, WITHOUT A CONFIRMATION — the same `rotate` endpoint, called
   * directly. A device still awaiting its first pairing has no live
   * credential to lose, so asking "are you sure?" before replacing a code
   * nobody has typed in yet would be a question with only one sensible
   * answer. Confirming still guards `rotate` above wherever a device IS
   * paired: that call replaces a credential a tablet is actively using.
   */
  const requestNewCode = (device: DeviceRow) =>
    act(async () => {
      const next = await post<IssuedCode>(`/devices/${device.id}/rotate`, {});
      setIssuedCodes((prev) => ({ ...prev, [next.deviceId]: next }));
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

  /*
   * NEWEST FIRST. The server lists devices oldest-first (it is the order
   * they were registered, which is the order an audit trail wants); this page
   * wants the opposite — "After Add tablet succeeds, the new row appears at
   * the top" (Carl, 4 Sep 2026) — so it is reordered here rather than asking
   * the one list endpoint to serve two different readers two different ways.
   */
  const devices = [...(data?.devices ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

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

      <Section
        number={1}
        title={strings.devices.title}
        aside={
          <Button
            variant="primary"
            onClick={() => setAddOpen((open) => !open)}
            aria-expanded={addOpen}
            data-testid="add-tablet-toggle"
          >
            {strings.devices.addToggleAction}
          </Button>
        }
      >
        {/*
          "ADD A TABLET" AT THE TOP, RIGHT OF THE HEADING (Carl, 4 Sep 2026 —
          "Add a tablet is buried"). Reveals the same one-field form inline,
          above the list, rather than in a section people had to scroll past
          the whole list to find.
        */}
        {addOpen && (
          <div className={`${styles.addPanel} ${styles.addInline}`} data-testid="device-add-panel">
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
                {busy
                  ? strings.devices.adding
                  : label.trim().length === 0
                    ? strings.devices.addBlocked
                    : strings.devices.addAction}
              </Button>
              <Button
                variant="subtle"
                onClick={() => {
                  setAddOpen(false);
                  setLabel('');
                }}
                data-testid="device-add-cancel"
              >
                {strings.devices.cancelAction}
              </Button>
            </div>
          </div>
        )}

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

              {device.state === 'awaiting_pairing' && (
                <PairingCodePanel
                  device={device}
                  issued={issuedCodes[device.id]}
                  busy={busy}
                  onNewCode={() => void requestNewCode(device)}
                />
              )}

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
                <>
                  {/*
                    THE WARNING IS THE HINT, NOT A FOOTNOTE. What this switch
                    turns on is patient names on a waiting-room screen, and the
                    person reaching for it should read that before the tap
                    rather than after it. Off is the default, and off is what a
                    patient actually sees at the tablet.

                    NOT OFFERED ON A REVOKED DEVICE: it holds no credential, so
                    the setting could not reach a screen — a control that can
                    only report having done nothing.
                  */}
                  {!device.revokedAt && (
                    <div className={styles.cardBody} data-testid={`test-device-${device.id}`}>
                      <Checkbox
                        checked={device.showsWaitingList}
                        onCheckedChange={(next) => void setTestDevice(device, next)}
                        label={strings.devices.testDeviceLabel}
                        hint={strings.devices.testDeviceWarning}
                      />
                    </div>
                  )}
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
                </>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section number={2} title={strings.devices.buildTitle}>
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

/**
 * THE CODE, ON THE ROW IT BELONGS TO (Carl, 4 Sep 2026 — "how do I pair these
 * tablets?"). Three states, and the state decides what is shown — never a
 * value this page does not actually hold:
 *
 *  1. THIS PAGE HOLDS A LIVE CODE (`issued`, unexpired). Shown large,
 *     monospaced and copyable, with its expiry and the one-line instruction.
 *  2. THE SERVER SAYS NO CODE IS LIVE (`device.pairingExpiresAt` is null).
 *     "Code expired", and New code — the same rotate `DevicesView` already
 *     has, offered without a confirmation because nothing is being revoked:
 *     a device still awaiting its first pairing has no credential to lose.
 *  3. A CODE IS LIVE SERVER-SIDE BUT THIS PAGE NEVER HELD ITS VALUE — issued
 *     in an earlier session, say. The row says a code is outstanding and
 *     offers the same New code action, because the original is genuinely not
 *     retrievable (the file banner's whole point) and a fresh, visible one is
 *     one tap away.
 */
function PairingCodePanel({
  device,
  issued,
  busy,
  onNewCode,
}: {
  device: DeviceRow;
  issued: IssuedCode | undefined;
  busy: boolean;
  onNewCode: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const issuedLive = issued !== undefined && new Date(issued.expiresAt).getTime() > Date.now();

  if (issuedLive) {
    const formatted = formatPairingCode(issued.code);
    return (
      <div className={styles.cardBody} data-testid={`device-code-${device.id}`}>
        <div className={styles.codeRow}>
          <span className={styles.codeValue} data-testid={`device-code-value-${device.id}`}>
            {formatted}
          </span>
          <Button
            onClick={() => {
              setCopied(true);
              void navigator.clipboard?.writeText(formatted).catch(() => undefined);
            }}
            data-testid={`device-code-copy-${device.id}`}
          >
            {copied ? strings.devices.codeCopied : strings.devices.codeCopyAction}
          </Button>
        </div>
        <p className={ui.hint}>{strings.devices.codeExpires(minutesUntil(issued.expiresAt))}</p>
        <p className={ui.hint}>{strings.devices.codeWhere}</p>
      </div>
    );
  }

  if (!device.pairingExpiresAt) {
    return (
      <div className={styles.cardBody} data-testid={`device-code-${device.id}`}>
        <p data-testid={`device-code-expired-${device.id}`}>{strings.devices.codeExpiredLabel}</p>
        <div className={styles.formActions}>
          <Button disabled={busy} onClick={onNewCode} data-testid={`device-new-code-${device.id}`}>
            {strings.devices.newCodeAction}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cardBody} data-testid={`device-code-${device.id}`}>
      <p className={ui.hint}>{strings.devices.codeOutstanding(when(device.pairingExpiresAt))}</p>
      <div className={styles.formActions}>
        <Button disabled={busy} onClick={onNewCode} data-testid={`device-new-code-${device.id}`}>
          {strings.devices.newCodeAction}
        </Button>
      </div>
    </div>
  );
}

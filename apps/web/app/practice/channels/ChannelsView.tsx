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
import { ArrowRight, CheckCircle2, FileText, MessageSquare, Monitor, ShieldQuestion, Timer } from 'lucide-react';
import {
  APPROVED_IDENTIFIER_TYPES,
  IDENTIFIER_COUNT_FLOOR,
  KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS,
  audiencesOf,
  kioskIdleTimeoutOrDefault,
  mayReach,
  type Audience,
  type DeviceRow,
} from '@aobplatform/domain';
import { Button, Checkbox, Chip, Field, Notice, SelectInput, Shell, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';
import { SessionControl } from '../../SessionControl';
import { apiHeaders, currentSession } from '../../auth';
import { toViewPath } from '../../viewPath';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Practice {
  id: string;
  senderIdRegistered: boolean;
  linkExpiryHours: number;
  identifierTypes: string[];
  /**
   * SECONDS, and the field on this page is in MINUTES. See
   * `strings.channels.idleHint`: nobody thinks "three hundred", and the tablet
   * counting down does, so the conversion lives here and the server keeps one
   * unit.
   */
  kioskIdleTimeoutSeconds?: number;
  /**
   * WHICH AGREEMENT THE PRE-STEP OFFERS FIRST (Carl, 4 Sep 2026; GA-PLAN B6).
   * A default, never a permission — enduring stays GP-only and per
   * practitioner x patient whatever this says (hard rule 6, REQ-END-01/-01a).
   */
  enduringByDefault?: boolean;
}

/**
 * THE BOUNDS THIS PAGE OFFERS, in the unit this page uses. The server's own
 * range is 60..1800 seconds and the DTO enforces it; these are the same range
 * expressed in whole minutes, so the input cannot produce a value the save
 * will be refused for.
 */
const IDLE_MIN_MINUTES = 1;
const IDLE_MAX_MINUTES = 30;

/**
 * THE SAME SHAPE `SetupHub` READS, for the same reason: the Kiosk row here
 * and the hub's Tablets card must never disagree about how many tablets are
 * paired, and the only way to guarantee that structurally is for both to
 * read `GET /devices` and count the same way.
 *
 * `unavailable` IS ITS OWN STATE, not a zero — `GET /devices` is
 * `@PracticeScoped`, so the platform's read-only twin of this page (which
 * carries no practice claim) is refused, and a wrong "0 paired" would read as
 * "no tablets", which may simply be untrue.
 */
interface DevicesSummary {
  status: 'loading' | 'ok' | 'unavailable';
  total: number;
  paired: number;
  revoked: number;
}

const DEVICES_LOADING: DevicesSummary = { status: 'loading', total: 0, paired: 0, revoked: 0 };
const DEVICES_UNAVAILABLE: DevicesSummary = { status: 'unavailable', total: 0, paired: 0, revoked: 0 };

/**
 * D6a — THE PRACTICE'S DEFAULT BASIC SERVICE DESCRIPTION, AND THE LIST IT IS
 * CHOSEN FROM.
 *
 * THE WORDS ARE NOT IN THIS FILE AND NEVER WILL BE. They are versioned content
 * (`packages/domain/content/service-descriptions.json`, hard rule 14) and the
 * rules engine's C6 match against them is exact and case-sensitive — so a copy
 * in a component is a copy that goes stale the moment the mapping moves, and
 * the practice discovers it as a refusal at a tablet rather than as a failing
 * build. The select renders what the server sent, in the order it sent it.
 *
 * ONE ROUND TRIP. `GET /service-descriptions/settings` IS the list plus this
 * practice's default — the service spreads `list()` into it — and it exists
 * precisely for this control, so the screen cannot show a default chosen from
 * one version of the list beside options from another.
 */
interface DescriptionSettings {
  version: string;
  descriptions: string[];
  defaultDescription: string | null;
}

async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

export function ChannelsView({
  practiceId,
  /** Read-only, as the platform. See `SetupHub` for the full reasoning. */
  viewOnly = false,
}: {
  practiceId: string;
  viewOnly?: boolean;
}) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DevicesSummary>(DEVICES_LOADING);

  const [senderId, setSenderId] = useState(false);
  const [expiry, setExpiry] = useState('24');
  const [identifiers, setIdentifiers] = useState<string[]>([]);
  const [idleMinutes, setIdleMinutes] = useState(String(KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS / 60));
  const [enduringDefault, setEnduringDefault] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * D6a KEEPS ITS OWN STATE, ITS OWN BUTTON AND ITS OWN REFUSAL. It is a
   * different endpoint (`PUT /service-descriptions/default`, not the practice
   * config PATCH), and it refuses a caller with no signed-in user outright —
   * because a setting that decides a particular of every future agreement is
   * recorded against the person who changed it. A 403 on that belongs beside
   * the control that earned it, not on a button that also saves five other
   * settings and would then be lying about them.
   */
  const [descriptions, setDescriptions] = useState<DescriptionSettings | null>(null);
  const [d6aChoice, setD6aChoice] = useState('');
  const [d6aBusy, setD6aBusy] = useState(false);
  const [d6aError, setD6aError] = useState<string | null>(null);
  const [d6aSaved, setD6aSaved] = useState(false);
  /** How many drafts are still waiting on one. `null` = not known, never "0". */
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const session = currentSession();
  const audiences: Audience[] = audiencesOf({
    roles: session?.roles ?? [],
    practiceId,
    practitionerId: session?.practitionerId,
    consoleRole: session?.consoleRole,
  });
  const canOpen = (path: string) => viewOnly || mayReach(path, audiences);

  /**
   * How many drafts still have no description.
   *
   * READ SEPARATELY, AND RE-READ AFTER EVERY SAVE. Saving a default does NOT
   * reach back into drafts that already exist — see `saveDefault` — so this is
   * the only honest way to say what saving one did and did not do.
   *
   * `null` RATHER THAN ZERO when it cannot be read: a platform operator with no
   * practice claim is refused this list, and "0 waiting" would read as "nothing
   * to do", which may simply be untrue.
   */
  const refreshPending = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/service-descriptions/pending`, {
        headers: apiHeaders(practiceId),
      });
      if (!res.ok) throw new Error(String(res.status));
      const rows = (await res.json()) as unknown;
      setPendingCount(Array.isArray(rows) ? rows.length : null);
    } catch {
      setPendingCount(null);
    }
  }, [practiceId]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${CORE_URL}/practices/${practiceId}`, {
        headers: apiHeaders(practiceId),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const data = (await res.json()) as Practice;
      setPractice(data);
      setSenderId(Boolean(data.senderIdRegistered));
      setExpiry(String(data.linkExpiryHours ?? 24));
      setIdentifiers(data.identifierTypes ?? []);
      /*
       * FAIL CLOSED ON A SERVER THAT DID NOT SAY. `kioskIdleTimeoutOrDefault`
       * answers five minutes for an absent or out-of-range value rather than
       * leaving the box empty — an empty box on this page would read as "no
       * timeout", which is the one thing this setting may never mean.
       */
      setIdleMinutes(String(kioskIdleTimeoutOrDefault(data.kioskIdleTimeoutSeconds) / 60));
      /*
       * THE DEFAULT IS TRUE ON A SERVER THAT DID NOT SAY, matching the column.
       * An unticked box would read as "this practice chose episodic", which is
       * a decision nobody made.
       */
      setEnduringDefault(data.enduringByDefault ?? true);
    } catch (e) {
      setLoadError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    }

    /*
     * THE SAME FETCH THE SETUP HUB'S TABLETS CARD READS. Kept independent of
     * the practice-config load above: a refusal here says nothing about
     * whether the practice's own settings loaded, and the reverse.
     */
    try {
      const res = await fetch(`${CORE_URL}/devices`, { headers: apiHeaders(practiceId) });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { devices: DeviceRow[] };
      const paired = body.devices.filter((d) => d.state === 'paired').length;
      const revoked = body.devices.filter((d) => d.state === 'revoked').length;
      setDevices({ status: 'ok', total: body.devices.length, paired, revoked });
    } catch {
      setDevices(DEVICES_UNAVAILABLE);
    }

    /*
     * D6a: THE LIST AND THIS PRACTICE'S DEFAULT. Independent of the two reads
     * above for the same reason they are independent of each other — an older
     * core that does not serve this route says nothing about whether the
     * practice's own settings loaded.
     *
     * A RESPONSE WITHOUT A LIST IS NOT A LIST. The control is withdrawn rather
     * than rendered empty: an empty select would invite somebody to save "no
     * default" onto a practice that had one.
     */
    try {
      const res = await fetch(`${CORE_URL}/service-descriptions/settings`, {
        headers: apiHeaders(practiceId),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Partial<DescriptionSettings>;
      if (typeof body.version !== 'string' || !Array.isArray(body.descriptions)) {
        throw new Error('no list');
      }
      setDescriptions({
        version: body.version,
        descriptions: body.descriptions,
        defaultDescription: body.defaultDescription ?? null,
      });
      setD6aChoice(body.defaultDescription ?? '');
    } catch {
      setDescriptions(null);
    }

    await refreshPending();
  }, [practiceId, refreshPending]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <Shell right={<SessionControl audience={strings.setup.audience} />}
      title={strings.channels.title}
      lead={strings.channels.lead}
    >
        <Notice tone="stop" title={strings.channels.notLoaded}>
          {loadError}
        </Notice>
      </Shell>
    );
  }

  const hours = Number(expiry);
  const minutes = Number(idleMinutes);
  const idleValid =
    Number.isInteger(minutes) && minutes >= IDLE_MIN_MINUTES && minutes <= IDLE_MAX_MINUTES;
  // DEAD UNTIL VALID. The floor is REQ-VER-06 and the server enforces it too;
  // the button simply does not pretend a set of two could be saved.
  const valid =
    identifiers.length >= IDENTIFIER_COUNT_FLOOR &&
    Number.isFinite(hours) &&
    hours >= 1 &&
    hours <= 168 &&
    idleValid;

  // DONE ONLY ON EVIDENCE. An operator viewing this read-only, who cannot
  // call the `@PracticeScoped` `/devices` list, gets NEEDS WORK rather than a
  // guessed DONE — the same reasoning the setup hub's Tablets card follows.
  const kioskDone = devices.status === 'ok' && devices.paired > 0;
  const kioskNote =
    devices.status === 'unavailable'
      ? strings.channels.kioskUnavailable
      : devices.status === 'loading'
        ? strings.channels.loading
        : devices.total === 0
          ? strings.channels.kioskNone
          : strings.channels.kioskSummary(devices.paired, devices.revoked);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`${CORE_URL}/practices/${practiceId}/config`, {
        method: 'PATCH',
        headers: apiHeaders(practiceId),
        body: JSON.stringify({
          senderIdRegistered: senderId,
          linkExpiryHours: hours,
          identifierTypes: identifiers,
          // MINUTES ON THE SCREEN, SECONDS ON THE WIRE. One conversion, in one
          // place, so the server never sees two units for one setting.
          kioskIdleTimeoutSeconds: minutes * 60,
          enduringByDefault: enduringDefault,
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

  /**
   * The practice's default D6a.
   *
   * IT DOES NOT TOUCH DRAFTS THAT ALREADY EXIST, deliberately and permanently.
   * Sweeping the new default across every waiting draft would be this screen
   * deciding a particular of contracts already drafted for named patients —
   * the exact act the D6a design moved off the tablet and onto a staff surface
   * so that a person's identity is on it. If a bulk action is ever wanted it is
   * a separate decision with its own attribution, not a side effect of saving a
   * setting. What the save does instead is SAY how many are still waiting, and
   * link to where each one is fixed.
   *
   * The empty option sends an explicit `null` — "we have not chosen one" — which
   * is what the server stores. It is not the same as leaving the setting alone.
   */
  async function saveDefault() {
    setD6aBusy(true);
    setD6aError(null);
    setD6aSaved(false);
    try {
      const res = await fetch(`${CORE_URL}/service-descriptions/default`, {
        method: 'PUT',
        headers: { ...apiHeaders(practiceId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: d6aChoice === '' ? null : d6aChoice }),
      });
      // THE SERVER'S OWN SENTENCE, not a paraphrase. Its 403 explains why an
      // unattributed caller is refused, and that reason is the answer.
      if (!res.ok) throw new Error(await refusalMessage(res));
      setD6aSaved(true);
      await load();
    } catch (e) {
      setD6aError(e instanceof TypeError ? strings.review.unreachableBody : (e as Error).message);
    } finally {
      setD6aBusy(false);
    }
  }

  function toggle(type: string, on: boolean) {
    setSaved(false);
    setIdentifiers((current) =>
      on ? [...current, type] : current.filter((t) => t !== type),
    );
  }

  return (
    <Shell right={<SessionControl audience={strings.setup.audience} />}>

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

          {/*
            --- Kiosk. Reads the SAME `/devices` fetch the setup hub's
            Tablets card does (see `DevicesSummary` above), so the two can
            never disagree about how many tablets are paired — which used to
            be the bug: this card said "NOT BUILT YET" long after pairing
            existed and tablets were actually paired.
          */}
          {/*
            `id="kiosk"` IS A DESTINATION, NOT DECORATION (Carl, 5 Sep 2026).
            `/practice/tablet` refuses an ongoing agreement while the enduring
            rule set is awaiting authoring, and its band links here — to the
            setting that decides what the tablet offers FIRST, so the next
            arrival is drafted as an agreement for the visit instead of joining
            the queue of blocked ongoing ones. A link to the top of a page with
            four cards on it would be directions to a screen, which is the
            failure CLAUDE.md §7 is named after.
          */}
          <div id="kiosk" className={styles.card} style={{ marginTop: 'var(--s3)' }}>
            <div className={styles.cardHead}>
              <Monitor size={18} aria-hidden="true" className={styles.cardIcon} />
              <div className={styles.cardMain}>
                <p className={styles.cardTitle}>{strings.channels.kioskTitle}</p>
                <p className={styles.cardNote}>{kioskNote}</p>
              </div>
              <div className={styles.cardAside}>
                <Chip tone={kioskDone ? 'ok' : 'warn'}>
                  {kioskDone ? strings.channels.kioskDone : strings.channels.kioskNeedsWork}
                </Chip>
              </div>
            </div>
            {/*
              RETURN TO THE START WHEN NOBODY IS USING IT (Carl, 4 Sep 2026).
              It lives in the Kiosk card because it is about the tablet, and it
              is offered even where the tablets link is not: a read-only
              operator cannot list a practice's devices but the setting is
              still the practice's own, and hiding the field would hide what
              the practice has chosen.
            */}
            <div className={styles.cardBody}>
              <p className={styles.cardTitle}>{strings.channels.idleTitle}</p>
              <div className={styles.inlineForm}>
                <Field label={strings.channels.idleLabel} hint={strings.channels.idleHint}>
                  {(props) => (
                    <TextInput
                      {...props}
                      type="number"
                      min={IDLE_MIN_MINUTES}
                      max={IDLE_MAX_MINUTES}
                      value={idleMinutes}
                      onChange={(e) => {
                        setIdleMinutes(e.target.value);
                        setSaved(false);
                      }}
                      data-testid="channels-idle-minutes"
                    />
                  )}
                </Field>
              </div>
              <p className={styles.cardNote}>{strings.channels.idleLead}</p>
            </div>
            {/*
              WHICH AGREEMENT THE PRE-STEP OFFERS FIRST (Carl, 4 Sep 2026;
              GA-PLAN B6). It sits in the Kiosk card because it is about what
              the tablet shows, next to the other setting that is.

              A DEFAULT, NOT A PERMISSION, and the hint says so: enduring is
              GP-only and per practitioner x patient however this is set (hard
              rule 6, REQ-END-01/-01a). Ticking it does not make a specialist's
              agreement ongoing, and unticking it does not stop a GP offering
              one -- it decides what is offered FIRST.
            */}
            <div className={styles.cardBody}>
              <p className={styles.cardTitle}>{strings.channels.enduringTitle}</p>
              <Checkbox
                checked={enduringDefault}
                onCheckedChange={(v) => {
                  setEnduringDefault(v);
                  setSaved(false);
                }}
                label={strings.channels.enduringLabel}
                hint={strings.channels.enduringHint}
              />
              <p className={styles.cardNote}>{strings.channels.enduringLead}</p>
            </div>
            {/*
              --- D6a: WHAT AN ARRIVAL'S AGREEMENT IS LOCKED WITH (Carl, 5 Sep
              2026; GA-PLAN B10). Beside the setting above because between them
              the two decide what the agreement drafted for a patient who has
              just walked up already says, before anybody touches a tablet.

              THE OPTIONS ARE THE SERVER'S, IN THE SERVER'S ORDER. This file
              knows none of the words — see `DescriptionSettings`. There is no
              free-text path to this setting anywhere, because C6 matches
              exactly and a typed description is a refusal waiting to happen at
              a tablet (TODO.md: "stop asking anyone to type it").
            */}
            <div className={styles.cardBody}>
              <p className={styles.cardTitle}>{strings.channels.d6aTitle}</p>
              {descriptions === null ? (
                <p className={ui.hint}>{strings.channels.d6aUnavailable}</p>
              ) : (
                <>
                  <div className={styles.inlineForm}>
                    <Field label={strings.channels.d6aLabel} hint={strings.channels.d6aHint}>
                      {(props) => (
                        <SelectInput
                          {...props}
                          value={d6aChoice}
                          onChange={(e) => {
                            setD6aChoice(e.target.value);
                            setD6aSaved(false);
                          }}
                          data-testid="channels-d6a"
                        >
                          {/* An explicit "we have not chosen one", which sends null. */}
                          <option value="">{strings.channels.d6aNone}</option>
                          {descriptions.descriptions.map((description) => (
                            <option key={description} value={description}>
                              {description}
                            </option>
                          ))}
                        </SelectInput>
                      )}
                    </Field>
                    {/* WHICH LIST THESE WORDS CAME FROM, beside them (hard rule 14). */}
                    <Chip tone="neutral">{strings.channels.d6aVersion(descriptions.version)}</Chip>
                    <Button
                      onClick={() => void saveDefault()}
                      disabled={d6aBusy}
                      data-testid="channels-d6a-save"
                    >
                      {d6aBusy ? strings.channels.d6aSaving : strings.channels.d6aSave}
                    </Button>
                  </div>
                  <p className={styles.cardNote}>{strings.channels.d6aLead}</p>

                  {d6aError && (
                    <Notice tone="stop" title={strings.channels.d6aFailed} data-testid="channels-d6a-error">
                      {d6aError}
                    </Notice>
                  )}
                  {d6aSaved && !d6aError && <Notice tone="ok">{strings.channels.d6aSaved}</Notice>}

                  {/*
                    THE CONSEQUENCE, SHOWN RATHER THAN LEFT TO BE DISCOVERED.
                    Saving a default changes nothing about the drafts already
                    waiting, so the count says so and the link lands on the page
                    that holds them — never "see the practice queue" in prose
                    (Carl, 4 Sep 2026).
                  */}
                  {pendingCount !== null && pendingCount > 0 && (
                    <Notice tone="warn" data-testid="channels-d6a-pending">
                      {strings.channels.d6aPending(pendingCount)}
                      {canOpen('/practice/tablet') && (
                        <>
                          {' '}
                          <Link
                            href={viewOnly ? toViewPath('/practice/tablet', practiceId) : '/practice/tablet'}
                            data-testid="channels-d6a-pending-link"
                          >
                            {strings.channels.d6aPendingLink}
                          </Link>
                        </>
                      )}
                    </Notice>
                  )}
                </>
              )}
            </div>
            {canOpen('/practice/devices') && (
              <div className={styles.cardBody}>
                <Link
                  href={viewOnly ? toViewPath('/practice/devices', practiceId) : '/practice/devices'}
                  className={ui.buttonLink}
                  data-testid="channels-manage-tablets"
                >
                  {strings.channels.kioskManage}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>

          {/*
            THE DOCUMENT IS NOT A CHANNEL, so it is not a card on this page —
            but somebody setting up capture will look for the letterhead here,
            and a link is cheaper than a second copy of the settings (Carl,
            5 Sep 2026; W1).
          */}
          {canOpen('/practice/templates') && (
            <div className={styles.card} style={{ marginTop: 'var(--s3)' }}>
              <div className={styles.cardHead}>
                <FileText size={18} aria-hidden="true" className={styles.cardIcon} />
                <div className={styles.cardMain}>
                  <p className={styles.cardTitle}>{strings.channels.documentTitle}</p>
                  <p className={styles.cardNote}>{strings.channels.documentLead}</p>
                </div>
              </div>
              <div className={styles.cardBody}>
                <Link
                  href={viewOnly ? toViewPath('/practice/templates', practiceId) : '/practice/templates'}
                  className={ui.buttonLink}
                  data-testid="channels-open-templates"
                >
                  {strings.channels.documentOpen}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}

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

'use client';

/**
 * THE ACTIVATION PAGE — the door the invitation link opens (FR-1.14,
 * REQ-PORT-08, REQ-PORT-06).
 *
 * WHAT IT IS NOT. It is not a sign-up, and nothing on it says "create an
 * account", "register" or "verify your identity". The patient is being asked
 * for details their own practice already holds, and the sentence says where
 * they last gave them: the same ones they were asked when they signed. A person
 * who is being asked a fair question can answer it; a person who feels they are
 * being asked to prove themselves to a website closes the tab.
 *
 * THE FIELD SET IS THE SERVER'S, AND IT IS THE SAME SET THE KIOSK DRAWS.
 * `identifierFieldsFor` — the kiosk's own rules module, imported rather than
 * copied — puts the practice's configured types through the domain's
 * `assertValidIdentifierSet` before a single input is rendered. There is no
 * Medicare card field on this page, no label for one in the string table, and
 * no fallback branch that would draw an input for an unrecognised type. The
 * absence is the enforcement (hard rule 1, REQ-VER-02).
 *
 * THE CHROME IS NOT THE KIOSK'S. A tablet bolted to a wall in a waiting room
 * and a phone in a patient's own hand are different rooms: this page is the
 * portal's own Shell and the portal's own buttons, at the portal's reading
 * width. What is shared is the RULES — which fields, which composition, which
 * refusal to name the one that failed — because those are the parts that would
 * be wrong if they differed.
 *
 * DATE OF BIRTH IS ONE NATIVE DATE INPUT HERE, WHERE THE KIOSK USES THREE
 * PICKERS (Carl, 5 Sep 2026). The kiosk cannot rely on a native picker: it runs
 * on a shared tablet in an unknown browser and the three-select form is the one
 * that behaves the same everywhere. This page runs on the patient's OWN phone,
 * where `type="date"` is the control they use every day and already know. Both
 * produce the same `YYYY-MM-DD` the server compares, which is the only part
 * that has to agree.
 *
 * A MISMATCH SAYS ONE THING AND NAMES NOTHING (REQ-SEC-07). Never which
 * identifier, never how close, never a highlighted field. It appears in place,
 * above Continue, and everything typed STAYS — the kiosk learned that the hard
 * way on 3 September, when "try again" came back to an empty form and somebody
 * who had mistyped one letter retyped all three.
 *
 * NOTHING IS PERSISTED IN THE BROWSER. No storage API is touched, no answer is
 * logged, and the token goes into one request and nowhere else. The values live
 * in component state for as long as the form is on screen and are dropped when
 * it leaves (REQ-VER-04).
 *
 * AND IT NEVER BLOCKS ANYTHING. A dead link, a locked invitation and an
 * unreachable server all say the same last thing: nothing about the patient's
 * care or appointments is affected, and a new invitation comes from the
 * practice (hard rule 8, REQ-PORT-08).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { Shell, ui } from '../../../../ui';
import { strings } from '../../../../strings';
import { useRefreshable } from '../../../../refresh';
import { identifierFieldsFor, type IdentifierField } from '../../../../kiosk/rules/identifiers';
import { composeName } from '../../../../kiosk/rules/verify-fields';
import {
  activatePortal,
  fetchActivationChallenge,
  passkeysAvailable,
  PORTAL_FIXTURES,
  PortalApiError,
  signInWithPasskey,
  type PortalActivationChallenge,
} from '../../api';
import { PortalButton } from '../../portal-ui';
import styles from '../../portal.module.css';

/** How many tries an invitation gets. Mirrors `PORTAL_ACTIVATION_MAX_ATTEMPTS`. */
const MAX_ATTEMPTS = 3;

type Phase =
  | { kind: 'loading' }
  /** The link is dead. `reason` is the server's code — mapped to copy and a next step. */
  | { kind: 'refused'; reason: string }
  /** The server could not be reached, which is a different sentence from a dead link. */
  | { kind: 'unreachable' }
  | { kind: 'asking'; challenge: PortalActivationChallenge }
  | { kind: 'locked' };

export function ActivateView({ token }: { token: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  /**
   * THE CHALLENGE READ, as a loader the top bar's refresh button can call
   * again (Carl, 5 Sep 2026: the page needs the refresh and sign-in controls
   * the portal has). "Unreachable" is the state a refresh exists for.
   */
  const load = useCallback(async () => {
    try {
      const challenge = await fetchActivationChallenge(token);
      // Zero tries left is a locked invitation however it got that way.
      setPhase(
        challenge.attemptsRemaining <= 0
          ? { kind: 'locked' }
          : { kind: 'asking', challenge },
      );
    } catch (err) {
      /*
       * A CODED REFUSAL IS A STATE; ANYTHING ELSE IS THE SERVER BEING
       * UNREACHABLE. The two get different sentences because they have
       * different next steps — one is "ask your practice", the other is
       * "try again shortly" — and telling a patient to go and queue at
       * reception because our server blinked would be the worse mistake.
       */
      setPhase(
        err instanceof PortalApiError && err.reason
          ? { kind: 'refused', reason: err.reason }
          : { kind: 'unreachable' },
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useRefreshable(load);

  if (phase.kind === 'loading') {
    return (
      <ActivateShell>
        <p role="status">{strings.portal.activate.loading}</p>
      </ActivateShell>
    );
  }

  if (phase.kind === 'locked') {
    return (
      <ActivateShell>
        <h2 className={styles.cardTitle}>{strings.portal.activate.lockedHeading}</h2>
        <div className={styles.prose}>
          <p>{strings.portal.activate.lockedBody}</p>
          {/* Hard rule 8, on the screen where somebody is most likely to fear otherwise. */}
          <p>{strings.portal.activate.lockedReassurance}</p>
        </div>
      </ActivateShell>
    );
  }

  if (phase.kind === 'unreachable') {
    return (
      <ActivateShell>
        <p role="alert" className={styles.cardError}>
          {strings.portal.signedOut.unreachable}
        </p>
      </ActivateShell>
    );
  }

  if (phase.kind === 'refused') {
    /*
     * EVERY REASON MAPS TO COPY AND A NEXT STEP, and an unmapped one shows its
     * own code so it can be read out to support rather than becoming a shrug
     * (Carl, 4 Sep 2026 — "shortcuts to the answer, not directions to a
     * screen"). A generic fallback here would be a defect.
     */
    const mapped = strings.portal.activate.reasons[phase.reason];
    return (
      <ActivateShell>
        <h2 className={styles.cardTitle}>
          {mapped ? mapped.heading : strings.portal.activate.lockedHeading}
        </h2>
        <div className={styles.prose}>
          <p>{mapped ? mapped.body : strings.portal.activate.unmappedReason(phase.reason)}</p>
          <p>{strings.portal.activate.lockedReassurance}</p>
        </div>
      </ActivateShell>
    );
  }

  return (
    <ActivateShell>
      <ActivateForm
        token={token}
        challenge={phase.challenge}
        onLocked={() => setPhase({ kind: 'locked' })}
        onRefused={(reason) => setPhase({ kind: 'refused', reason })}
        onActivated={() => {
          /*
           * THE SERVER SET THE COOKIE; THIS IS ONLY NAVIGATION. `?welcome=1`
           * asks the portal for one line pointing at the passkey card, which is
           * the next thing worth doing and the only thing that stops the next
           * visit needing another invitation. It is a query parameter rather
           * than anything stored, so nothing survives the tab.
           */
          router.push('/patient/portal?welcome=1');
        }}
      />
    </ActivateShell>
  );
}

/**
 * The portal's Shell with the session bar in its SIGNED-OUT form: the audience
 * label and nothing else.
 *
 * NO SIGN-OUT, because there is no session — and no passkey sign-in either,
 * deliberately. Somebody on this page is holding an invitation and has been
 * asked one question; offering a second, different way in beside it is how a
 * person ends up pressing the control that cannot work for them yet.
 */
function ActivateShell({ children }: { children: React.ReactNode }) {
  return (
    <Shell
      title={strings.portal.activate.title}
      right={
        <span className={ui.sessionBar}>
          <span className={ui.sessionAudience}>{strings.portal.session.audience}</span>
          <ActivateSignIn />
        </span>
      }
    >
      <div className={styles.activate}>{children}</div>
    </Shell>
  );
}

/**
 * THE SAME SIGN-IN THE PORTAL'S SIGNED-OUT SCREEN OFFERS, in the same bar
 * (Carl, 5 Sep 2026). Somebody who already has a passkey and lands here from
 * an old invitation should not have to answer the three questions again —
 * they sign in and the portal is theirs. Only where the browser can do
 * WebAuthn; a failed or cancelled prompt says nothing more than "that did
 * not work", and never which credential.
 */
function ActivateSignIn() {
  const router = useRouter();
  const [canPasskey, setCanPasskey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setCanPasskey(passkeysAvailable()), []);
  if (!canPasskey) return null;
  return (
    <>
      <button
        type="button"
        className={ui.sessionButton}
        disabled={busy}
        data-testid="activate-sign-in"
        onClick={async () => {
          setFailed(false);
          setBusy(true);
          try {
            await signInWithPasskey();
            router.push('/patient/portal');
          } catch {
            setFailed(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <LogIn size={13} aria-hidden="true" />
        {busy ? strings.portal.passkeys.signInBusy : strings.portal.passkeys.signInAction}
      </button>
      {failed && (
        <span role="alert" className={ui.sessionAffiliation}>
          {strings.portal.passkeys.signInFailed}
        </span>
      )}
    </>
  );
}

/** The two halves of a name, held apart until they are sent as one identifier. */
interface NameState {
  readonly given: string;
  readonly family: string;
}

function ActivateForm({
  token,
  challenge,
  onActivated,
  onLocked,
  onRefused,
}: {
  token: string;
  challenge: PortalActivationChallenge;
  onActivated: () => void;
  onLocked: () => void;
  onRefused: (reason: string) => void;
}) {
  /*
   * THE FIELD SET, THROUGH THE DOMAIN GUARD. A practice that somehow configured
   * a card number produces a page that refuses to render the challenge, not a
   * page with a card-number box on it (hard rule 1). The refusal is the dead-
   * link screen with the code on it, which is the honest thing to show somebody
   * who cannot fix it themselves.
   */
  let fields: readonly IdentifierField[] = [];
  let unrenderable = false;
  try {
    fields = identifierFieldsFor(challenge.identifierTypes);
  } catch {
    unrenderable = true;
  }

  const [name, setName] = useState<NameState>({ given: '', family: '' });
  const [plain, setPlain] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState(challenge.attemptsRemaining);

  /** Focus goes to the first input when an attempt fails (WCAG 2.2 AA). */
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const valueFor = useCallback(
    (type: string): string => (type === 'name' ? composeName(name) : (plain[type] ?? '')),
    [name, plain],
  );

  const ready =
    !unrenderable &&
    fields.every((field) =>
      field.type === 'name'
        ? name.given.trim() !== '' && name.family.trim() !== ''
        : (plain[field.type] ?? '').trim() !== '',
    );

  if (unrenderable) {
    return (
      <>
        <h2 className={styles.cardTitle}>{strings.portal.activate.lockedHeading}</h2>
        <div className={styles.prose}>
          <p role="alert">{strings.portal.activate.unmappedReason('identifier_set_not_renderable')}</p>
          <p>{strings.portal.activate.lockedReassurance}</p>
        </div>
      </>
    );
  }

  async function submit() {
    setMismatch(false);
    setFailed(false);
    setBusy(true);
    try {
      const stated: Record<string, string> = {};
      for (const field of fields) stated[field.type] = valueFor(field.type).trim();
      await activatePortal(token, stated);
      onActivated();
    } catch (err) {
      if (err instanceof PortalApiError && err.status === 423) {
        onLocked();
        return;
      }
      if (err instanceof PortalApiError && err.status === 401) {
        setMismatch(true);
        setAttemptsRemaining(err.attemptsRemaining ?? Math.max(0, attemptsRemaining - 1));
        firstFieldRef.current?.focus();
        return;
      }
      if (err instanceof PortalApiError && err.reason) {
        onRefused(err.reason);
        return;
      }
      // Unreachable, or something we do not map. Nothing has changed and the
      // form keeps everything typed.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className={styles.prose}>
        <p>{strings.portal.activate.offer(challenge.practiceName)}</p>
        <p>{strings.portal.activate.ask}</p>
        {/* REQ-PORT-08, on every screen that could imply otherwise. */}
        <p className={styles.activateNote}>{strings.portal.activate.optional}</p>
      </div>

      <form
        className={styles.activateForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !busy) void submit();
        }}
        noValidate
      >
        {fields.map((field, index) => (
          <div key={field.type} className={styles.activateGroup}>
            {field.type === 'name' ? (
              <fieldset className={styles.activateGroup}>
                {/*
                  TWO INPUTS, ONE IDENTIFIER — and the note says so, because a
                  patient counting "you asked me for four things" is a patient
                  who thinks we asked for more than the three we are allowed to
                  need (REQ-VER-06).
                */}
                <legend className={styles.fieldLabel}>{field.label}</legend>
                <div className={styles.activateRow}>
                  <span className={styles.activateCell}>
                    <label className={styles.fieldLabel} htmlFor="activate-name-given">
                      {strings.portal.activate.nameGiven}
                    </label>
                    <input
                      id="activate-name-given"
                      className={styles.field}
                      ref={index === 0 ? firstFieldRef : undefined}
                      autoComplete="given-name"
                      value={name.given}
                      onChange={(event) => setName((prev) => ({ ...prev, given: event.target.value }))}
                      aria-describedby={mismatch ? 'activate-mismatch' : undefined}
                    />
                  </span>
                  <span className={styles.activateCell}>
                    <label className={styles.fieldLabel} htmlFor="activate-name-family">
                      {strings.portal.activate.nameFamily}
                    </label>
                    <input
                      id="activate-name-family"
                      className={styles.field}
                      autoComplete="family-name"
                      value={name.family}
                      onChange={(event) => setName((prev) => ({ ...prev, family: event.target.value }))}
                      aria-describedby={mismatch ? 'activate-mismatch' : undefined}
                    />
                  </span>
                </div>
                <p className={styles.activateNote}>{strings.portal.activate.nameNote}</p>
              </fieldset>
            ) : (
              <>
                <label className={styles.fieldLabel} htmlFor={`activate-${field.type}`}>
                  {field.label}
                </label>
                {/*
                  DATE OF BIRTH IS A NATIVE DATE INPUT and everything else — the
                  address included — is one plain line. `type="date"` yields
                  `YYYY-MM-DD`, which is exactly what the server compares, so
                  the patient is never asked to guess our formatting on a screen
                  whose failure message is not allowed to mention formatting.
                */}
                <input
                  id={`activate-${field.type}`}
                  className={styles.field}
                  ref={index === 0 ? firstFieldRef : undefined}
                  type={field.type === 'date_of_birth' ? 'date' : 'text'}
                  placeholder={field.type === 'date_of_birth' ? undefined : field.hint}
                  autoComplete={autoCompleteFor(field.type)}
                  value={plain[field.type] ?? ''}
                  onChange={(event) =>
                    setPlain((prev) => ({ ...prev, [field.type]: event.target.value }))
                  }
                  aria-describedby={mismatch ? 'activate-mismatch' : undefined}
                />
              </>
            )}
          </div>
        ))}

        {/*
          ONE LINE, IN PLACE, NAMING NOTHING. `role="alert"` so it is announced
          when it appears rather than silently painted, and every input points
          at it with `aria-describedby` — a screen-reader user gets told the
          attempt failed and gets told exactly as much as everybody else does
          (REQ-SEC-07, WCAG 2.2 AA).
        */}
        {mismatch && (
          <div id="activate-mismatch" role="alert">
            <p className={styles.cardError}>{strings.portal.activate.mismatchHeading}</p>
            <p className={styles.activateNote}>{strings.portal.activate.mismatchBody}</p>
            {attemptsRemaining > 0 && (
              <p className={styles.activateNote} data-testid="activate-attempts">
                {strings.portal.activate.attemptsRemaining(attemptsRemaining)}
              </p>
            )}
          </div>
        )}

        {failed && (
          <p className={styles.cardError} role="alert">
            {strings.portal.activate.failed}
          </p>
        )}

        <div className={styles.activateActions}>
          <PortalButton type="submit" variant="primary" disabled={!ready || busy}>
            {busy ? strings.portal.activate.continueBusy : strings.portal.activate.continueAction}
          </PortalButton>
          {!ready && <span className={styles.activateNote}>{strings.portal.activate.continueBlocked}</span>}
        </div>
      </form>

      {/*
        THE FIXTURE NOTE — development only, and it says which answers this
        build accepts. A fixture form nobody can pass is a fixture form nobody
        looks at twice; the note disappears the moment the switch is off, along
        with the module it describes.
      */}
      {PORTAL_FIXTURES && <FixtureNote />}
      {/* Attempts left before the first failure, so nobody is locked out unwarned. */}
      {!mismatch && attemptsRemaining < MAX_ATTEMPTS && attemptsRemaining > 0 && (
        <p className={styles.activateNote}>
          {strings.portal.activate.attemptsRemaining(attemptsRemaining)}
        </p>
      )}
    </>
  );
}

/**
 * WHICH BROWSER AUTOFILL HINT, AND WHY THERE IS NO DEFAULT.
 *
 * Only the types a browser genuinely knows get one. An unrecognised type gets
 * nothing rather than a guess: `autocomplete="off"` on a field a patient is
 * struggling with helps nobody, and a wrong hint invites the browser to fill a
 * record number with a postcode.
 */
function autoCompleteFor(type: string): string | undefined {
  switch (type) {
    case 'date_of_birth':
      return 'bday';
    case 'address':
      return 'street-address';
    default:
      return undefined;
  }
}

function FixtureNote() {
  /*
   * IMPORTED LAZILY, like every other use of the fixture module, so a build
   * with the switch off drops it entirely rather than shipping sample
   * identities to a browser. Nothing renders until it resolves — an empty note
   * for one tick is better than a static import that can never be removed.
   */
  const [answers, setAnswers] = useState('');
  useEffect(() => {
    let live = true;
    void import('../../fixtures').then((module) => {
      if (!live) return;
      setAnswers(
        Object.entries(module.FIXTURE_ACTIVATION_ANSWERS)
          .map(([type, value]) => `${type} = ${value}`)
          .join('; '),
      );
    });
    return () => {
      live = false;
    };
  }, []);

  if (!answers) return null;
  return (
    <div className={styles.devSeam}>
      <p className={styles.devSeamHeading}>{strings.portal.activate.fixtureHeading}</p>
      <p className={styles.activateNote}>{strings.portal.activate.fixtureHint(answers)}</p>
    </div>
  );
}

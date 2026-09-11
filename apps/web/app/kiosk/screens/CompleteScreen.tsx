'use client';

/**
 * K-6 — done, and back to idle.
 *
 * IT REPORTS THE EVENT, NOT SUCCESS ON ITS OWN AUTHORITY (handoff §6). The
 * heading appears because the server returned a stored agreement and a
 * completed capture request; the write-back line says "being written back",
 * because that is a queued sweep and claiming it landed would be a claim the
 * kiosk cannot support.
 *
 * IT ALSO OFFERS THE COPY — W6, REQ-PORT-02, the s 65C copy-on-request
 * obligation automated. Three rules shape the offer and none of them is
 * cosmetic:
 *
 *   1. NO ADDRESS IS EVER TYPED HERE (D-2026-09-11-03). The buttons name a
 *      contact the record already holds, MASKED by the server, and there is no
 *      input on this screen and no API call that would accept one. A wrong or
 *      missing address is reception's to fix at the desk.
 *   2. IT IS AN EXTRA, NEVER A STEP (hard rule 8). The agreement is signed
 *      before this screen renders. Declining, a failed send and an offer that
 *      could not be built all leave the ceremony exactly as complete, and the
 *      Done button never waits on any of them.
 *   3. IT SAYS WHY AND WHERE, never a generic apology ("Shortcuts to the
 *      answer", Carl 4 Sep 2026). Every server reason code maps to copy that
 *      names the fix; an unmapped code shows its code so it can be diagnosed.
 *
 * NO PORTAL ACTIVATION HERE. The handoff offers it and the MVP scope
 * explicitly excludes it — an optional account is a whole flow (identity,
 * delivery, revocation) and building half of it would be worse than not
 * offering it. The copy link is not an account: it opens one document and
 * grants nothing.
 *
 * NOTHING PATIENT-IDENTIFYING SURVIVES THIS SCREEN, and there is no way back
 * to it. The countdown returns to idle and the ceremony drops every piece of
 * state it held — including the masked contact, which lives in component state
 * for the seconds the screen is up and is written nowhere (zero-footprint,
 * CLAUDE.md §7). The sub-steps are component state rather than routes, so
 * there is no history entry for the next person to walk back through
 * (C2: no residual patient data on device).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Screen } from '../components/Chrome';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { fetchCopyOffer, requestCopy, type CopyOfferResponse } from '../api';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

/** The Expo build's timeout, unchanged. Long enough to read, short enough to clear the counter. */
export const RETURN_SECONDS = 20;

/**
 * LONGER WHILE A QUESTION IS ON SCREEN (W6).
 *
 * Twenty seconds is right for a screen that only says thank you. It is not
 * right for one asking a question: a countdown that takes the choice away
 * mid-decision turns an offer into a trick. The window widens while the offer
 * is unanswered and drops back to the ordinary one the moment it is answered,
 * so an abandoned tablet still clears itself.
 */
export const OFFER_RETURN_SECONDS = 60;

/** Where the copy offer has got to. Nothing here can block `onDone`. */
type CopyState =
  | { readonly step: 'loading' }
  | { readonly step: 'offering'; readonly offer: CopyOfferResponse }
  | { readonly step: 'sending'; readonly offer: CopyOfferResponse }
  | { readonly step: 'sent'; readonly channel: 'email' | 'sms' }
  | { readonly step: 'declined' }
  | { readonly step: 'failed' }
  /** No channel could be offered, or the offer could not be fetched at all. */
  | { readonly step: 'unavailable'; readonly reason: string | null };

export function CompleteScreen({
  practiceName,
  locationLine,
  givenName,
  enduringProviderName,
  agreementId,
  sessionId,
  patientId,
  onDone,
}: {
  practiceName: string;
  locationLine: string | null;
  givenName: string;
  /**
   * WHAT IS DIFFERENT ABOUT HAVING SIGNED AN ONGOING AGREEMENT (Carl, 4 Sep
   * 2026). Passed only for that type, and it carries the PROVIDER'S name
   * because that is where hard rule 6 would otherwise be quietly broken in the
   * patient's head: an ongoing agreement is per practitioner x patient and
   * never practice-wide (REQ-END-01), and "you will not be asked again here"
   * would say the opposite.
   */
  enduringProviderName?: string | null;
  /**
   * THE AGREEMENT THAT WAS JUST SIGNED — the only thing the copy offer needs.
   * Null on any path that reached here without one, and the offer is simply
   * not made: a thank-you screen with no copy on it is a complete ceremony.
   */
  agreementId?: string | null;
  /** The pushed session's own id — an audit/testing aid in the footer. See `Chrome.tsx`'s `Screen`. */
  sessionId?: string | null;
  /**
   * The patient's own AoBPlatform id, on a PUSHED session only — the walk-up
   * screens know nobody yet and pass nothing. See `Chrome.tsx`'s `Screen`.
   */
  patientId?: string | null;
  onDone: () => void;
}): ReactNode {
  const [copy, setCopy] = useState<CopyState>(agreementId ? { step: 'loading' } : { step: 'declined' });
  const awaitingChoice = copy.step === 'offering' || copy.step === 'sending' || copy.step === 'loading';
  const [remaining, setRemaining] = useState(agreementId ? OFFER_RETURN_SECONDS : RETURN_SECONDS);

  /*
   * THE OFFER IS FETCHED, NOT ASSUMED. The tablet does not know whose contact
   * applies — the patient's or the assignor's — and must not guess: the server
   * reads whichever ONE record the signer's contact lives on
   * (ASSIGNOR-RULES rules 5–6) and answers with a mask.
   *
   * A FAILURE IS NOT AN ERROR SCREEN. It lands on `unavailable` with no code,
   * which reads as "reception can give you a copy" — because that is true, and
   * because nothing on this screen may look like the signature did not take.
   */
  useEffect(() => {
    if (!agreementId) return;
    let live = true;
    fetchCopyOffer(agreementId)
      .then((offer) => {
        if (!live) return;
        setCopy(
          offer.channels.length > 0
            ? { step: 'offering', offer }
            : { step: 'unavailable', reason: offer.unavailable ?? null },
        );
      })
      .catch(() => {
        if (live) setCopy({ step: 'unavailable', reason: null });
      });
    return () => {
      live = false;
    };
  }, [agreementId]);

  /** Answered: the question is gone, so the ordinary countdown applies again. */
  useEffect(() => {
    if (!awaitingChoice) setRemaining((n) => Math.min(n, RETURN_SECONDS));
  }, [awaitingChoice]);

  useEffect(() => {
    if (remaining <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onDone]);

  const choose = useCallback(
    (optionKey: string) => {
      if (copy.step !== 'offering') return;
      const chosen = copy.offer.channels.find((c) => c.key === optionKey);
      if (!chosen) {
        // The decline option. Nothing is sent and nothing is recorded beyond
        // the ceremony already being complete.
        setCopy({ step: 'declined' });
        return;
      }
      const offer = copy.offer;
      setCopy({ step: 'sending', offer });
      if (!agreementId) {
        setCopy({ step: 'failed' });
        return;
      }
      requestCopy(agreementId, optionKey)
        .then((result) => setCopy({ step: 'sent', channel: result.channel }))
        /*
         * A FAILED SEND FAILS HERE AND STOPS (hard rule 8). It says so once,
         * points at reception, and does not retry, does not re-ask, and does
         * not touch the agreement. The queued-or-failed message is visible to
         * reception in the practice's own message log, which is where a send
         * that cannot go belongs — not on a patient's screen.
         */
        .catch(() => setCopy({ step: 'failed' }));
    },
    [copy, agreementId],
  );

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.complete}
      context={strings.complete.writeBackQueued}
      sessionId={sessionId}
      patientId={patientId}
    >
      <div className={styles.centred}>
        <h1 className={styles.h1Small} data-testid="complete-heading">
          {strings.complete.heading(givenName)}
        </h1>
        <p className={styles.lede}>{strings.complete.body}</p>
        {enduringProviderName ? (
          <p className={styles.lede} data-testid="complete-enduring">
            {strings.complete.enduringBody(enduringProviderName)}
          </p>
        ) : null}

        <CopyOffer state={copy} onChoose={choose} />

        <PrimaryButton label={strings.complete.done} onPress={onDone} testId="complete-done" />
        <p className={styles.muted}>{strings.complete.returning(remaining)}</p>
      </div>
    </Screen>
  );
}

/**
 * The offer, and every outcome of it.
 *
 * `aria-live="polite"` ON THE OUTCOME, because the whole of what changes when
 * a patient taps a channel is a line of text (WCAG 2.2 AA — a status that is
 * only drawn is a status a screen-reader user never receives). The question
 * itself labels the group, so the buttons are announced as answers to it
 * rather than as three loose controls.
 */
function CopyOffer({ state, onChoose }: { state: CopyState; onChoose: (optionKey: string) => void }): ReactNode {
  if (state.step === 'loading') return null;

  if (state.step === 'offering' || state.step === 'sending') {
    const busy = state.step === 'sending';
    return (
      <div
        className={styles.stack}
        role="group"
        aria-label={strings.complete.copy.question}
        aria-busy={busy ? true : undefined}
        data-testid="copy-offer"
      >
        <p className={styles.lede}>{strings.complete.copy.question}</p>
        {/* FILE ORDER IS SCREEN ORDER. The server returns the channels in the
            content file's own order and this renders them as given — the list
            changes by editing the file, never by editing this component. */}
        {state.offer.channels.map((channel) => {
          const label = strings.complete.copy.options[channel.key];
          return (
            <SecondaryButton
              key={channel.key}
              label={typeof label === 'function' ? label(channel.masked) : (label ?? channel.masked)}
              onPress={() => onChoose(channel.key)}
              testId={`copy-option-${channel.key}`}
            />
          );
        })}
        <SecondaryButton
          label={String(strings.complete.copy.options[state.offer.declineKey] ?? strings.complete.copy.options.not_now)}
          onPress={() => onChoose(state.offer.declineKey)}
          testId="copy-option-decline"
        />
        {busy ? (
          <p className={styles.muted} aria-live="polite" data-testid="copy-sending">
            {strings.complete.copy.sending}
          </p>
        ) : null}
      </div>
    );
  }

  const line =
    state.step === 'sent'
      ? state.channel === 'email'
        ? strings.complete.copy.sentEmail
        : strings.complete.copy.sentSms
      : state.step === 'declined'
        ? strings.complete.copy.declined
        : state.step === 'failed'
          ? strings.complete.copy.failed
          : /*
             * UNAVAILABLE. The reason code names the fix; an UNMAPPED code
             * shows itself rather than hiding behind a generic sentence, which
             * is the defect Carl's 4 Sep rule calls out by name.
             */
            state.reason === null
            ? strings.complete.copy.offerUnavailable
            : (strings.complete.copy.reasons[state.reason] ??
              strings.complete.copy.unmappedReason(state.reason));

  return (
    <p className={styles.lede} aria-live="polite" data-testid={`copy-${state.step}`}>
      {line}
    </p>
  );
}

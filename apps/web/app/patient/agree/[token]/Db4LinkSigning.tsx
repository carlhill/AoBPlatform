'use client';

/**
 * A DB4 ON THE PATIENT'S PHONE — THE TABLET'S OWN K-3 AND K-4, NOT A COPY
 * (TELEHEALTH-PLAN §8 step 1, 12 Oct 2026).
 *
 * WHAT THIS FILE IS. The link page's third screen when the agreement came from
 * a DB4 Print Record. Everything the patient sees is the kiosk's: the measured
 * DB4 sheets, the page turns and the statement ticks are `ParticularsScreen`,
 * and the pen is `SignatureScreen` with `SignaturePad`. This file holds the
 * state the kiosk's `Ceremony.tsx` holds for them — which page, which ticks,
 * the pad's ink — and sends the signature to the link's own endpoint instead
 * of the tablet's. It draws nothing of its own but the refusal card.
 *
 * WHY NOT A SECOND RENDERING. Carl's practice wants "the exact same DB4"
 * (D-2026-09-14-02). A phone page that drew its own version of the form would
 * be a second source of the words on a contract, free to drift from the one
 * the tablet shows and the Signed-DB4 reproduces. Reuse is proved by test:
 * `link_page_draws_the_kiosk_db4_sheets_not_a_copy`.
 *
 * THE GATE IS THE KIOSK'S GATE (hard rule 2, REQ-REG-06). `evaluateSignatureGate`
 * reads the same four facts here that it reads on the tablet, the signature
 * control cannot enable from anything but `valid`, and `ParticularsScreen`
 * keeps Continue shut until every statement is ticked. The server refuses an
 * unlocked or under-ticked signature whatever this page does.
 *
 * THE AMOUNT IS DISPLAY ONLY (hard rule 4 as narrowed by D-2026-09-14-02). It
 * arrives as a string on `Db4FormView` and is drawn by `ParticularsScreen` as
 * it arrived. The sign body is composed by `composeSignRequest`, which has no
 * field an amount could occupy.
 *
 * NO PRACTITIONER SIGNATURE (hard rule 3). `Db4FormView` carries no signature
 * region, so there is none to draw.
 *
 * NOTHING IS KEPT. The strokes exist for one fetch; nothing here touches a
 * storage API or a console.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgreementType } from '@aobplatform/domain';
import type { Db4FormView } from '@aobplatform/contracts';
import { ParticularsScreen, type ParticularsView } from '../../../kiosk/screens/ParticularsScreen';
import { SignatureScreen } from '../../../kiosk/screens/SignatureScreen';
import { Screen } from '../../../kiosk/components/Chrome';
import { PrimaryButton } from '../../../kiosk/components/Buttons';
import type { SignaturePadHandle } from '../../../kiosk/components/SignaturePad';
import { evaluateSignatureGate } from '../../../kiosk/rules/signature-gate';
import { composeSignRequest } from '../../../kiosk/rules/signature-payload';
import { FIRST_DB4_PAGE, type Db4Page } from '../../../kiosk/rules/db4-pages';
import { strings } from '../../../strings';
import kioskStyles from '../../../kiosk/kiosk.module.css';

/** The parts of `GET /agree/:token` this screen reads. */
export interface Db4LinkRead {
  readonly particulars: {
    readonly practiceName: string | null;
    readonly providerName: string | null;
    readonly agreementType: string;
    readonly agreementDate: string;
    readonly serviceDate: string;
    readonly mbsItemNumbers: readonly string[];
    readonly patientName: string;
    /** D7. The caller does not draw this screen when it is null — it is never guessed. */
    readonly assignorIsPatient: boolean;
    readonly assignorName: string | null;
    readonly assignorRelationship: string | null;
  };
  readonly statements: readonly { readonly key: string; readonly text: string }[];
  readonly templateVersion: string | null;
  readonly db4Form: Db4FormView;
  readonly gate: {
    readonly status: string;
    readonly particularsPresent: boolean;
    readonly particularsLockedAt: string | null;
    readonly ruleSetVersion: string | null;
    readonly mappingVersion: string | null;
    readonly renderedArtefactHash: string | null;
  };
  readonly providerAddress: string | null;
  readonly basicServiceDescription: string | null;
}

/** The two refusals the person can put right on this page, by ticking or by signing again. */
const FIXABLE_HERE = new Set(['affirmations_missing', 'signature_capture_invalid']);

export function Db4LinkSigning({
  token,
  coreUrl,
  read,
  onSigned,
  onLinkOutcome,
}: {
  token: string;
  coreUrl: string;
  read: Db4LinkRead;
  /** The signature is stored. `writtenBack` is whether the copy has already landed in the practice's system. */
  onSigned: (writtenBack: boolean) => void;
  /** The link itself stopped working (404, 410, 423): the page's existing outcome screens say why. */
  onLinkOutcome: (status: number) => void;
}): ReactNode {
  const [step, setStep] = useState<'particulars' | 'signature' | 'refused'>('particulars');
  const [page, setPage] = useState<Db4Page>(FIRST_DB4_PAGE);
  const [affirmed, setAffirmed] = useState<readonly string[]>([]);
  const [inkPresent, setInkPresent] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Why the last press recorded nothing, when it never reached a server that could refuse it. */
  const [unsent, setUnsent] = useState<'not_reached' | 'nothing_drawn' | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle | null>(null);

  const p = read.particulars;
  const practiceName = p.practiceName ?? '';

  /*
   * THE SAME SHAPE `Ceremony.tsx` BUILDS FOR K-3, from the link's read rather
   * than the tablet's — every field off the LOCKED particulars or the server's
   * own form view, none typed or inferred here.
   */
  const view: ParticularsView = useMemo(
    () => ({
      agreementType: p.agreementType as AgreementType,
      patientName: p.patientName,
      providerName: p.providerName,
      providerAddress: read.providerAddress,
      serviceDate: p.serviceDate ?? null,
      agreementDate: p.agreementDate ?? null,
      basicServiceDescription: read.basicServiceDescription,
      mbsItemNumbers: p.mbsItemNumbers,
      assignorIsPatient: p.assignorIsPatient,
      assignorName: p.assignorName,
      assignorRelationship: p.assignorRelationship,
      particularsLocked: read.gate.particularsLockedAt !== null,
      ruleSetVersion: read.gate.ruleSetVersion,
      mappingVersion: read.gate.mappingVersion,
      artefactHash: read.gate.renderedArtefactHash,
      statements: read.statements,
      templateVersion: read.templateVersion,
      db4Form: read.db4Form,
    }),
    [p, read],
  );

  const validation = useMemo(
    () =>
      evaluateSignatureGate({
        status: read.gate.status,
        particulars: read.gate.particularsPresent ? {} : null,
        particularsLockedAt: read.gate.particularsLockedAt,
        ruleSetVersion: read.gate.ruleSetVersion,
        renderedArtefactHash: read.gate.renderedArtefactHash,
      }),
    [read.gate],
  );

  async function sign(method: 'drawn' | 'tap_to_approve') {
    setBusy(true);
    setUnsent(null);
    /*
     * THE KIOSK'S COMPOSER, SO A DRAWN SIGNATURE WITH NOTHING IN IT IS NEVER
     * SENT AS ONE. The link names its capture request by its token, so the id
     * the composer carries for the tablet is dropped before sending.
     */
    const composed = composeSignRequest(
      method,
      'link',
      method === 'drawn' ? (padRef.current?.capture() ?? null) : null,
      affirmed,
    );
    if (!composed) {
      setUnsent('nothing_drawn');
      setBusy(false);
      return;
    }
    const { captureRequestId: _unused, ...body } = composed;
    void _unused;
    try {
      const res = await fetch(`${coreUrl}/agree/${token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 404 || res.status === 410 || res.status === 423) {
        onLinkOutcome(res.status);
        return;
      }
      if (!res.ok) {
        const refused = (await res.json().catch(() => ({}))) as { reason?: unknown };
        setRefusal(typeof refused.reason === 'string' ? refused.reason : String(res.status));
        setStep('refused');
        return;
      }
      const outcome = (await res.json().catch(() => ({}))) as { writtenBack?: boolean };
      onSigned(Boolean(outcome.writtenBack));
    } catch {
      // fetch threw: the request never reached a server that could refuse it.
      setUnsent('not_reached');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'refused') {
    const code = refusal ?? '';
    const line = strings.link.db4.reasons[code] ?? strings.link.db4.unmapped(code);
    return (
      <Screen practiceName={practiceName}>
        <div className={kioskStyles.stack} data-testid="link-db4-refused">
          <h1 className={kioskStyles.h2}>{strings.link.db4.refusedTitle}</h1>
          <p className={kioskStyles.body} data-testid="link-db4-refused-reason">
            {line}
          </p>
          {FIXABLE_HERE.has(code) ? (
            <PrimaryButton
              label={strings.link.db4.signAgain}
              onPress={() => {
                padRef.current?.clear();
                setInkPresent(false);
                setStep('particulars');
              }}
              testId="link-db4-sign-again"
            />
          ) : null}
        </div>
      </Screen>
    );
  }

  if (step === 'signature') {
    return (
      <SignatureScreen
        practiceName={practiceName}
        locationLine={null}
        heading={strings.kiosk.particulars.headingByAgreementType[view.agreementType]}
        parties={{
          patientName: view.patientName,
          assignorIsPatient: view.assignorIsPatient,
          assignorName: view.assignorName,
          assignorRelationship: view.assignorRelationship,
        }}
        validation={validation}
        padRef={padRef}
        inkPresent={inkPresent}
        submitting={busy}
        error={unsent}
        failedText={unsent === 'nothing_drawn' ? strings.link.db4.nothingDrawn : strings.link.db4.notReached}
        whoNotRight={strings.link.db4.whoNotRight}
        onInkChange={setInkPresent}
        onClear={() => {
          padRef.current?.clear();
          setInkPresent(false);
        }}
        onSignDrawn={() => void sign('drawn')}
        onSignTap={() => void sign('tap_to_approve')}
        onBack={() => setStep('particulars')}
      />
    );
  }

  return (
    <ParticularsScreen
      practiceName={practiceName}
      locationLine={null}
      view={view}
      validation={validation}
      affirmed={affirmed}
      onToggleAffirmation={(key) =>
        setAffirmed((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]))
      }
      onContinue={() => setStep('signature')}
      page={page}
      onPage={setPage}
    />
  );
}

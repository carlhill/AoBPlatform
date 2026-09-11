'use client';

/**
 * RECEPTION TYPES AN AGREEMENT BY HAND (Carl, 7 Sep 2026;
 * PMS_to_AoB_Workflow.md case 4, row W2).
 *
 * THE CASE IT ANSWERS. The practice management system is down, or the practice
 * is not integrated yet, or somebody has walked in who has no record in it at
 * all. Reception types what the connector would have sent, and the platform
 * drafts the agreement exactly as it would have.
 *
 * IT IS AN ARRIVAL TYPED BY HAND, AND THAT IS THE WHOLE DESIGN. This panel
 * posts `POST /arrivals` with `source: 'reception'` — the SAME endpoint, the
 * same servicing-provider guard, the same versioned visit policy, the same
 * draft, the same capture request, the same lock and the same queue row. There
 * is no second pipeline and there must never be one: case 4 is what a practice
 * falls back to when its own software fails, which is precisely the moment a
 * second, subtly different code path would do the most damage.
 *
 * A STAFF SURFACE, ON THE STAFF SIDE OF THE DESK. Nothing on the PATIENT
 * surface asks a patient to type a detail on the practice's behalf (Carl,
 * 3 Sep 2026); this form is the other side of that rule rather than an
 * exception to it. The person filling it in works here, is signed in, and the
 * arrival records who they were.
 *
 * WHAT IT DOES NOT ASK, AND WHY EACH ABSENCE IS A REQUIREMENT:
 *
 *   * NO MEDICARE CARD NUMBER. There is no field, no label and no hint for
 *     one; the card number is not an identity identifier, the exclusion is
 *     non-configurable, and the server refuses any key matching /medicare/i in
 *     the raw body besides (hard rule 1, REQ-VER-02). Named test:
 *     `new_agreement_form_never_carries_a_medicare_number`.
 *   * NO AGREEMENT TYPE. What the visit needs is decided by the versioned
 *     visit policy from the provider and the patient (hard rules 6 and 14), so
 *     the form SHOWS the answer live above Submit rather than offering a
 *     choice. Named test:
 *     `new_agreement_form_shows_the_policy_decision_before_submit`.
 *   * NO CAPACITY QUESTION, anywhere (REQ-VUL-05).
 *   * NO BENEFIT AND NO DOLLAR AMOUNT (hard rule 4), and nothing in the copy
 *     claims any form is certified, approved or accredited (hard rule 12).
 *   * NO DATE OF BIRTH FOR AN ASSIGNOR. What is recorded when somebody signs
 *     for another person is a DECLARATION that they are of full age, never
 *     verified and never stored as a birth date (REQ-AGE-01, REQ-VUL-02) — the
 *     same answer the kiosk's K-5 screen and the tablet desk both give.
 *
 * WHO MAY SIGN IS GATED BY ONE FUNCTION. `whoIsBlocked` from `pushDesk.tsx` —
 * imported, not copied — which itself imports every threshold, the
 * relationship-to-authority mapping and the practice-staff comparison from
 * `@aobplatform/domain`. The SERVER runs the identical refusals inside
 * `buildAssignorForAnother` before it will accept the arrival, so this
 * disables a control the server would refuse rather than deciding anything of
 * its own (hard rule 10, REQ-VUL-04, REQ-AGE-01, REQ-REG-08).
 *
 * DOUBLE-CLICK DRAFTS ONCE. The idempotency key is composed from the record
 * number, the provider, the service date and a nonce minted when the panel
 * opened — so the second press of one Submit is the same arrival and produces
 * one row, while a genuinely new agreement for the same person and provider on
 * the same day (a second visit) gets a new nonce and is a new arrival. Named
 * test: `new_agreement_form_double_submit_drafts_once`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, UserPlus } from 'lucide-react';
import type { ArrivalPreview, ArrivalProviderChoice, PatientSearchResult } from '@aobplatform/contracts';
import {
  ASSIGNOR_RELATIONSHIP_OPTIONS,
  ASSIGNOR_RELATIONSHIPS_VERSION,
  authorityBasisFor,
  MIN_AGE_ASSIGN_FOR_OTHER,
  MIN_AGE_SELF_ASSIGN,
  relationshipNeedsFreeText,
} from '@aobplatform/domain';
import { Button, Checkbox, Field, Notice, RecordId, Section, SelectInput, TextInput, ui } from '../../ui';
import { strings } from '../../strings';
import { apiHeaders } from '../../auth';
import styles from '../manage.module.css';
import {
  EMPTY_WHO,
  bornOn,
  whoIsBlocked,
  type PatientDetails,
  type WhoDraft,
} from '../tablet/pushDesk';
import {
  composeDateOfBirth,
  dayOptions,
  monthOptions,
  yearOptions,
  type DateOfBirthParts,
} from '../../kiosk/rules/verify-fields';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

/**
 * TODAY, BY THE PRACTICE'S CLOCK — never `toISOString().slice(0, 10)`.
 *
 * At 9 a.m. in Sydney the UTC calendar day is yesterday, and D5 is a
 * particular of a contract. The server takes this date verbatim rather than
 * deriving one from a timestamp, for exactly this reason.
 */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The words for a relationship key, from the string table; the key is the content file's. */
function relationshipLabel(key: string): string {
  return strings.kiosk.assignor.relationshipNames[key] ?? key;
}

/** What is actually sent as the relationship: the free text where the option asks for one. */
function relationshipDescription(key: string, describe: string): string {
  return relationshipNeedsFreeText(key) ? describe.trim() : relationshipLabel(key);
}

/** What the form is holding about the patient, before anything is sent. */
interface PatientDraft {
  /** Set only when reception picked somebody the practice already holds. */
  chosen: PatientSearchResult | null;
  familyName: string;
  givenNames: string;
  dateOfBirth: DateOfBirthParts;
  address: string;
  mobile: string;
  email: string;
  recordNumber: string;
}

const EMPTY_PATIENT: PatientDraft = {
  chosen: null,
  familyName: '',
  givenNames: '',
  dateOfBirth: { day: '', month: '', year: '' },
  address: '',
  mobile: '',
  email: '',
  recordNumber: '',
};

/**
 * EVERY REASON THIS CANNOT BE SUBMITTED, ALL AT ONCE — live, before anybody
 * presses (CLAUDE.md §6: blocked states are unreachable, not merely inert).
 *
 * ALL of them, not the first: somebody missing an address AND a provider
 * should see both, the same way the kiosk's signature control lists everything
 * outstanding. The who-is-signing half is delegated whole to `whoIsBlocked`,
 * which is the tablet desk's own gate and the domain's rules behind it.
 */
export function newAgreementBlocked(input: {
  patient: PatientDraft;
  /** True once reception said "New patient" — before that, nobody is named at all. */
  newPatient: boolean;
  affiliationId: string;
  serviceDate: string;
  who: WhoDraft;
  staffNames: readonly string[];
  preview: ArrivalPreview | null;
}): readonly string[] {
  const { patient, newPatient, affiliationId, serviceDate, who, staffNames, preview } = input;
  const reasons: string[] = [];

  if (patient.chosen) {
    // A found patient still needs the practice's own record number, because
    // the column is nullable and an arrival is matched on it.
    if (patient.recordNumber.trim().length === 0) reasons.push(strings.newAgreement.needRecordNumber);
    /*
     * AND THE PLATFORM MUST HOLD THEIR ADDRESS BEFORE THIS CAN BE SENT.
     *
     * AN ARRIVAL IS A MIRROR WRITE (REQ-DATA-10): `mirrorPatient` brings the
     * patient row up to what the message says, field by field. So an arrival
     * carrying an EMPTY address would not leave the held one alone — it would
     * overwrite it with nothing, and a walk-in typed at the desk would erase
     * the address of somebody the practice has held for years. The search
     * result deliberately carries no address (hard rule 1's minimisation), so
     * the chosen patient's own details are read separately and held here; if
     * that read has not landed, or failed, Submit stays dead and says so
     * rather than posting a blanking write.
     */
    if (patient.address.trim().length === 0) reasons.push(strings.newAgreement.needAddress);
  } else if (!newPatient) {
    // Nobody is named yet. One line rather than five empty-field complaints
    // about a form nobody has started filling in.
    reasons.push(strings.newAgreement.needPatient);
  } else {
    if (patient.familyName.trim().length === 0) reasons.push(strings.newAgreement.needFamilyName);
    if (patient.givenNames.trim().length === 0) reasons.push(strings.newAgreement.needGivenNames);
    if (composeDateOfBirth(patient.dateOfBirth).length === 0) {
      reasons.push(strings.newAgreement.needDateOfBirth);
    }
    if (patient.address.trim().length === 0) reasons.push(strings.newAgreement.needAddress);
    if (patient.recordNumber.trim().length === 0) reasons.push(strings.newAgreement.needRecordNumber);
  }

  if (affiliationId.length === 0) reasons.push(strings.newAgreement.needProvider);
  if (serviceDate.length === 0) reasons.push(strings.newAgreement.needServiceDate);

  // The server's own answer, honoured rather than second-guessed: a provider
  // it will refuse is a provider this form must not offer to submit.
  if (preview?.blocked) reasons.push(strings.newAgreement.needProviderUsable);
  if (preview?.decision?.type === 'none') reasons.push(strings.newAgreement.needNothingToSign);

  const whoBlocked = whoIsBlocked(who, staffNames);
  if (whoBlocked) reasons.push(whoBlocked);
  /*
   * AND A RELATIONSHIP THAT DERIVES NO AUTHORITY BASIS IS BLOCKED TOO.
   *
   * `whoIsBlocked` covers the reachable cases — no relationship chosen, the
   * free-text option left undescribed. This covers the one it cannot: a
   * content-file inconsistency in `assignor-relationships.json` that leaves an
   * option mapping to nothing. Without it, Submit would be alive on a choice
   * the server must refuse — and hard rule 14's whole point is that the
   * content file can change without a code change, so the code must fail
   * visibly when it changes wrongly rather than assume it never will.
   */
  if (
    !who.isPatient &&
    who.relationship.length > 0 &&
    !authorityBasisFor(who.relationship, relationshipDescription(who.relationship, who.describe))
  ) {
    reasons.push(strings.newAgreement.needRelationshipBasis(who.relationship));
  }

  return reasons;
}

export function NewAgreementPanel({
  practiceId,
  canAct,
  /** Pre-filled on a patient's own work page; absent on the queue. */
  forPatientId,
  onCreated,
  onClose,
}: {
  practiceId: string;
  canAct: boolean;
  forPatientId?: string;
  /** The queue refreshes and the work page re-reads its cards. */
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [patient, setPatient] = useState<PatientDraft>(EMPTY_PATIENT);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<PatientSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [newPatient, setNewPatient] = useState(false);

  const [choices, setChoices] = useState<ArrivalProviderChoice[] | null>(null);
  const [affiliationId, setAffiliationId] = useState('');

  const [serviceDate, setServiceDate] = useState(todayLocal());
  const [descriptions, setDescriptions] = useState<{
    version: string;
    descriptions: readonly string[];
    defaultDescription: string | null;
  } | null>(null);
  const [serviceDescription, setServiceDescription] = useState('');

  const [who, setWho] = useState<WhoDraft>(EMPTY_WHO);
  const [staffNames, setStaffNames] = useState<readonly string[]>([]);

  const [preview, setPreview] = useState<ArrivalPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * WHAT WAS CREATED, AND WHETHER IT CAN ACTUALLY GO YET.
   *
   * `blocked` IS NOT COSMETIC. Two states produce a draft the queue cannot
   * send: a practice with no default D6a and no description chosen here (the
   * pipeline's own "NO DEFAULT D6a MEANS NO LOCK" branch — hard rule 2 forbids
   * an unlocked agreement at `awaiting_signature`), and an `enduring` draft,
   * which the s 65C rule set has no path for yet (`enduring_rules_not_authored`,
   * GA-PLAN B5). Saying "ready to send to a tablet" in either case would be the
   * generic-reassurance defect Carl named on 4 Sep 2026: the banner has to name
   * the real state and point at the row that carries the fix.
   */
  const [created, setCreated] = useState<{
    patientId: string;
    agreementId: string | null;
    blocked: boolean;
  } | null>(null);

  /*
   * THE NONCE THAT MAKES A DOUBLE-CLICK ONE AGREEMENT. Minted once when the
   * panel mounts and never regenerated while it is open, so two presses of one
   * Submit carry one idempotency key. A SECOND visit by the same patient to the
   * same provider on the same day is a fresh open of this panel and therefore
   * a fresh nonce — which is right: it is a second walk-in, not a retry.
   */
  const nonce = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : String(Date.now()),
  );

  // --- What the form needs from the server, read once when it opens --------
  useEffect(() => {
    const scope = apiHeaders(practiceId);
    void fetch(`${CORE_URL}/arrivals/servicing-providers`, { headers: scope })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: ArrivalProviderChoice[]) => setChoices(Array.isArray(body) ? body : []))
      .catch(() => setChoices([]));

    /*
     * THE DESCRIPTIONS AND THIS PRACTICE'S DEFAULT, FROM THE SERVER. The words
     * are the exact strings the rules engine's C6 check matches and they are
     * versioned content — a list in this file would be a second copy that goes
     * stale silently (hard rule 14). The default is PRE-SELECTED, and reception
     * may pick another entry; they can never type one.
     */
    void fetch(`${CORE_URL}/service-descriptions/settings`, { headers: scope })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { version: string; descriptions: string[]; defaultDescription: string | null }) => {
        setDescriptions(body);
        setServiceDescription(body.defaultDescription ?? '');
      })
      .catch(() => setDescriptions(null));

    /*
     * THE PRACTICE'S OWN STAFF LIST, held in memory for this panel only, so
     * the "someone else is signing" branch blocks a staff member LIVE rather
     * than after a press (REQ-VUL-04). It fails toward the desk: if the list
     * cannot be read the block cannot fire, and the server still refuses with
     * the same sentence — a page that silently stopped blocking would be worse
     * than one that defers to the endpoint that always checks.
     */
    void fetch(`${CORE_URL}/practice-users`, { headers: scope })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { users?: Array<{ name?: string }> }) =>
        setStaffNames((body.users ?? []).map((u) => u.name ?? '').filter(Boolean)),
      )
      .catch(() => setStaffNames([]));
  }, [practiceId]);

  /*
   * OPENED FROM A PATIENT'S OWN PAGE: their details are pre-filled from the
   * record the practice already holds, so nobody retypes what is on screen
   * behind the panel. The record number comes from the search endpoint, which
   * is the only read that carries it — the details endpoint deliberately does
   * not (it returns only what may be CORRECTED).
   */
  useEffect(() => {
    if (!forPatientId) return;
    const scope = apiHeaders(practiceId);
    void fetch(`${CORE_URL}/patients/${forPatientId}/details`, { headers: scope })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(async (details: PatientDetails) => {
        const matches = await fetch(
          `${CORE_URL}/patients/search?q=${encodeURIComponent(details.familyName)}`,
          { headers: scope },
        )
          .then((r) => (r.ok ? (r.json() as Promise<PatientSearchResult[]>) : []))
          .catch(() => [] as PatientSearchResult[]);
        const mine = matches.find((row) => row.patientId === forPatientId) ?? null;
        setPatient({
          chosen: mine ?? {
            patientId: forPatientId,
            givenNames: details.givenNames,
            familyName: details.familyName,
            dateOfBirth: details.dateOfBirth,
            patientRecordNumber: null,
          },
          familyName: details.familyName,
          givenNames: details.givenNames,
          dateOfBirth: partsOf(details.dateOfBirth),
          address: details.address ?? '',
          mobile: details.mobile ?? '',
          email: details.email ?? '',
          recordNumber: mine?.patientRecordNumber ?? '',
        });
      })
      .catch(() => undefined);
  }, [practiceId, forPatientId]);

  /**
   * SOMEBODY WAS CHOSEN FROM THE SEARCH — NOW READ WHAT WE ACTUALLY HOLD.
   *
   * WHY THIS READ IS NOT OPTIONAL. An arrival is a MIRROR WRITE (REQ-DATA-10):
   * `mirrorPatient` brings the patient row up to what the message says, field
   * by field, and an empty address in the message overwrites a real one on the
   * record. The search result carries four fields on purpose — no address, no
   * contact details (hard rule 1's minimisation) — so posting straight from it
   * would ERASE the address, mobile and email of somebody the practice has
   * held for years, on the very case this build exists for.
   *
   * SO THE DETAILS COME FROM THE PATIENT'S OWN READ, the same
   * `GET /patients/:id/details` the work page and the correction control use,
   * and the arrival carries the values the platform already holds — which
   * makes the mirror write a no-op rather than a loss. Until it lands, Submit
   * is dead with `needAddress` on screen (`newAgreementBlocked`).
   *
   * THEY ARE HELD, NOT OFFERED FOR EDITING. Changing a patient's address is
   * the Correct control's act, on the work page, with its own evidence and its
   * own supersession of a locked agreement (HARD-02). A second editable copy
   * here would be a second way to change a detail with none of that.
   */
  const choosePatient = useCallback(
    async (row: PatientSearchResult) => {
      setPatient({
        chosen: row,
        familyName: row.familyName,
        givenNames: row.givenNames,
        dateOfBirth: partsOf(row.dateOfBirth),
        address: '',
        mobile: '',
        email: '',
        recordNumber: row.patientRecordNumber ?? '',
      });
      try {
        const res = await fetch(`${CORE_URL}/patients/${row.patientId}/details`, {
          headers: apiHeaders(practiceId),
        });
        if (!res.ok) return;
        const details = (await res.json()) as PatientDetails;
        setPatient((p) =>
          p.chosen?.patientId === row.patientId
            ? {
                ...p,
                address: details.address ?? '',
                mobile: details.mobile ?? '',
                email: details.email ?? '',
              }
            : p,
        );
      } catch {
        // Left blank on purpose: Submit stays dead and names the missing
        // address, which is the honest outcome of a read that did not land.
      }
    },
    [practiceId],
  );

  // --- Type-to-find, over this practice's own records only ----------------
  const search = useCallback(
    async (value: string) => {
      if (value.trim().length < 2) {
        setFound(null);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(`${CORE_URL}/patients/search?q=${encodeURIComponent(value.trim())}`, {
          headers: apiHeaders(practiceId),
        });
        setFound(res.ok ? ((await res.json()) as PatientSearchResult[]) : []);
      } catch {
        setFound([]);
      } finally {
        setSearching(false);
      }
    },
    [practiceId],
  );

  /*
   * THE LIVE READ ABOVE SUBMIT. Asked whenever the two inputs the visit policy
   * actually turns on change — the provider and the patient's record number —
   * and never on a timer. It writes nothing; a receptionist changing their mind
   * about a dropdown must not put anybody on a queue.
   */
  useEffect(() => {
    if (affiliationId.length === 0 || patient.recordNumber.trim().length === 0) {
      setPreview(null);
      return;
    }
    let live = true;
    setPreviewing(true);
    void fetch(`${CORE_URL}/arrivals/preview`, {
      method: 'POST',
      headers: apiHeaders(practiceId),
      body: JSON.stringify({
        pmsPatientRecordNumber: patient.recordNumber.trim(),
        affiliationId,
      }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<ArrivalPreview>) : Promise.reject(new Error(String(r.status)))))
      .then((body) => {
        if (live) setPreview(body);
      })
      .catch(() => {
        if (live) setPreview(null);
      })
      .finally(() => {
        if (live) setPreviewing(false);
      });
    return () => {
      live = false;
    };
  }, [practiceId, affiliationId, patient.recordNumber]);

  const blocked = useMemo(
    () => newAgreementBlocked({ patient, newPatient, affiliationId, serviceDate, who, staffNames, preview }),
    [patient, newPatient, affiliationId, serviceDate, who, staffNames, preview],
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const recordNumber = patient.recordNumber.trim();
      const body: Record<string, unknown> = {
        pmsPatientRecordNumber: recordNumber,
        familyName: patient.familyName.trim(),
        givenNames: patient.givenNames.trim(),
        dateOfBirth: composeDateOfBirth(patient.dateOfBirth),
        address: patient.address.trim(),
        ...(patient.mobile.trim() ? { mobile: patient.mobile.trim() } : {}),
        ...(patient.email.trim() ? { email: patient.email.trim() } : {}),
        affiliationId,
        arrivedAt: new Date().toISOString(),
        source: 'reception',
        serviceDate,
        ...(serviceDescription ? { serviceDescription } : {}),
        /*
         * ONE WALK-IN, ONE AGREEMENT. Composed from the practice's record
         * number, the provider, the day and the nonce this panel was opened
         * with — so the second press of one Submit is the same arrival.
         */
        idempotencyKey: `reception:${recordNumber}:${affiliationId}:${serviceDate}:${nonce.current}`,
      };

      /*
       * WHO IS SIGNING, WHERE IT IS NOT THE PATIENT. BOTH answers go: the
       * relationship is the word the person chose and is what C8 prints, and
       * the authority basis is reg 65CB(5)'s category derived from it through
       * the versioned content file. REQ-VUL-01 names them as separate
       * attributes, and the version travels with them (hard rule 14).
       *
       * D7 STAYS EXPLICIT. Its absence means the patient is signing for
       * themselves and the record says so, rather than being inferred later.
       */
      if (!who.isPatient) {
        const description = relationshipDescription(who.relationship, who.describe);
        const derived = authorityBasisFor(who.relationship, description);
        /*
         * THE PARTY IS SENT WHETHER OR NOT A BASIS DERIVED, and that is
         * deliberate — the same shape the tablet desk's `saveWho` uses.
         *
         * If a content-file inconsistency ever left `authorityBasisFor`
         * returning null, OMITTING the assignor here would post an arrival
         * with no `assignor` at all — which the server reads as D7 "the
         * patient is signing for themselves" and records exactly that, after
         * a staff member explicitly said somebody else was. A consent record
         * naming the wrong party is the worst outcome this form has, and a
         * silent one is worse still. Sending it without a basis makes the DTO
         * refuse it out loud instead (`@IsIn(AUTHORITY_BASES_FOR_ANOTHER)`),
         * and `newAgreementBlocked` keeps the state unreachable in the first
         * place.
         */
        body.assignor = {
          name: who.name.trim(),
          relationship: description,
          relationshipsVersion: ASSIGNOR_RELATIONSHIPS_VERSION,
          ...(derived ? { authorityBasis: derived.authorityBasis } : {}),
          ...(derived?.note ? { note: derived.note } : {}),
          // A DECLARATION, recorded and never verified (REQ-AGE-01,
          // REQ-VUL-02). No date of birth is asked for or stored.
          declaresEighteenOrOver: who.declaredOfAge,
          ...(who.mobile.trim() ? { mobile: who.mobile.trim() } : {}),
          ...(who.email.trim() ? { email: who.email.trim() } : {}),
        };
      }

      const res = await fetch(`${CORE_URL}/arrivals`, {
        method: 'POST',
        headers: apiHeaders(practiceId),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        throw new Error(
          Array.isArray(problem.message) ? problem.message.join(' ') : (problem.message ?? String(res.status)),
        );
      }
      const receipt = (await res.json()) as { patientId: string; agreementId: string | null };
      /*
       * WHETHER IT CAN GO, WORKED OUT FROM WHAT WAS KNOWN BEFORE SUBMIT rather
       * than guessed afterwards. An `enduring` draft cannot be locked or pushed
       * yet, and a draft with no D6a cannot be locked at all — both leave a row
       * on the queue that states its own reason and carries its own fix.
       */
      const willBlock =
        preview?.decision?.type === 'enduring' ||
        (serviceDescription.length === 0 && !descriptions?.defaultDescription);
      setCreated({ ...receipt, blocked: receipt.agreementId !== null && willBlock });
      await onCreated();
    } catch (e) {
      setError(e instanceof TypeError ? strings.status.unreachable : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const patientName = `${patient.givenNames} ${patient.familyName}`.trim();

  // --- What was created, and where to go next -----------------------------
  if (created) {
    return (
      <div className={styles.addPanel} data-testid="new-agreement-created">
        <Notice
          tone={created.blocked ? 'warn' : 'ok'}
          title={strings.newAgreement.createdTitle}
        >
          <p>
            {created.agreementId === null
              ? strings.newAgreement.createdNothing(patientName)
              : created.blocked
                ? strings.newAgreement.createdBlocked(patientName)
                : strings.newAgreement.created(patientName)}
          </p>
          <p className={ui.hint}>
            {/*
              SOMEWHERE TO GO, not a sentence pointing at a screen (CLAUDE.md
              §7). The link lands on the exact patient the form just created.
            */}
            <Link href={`/practice/patients/${created.patientId}`} data-testid="new-agreement-created-open">
              {strings.newAgreement.createdOpen}
            </Link>
          </p>
        </Notice>
        <div className={styles.formActions}>
          <Button onClick={onClose} data-testid="new-agreement-done">
            <Check size={14} aria-hidden="true" />
            {strings.newAgreement.close}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.addPanel} data-testid="new-agreement-panel">
      <p className={ui.hint}>{strings.newAgreement.lead}</p>

      {error && (
        <Notice tone="stop" title={strings.newAgreement.failed} data-testid="new-agreement-error">
          {error}
        </Notice>
      )}

      {/* ---------------------------------------------------------------- */}
      <Section number={1} title={strings.newAgreement.patientHeading}>
        {!forPatientId && (
          <div className={styles.formActions}>
            <Button
              variant={newPatient ? 'subtle' : 'primary'}
              onClick={() => {
                setNewPatient(false);
                setPatient((p) => ({ ...EMPTY_PATIENT, recordNumber: p.recordNumber }));
              }}
              data-testid="new-agreement-mode-existing"
            >
              {strings.newAgreement.patientExisting}
            </Button>
            <Button
              variant={newPatient ? 'primary' : 'subtle'}
              onClick={() => {
                setNewPatient(true);
                setFound(null);
                setPatient((p) => ({ ...EMPTY_PATIENT, recordNumber: p.recordNumber }));
              }}
              data-testid="new-agreement-mode-new"
            >
              <UserPlus size={14} aria-hidden="true" />
              {strings.newAgreement.patientNew}
            </Button>
          </div>
        )}

        {!newPatient && !forPatientId && (
          <>
            <Field label={strings.newAgreement.findLabel} hint={strings.newAgreement.findHint}>
              {(props) => (
                <TextInput
                  {...props}
                  value={term}
                  placeholder={strings.newAgreement.findPlaceholder}
                  maxLength={100}
                  onChange={(e) => {
                    setTerm(e.target.value);
                    void search(e.target.value);
                  }}
                  data-testid="new-agreement-find"
                />
              )}
            </Field>

            {searching && <p className={ui.hint}>{strings.newAgreement.findSearching}</p>}

            {found !== null && found.length === 0 && !searching && (
              <p className={ui.hint} data-testid="new-agreement-find-none">
                {strings.newAgreement.findNone(term.trim())}
              </p>
            )}

            <ul className={styles.suggestions} data-testid="new-agreement-find-results">
              {(found ?? []).map((row) => (
                <li key={row.patientId}>
                  <Button
                    variant="subtle"
                    onClick={() => void choosePatient(row)}
                    data-testid={`new-agreement-choose-${row.patientId}`}
                  >
                    {strings.newAgreement.findResult(
                      `${row.givenNames} ${row.familyName}`,
                      bornOn(row.dateOfBirth),
                    )}
                    {row.patientRecordNumber === null
                      ? ` · ${strings.newAgreement.findResultNoRecordNumber}`
                      : ` · ${row.patientRecordNumber}`}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}

        {patient.chosen && (
          <>
            <p className={ui.hint} data-testid="new-agreement-chosen">
              {strings.newAgreement.chosen(`${patient.givenNames} ${patient.familyName}`)}
            </p>
            {/*
              AND WHICH RECORD WAS PICKED (Carl, 7 Sep 2026). Two people share
              a name; the id is what says which of them this agreement is about
              before anything is created. An opaque id we minted — never a
              Medicare number, and there is no column for one (hard rule 1).
            */}
            <RecordId
              label={strings.recordId.patient}
              value={patient.chosen.patientId}
              testId="new-agreement-patient-id"
            />
          </>
        )}

        {/*
          THE FIVE DETAILS. Shown and editable for a NEW patient; for somebody
          the practice already holds they are the record's own and are not
          retyped here — a form that re-asked for them would be a second place
          a patient's address can be changed, with none of the correction
          path's evidence (REQ-DATA-10).
        */}
        {newPatient && !patient.chosen && (
            <div className={styles.addGrid} data-testid="new-agreement-new-patient">
              <Field label={strings.newAgreement.familyName} required>
                {(props) => (
                  <TextInput
                    {...props}
                    value={patient.familyName}
                    maxLength={200}
                    onChange={(e) => setPatient((p) => ({ ...p, familyName: e.target.value }))}
                    data-testid="new-agreement-family-name"
                  />
                )}
              </Field>
              <Field label={strings.newAgreement.givenNames} required>
                {(props) => (
                  <TextInput
                    {...props}
                    value={patient.givenNames}
                    maxLength={200}
                    onChange={(e) => setPatient((p) => ({ ...p, givenNames: e.target.value }))}
                    data-testid="new-agreement-given-names"
                  />
                )}
              </Field>

              {/*
                THREE PICKERS, exactly as the kiosk and the portal use — the
                same helpers, so a date typed at the desk and a date chosen by
                a patient compose identically and neither can send a
                half-filled one.
              */}
              <Field label={strings.newAgreement.dateOfBirth} required>
                {(props) => (
                  <SelectInput
                    {...props}
                    aria-label={strings.newAgreement.dayLabel}
                    value={patient.dateOfBirth.day}
                    onChange={(e) =>
                      setPatient((p) => ({ ...p, dateOfBirth: { ...p.dateOfBirth, day: e.target.value } }))
                    }
                    data-testid="new-agreement-dob-day"
                  >
                    <option value="">{strings.newAgreement.dayLabel}</option>
                    {dayOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field label={strings.newAgreement.monthLabel}>
                {(props) => (
                  <SelectInput
                    {...props}
                    value={patient.dateOfBirth.month}
                    onChange={(e) =>
                      setPatient((p) => ({ ...p, dateOfBirth: { ...p.dateOfBirth, month: e.target.value } }))
                    }
                    data-testid="new-agreement-dob-month"
                  >
                    <option value="">{strings.newAgreement.monthLabel}</option>
                    {monthOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field label={strings.newAgreement.yearLabel}>
                {(props) => (
                  <SelectInput
                    {...props}
                    value={patient.dateOfBirth.year}
                    onChange={(e) =>
                      setPatient((p) => ({ ...p, dateOfBirth: { ...p.dateOfBirth, year: e.target.value } }))
                    }
                    data-testid="new-agreement-dob-year"
                  >
                    <option value="">{strings.newAgreement.yearLabel}</option>
                    {yearOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>

              <Field label={strings.newAgreement.address} hint={strings.newAgreement.addressHint} required>
                {(props) => (
                  <TextInput
                    {...props}
                    value={patient.address}
                    maxLength={500}
                    onChange={(e) => setPatient((p) => ({ ...p, address: e.target.value }))}
                    data-testid="new-agreement-address"
                  />
                )}
              </Field>
              <Field label={strings.newAgreement.mobile} hint={strings.newAgreement.contactHint}>
                {(props) => (
                  <TextInput
                    {...props}
                    value={patient.mobile}
                    maxLength={30}
                    onChange={(e) => setPatient((p) => ({ ...p, mobile: e.target.value }))}
                    data-testid="new-agreement-mobile"
                  />
                )}
              </Field>
              <Field label={strings.newAgreement.email}>
                {(props) => (
                  <TextInput
                    {...props}
                    value={patient.email}
                    maxLength={320}
                    onChange={(e) => setPatient((p) => ({ ...p, email: e.target.value }))}
                    data-testid="new-agreement-email"
                  />
                )}
              </Field>
            </div>
          )}

        {/*
          ALWAYS ASKED, FOR EVERY PATIENT. It is the practice's own handle and
          the key an arrival is matched on, so a record already holding one
          shows it and a record without one finally gets it here.

          NOTE WHAT IS NOT BESIDE IT: there is no Medicare card number field on
          this form, and there is no hint that mentions one. The card number is
          not an identity identifier (hard rule 1, REQ-VER-02).
        */}
        <Field
          label={strings.newAgreement.recordNumber}
          hint={strings.newAgreement.recordNumberHint}
          required
        >
          {(props) => (
            <TextInput
              {...props}
              value={patient.recordNumber}
              maxLength={100}
              onChange={(e) => setPatient((p) => ({ ...p, recordNumber: e.target.value }))}
              data-testid="new-agreement-record-number"
            />
          )}
        </Field>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section number={2} title={strings.newAgreement.providerHeading}>
        <p className={ui.hint}>{strings.newAgreement.providerHint}</p>

        {choices !== null && choices.length === 0 ? (
          <Notice tone="warn" title={strings.newAgreement.providerHeading} data-testid="new-agreement-no-providers">
            <p>{strings.newAgreement.providerNone}</p>
            <p className={ui.hint}>
              <Link href="/practice/affiliations" data-testid="new-agreement-to-affiliations">
                {strings.newAgreement.providerToAffiliations}
              </Link>
            </p>
          </Notice>
        ) : (
          <Field label={strings.newAgreement.providerLabel} required>
            {(props) => (
              <SelectInput
                {...props}
                value={affiliationId}
                onChange={(e) => setAffiliationId(e.target.value)}
                data-testid="new-agreement-provider"
              >
                <option value="">{strings.newAgreement.providerPlaceholder}</option>
                {(choices ?? []).map((choice) => (
                  <option key={choice.affiliationId} value={choice.affiliationId}>
                    {choice.locationLabel
                      ? strings.newAgreement.providerAt(choice.name, choice.locationLabel)
                      : choice.name}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section number={3} title={strings.newAgreement.visitHeading}>
        <div className={styles.addGrid}>
          <Field label={strings.newAgreement.serviceDate} hint={strings.newAgreement.serviceDateHint} required>
            {(props) => (
              <TextInput
                {...props}
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                data-testid="new-agreement-service-date"
              />
            )}
          </Field>

          <Field
            label={strings.newAgreement.serviceDescription}
            hint={
              descriptions ? strings.newAgreement.serviceDescriptionHint(descriptions.version) : undefined
            }
          >
            {(props) => (
              <SelectInput
                {...props}
                value={serviceDescription}
                onChange={(e) => setServiceDescription(e.target.value)}
                data-testid="new-agreement-service-description"
              >
                <option value="">{strings.newAgreement.serviceDescriptionDefault}</option>
                {(descriptions?.descriptions ?? []).map((description) => (
                  <option key={description} value={description}>
                    {description}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
        </div>

        {descriptions && descriptions.defaultDescription === null && serviceDescription === '' && (
          <p className={ui.hint} data-testid="new-agreement-no-default">
            {strings.newAgreement.serviceDescriptionNone}
          </p>
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section number={4} title={strings.newAgreement.signingHeading}>
        <p className={ui.hint}>{strings.newAgreement.signingSelfHint(MIN_AGE_SELF_ASSIGN)}</p>

        <div className={styles.formActions}>
          <Button
            variant={who.isPatient ? 'primary' : 'subtle'}
            onClick={() => setWho(EMPTY_WHO)}
            data-testid="new-agreement-who-patient"
          >
            {strings.newAgreement.signingPatient}
          </Button>
          <Button
            variant={who.isPatient ? 'subtle' : 'primary'}
            onClick={() => setWho((w) => ({ ...w, isPatient: false }))}
            data-testid="new-agreement-who-other"
          >
            {strings.newAgreement.signingOther}
          </Button>
        </div>

        {!who.isPatient && (
          <div className={styles.addGrid} data-testid="new-agreement-who-panel">
            <Field label={strings.newAgreement.signingName} required>
              {(props) => (
                <TextInput
                  {...props}
                  value={who.name}
                  maxLength={200}
                  onChange={(e) => setWho((w) => ({ ...w, name: e.target.value }))}
                  data-testid="new-agreement-who-name"
                />
              )}
            </Field>

            {/*
              THE RELATIONSHIP, NOT THE AUTHORITY BASIS. The person at the desk
              knows they are a grandparent; they do not know whether that makes
              them a "co-resident relative 18+". The options and their ORDER
              come from `assignor-relationships.json` — versioned content, so
              the list and the legal mapping behind it change without a code
              change (hard rule 14, CLAUDE.md §7). Only the WORDS are ours.
            */}
            <Field label={strings.newAgreement.signingRelationship} required>
              {(props) => (
                <SelectInput
                  {...props}
                  value={who.relationship}
                  onChange={(e) => setWho((w) => ({ ...w, relationship: e.target.value }))}
                  data-testid="new-agreement-who-relationship"
                >
                  <option value="">{strings.newAgreement.signingRelationshipPlaceholder}</option>
                  {ASSIGNOR_RELATIONSHIP_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {relationshipLabel(option.key)}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>

            {relationshipNeedsFreeText(who.relationship) && (
              <Field label={strings.newAgreement.signingDescribe} required>
                {(props) => (
                  <TextInput
                    {...props}
                    value={who.describe}
                    maxLength={80}
                    onChange={(e) => setWho((w) => ({ ...w, describe: e.target.value }))}
                    data-testid="new-agreement-who-describe"
                  />
                )}
              </Field>
            )}

            {/*
              REQ-AGE-01 — A DECLARATION, AND THE THRESHOLD IS NEVER TYPED
              HERE. `MIN_AGE_ASSIGN_FOR_OTHER` comes from the domain, because
              it has moved once already. Nothing asks for or stores a date of
              birth for this person (REQ-VUL-02).
            */}
            <Checkbox
              checked={who.declaredOfAge}
              onCheckedChange={(checked) => setWho((w) => ({ ...w, declaredOfAge: checked }))}
              label={strings.newAgreement.signingAge(MIN_AGE_ASSIGN_FOR_OTHER)}
              hint={strings.newAgreement.signingAgeHint}
            />

            <Field label={strings.kiosk.assignor.mobileLabel} hint={strings.newAgreement.signingContactHint}>
              {(props) => (
                <TextInput
                  {...props}
                  value={who.mobile}
                  maxLength={30}
                  onChange={(e) => setWho((w) => ({ ...w, mobile: e.target.value }))}
                  data-testid="new-agreement-who-mobile"
                />
              )}
            </Field>
            <Field label={strings.kiosk.assignor.emailLabel}>
              {(props) => (
                <TextInput
                  {...props}
                  value={who.email}
                  maxLength={320}
                  onChange={(e) => setWho((w) => ({ ...w, email: e.target.value }))}
                  data-testid="new-agreement-who-email"
                />
              )}
            </Field>
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section number={5} title={strings.newAgreement.decisionHeading}>
        <p className={ui.hint}>{strings.newAgreement.decisionLead}</p>

        <div data-testid="new-agreement-decision">
          {affiliationId.length === 0 || patient.recordNumber.trim().length === 0 ? (
            <p className={ui.hint}>{strings.newAgreement.decisionNeedsProvider}</p>
          ) : previewing && preview === null ? (
            <p className={ui.hint}>{strings.newAgreement.decisionAsking}</p>
          ) : preview?.blocked ? (
            <Notice
              tone="stop"
              title={strings.newAgreement.decisionBlockedTitle}
              data-testid="new-agreement-decision-blocked"
            >
              {/*
                THE REASON, AND WHAT FIXES IT, ON THE ITEM — never a sentence
                pointing at another screen. An UNMAPPED code shows itself so it
                can be diagnosed rather than swallowed (CLAUDE.md §7).
              */}
              {strings.newAgreement.decisionBlocked[preview.blocked.reason]
                ? strings.newAgreement.decisionBlocked[preview.blocked.reason]!(
                    preview.providerName ?? '',
                    preview.blocked.billingRole
                      ? (strings.billingRoles.names[preview.blocked.billingRole] ??
                        preview.blocked.billingRole)
                      : '',
                  )
                : strings.newAgreement.decisionBlockedUnknown(preview.blocked.reason)}
            </Notice>
          ) : preview?.decision ? (
            <>
              <p className={ui.hint} data-testid="new-agreement-decision-line">
                {preview.decision.type === 'enduring'
                  ? strings.newAgreement.decisionEnduring(preview.providerName ?? '')
                  : preview.decision.type === 'episodic_pre'
                    ? strings.newAgreement.decisionEpisodic
                    : strings.newAgreement.decisionNone(preview.providerName ?? '')}
              </p>
              {/* Hard rule 14: which table gave that answer. */}
              <p className={ui.hint} data-testid="new-agreement-decision-version">
                {strings.newAgreement.decisionVersion(preview.policyVersion)}
              </p>
              {preview.decision.type === 'none' && preview.coveringAgreementId && (
                <p className={ui.hint}>
                  <Link
                    href={`/practice/patients/${patient.chosen?.patientId ?? ''}`}
                    data-testid="new-agreement-decision-covered-link"
                  >
                    {strings.newAgreement.decisionNoneOpen}
                  </Link>
                </p>
              )}
            </>
          ) : (
            <p className={ui.hint}>{strings.newAgreement.decisionNeedsProvider}</p>
          )}
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      {blocked.length > 0 && (
        <Notice tone="warn" title={strings.newAgreement.submitBlockedTitle} data-testid="new-agreement-blocked">
          <ul>
            {blocked.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className={styles.formActions}>
        <Button
          variant="primary"
          disabled={!canAct || busy || blocked.length > 0}
          onClick={() => void submit()}
          data-testid="new-agreement-submit"
        >
          {busy ? strings.newAgreement.submitting : strings.newAgreement.submit}
        </Button>
        <Button onClick={onClose} data-testid="new-agreement-cancel">
          {strings.newAgreement.close}
        </Button>
      </div>
    </div>
  );
}

/** "1957-03-14" back into the three parts the pickers hold. */
function partsOf(iso: string): DateOfBirthParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return { day: '', month: '', year: '' };
  return { year: match[1]!, month: match[2]!, day: match[3]! };
}

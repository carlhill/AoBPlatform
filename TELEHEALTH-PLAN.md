# TELEHEALTH-PLAN.md: telehealth consultations, and the DB4 sent to the patient's phone

**Status:** planned 11 Oct 2026. Not yet built. The five design answers are
**D-2026-10-11-07**; the exceptions and the two scenarios are
**D-2026-10-11-08**. Section 5c lists other scenarios that Claude has proposed
and Carl has **not yet ruled on**.
**Replaces:** the TODO.md entry "Telehealth: the call IS the acceptance"
(22 Aug 2026). The call does not run in our app.
**Extends:** DB4-AND-AOBL.md §11 (14 Sep 2026: the post-service DB4 goes out by
link, and the form says TELEHEALTH where the rubber stamp went). This adds a
step before the consultation, which §11 left as "offer it; do not assume it".

---

## 1. The problem, in Carl's words

*"TeleHealth appointments - currently there is no way to audit this appointment
type."* The patient is not in the building. Nobody sees them at the desk and no
tablet is handed over, so today the practice prints the DB4 and stamps it
TELEHEALTH, and there is no evidence of who was on the call.

The plan gives a telehealth consultation two pieces of evidence:
- **Before the consultation:** a record that the identified patient (or carer)
  agreed to a telehealth consultation with this doctor, at this time.
- **After the consultation:** the same Signed-DB4 the kiosk produces, signed on
  the patient's own phone.

**And it gives reception the second thing for free.** The page that shows a DB4
on the patient's phone is also how reception follows up a DB4 that was never
signed at the practice: the patient left, the internet was down, or anything
else.

## 2. The decisions (Carl, 11 Oct 2026)

| # | Question | Decided | Why |
|---|---|---|---|
| 1 | What is the step before the consultation, legally? | **A record that the patient agreed to a telehealth consultation. It is NOT an assignment of benefit and NOT a pre-agreement (s 65C(4) item 5).** | The audit trail Carl asked for, with no service details needed. The DB4 after the call stays the one agreement, so nobody signs twice. Powell St is post-only (DB4-AND-AOBL §11a), and the DB4E is post-only. |
| 2 | Who checks identity on a live call? | **The doctor, on the call. That check plus the 6-digit code replaces the patient typing three identifiers, for the live call only.** | RACGP C6.1 covers identifying patients over the telephone. The in-practice flow already records "checked by staff, and which staff member" (REQ-VER-03). The code shows that whoever opened the link can hear the call. |
| 3 | Where does the link go? | **The mobile or email already on the patient's record (or the carer's), only.** The doctor reads back the masked number ("ending 412?"). If it is wrong, it is corrected in PracSoft and syncs through. | D-2026-09-11-03 holds: the practice's PMS is the source of record, and a contact is never typed in to send one link. |
| 4 | One link or two? | **One page for the whole consultation.** It waits after the patient agrees, and the DB4 appears on it at the end, as it does when the desk sends to the tablet. | No second link, no second code, and nothing for the patient to find in their messages at the end of the call. |
| 5 | Languages | **Built in from the start, English first.** Each language is added as content when its professional translation arrives. **The screen is translated; the Signed-DB4 stays the English DB4**, with a translated reading page vaulted beside it. | REQ-LANG-01/-03/-04. The second half amends REQ-LANG-02 (side by side on the form), because Powell St wants the exact same DB4 (D-2026-09-14-02). |

**Carl's standing note: "We always have exceptions to the process."** Every
step below has a way past it that is recorded rather than blocked (hard rule 8).

## 3. The flow: the doctor at the practice, in hours (scenario A)

1. **The patient calls, or the doctor calls them back.** We do not run the call.
   Phone or video, any platform.
2. **The doctor opens Telehealth in the practitioner console** and picks the
   patient (from the PMS sync).
3. **The doctor checks identity on the call** and ticks which identifier types
   they checked. They tick types, never values (hard rule 9), from the approved
   set; the Medicare number is not one of them (hard rule 1).
4. **The doctor reads back the masked contact on file** and chooses SMS, email or
   both. The patient may be a carer, signing for the patient under the signer
   rules (ASSIGNOR-RULES; 18+ when signing for someone else).
5. **The doctor presses Send.** The doctor's screen shows a 6-digit code. The
   message holds the link and **never** the code.
6. **The patient opens the link.** First they choose a language, then they enter
   the code the doctor reads out.
7. **The page shows the practice and the doctor** and one statement, with one
   button, e.g. *"Yes, start my telehealth consultation with Dr Smith"*. The
   word "approve" is not used: it is banned of our forms (hard rule 12) and it
   suggests the patient is permitting something that gates care.
8. **The doctor's screen updates live:** code entered, then agreed. The doctor
   proceeds with the consultation.
9. **The patient's page now says it is waiting for Dr Smith** and stays open.
10. **At the end of the consultation, the DB4 is printed to AOBPRINTER as today**
    (by the doctor or reception). The platform matches it to the open
    telehealth session (same patient, same practitioner, same day) and marks it
    `deliveryMode: telehealth`, so the Signed-DB4 says TELEHEALTH.
11. **The doctor presses "Send DB4 to the patient's page".** The DB4 appears
    there: the kiosk's measured DB4 sheets, the ticks, the signature pad, the
    same render path (hard rule 13), the amount as PracSoft printed it (hard
    rule 4 as narrowed).
12. **The patient signs.** The doctor's screen says so, and the doctor ends the
    call. The patient is offered a copy to the contact on file.

**If the page was closed** (the patient hung up, or the phone locked and dropped
the page), the doctor sends a fresh link and a new code. The session is the
same one.

## 4. Exceptions to the step before the consultation (Carl)

**The doctor decides.** In an emergency, or wherever the patient or carer cannot
do the step before the consultation, the doctor marks it **not done, with a
reason**, and the consultation goes ahead. The patient or carer then does only
the DB4 afterwards.

- **The reasons are a versioned option list** under `packages/domain/content/`,
  with labels in the string table (project rule: option lists are content).
- **Starting list:** `emergency`, `language_barrier`, `technology_gap` (no
  smartphone, cannot use one), `no_contact_on_file`, `patient_declined_link`,
  `doctor_without_access` (scenario B, the doctor could not open AoBPlatform),
  `other`.
- **`other` takes a short note.** The note is free text, so the screen says not
  to put identifiers in it.
- **The time it was recorded is kept**, as well as the consultation time the
  doctor states. A reason recorded the next morning is honest about being
  recorded the next morning.

**The DB4 afterwards can have exceptions too.** These are the existing
fallbacks, not new ones: the reconciliation chase (§5b), paper (REQ-CAP-04),
and verbal until 30 June 2027 (hard rule 5; risk-flagged, and off after that
date). After 30 June 2027, a patient who can never do the DB4 leaves the
record outstanding. That is the practice's billing risk to manage, and the
platform says so honestly rather than inventing a path.

## 5. Scenarios

### 5a. A: the doctor at the practice, in hours

Section 3. The DB4 goes to the patient's page before the call ends.

### 5b. B: the doctor outside the practice, or outside business hours (Carl)

The doctor may not have PracSoft, and nobody is at the desk. **The DB4 is sent
the next day**, after the doctor has updated the PMS, and reception contacts the
patient or carer.

1. **The step before the consultation can still happen live.** It needs only the
   AoBPlatform console (passkey sign-in, on a laptop or phone), not PracSoft. If
   the doctor cannot open it, they record it the next day as not done,
   `doctor_without_access`.
2. **The session stays open**, marked "consultation done, waiting for the DB4".
3. **Next day:** the doctor updates PracSoft, and the DB4 is printed to
   AOBPRINTER. The platform matches it to the open session, which gives it
   `deliveryMode: telehealth`.
4. **Reception follows up, in one of two ways:**
   - **By phone (the live path again):** reception checks identity on the call
     and reads out a new code. This is decision 2 with reception as the checker,
     recorded with the reception staff member.
   - **By link only (nobody on the phone):** the patient types three identifiers
     (REQ-VER-03), as every other link does today.
5. **Unsigned DB4s fall into the reconciliation queue and the post-service
   chase** as they do now.

**This is the same machinery as Carl's second requirement**: reception following
up any DB4 that was not signed at the practice.

### 5c. Other scenarios: proposed by Claude, NOT yet ruled by Carl

| # | Scenario | Proposed handling |
|---|---|---|
| C1 | **An enduring agreement already covers this doctor and patient** | No DB4 is sent. The panel says it is covered. 89AA notices stay one-way and are never chased (hard rules 6 and 7). |
| C2 | **The consultation does not go ahead after the patient agreed** (cancelled, unreachable) | The doctor marks the session "did not proceed". No DB4 is expected and nothing is chased. |
| C3 | **The patient declines to sign the DB4** | Recorded as declined. The practice bills by its own process, and the platform never blocks care (hard rule 8). |
| C4 | **An interpreter is on the call** (TIS National) | Recorded as interpreter-assisted (REQ-LANG-06), rather than marking the step "not done, language barrier", when the patient can still complete it with help. |
| C5 | **Two patients on one call** (a parent and child) | One session, one code and one DB4 each. A carer may hold several sessions at once. |
| C6 | **The DB4 names a different practitioner from the session** (a handover) | It does not auto-match. The desk links it by hand, and both practitioners are on the record. |
| C7 | **A session never gets a DB4** (the service was never billed) | After N days, the session appears in reconciliation as "telehealth consultation with no DB4". This is the audit gap Carl started from, and it feeds the PMS / AOBPRINTER / AoBPlatform reconciliation TODO. |
| C8 | **No mobile or email on file** | The step before is "not done, `no_contact_on_file`". Reception updates PracSoft, and scenario B's follow-up applies. |
| C9 | **The patient opens the link on the same phone they are talking on** | The page must work alongside a call: short, large buttons, and the code readable back after switching apps. This is a design constraint, not a branch. |

## 6. What exists, and what is new

**Reused:**
- `sms_link` / `email_link`, the link token routes (`/verify/[token]`,
  `/agree/[token]`), `openLink` / `verifyLink`, and contact-on-record;
- the reconciliation queue's send action (`ReconciliationView`, `channelFor`) and
  the post-service chase sweep;
- the kiosk's measured DB4 sheets, ticks and signature pad (`rules/db4-pages.ts`,
  `ParticularsScreen`, `SignaturePad`);
- the Signed-DB4 render path, the vault, and the write-back pull;
- live refresh on the console (`useLiveRefresh`).

**New:**
1. **The link page shows the DB4 sheets.** Today the link pages render the
   general agreement, not the DB4. This is needed by both telehealth and
   reception's follow-up, so it comes first. **Built 12 Oct 2026** on
   `feat/link-page-db4-sheets` (D-2026-10-12-01, assumptions for Carl to
   confirm).
2. **A telehealth session** record: patient, practitioner, the identifier types
   checked and by whom, channel, and states (opened, code checked, agreed or
   not done with a reason, DB4 matched, sent, signed, did not proceed).
3. **The 6-digit code:**
   - made with a secure random generator and stored hashed;
   - valid for about 10 minutes, and single-use;
   - locks after a few wrong attempts and tells the practice;
   - never in the message.
   The link stays practice-branded, single-use and non-enumerable (REQ-VER-05).
4. **The doctor's Telehealth panel** in the practitioner console.
5. **The waiting page** that receives the DB4 when the doctor sends it.
6. **Matching a DB4 Print Record to an open session**, and `deliveryMode:
   telehealth` with the printed word (TODO piece 3).
7. **The language layer:**
   - strings keyed by language;
   - the picker;
   - right-to-left layout for Arabic;
   - messages in the patient's language with an English line (REQ-LANG-04);
   - the translated reading page vaulted beside the Signed-DB4.
8. **Vault events for the session.** Additions to `VAULT_EVENT_TYPES` need human
   approval (the vault is a human-authored zone).
9. **Later: notifications on the doctor's phone (web push), with no app.** A
   watch gets them free if it mirrors the phone. This probably needs a new
   dependency, which needs asking first.

## 7. Hard rules this touches

- **1 and 9:** identifier types only, never values; the Medicare number is not on
  the doctor's checklist.
- **2:** the DB4 comes from the invoice, so it is complete before it reaches the
  page.
- **4:** the amount appears only as PracSoft printed it.
- **5:** verbal capture works as a fallback only until 30 June 2027.
- **6 and 7:** scenario C1.
- **8:** every step has a recorded way past it.
- **10:** the carer signs under the signer rules.
- **12:** no "approve".
- **13:** same render path.
- **14:** the consent wording and the reasons list are versioned content.
- **15:** the doctor's console is passkey-only.

## 8. Order of work

1. **The link page shows the DB4 sheets.** This delivers reception's follow-up on
   its own.
2. **The telehealth session, the code, the consent page, the doctor's panel with
   live status, and the "not done" reasons.**
3. **The DB4 into the waiting page.** Scenario A complete.
4. **Next-day matching, and reception's phone follow-up.** Scenario B complete.
5. **The language layer.** This can start alongside step 1, and every string
   added in steps 1–4 goes into it from the start. Translations arrive as
   content.
6. **Push notifications to the doctor's phone.**

**Before production:**
- ACMA sender ID registration (REQ-VER-05);
- Carl's go-ahead for any real SMS or email (development uses the test gateway);
- approval of the vault event types;
- **ask Powell St what share of their bulk-billed services are telehealth**
  (VERSION-2 item 1).

## 9. Open questions

- **Does the step before the call make the agreement a pre-agreement?** The
  research (`TELEHEALTH-RULES-RESEARCH.md`) found that a post-agreement is one
  that neither party offers until after the service. If the patient's
  agreement to a telehealth consultation reads as an offer to assign, the DB4
  afterwards could count as a pre-agreement, which needs different
  particulars. **Until the Department answers (GOVERNMENT-QUESTIONS.md G10),
  the consent statement must not mention bulk billing, Medicare, the
  assignment or the DB4.** It is about the consultation only.
- **Scenario B and the practitioner's address.** A post-agreement carries the
  provider's name and either the address they practise from at the time or
  their provider number. A doctor consulting from home would carry the
  provider number. Confirm which number (G31).
- **The 5c scenarios:** Carl to rule.
- **Do the session states need an expiry?** For example, a session waiting for
  its DB4 longer than N days becomes C7. N is not decided.
- ~~**How a link sent to an unsigned draft interacts with the 7-day closure**
  (D-2026-10-10-09): a link sent on day 6 would die at closure. Check when step
  1 is built.~~ Checked 12 Oct 2026: it does not, for a DB4. The closure sweep
  never closes an agreement with a service record or an open, unexpired
  capture request, and a DB4 agreement has both (D-2026-10-12-01 item 7).
- **The wording of the consent statement and of the "not done" reasons** in
  English, before translation.

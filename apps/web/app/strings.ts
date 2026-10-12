/**
 * String table (REQ-LANG-01): every user-facing string lives here, none
 * inline in components. en-AU only for now; the multilingual pipeline (M14)
 * replaces this module with the real string-table architecture — keeping the
 * discipline from the first screen means no inline-string hunt later.
 * UK/AU spelling throughout (CLAUDE.md §3).
 *
 * A refusal message that the SERVER also emits is imported from the domain
 * rather than retyped here. The rule and its wording are one thing: if the form
 * says "same handset" and the API says something else, the applicant has been
 * told two different stories about one refusal. Importing keeps REQ-LANG-01
 * true — this module is still the only place a component reads text from — and
 * keeps the wording single-sourced with the rule that produces it.
 */
import { CONTACT_CLASH_MESSAGES, type AgreementType } from '@aobplatform/domain';

/**
 * THE WORDS FOR THE TWO IDS, HOISTED OUT OF THE TABLE SO THEY CAN BE REUSED
 * INSIDE IT (Carl, 12 September 2026: *"ok. In that case show both ids."*).
 *
 * An object literal cannot refer to itself while it is being built, and
 * `strings.frontdesk.panel` has to hand back exactly these words rather than a
 * second copy of them — two surfaces printing one person's identifiers
 * differently is the whole bug this fixes. So they are declared once, here,
 * and the table exposes them as `strings.recordId`.
 */
const recordIdWords = {
    /*
     * "AoBPlatform record ID", NOT "Patient ID" (Carl, 12 September 2026, with
     * both screens side by side: *"Patient ID is on frontdesk it is diff - see
     * both images"*).
     *
     * TWO DIFFERENT THINGS WERE WEARING ONE LABEL. The front desk says
     * "Patient ID DEV-JO-EXAMPLE" -- the PRACTICE's own number for that person,
     * the one reception reads out and types into their own software. This says
     * "Patient ID 37386834-6ffa-..." -- a value THIS platform minted, for a
     * support ticket. A receptionist reading both would reasonably conclude one
     * of them was wrong, and neither is.
     *
     * The practice's number keeps the plain words, because it is the one that
     * means something to a person. Ours says whose record it is.
     */
    patient: 'AoBPlatform record ID',
    /*
     * AND THE PRACTICE'S OWN NUMBER, WHICH GOES ABOVE IT ON EVERY SURFACE
     * (Carl, 12 September 2026: *"patientid is diff on /tablet and
     * /frontdesk"*, then *"ok. In that case show both ids."*).
     *
     * WHY THE WORDS LIVE HERE RATHER THAN ON A PAGE. The complaint was never
     * that either value was wrong — it was that two screens a receptionist
     * uses in the same minute disagreed about WHICH ONE to show. A second pair
     * of words per surface is how that comes back, so there is one pair and
     * every surface reads it (`PatientIdentity`).
     *
     * "Patient ID" IS WHAT A PRACTICE CALLS IT, and it is an APPROVED
     * identifier — the s 65C set is name, date of birth, gender, address,
     * patient record number and IHI (hard rule 1, REQ-VER-02). It is not a
     * Medicare card number, there is no column for one, and nothing here may
     * ever be pointed at one.
     */
    /*
     * "PMS PATIENT ID" SINCE 11 OCTOBER 2026 (Carl: *"is this the PMSPatientID?
     * If so lets call it that and not the ChartNumber"*; D-2026-10-11-06). It
     * is the practice's own number for the patient in their PMS — PracSoft
     * prints it as "Chart Number" — and we store it as `patientRecordNumber`,
     * the s 65C approved identifier's own name, which is why the CODE keeps
     * that name and only the words change.
     */
    practiceNumber: (number: string) => `PMS patient ID ${number}`,
    /*
     * SAID, RATHER THAN LEFT BLANK. A record that reached us by a route that
     * never carried the practice's number is an ordinary thing, and an empty
     * line under a name reads as a page that failed to load. Our own record id
     * needs no twin: it always exists.
     */
    practiceNumberUnknown: 'No PMS patient ID on this record',
    /*
     * AOBPRINTER'S OWN REFERENCE (Carl, 28 September 2026: *"we need the
     * AOBPrinter unique key probably after AoBPlatform record ID"*).
     *
     * IT IS THE ONE IDENTIFIER THAT CROSSES THE WIRE BOTH WAYS. There is no
     * file path and never was (8.2, provenance without possession): the
     * SHA-256 of the source print job is what AOBPRINTER knows the page by,
     * what our `@@unique([practiceId, documentType, sourceSha256])` knows it
     * by, and therefore the only thing a support ticket can name that both
     * ends can find. It rode on a refusal and nowhere else; a row does not
     * have to be broken for somebody to need it.
     *
     * NAMED FOR THE THING THAT MADE IT rather than for the hash it is. A
     * receptionist reading three ids in a column needs to know which end
     * each one belongs to.
     */
    printRecord: 'AOBPrinter reference',
    /*
     * THE ACCESSIBLE NAME ON THE DISCLOSURE THAT HOLDS THEM (Carl, 28
     * September 2026: *"Can these ids be put in an expander so the screen
     * looks less busy and less technical"*).
     *
     * THE PRACTICE'S NUMBER STAYS ON SCREEN AND IS ITSELF THE SUMMARY. It is
     * the one identifier that is not technical -- the handle reception reads
     * out (12 Sep 2026) -- so folding it away would take the useful one and
     * leave the row naming nobody. What folds is the hexadecimal: our record
     * id and AOBPRINTER's reference.
     *
     * THE VISIBLE WORDS ARE CONTAINED IN THE SPOKEN ONES (WCAG 2.2, 2.5.3
     * Label in Name), which is why this takes the visible text rather than
     * replacing it.
     */
    identifiersLabel: (visible: string) => `${visible} — show the record identifiers`,
    copy: 'Copy',
    copied: 'Copied',
    /** The accessible name on the copy control, so it is not twelve buttons all called "Copy". */
    copyLabel: (label: string) => `Copy ${label}`,
} as const;

export const strings = {
  appName: 'AoBPlatform',
  /**
   * THE RECORD LINE — "which record has the issue" (Carl, 7 Sep 2026).
   *
   * Every page that is ABOUT a patient names the patient's AoBPlatform id, in
   * full, quietly, with a copy button. It is the diagnostic handle a support
   * call and a test run both need: reception, the tablet, the vault events and
   * the console rows all name the same row, and until now nothing on screen
   * said which row that was.
   *
   * AN OPAQUE ID IS NOT A PERSONAL DETAIL. It is a value this platform minted;
   * it is never a Medicare number (hard rule 1 — there is no column for one
   * anywhere in this system), never an IHI, and never a record number belonging
   * to somebody else's system. The same reasoning the tablet's session id
   * already carries.
   *
   * IN FULL, NEVER TRUNCATED (Carl: "so we can see which record has the issue.
   * Also helps with testing"). A shortened id is something to compare by eye; a
   * full one is something to match exactly, which is what a support ticket
   * needs — hence the copy button, which writes to the clipboard and persists
   * nothing anywhere.
   */
  recordId: recordIdWords,
  auth: {
    /*
     * A TOKEN WITH NO ROLES. Not a permissions problem — a stale session that
     * keeps refreshing and can never regain what it was minted without.
     */
    staleToken: 'Sign in again',
    staleTokenHint:
      'Your session was issued before this realm was corrected and carries no roles, so anything you are '
      + 'entitled to do is hidden rather than refused. Signing in again fixes it.',
    signIn: 'Sign in with your passkey',
    /**
     * THE HONEST INTERIM AFTER A RELOAD (Carl, 7 Sep 2026, on pressing the
     * browser's reload on `/practice/setup`).
     *
     * The token is memory-only by design, so a reload starts the tab signed out
     * and a redirect then restores it from Keycloak's SSO session without
     * asking for anything. For that second the bar offered "Sign in" and the
     * gate said "sign in again" — which reads as "I have been signed out", and
     * nobody had been.
     *
     * IT PROMISES ONLY WHAT IT IS DOING. Not "please wait", not "loading" — the
     * one fact that matters is that nobody is being asked for anything and the
     * session is coming back. If it turns out not to be, the ordinary
     * signed-out state takes over (`silentRestoreInFlight`, auth.ts).
     */
    signingBackIn: 'Signing you back in…',
    /**
     * A RESTORE THAT WAS REFUSED, AND WHY (Carl, 7 Sep 2026).
     *
     * "You are not signed in. This page shows real records…" is written for
     * somebody who has never been here. Carl HAD been, minutes earlier —
     * Keycloak's SSO session had idled out — so the generic gate described the
     * state and hid the cause, and left him with no idea why it kept happening.
     *
     * IT NAMES THE RULE AND THE WAY BACK. The number is the REALM's, read from
     * the environment (`sessionIdleMinutes`, auth.ts) rather than typed here: a
     * confident "30 minutes" beside a realm set to 240 is a lie, and the realm
     * is the thing that moves.
     *
     * AND IT PROMISES THE RETURN, because that is the part somebody hesitates
     * over — signing in again looks like losing the page they were on, and it
     * is not (`returnPath`, and the landing rule behind it).
     *
     * ONLY FOR A BROWSER THAT HAS SIGNED IN HERE. One that never has keeps the
     * generic copy, which is true of it.
     */
    restoreRefusedHeading: 'Your earlier sign-in has ended',
    restoreRefusedBody: (minutes: number) =>
      `Sign-ins end after ${minutes} minutes without activity. Sign in again with your passkey — `
      + 'you will come back to this page afterwards.',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    signedOut: 'Not signed in — the console is running in development mode.',
    passkeyNote:
      'Practitioner and admin sign-in requires a passkey. There is no password option, by design (REQ-VAULT-04).',
    completing: 'Completing sign-in…',
    failed: 'Sign-in failed:',
    noCode: 'No authorisation code in this response.',
    onboarding: 'Practitioner onboarding',
    inviteButton: 'Invite practitioner to enrol a passkey',
    inviteSent: 'Invitation sent — open Mailhog to follow the link:',
    noAccount: 'no account yet',
    accountReady: 'account created — passkey pending',
    signedOutTitle: 'Sign in to continue',
    signedOutBody:
      'This page lists every practice on the platform, so it needs to know who you are. Signing in binds ' +
      'what you do here to your name.',
    /** Shown above the username in the top bar when the session carries no practice. */
    platformUser: 'AoBPlatform',
    /** The session is scoped to a practice whose name has not loaded yet. */
    practiceLoading: 'Practice…',
    /*
     * A TAB LEFT OPEN PAST EXPIRY (Carl, 7 Sep 2026). `currentSession()`
     * self-expires; without this the top bar went on saying "signed in" long
     * after every write had quietly stopped carrying an Authorization header.
     * Shown ONLY when this tab held a session earlier — never on a page that
     * was never signed in, which would just be noise.
     */
    sessionExpiredNote: 'Your sign-in has expired',
    /** The same note, WITH a reason, when the background refresh that should
     *  have kept the session alive is known to have failed rather than simply
     *  never having run (auth.ts, `refreshFailureReason`). Keycloak's own
     *  error code only — `invalid_grant`, `invalid_client` — never a token. */
    sessionExpiredNoteWithReason: (reason: string) => `Your sign-in expired — renewal failed (${reason})`,
    /** Heading on the card shown ABOVE still-mounted page content when a
     *  session ends while the page is open — deliberately not the fuller
     *  gate.heading/gate.body copy, which is for a page that was never signed
     *  in at all. */
    expiredHeading: 'Sign in again to continue',
    expiredBody:
      'Your sign-in ended while this page was open. Nothing here has been lost — sign in again and pick up ' +
      'where you left off.',
  },
  gate: {
    heading: 'Sign in to the practice console',
    body:
      'The console holds practice configuration, practitioner identities and provider numbers. Signing in ' +
      'binds every approval, activation, invitation and notice to a named person.',
    scopeWarningHeading: 'What this gate does not do:',
    scopeWarning:
      'the core API is running with AUTH_ENFORCE=false, so it still accepts an x-practice-id header from ' +
      'anyone who can reach it. This stops a person browsing the console; it does not stop a request. ' +
      'Enforcing the API is a release gate, and it comes after the passkey ceremony has been proven on real ' +
      'hardware — otherwise it locks you out of the screens used to enrol a passkey.',
    scopedTo: 'Scoped to practice',
    tokenWins: 'the token’s practice claim overrides anything typed in the console.',
    noPracticeClaim:
      'This account carries no practice claim, so practice-scoped screens will use whatever id you select. ' +
      'A platform operator is expected to have none; a practice user is not.',
    bypassButton: 'Continue without signing in (development only)',
    bypassWhy: 'Present only in the local build, and never in a production one.',
    bypassActive: 'UNAUTHENTICATED — development bypass is active',
    bypassNote:
      'Nothing you do here is attributed to a signed-in person. Names typed into the console are recorded as ' +
      'given, but nothing has verified who typed them.',
    endBypass: 'End bypass',
  },
  gates: {
    heading: 'Three checks run on this application',
    checksum: 'The ABN itself',
    checksumIdle: 'Arithmetic, run here before anything is sent. Catches a mistyped digit in a moment.',
    register: 'The Australian Business Register',
    registerIdle: 'Must be ACTIVE, and the name you give must match a name registered against it.',
    human: 'A person reads it',
    humanIdle:
      'An active ABN and a matching name are necessary and not sufficient. Somebody here checks that you are ' +
      'entitled to act for this practice.',
    marks: {
      not_run: 'Not run',
      passed: 'Passed',
      failed: 'Failed',
      waiting: 'Waiting',
      attested: 'Attested',
    },
    registerAttested:
      'The register could not be reached, so these details were read from the ABN Lookup and typed by ' +
      'the applicant. The same rules ran against them. A reviewer will re-read the register.',
  },
  apply: {
    navApply: 'Apply',
    navHelp: 'Help',
    audience: 'Practice admin',
    title: 'Register your practice',
    lead:
      'Three checks run on what you enter: the ABN itself, the Australian Business Register, and then a person ' +
      'here reads the application. Nothing is approved by this form.',

    entityHeading: 'The entity',
    practiceName: 'Practice name — legal or trading name',
    practiceNameHint:
      'Either will do. Practices routinely trade under a name that is not their registered entity name, and we ' +
      'match against both.',
    abn: 'ABN',
    abnHint: 'Checked here before anything is sent.',
    abnInvalid: 'The check digits do not agree. This is arithmetic, so it is almost always a mistyped digit.',
    website: 'Practice website (optional)',
    websiteHint:
      'Fetched once, over https, with the certificate recorded. The page content is nearly worthless as ' +
      'evidence; the certificate is not.',
    headOfficeHeading: 'Head-office address',
    headOfficeHint:
      'Structured, not one line — every locality match downstream depends on it. Registered or administrative ' +
      'address; not a place of practice.',
    headOfficeIsPop: 'Patients are also seen at this address',
    headOfficeIsPopHint: 'Creates a location. Leave unticked and this address is recorded but cannot host a practitioner.',
    practitionerCount: 'How many practitioners does the practice have?',
    practitionerCountHint: 'Sets the invitation allowance. Tell us if the practice grows.',

    proofHeading: 'Proof this is a health practice',
    proofLead: 'Add as many as you hold. More proofs make the review faster; one is enough to apply.',
    proofNone:
      'There is no general practice licence for an Australian GP clinic. AHPRA registers INDIVIDUALS; practices ' +
      'are accredited and identified by HPI-O.',
    credentialType: 'Credential type',
    credentialValue: 'Number / reference',
    addProof: 'Add another proof',
    removeProof: 'Remove',

    contactsHeading: 'Who is applying',
    contactsLead:
      'Two named people, each reachable independently. This is what makes an application expensive to fake — ' +
      'and it gives the reviewer somebody to call who is not the person who applied.',
    you: 'You',
    yourManager: 'Your manager',
    soleTraderHint: 'Leave blank if you are a sole trader.',
    fullName: 'Full name',
    emailLabel: 'Email',
    adminEmailHint: 'The passkey invitation goes here. There is no password to choose.',
    phone: 'Direct phone',
    position: 'Position at the practice',
    contactClash: CONTACT_CLASH_MESSAGES,

    submit: 'Send the application',
    submitDisabled: 'Complete the required fields to send.',
    submitting: 'Sending…',

    cancelledTitle: 'This ABN is cancelled',
    cancelledBody:
      'The Australian Business Register records this ABN as cancelled, not active. A practice cannot be ' +
      'onboarded against a cancelled ABN, because the entity that would be assigning benefits does not ' +
      'currently exist.',
    cancelledFixOne: 'Check the number — a cancelled ABN is often a superseded one.',
    cancelledFixTwo: 'If the ABN was reinstated recently, the register may not have caught up. Try again tomorrow.',
    cancelledClose: 'Change the ABN',

    nameMismatchTitle: 'That name is not registered against this ABN',
    attestHeading: 'The register cannot be reached',
    attestLead:
      'Open the ABN Lookup and type in what it shows. Every check still runs against these values — the ABN ' +
      'must be ACTIVE, and the name must match. What changes is only who looked, and the record says it was you.',
    attestOpen: 'Open ABN Lookup',
    attestLegalName: 'Entity name, exactly as the register shows it',
    attestTradingNames: 'Registered business names (comma separated)',
    attestStatus: 'ABN status',
    attestEntityType: 'Entity type',
    attestEntityTypeHint:
      'Copy what the register shows. "The trustee for … Family Trust" is a TRUST, not a company — a trust has ' +
      'no ACN of its own, and choosing a company type will be refused.',
    attestSightedBy: 'Your name — you are attesting that you read the register',

    /*
     * THE ABN PREVIEW.
     *
     * Wording rule, and it is a hard one (REQ-65C-05): nothing here may say
     * certified, approved, accredited or government-approved. The register is
     * being QUOTED. "Checked against the Australian Business Register" is the
     * permitted form, and the entity being on the register is not an opinion
     * about the practice.
     */
    registerChecking: 'Checking the Australian Business Register…',
    registerFoundTitle: 'Checked against the Australian Business Register',
    registerStatusSince: 'since {date}',
    registerGstRegistered: 'registered for GST',
    registerBusinessNames: 'Registered business names',
    registerNoBusinessNames:
      'No registered business names against this ABN. That is ordinary — many practices have none, and the ' +
      'entity name above is what your practice name will be matched against.',
    registerTradingNamesNote:
      'Business names only. The register stopped collecting TRADING names in May 2012, so a name a practice ' +
      'has traded under for years may simply not appear here — that is a gap in the register, not a problem ' +
      'with your practice, and a reviewer can see it.',
    registerMainLocation: 'Main business location',
    registerMainLocationNote:
      'the register’s own location for the entity, which is often an accountant’s address — it is shown for ' +
      'recognition only and is never used as your head office.',

    registerNotFoundTitle: 'The register has no record of this ABN',
    registerNotFoundNext:
      'Check the number against the practice’s own paperwork and change it above. There is nothing to attest ' +
      'to here: the register has answered, and it says this ABN has not been issued.',

    registerUnavailableTitle: 'The register could not be checked just now',
    registerUnavailableSend:
      'Send the application anyway. It is checked again when it arrives, and if the register is still quiet ' +
      'you will be asked to type what it shows and sign your name to it.',
    registerUnknownReason:
      'The register answered with something this screen has no wording for. The code is {code} — quote it if ' +
      'you contact us, and send the application in the meantime.',

    /**
     * Server reason codes, mapped to what the applicant should understand.
     * An unmapped code falls through to `registerUnknownReason`, which shows
     * the code itself rather than hiding it.
     */
    abrReasons: {
      no_record: 'The check digits agree, but the Australian Business Register holds no entity against this ABN.',
      invalid_search_text: 'The register would not accept this as an ABN at all.',
      register_refused:
        'The register declined our request. This is a fault at our end, not with your ABN, and it is already ' +
        'logged for us to fix.',
      not_configured: 'This environment has no connection to the register configured, so nothing was asked.',
      timeout: 'The register did not answer in time.',
      network: 'We could not reach the register.',
      http_error: 'The register answered with an error.',
      unparseable: 'The register answered with something we could not read.',
      rate_limited:
        'You have checked a lot of ABNs from here in a short time, so we have paused the checks for a few ' +
        'minutes. It does not stop you sending the application.',
    } as Record<string, string>,

    sentTitle: 'Application sent',
    sentBody:
      'A person reads it next. You will hear from us either way, at the email above. There is nothing further ' +
      'to do now.',
    sentReference: 'Reference',
  },
  reviewerGate: {
    heading: 'Sign in to review applications',
    body:
      'These screens approve practices, and approving a practice is what opens consent capture. It is the ' +
      'most privileged act in the system, so it is done by a named person with a passkey \u2014 there is no ' +
      'password, and no way to set one.',

    signedInAs: 'Reviewing as',

    wrongRoleTitle: 'This account cannot review applications',
    wrongRoleBody:
      'You are signed in, but not as a platform administrator. These screens are for AoBPlatform staff who ' +
      'read applications and approve practices; a practice account is a different role with a different job. ' +
      'If you believe you should have access, ask whoever administers the platform \u2014 the role is granted ' +
      'by invitation, never by request from this screen.',

    // The limit of the gate, said rather than implied. A gate that looks
    // stronger than it is, is worse than no gate.
    scopeHeading: 'What this gate does, and does not do',
    scopeBody:
      'It stops a person browsing to these screens. It does not yet stop a REQUEST: while the core service ' +
      'runs with AUTH_ENFORCE=false it still accepts a practice header from anyone who can reach it. Turning ' +
      'that on is a release gate, and it comes after the passkey ceremony has been proven on real hardware.',

    bypass: 'Continue without signing in (development only)',
    bypassOnlyHere: 'Present only in the local build, and never in a production one.',
    bypassActive: 'Development bypass active',
    bypassNote: 'Nothing has been authenticated. Every name recorded from here identifies nobody.',
    endBypass: 'End the bypass',
  },
  review: {
    // --- Editing an approved practice from the dossier ---
    // NOTE the prefix. `amend*` above means "ask the APPLICANT to correct it";
    // `edit*` is the console changing the record directly. Different acts, by
    // different parties, so deliberately not near-identical names.
    editHeading: 'Correct the details',
    editLead:
      'The practice record, as it stands. The entity itself cannot be changed here — a different ABN is a ' +
      'different legal entity, and that is a new application rather than a correction.',
    editOpen: 'Correct these details',
    editCancel: 'Cancel',
    editSave: 'Save the change',
    editSaving: 'Saving…',
    editFailed: 'That could not be saved',
    editReason: 'Why',
    editReasonHint:
      'One line, kept with the change and shown in the trail. This is the record of who was approved, and a ' +
      'change to it with no stated reason is indistinguishable from a mistake.',
    editRecordedAs: 'This will be recorded as changed by',
    editNothing: 'Change something before saving.',

    editPractice: 'Practice',
    editName: 'Practice name',
    editWebsite: 'Website',
    editAdmin: 'Practice administrator',
    editManager: 'Second contact',
    editHeadOffice: 'Head office',
    editFieldName: 'Name',
    editFieldEmail: 'Email',
    editFieldPhone: 'Phone',
    editFieldPosition: 'Position',
    editLine1: 'Street address',
    editLine2: 'Suite, level or unit',
    editSuburb: 'Suburb',
    editState: 'State',
    editPostcode: 'Postcode',
    editHeadcount: 'Practitioners at this practice',

    // --- The handover, which is what changing the admin email really is ---
    editHandoverTitle: 'This changes who controls the practice account',
    editHandoverBody:
      'Changing the administrator’s email is a HANDOVER, not a correction. The passkey enrolled against ' +
      'this practice will be REVOKED, so whoever holds it can no longer sign in, and the new address starts ' +
      'unconfirmed. The account itself is kept — it belongs to the practice. Send the sign-in invitation ' +
      'afterwards so the new administrator can enrol a passkey of their own.',
    editHandoverWhy:
      'This is the path for a practice administrator who has left, or who was never going to manage it ' +
      'themselves. The practice cannot do it alone, because the only account that could is the one that ' +
      'has gone.',
    editHandoverDone: 'The practice administrator has changed',
    editDisabledOk: 'The previous account has been disabled.',
    editDisabledFailed:
      'The previous account could NOT be disabled, so it may still be able to sign in. This needs looking ' +
      'at before the new administrator is invited.',
    editAffected:
      'This touches checks that had already passed: {keys}. They are not undone — but a reviewer who ' +
      'verified them did so against the old details.',
    editSendInvitation: 'Send the sign-in invitation',
    editSending: 'Sending…',
    // --- The score, restated at the decision ---
    decideScore: 'Identity strength {n}',
    decideScorePasses:
      '— above the threshold, and every part of it has been met. Enforcement is soft, so this informs the ' +
      'decision rather than making it; the person approving is still the person deciding.',
    decideScoreBelow:
      '— below the threshold. {why} Enforcement is soft, so this does not refuse the approval. It is ' +
      'recorded against the decision, and it is the number that will say later whether this was a good call.',

    entitlementNoneYet: 'No entitlement check has passed yet',
    entitlementRecordItAbove:
      'Record it in the checklist above, not here — a check carries who performed it, its outcome and its ' +
      'evidence, and those are what the approval rests on. The ABN gate proves the entity exists; it does ' +
      'not prove this person speaks for it.',

    // --- Entitlement, taken from the recorded check rather than retyped ---
    entitlementEstablished: 'Entitlement has already been established',
    entitlementEstablishedBy: '“{label}” — recorded by {who} on {when}.',
    entitlementEstablishedSpokeWith: 'Spoke with {who}.',
    entitlementHasEvidence: 'Evidence is attached.',
    entitlementNoEvidence: 'NO evidence is attached to it.',
    entitlementAlsoPassed: '{n} other entitlement check(s) also passed.',
    entitlementNotRetyped:
      'The decision will record this check, and the person who performed it. You are not asked to retype ' +
      'it — a second copy without the evidence attached could disagree with the first, and it would ' +
      'attribute their check to you.',

    toIdentity: 'Identity strength',
    toIdentityHint:
      '— what is known about every practice and practitioner on the platform, and what hard enforcement ' +
      'would cost today.',

    navQueue: 'Queue',
    audience: 'Reviewer',

    queueTitle: 'Applications waiting for approval from the Platform',
    queueLead:
      'Gate 3. Every application here has already passed its check digits and the register — those two are ' +
      'necessary and not sufficient. What is left is the question neither can answer: is this applicant ' +
      'entitled to act for this entity.',
    queueEmpty: 'Nothing is waiting. When an application arrives it appears here.',
    queueEmptyTitle: 'The queue is empty',
    queueCount: 'waiting',
    queueSearch: 'Filter by name or ABN',
    queueSearchHint: 'Matches on practice name, legal name or ABN. Leave blank to see everything waiting.',
    queueNoMatch: 'No waiting application matches that.',
    queueOpen: 'Review',
    queueWaiting: 'Waiting',
    queueSortNote: 'Ordered by what needs the most attention, not by arrival.',

    // The flags. Each names ONE thing a reviewer must not miss, in the words
    // they would use to describe it to a colleague.
    blockingHeading: 'This cannot be approved as it stands',
    blockingLead:
      'Approval is refused while this is true. It is not a judgement about the applicant — it is a fact the ' +
      'approval would depend on, which is not currently established. Every one of these can be fixed by the ' +
      'applicant, and the link below sends them to do it.',
    blockingMark: 'Blocks approval',
    blockedApprove: 'Approval is blocked — see the top of this page. Rejecting is still available.',
    sendAmendLink: 'Email the applicant a correction link',
    sendingAmendLink: 'Sending…',
    amendLinkExplain:
      'This emails the applicant a link to correct their own details and resubmit. It needs no sign-in — they ' +
      'have no account here until the practice is approved — it cannot change the ABN, and it cannot decide ' +
      'anything. The link stops working after five days.',
    amendReason: 'What do they need to correct?',
    amendReasonHint:
      'Sent to them word for word, so write it for somebody outside this building. “Details did not match” ' +
      'tells them nothing; “the second contact’s phone is the same as yours” tells them exactly what to do. ' +
      'Do not say whether the ABN is already registered here.',
    amendSent: 'Correction request sent',
    amendSentBody:
      'The applicant has been emailed. The link works for five days; if it expires, send another from here.',
    amendFailed: 'That was not sent',

    // The audit trail for one check.
    historyHeading: 'Everything recorded against this check',
    historyShow: 'Show what was recorded',
    historyHide: 'Hide',
    historyEmpty: 'Nothing has been recorded against this check yet.',
    historyBy: 'by',

    auditHeading: 'Everything that has happened',
    auditLead:
      'Oldest first, because this answers how the application got here rather than what happened lately. ' +
      'Nothing is ever removed: a superseded check stays on the page, marked, because a reviewer changing ' +
      'their mind is itself part of the record.',
    auditChecks: 'checks recorded',
    auditAmendments: 'corrections by the applicant',
    auditEvidence: 'files attached',
    auditPeople: 'People involved:',
    auditSuperseded: 'Superseded',
    evidenceOpen: 'Open the file',
    evidenceOpening: 'Opening…',
    evidenceOpenFailed: 'That file could not be opened',
    evidenceReadLogged: 'Opening it is recorded, with your name.',
    evidenceRemoved:
      'The file itself has been removed. Its hash and provenance remain — ceasing to hold a document is not ' +
      'the same as it never having existed.',
    auditCollapsed: 'Every check, correction, file and decision on this application — open to read it.',
    auditKinds: {
      submitted: 'Applied',
      email_verified: 'Email confirmed',
      correction_requested: 'Correction asked',
      amended: 'Corrected',
      check: 'Check',
      evidence: 'Evidence',
      ceremony: 'Ceremony',
      decision: 'Decision',
    } as Record<string, string>,
    historyAt: 'on',
    historyReason: 'Reason',
    historyNote: 'Note',
    historyEvidence: 'Evidence',
    historySuperseded:
      'Superseded by a later entry. Nothing is ever edited or removed — a correction is a new entry, so both ' +
      'stand and the change of mind is itself part of the record.',
    historyLatest: 'Current',

    flagAttested: 'ABN typed by applicant',
    flagAttestedWhy:
      'The register could not be reached, so the applicant read it and typed what it said. The rules ran ' +
      'against their transcription, not against the ABR. Re-read the register before approving.',
    flagContactsClash: 'Both contacts share a',
    flagContactsClashWhy:
      'The second contact exists to give you somebody to call who is not the applicant. These two reach the ' +
      'same place, so there is only one contact here.',
    flagEmailUnverified: 'Email not confirmed',
    flagEmailUnverifiedWhy:
      'The applicant has not clicked the link confirming they can read mail at that address. So every message ' +
      'sent about this application may have gone nowhere — including any you are assuming landed. It proves ' +
      'only that somebody can read that mailbox; it is not evidence of entitlement and never was.',
    sendVerification: 'Email them a confirmation link',
    sendingVerification: 'Sending…',
    verificationSent: 'Confirmation link sent. It works for seven days and can be used once.',
    verificationFailed: 'That was not sent',
    flagNoManager: 'No second contact',
    flagNoManagerWhy:
      'Permitted — a sole trader has no manager — but it removes the cheapest check you have. Weigh it.',
    flagSoleTrader: 'Sole trader',
    flagWeakProof: 'One proof only',
    flagWeakProofWhy: 'More proofs are not required. Fewer proofs means more of the decision rests on you.',

    dossierTitle: 'Application',
    back: 'Back to the queue',
    notFound: 'No application with that reference is waiting.',
    notFoundBody:
      'It may already have been decided, or the reference may be wrong. The queue shows everything still ' +
      'waiting.',

    entityHeading: 'What the register says',
    // Asked directly: "how do I edit any of these blocks". The answer is a
    // design position, so the screen states it rather than leaving a reviewer
    // hunting for a button that must not exist.
    asSubmitted: 'As submitted. Not editable here.',
    asSubmittedWhy:
      'These are the applicant’s own words and the ABR values the checks ran against — they are the evidence ' +
      'under review, and a reviewer editing them would destroy the thing being reviewed. If something here ' +
      'is wrong, that is a finding: record it on the checklist below, with the outcome and the reason. If the ' +
      'applicant needs to correct it, they resubmit.',
    appliedAs: 'Applied as',
    legalName: 'Legal name',
    tradingNames: 'Registered business names',
    entityType: 'Entity type',
    abnStatus: 'ABN status',
    nameMatch: 'Name match',
    verifiedVia: 'Verified via',
    viaApi: 'ABR API',
    viaAttestation: 'Applicant attestation',
    sightedBy: 'Sighted by',
    noneRecorded: 'None recorded',

    contactsHeading: 'Who is applying',
    contactAdmin: 'Applicant',
    contactManager: 'Second contact',
    contactNone: 'No second contact was given.',

    detailsHeading: 'What they told us',
    headOffice: 'Head office',
    websiteLabel: 'Website',
    proofsHeading: 'Proof offered',
    proofNone: 'No proof was offered. That is not disqualifying, and it is not nothing.',

    checksHeading: 'The checklist',
    checksLead:
      'Record what you actually did. A check you did not run is INCOMPLETE, not a failure — the two mean ' +
      'different things and the difference is the whole point of the record.',
    checkRun: 'Record',
    checkOutcome: 'Outcome',
    checkReason: 'Reason',
    checkNote: 'What happened, in your words',
    checkEvidence: 'Link to evidence (optional)',
    checkBy: 'Your name',
    checkSave: 'Save this check',
    checkSaved: 'Recorded',
    checkAppendOnly: 'Checks are append-only. A correction is a new entry, never an edit.',
    checkRecordThis: 'Record what you did',
    checkCancel: 'Cancel',
    checkOutcomeChoose: '—',
    checkOutcomes: {
      passed: 'Passed',
      failed: 'Failed',
      not_applicable: 'Not applicable',
      could_not_complete: 'Could not complete',
    },
    checkReasonRequired: 'Pick the reason. “Failed” with no reason cannot be counted and tells the next person nothing.',
    checkNoteRequiredFailed: 'A failed check must also say what happened, in words.',
    checkNoteRequiredNa: 'Not applicable must say why — it is excluded from the score, so an unexplained one is indistinguishable from skipping it.',
    checkReasons: {
      identity_not_confirmed: 'Identity not confirmed',
      contact_denied_association: 'The contact denied knowing them',
      details_did_not_match: 'Details did not match',
      applicant_uncooperative: 'The applicant was uncooperative',
      evidence_appeared_altered: 'The evidence appeared altered',
      no_answer: 'No answer',
      source_unavailable: 'The source was unavailable',
      applicant_unresponsive: 'The applicant did not respond',
      outside_our_capability: 'Outside what we can check',
      other: 'Other — say what in the note',
    },
    checkHistory: 'Recorded',
    checkWillBeRecordedAs: 'This will be recorded as performed by',
    checkRefused: 'That check was not recorded',
    checkVerifyAt: 'Check it at',

    // Evidence.
    evidenceHeading: 'Evidence',
    evidenceAdd: 'Attach a file',
    evidenceRequiredHere:
      'This check cannot be recorded as PASSED without a file. A check with no evidence is somebody’s memory, ' +
      'and the point of the record is that it outlives the person who made it.',
    evidenceOptionalHere: 'Optional for this check, and it makes the record far stronger.',
    evidenceUploading: 'Uploading…',
    evidenceRemove: 'Remove',
    evidenceNone: 'Nothing attached yet.',
    evidenceRejected: 'That file was not accepted',
    evidenceTypes:
      'Images and PDFs. Not SVG, HTML or ZIP — each of those can carry something that runs when opened, and ' +
      'evidence is not worth that risk.',
    evidenceMax: 'Up to',

    /*
     * Labels for the structured fields a check demands when it passes.
     *
     * Keyed by the field name from the catalogue, so adding a requiredField in
     * the domain surfaces an input here automatically — an unlabelled key
     * renders with its own name rather than silently disappearing, which is the
     * failure mode worth engineering against.
     */
    checkFields: {
      phoneNumber: 'The number you called',
      numberSource: 'Where you got that number',
      spokeWithName: 'Who you spoke to',
      reference: 'Reference given',
      documentType: 'Type of document',
    } as Record<string, string>,
    checkFieldHints: {
      numberSource:
        'A number off the application form proves nothing — the applicant supplied it. An independently ' +
        'obtained number is what makes the call evidence.',
      spokeWithName: 'The person who answered, and their role if they gave it.',
    } as Record<string, string>,
    checkFieldsNeeded: 'This check records these when it passes. They are what make it evidence rather than a note.',
    evidenceTooLarge:
      'That file is {size}. The limit is {max} — large enough for a scanned document or a screenshot, and ' +
      'small enough that the evidence store stays something anyone can audit. A long call recording usually ' +
      'needs to be a transcript plus a reference to where the recording is held.',
    evidenceChecking: 'Looking at that file…',
    evidenceWarnHeading: 'Worth a look before you save',
    evidenceWarnAck:
      'These do not stop you saving. Neither test can prove a document is genuine — a hash is changed by ' +
      're-exporting the file, and a fabricated screenshot contains the right number just as reliably. They ' +
      'rule out the wrong file, and nothing more.',
    evidenceOnlyOnPass: 'Evidence is attached when a check passes; a failure is explained in the reason and the note.',

    // The reviewer's identity. Not a text box — see identityUnverifiedBody.
    identityHeading: 'Who is reviewing',
    identityAs: 'Reviewing as',
    identityUnverified: 'This name is typed, not verified',
    identityUnverifiedBody:
      'There is no platform-admin sign-in yet, so this name is whatever is entered here — it identifies ' +
      'nobody. Every check and every decision recorded now carries an unverified name. It is asked for once ' +
      'and applied to everything on this screen, and it becomes the signed-in identity as soon as ' +
      'platform-admin sign-in exists.',
    identityName: 'Your name',
    identityNeeded: 'Enter your name above before recording anything — a check that names nobody is not a check.',
    checkBySuffix: 'by',
    // A network failure, said in terms of what happened rather than what the
    // browser called it. "Failed to fetch" is a DOM exception, not an answer.
    unreachable: 'The service could not be reached',
    unreachableBody:
      'Nothing was sent and nothing has changed. This is a connection problem between this screen and the ' +
      'core service — not a refusal, and not something wrong with the application you are looking at. Try ' +
      'again in a moment; if it persists, the core service is probably not running.',
    retry: 'Try again',
    loading: 'Loading…',
    loadFailed: 'This application could not be loaded',

    scoreHeading: 'Identity strength',
    scoreOf: 'of',
    scorePoints: 'points',
    scoreSoft:
      'Not enforced yet. The score is recorded against the decision either way, so the threshold can be ' +
      'turned on later against real history rather than a guess.',
    scoreWouldPass: 'Would meet the threshold',
    scoreWouldNotPass: 'Would not meet the threshold',

    decideHeading: 'The decision',
    decideLead:
      'Your name goes on this. There is no "approved by the system" — an approval is somebody deciding, and ' +
      'the record says who.',
    reviewerName: 'Your name',
    decideNote: 'Note',
    entitlementHeading: 'How you verified they represent this entity',
    entitlementMethod: 'Method',
    entitlementNumber: 'Number you called',
    entitlementNumberSource: 'Where you got that number',
    entitlementNumberSourceHint:
      'A number off the application form proves nothing — the applicant supplied it. An independently ' +
      'obtained number is what makes the call evidence.',
    entitlementSpokeWith: 'Who you spoke to',
    approve: 'Approve',
    reject: 'Reject',
    approveNeedsEntitlement:
      'An approval needs an entitlement check. Rejecting does not — refusing what you could not verify is ' +
      'the correct outcome, and demanding a completed check first would be backwards.',
    rejectReason: 'Reason the applicant will be told',
    rejectDisclosure:
      'The applicant reads this. It must not say whether an ABN is already registered here — that turns a ' +
      'rejection into a way to enumerate our customers.',
    decidedApproved: 'Approved',
    decidedRejected: 'Rejected',
    decidedBody: 'The applicant has been told. This application has left the queue.',
    decidedNotTold:
      'The decision is recorded and this application has left the queue — but the message to the applicant ' +
      'did NOT go, so they do not know and cannot sign in yet.',
    decidedNotToldTitle: 'The applicant has NOT been told',
  },
  verify: {
    audience: 'Confirm your email',
    checking: 'Loading…',

    enterTitle: 'Enter the code from your email',
    enterLead:
      'The message we sent contains a six-digit code. Type it below to confirm you can read mail at this ' +
      'address.',
    codeLabel: 'Six-digit code',
    codeHint: 'Six digits, exactly as they appear in the email.',
    whyHeading: 'Why a code as well as a link?',
    assurance:
      'We will never ask you for a password, a Medicare number, or bank details — on this page or by email.',
    attemptsLeft: '{n} attempt(s) left before this link locks.',
    confirm: 'Confirm',
    confirming: 'Confirming…',
    wrongCode: 'That code was not accepted',

    // Explains the extra step rather than leaving it feeling like friction.
    whyCode:
      'A link on its own proves nothing. Mail scanners, link previews and antivirus gateways open links ' +
      'automatically, so the one in your email may already have been opened by a machine before you saw it. ' +
      'Typing the code is what shows a person read the message.',

    okTitle: 'Thank you — that address is confirmed',
    okBody:
      'We know we can reach you. Everything about this application from here — any question, the decision ' +
      'itself, and your sign-in invitation if it is approved — comes to this address.',
    nothingElse: 'There is nothing else to do.',

    alreadyTitle: 'That address is already confirmed',
    alreadyBody: 'Nothing further is needed. You can close this page.',

    lockedTitle: 'This link is locked',
    lockedBody:
      'Too many wrong codes were entered, so it has stopped accepting them. Reply to the email we sent you ' +
      'and we will issue a new code. Your application is unaffected.',

    expiredTitle: 'That code has expired',
    expiredBody:
      'Confirmation codes do not last indefinitely, so that a copy in an old inbox cannot be used later. ' +
      'Reply to the email we sent you and we will issue a new one. Your application is unaffected.',

    failTitle: 'That link is not valid',
    failBody:
      'It may be incomplete — these links are long and email clients sometimes break them across lines. Try ' +
      'copying the whole thing into the address bar. If it still does not work, reply to the email we sent you.',
  },
  practices: {
    title: 'Your practices',
    lead:
      'A practice administrator can hold more than one \u2014 a group with several clinics, or a trust ' +
      'operating two sites under separate ABNs. The one needing attention is first.',
    notLoaded: 'Your practices could not be loaded',
    open: 'Open',
    capturing: 'Capturing',
    needsWork: 'Needs work',
    unknown: 'Unknown',
    /*
     * Written from the READER'S seat, not ours.
     *
     * "Waiting on us" and "somebody here is reading it" were both written in
     * AoBPlatform's voice and then placed on a page belonging to the practice,
     * where "us" reads as the clinic and "here" reads as the surgery. Both said
     * the opposite of what they meant: that the practice owed us something.
     *
     * On a page addressed to somebody else, name yourself.
     */
    pending: 'Being reviewed',
    pendingBody:
      'AoBPlatform is reviewing this application. Nothing is needed from you \u2014 you will hear either way, ' +
      'at the email on the application.',
    openStatus: 'See where it is up to',
    /*
     * WHAT THE ROW OFFERS AN OPERATOR. Every row used to say "Open" and link
     * to the console, which an operator cannot reach without a practice claim
     * -- so clicking a practice bounced them to their own landing page four
     * seconds later. The row now says what will actually happen.
     */
    /*
     * THE PLATFORM'S OWN WORK, which is not acting-as. Named for what it is
     * rather than "open" — an operator choosing between two doors needs the
     * difference in the label, not in a tooltip.
     */
    /*
     * WHAT AN OPERATOR ACTUALLY DOES with an application under review: decide
     * it. "See where it is up to" is the applicant's question, not ours.
     */
    /*
     * LOOKING IS NOT ACTING. Clicking a practice shows it; acting as them is a
     * separate, deliberate press with a stated reason.
     */
    viewSetup: 'View their setup',
    /* The working door, shown only while an acting-as session is open. */
    openAsThem: 'Open their console to make changes',
    reviewIt: 'Review this application',
    checkAsPlatform: 'Check their practitioners (as AoBPlatform)',
    actAsFirst: 'Act as this practice',
    actAsFirstHint:
      'Their console is theirs, so opening it means acting as them — with a reason, recorded, and visible to '
      + 'the practice. Choose a reason below and you will land on their hub.',
    openPending: 'See where it is up to',
    rejected: 'Not approved',
    rejectedBody:
      'AoBPlatform did not approve this application. The reasons were sent to the email on the application.',
    switch: 'Switch practice',

    search: 'Find a practice',
    searchHint:
      'Name, ABN, or the email or phone of either named contact. Type whichever you have \u2014 spacing and ' +
      '+61 do not matter.',
    searchPlaceholder: 'Riverbank, 27 734 610 304, carl@\u2026, 0408\u2026',
    filters: {
      all: 'All',
      needs_work: 'Needs work',
      capturing: 'Capturing',
      being_reviewed: 'Being reviewed',
      not_approved: 'Not approved',
    } as Record<string, string>,
    showing: 'Showing',
    of: 'of',
    noMatch: 'Nothing matches that.',
    noMatchHint: 'Try a shorter fragment \u2014 part of a name, or the first few digits of an ABN.',
    clear: 'Clear',

    emptyTitle: 'No practice yet',
    emptyBody:
      'A practice appears here once it has been approved. If you have applied and are waiting, the link in ' +
      'your acknowledgement email shows where the application has got to.',

    // Honest about the scoping that does not exist yet, rather than presenting
    // a list that looks authoritative and is not scoped to anybody.
    scopeHeading: 'This list is not yet scoped to you',
    scopeBody:
      'Until platform sign-in exists there is no session to say which practices you administer, so this shows ' +
      'every practice, in every state. Once sign-in is in place it shows only yours.',
  },
  setup: {
    audience: 'Practice admin',
    title: 'Set up',
    approvedBy: 'Approved by',
    backToPractices: 'All your practices',
    backToApplication: 'Back to the application',
    notLoaded: 'The setup hub could not be loaded',
    nothingYet: 'Nothing here yet.',
    andMore: '+ {n} more',
    open: 'Open the',
    states: {
      blocked: 'Blocked',
      attention: 'Needs work',
      not_started: 'Not started',
      done: 'Done',
    } as Record<string, string>,

    /*
     * THE ONE LINK BACK TO THE DAY'S WORK (PRACTICE-NAVIGATION.md §2, §5 rule
     * 1). The hub stopped carrying the shift's five destinations; somebody who
     * bookmarked this page before that must still reach them in one press,
     * rather than discovering that their bookmark now opens the half of the
     * console they never wanted.
     */
    todayTitle: 'The day’s work',
    todayBody:
      'The front desk, who is waiting, the tablets, the patients and the messages have their own page now. '
      + 'This one keeps the setting up and the records.',
    todayLink: 'Open today',

    offlineTitle: 'We cannot reach the server',
    offlineBody:
      'Nothing is shown here because there is no way to read it right now — not because anything is missing. '
      + 'Your selection has been kept. Try again in a moment, and if it keeps happening the API is not running.',
    noPracticeTitle: 'No practice is selected',
    noPracticeScoped:
      'Your sign-in is tied to one practice, and we could not load it. That usually means the approval has ' +
      'not finished, or the practice was changed after your invitation was sent. Nothing is wrong with your ' +
      'passkey — tell us and we will look.',
    noPracticeBody:
      'This page shows the setup for one practice, and none is currently selected \u2014 or the one that was ' +
      'selected no longer exists. Once platform sign-in is in place the practice comes from your session and ' +
      'this will not happen.',

    pickerDevTitle: 'Development only — this list does not belong here',
    pickerDevBody:
      'A practice admin must never see a list of other practices. This exists only because platform sign-in ' +
      'does not yet, so there is no session to say which practice you belong to. It disappears the moment ' +
      'there is one.',
    pickerEmpty:
      'No approved practice to show. A practice appears here once a reviewer has approved it — check the ' +
      'review queue.',

    reviewTitle: 'This practice is still being reviewed',
    reviewLead:
      'The setup hub opens once AoBPlatform approves the practice \u2014 approval is what makes consent ' +
      'capture possible, so there is nothing here to set up until then.',
    reviewGateHuman:
      'A person at AoBPlatform reads the application and checks that whoever applied is entitled to act for ' +
      'this entity. That usually means a phone call to the practice, on a number they find themselves. How ' +
      'long it takes is not something we will guess at.',
    reviewRejectedTitle: 'This application was not approved',
    reviewRejectedLead:
      'AoBPlatform did not approve it. The reasons were sent to the email on the application. Applying again ' +
      'starts a new application with its own review.',
    openReview: 'Open in the review queue',
    openReviewHint:
      'The reviewer’s view of this application — the checks, the evidence and the decision. It ' +
      'requires a platform administrator; a practice account is refused. To correct the application, use ' +
      'the link in the email, or ask the reviewer to send a new one.',
    reviewReference: 'Reference',

    pmsTitle: 'PMS connection',
    pmsBody:
      'The site connector runs on a practice Windows machine and dials out only. Nothing listens for an ' +
      'inbound connection, so it opens no port on the practice network.',
    // Dashed, and honest about why: how results are written back to the PMS is
    // an open decision (D-01), so this promises a download and nothing more.
    pmsUnsettled:
      'How results are written back to the PMS is not settled yet, so this promises a download and nothing ' +
      'more. Better an unfinished card than a finished-looking one that does not work.',

    /*
     * THE TABLETS CARD. It used to be two links buried in the Messages card at
     * the foot of the hub — "Open the tablets" and "Open the send to the
     * tablet" — which put a device's own card under a card about
     * correspondence, and told nobody whether anything was actually paired.
     * This one reads the same `/devices` list both target pages do, so its
     * rollup and Capture channels' Kiosk row can never disagree.
     */
    tabletsRollupNone: 'No tablet paired yet',
    tabletsRollup: (paired: number, revoked: number) => `${paired} paired · ${revoked} revoked`,
    // WHAT AN OPERATOR SEES INSTEAD OF A COUNT. `GET /devices` is
    // `@PracticeScoped` — handing out the credential that opens a waiting
    // list is the practice's own act — so a platform session with no practice
    // claim is refused. Naming that plainly beats guessing at a number: a
    // wrong "0 paired" reads as "this practice has no tablets", which may
    // simply be untrue.
    tabletsUnavailableAsPlatform: 'Act as the practice to see which tablets are paired.',
    kioskPaired: (n: number) => (n === 1 ? '1 tablet paired' : `${n} tablets paired`),
    kioskUnpaired: 'unpaired',
  },
  status: {
    audience: 'Your application',

    leadPending:
      'Your application is with us. The first two checks are arithmetic and a register lookup, and both have ' +
      'passed. The third is a person, and that is where it is now.',
    leadApproved: 'Your application has been approved. Look for the email with your sign-in invitation.',
    leadDecided: 'A decision has been made on this application, and it was sent to you by email.',

    humanWaiting:
      'Somebody here reads the application and checks that you are entitled to act for this practice. That ' +
      'usually means a phone call to the practice, on a number we find ourselves. We cannot say how long it ' +
      'will take, and we would rather say that than guess.',
    humanDecided: 'This has been decided. The reasons were sent to the email on the application.',

    reference: 'Reference',
    amendedTimes: 'Corrected {n} time(s) since it was submitted.',

    correct: 'Correct a mistake',
    correctHint:
      'You can fix your own details while the application is waiting. It does not restart the review and it ' +
      'does not need a sign-in — you have no account here yet.',

    correctTitle: 'Correct your application',
    correctLead:
      'Change what is wrong and send it. Only what you actually change is recorded, and the previous value is ' +
      'kept — the person reviewing needs to see what moved.',

    lockedHeading: 'What cannot be changed',
    lockedWhy:
      'Every check runs against one legal entity, so the ABN is fixed once an application is submitted. If ' +
      'this is the wrong entity, that is a new application rather than a correction — apply again and it gets ' +
      'its own review. The legal name and entity type come from the Australian Business Register, not from you.',

    correctableHeading: 'What you can correct',
    whatChanges: 'What you are about to change',
    nothingChanged: 'Nothing has been changed yet.',
    amendmentIsRecorded:
      'Both the old and the new value are kept. This does not restart the review, and it does not undo a check ' +
      'that has already been done — it tells the reviewer what moved.',
    send: 'Send the correction',
    sending: 'Sending…',

    correctedTitle: 'Correction received',
    correctedBody:
      'Your application has been updated and the person reviewing it can see what changed. There is nothing ' +
      'further to do.',

    backToStatus: 'Back to your application',
    // THREE distinct states, deliberately not collapsed into one message.
    // "Closed", "not open yet" and "expired" have different causes and
    // different remedies, and telling somebody their application is closed when
    // it is merely waiting is both wrong and alarming.
    closedTitle: 'This application is closed',
    closedBody:
      'It has already been decided, so it can no longer be corrected. If you believe the decision was wrong, ' +
      'reply to the email we sent you.',

    notOpenTitle: 'Nothing needs correcting right now',
    notOpenBody:
      'Your application is still with us and has not been decided. Corrections open when somebody here reads ' +
      'it and finds something you need to fix — you will get an email if that happens. If you have spotted a ' +
      'mistake yourself, reply to the email we sent when you applied and we will open it for you.',

    expiredTitle: 'This correction link has expired',
    expiredBody:
      'Correction links work for five days, so that a copy sitting in an old inbox cannot be used later. Your ' +
      'application is unaffected and still with us. Reply to the email we sent you and we will send a new link.',
    expiredOn: 'It expired on',

    correctionAsked: 'What we asked you to correct',
    correctionAskedBy: 'Asked by',
    correctionCloses: 'This link stops working on',

    notFound: 'That link does not match an application',
    notFoundBody:
      'The link may be incomplete — they are long and email clients sometimes break them across lines. Try ' +
      'copying the whole thing into the address bar.',
    notLoaded: 'This could not be loaded',
    notSaved: 'That correction was not saved',
    unreachable:
      'We could not reach the service. Nothing was sent and nothing has changed. Please try again in a moment.',
    /*
     * THE ONE FAILURE `explainFailure` (apiError.ts) NAMES ITSELF, because it
     * is the one a person can act on without knowing anything about the
     * screen they were on: sign in again, press the same button again.
     */
    sessionExpired: 'Your sign-in has expired. Sign in again and retry.',
    /** Never a bare number on its own — the code stays visible, in words,
     *  when nothing better is available (CLAUDE.md §7). */
    httpRefused: (status: number) => `The server refused this (HTTP ${status})`,
  },
  org: {
    heading: 'Practice onboarding',
    intro:
      'Three gates, in order: the ABN checksum (offline), the ABR (must be ACTIVE, and the name must match), ' +
      'then a named human. The first two are necessary and not sufficient.',
    // Step 1
    registerHeading: '1. Register the practice',
    nameLabel: 'Practice name (legal OR trading name)',
    abnLabel: 'ABN',
    offlineNote:
      'ABN lookup runs offline against fixtures in this environment, so only these resolve: 53004085616 ' +
      '(company, trades under another name), 51824753556 (sole trader, no ACN), 13824753558 (CANCELLED).',
    registerButton: 'Register',
    applicantHeading: 'Who is applying',
    applicantNote:
      'Two named people, each independently reachable. This is the anti-fraud surface: one applicant with one ' +
      'throwaway email is cheap to fake; a second contact in a stated position is not — and it gives the ' +
      'reviewer somebody to call who is NOT the person who applied.',
    adminNameLabel: 'Your full name',
    adminEmailLabel: 'Your email — the passkey invitation goes here',
    adminPhoneLabel: 'Your direct phone',
    adminPositionLabel: 'Your position at the practice',
    managerHeading: 'Your manager (leave blank if you are a sole trader)',
    managerNameLabel: 'Manager’s full name',
    managerEmailLabel: 'Manager’s email',
    managerPhoneLabel: 'Manager’s phone',
    managerPositionLabel: 'Manager’s position',
    managerMustDiffer:
      'The manager must be a different person — a second contact with your own email verifies nothing.',
    headOfficeHeading: 'Head office',
    headOfficeNote:
      'This is the registered or administrative address. It is NOT automatically a place of practice — a ' +
      'practitioner’s provider number must never end up attached to an address they have never attended. ' +
      'Tick the box only if patients are actually seen here.',
    headOfficeLabel: 'Head-office address',
    line1Label: 'Address line 1',
    line2Label: 'Address line 2 (unit, level, building)',
    suburbLabel: 'Suburb',
    stateLabel: 'State',
    statePick: 'Select…',
    postcodeLabel: 'Postcode',
    countryLabel: 'Country',
    addressStructuredNote:
      'Six fields rather than one line, because one line cannot be matched. The AHPRA register publishes a ' +
      'practitioner’s principal place of practice as SUBURB and POSTCODE, G-NAF matches on components, and ' +
      'the ABR reports a locality — comparing any of those against a sentence is impossible. When the G-NAF ' +
      'ingest lands, a single autocompleted line will replace these.',
    headOfficeIsPopLabel: 'Patients are also seen at this address (creates a location)',
    websiteLabel: 'Practice website (optional)',
    credentialHeading: 'Proof this is a health practice',
    credentialNote:
      'There is no general "practice licence" for an Australian GP clinic. AHPRA registers INDIVIDUALS; ' +
      'practices are accredited against the RACGP Standards and identified by HPI-O. The AHPRA number of a ' +
      'responsible practitioner is the only one of the three that is publicly checkable.',
    credentialTypeLabel: 'Credential type',
    credentialTypePick: 'Select…',
    credentialValueLabel: 'Number / reference',
    credentialAdd: 'Add this credential',
    credentialAddAnother: 'Add as many as you have — each one is a separate signal',
    credentialsHeading: 'Credentials on record',
    credentialsEmpty: 'None yet.',
    credentialUnverified: 'Entered, not verified — worth nothing yet',
    credentialVerified: 'Verified by',
    credentialVerifyHeading: 'Record that you checked one',
    credentialVerifyNote:
      'Strength comes from VERIFIED credentials, never from entered ones. If typing a number scored, ten ' +
      'invented ones would clear any threshold and the score would be measuring typing. So a credential ' +
      'arrives worth nothing, and only a check by a named person gives it weight.',
    credentialVerifyMethod: 'How did you check it?',
    credentialVerifyBy: 'Your name',
    credentialVerifyButton: 'Record the check',
    credentialRemove: 'Remove',
    credentialLabelLabel: 'Label (for “other”, or the accrediting body)',
    entitlementHeading: 'How did you verify this applicant represents this entity?',
    entitlementNote:
      'Required to approve. The ABN gate proves the ENTITY exists — it does not prove this person speaks ' +
      'for it, and the ABN and trading names are public. Rejecting needs no check: refusing an application ' +
      'you could not verify is the right outcome.',
    entitlementMethodLabel: 'Method',
    entitlementMethodPick: 'Select…',
    entitlementPhoneLabel: 'Number you dialled',
    entitlementSourceLabel: 'Where did that number come from?',
    entitlementSourcePick: 'Select…',
    entitlementSpokeWithLabel: 'Who you spoke to',
    entitlementSourceWarning:
      'A number off the application form is chosen by the applicant, so calling it proves only that they ' +
      'answer their own phone. AHPRA cannot help either — the public register publishes suburb and postcode ' +
      'only, never a phone number.',
    contactCol: 'Contacts',
    checklistHeading: 'The checklist',
    checklistNote:
      'Work down it. Each check can be done more than once — a call nobody answered on Tuesday and a call ' +
      'that succeeded on Thursday are both kept, because how many attempts it took is part of the picture.',
    checkOutcomeLabel: 'Outcome',
    checkOutcomePick: 'Not yet performed',
    checkPerformedBy: 'Your name',
    checkReasonLabel: 'Reason',
    checkReasonPick: 'Select…',
    checkNoteLabel: 'What happened',
    checkRecord: 'Record this check',
    checkEvidenceHeading: 'Evidence',
    checkAttach: 'Attach a file',
    checkAttached: 'Attached',
    checkNoEvidence: 'Nothing attached yet',
    checkHistoryHeading: 'Performed so far',
    checkNever: 'Not performed',
    checkWouldPassYes: 'Would be admitted under hard enforcement',
    checkWouldPassNo: 'Would NOT be admitted under hard enforcement',
    checkSoftNote:
      'Enforcement is SOFT: this is advice, and the decision is yours. It is recorded either way, so we can ' +
      'see how many real practices a threshold would have turned away before switching one on.',
    checkScoreLabel: 'Score',
    checkNotShownToApplicant: 'Never shown to the applicant — a threshold and its weights are a fraud playbook.',
    followUpHeading: 'What happened next',
    ahpraHeading: 'AHPRA register check',
    ahpraNote:
      'There is no free AHPRA API — PIE costs $4,000 to install plus $1 per practitioner per year, and ' +
      'scraping the register routes around the licence the regulator sells for exactly this. So open the ' +
      'register, read the record, and type what it says. Your name is recorded against it.',
    ahpraOpen: 'Open the AHPRA register',
    ahpraStatusLabel: 'Registration status',
    ahpraStatusPick: 'Select…',
    ahpraProfessionLabel: 'Profession',
    ahpraDivisionLabel: 'Division',
    ahpraConditionsLabel: 'Conditions (type “None” if none)',
    ahpraUndertakingsLabel: 'Undertakings',
    ahpraReprimandsLabel: 'Reprimands',
    ahpraPrincipalHeading: 'Principal place of practice',
    ahpraSuburbLabel: 'Suburb',
    ahpraStateLabel: 'State',
    ahpraPostcodeLabel: 'Postcode',
    ahpraCountryLabel: 'Country',
    ahpraSightedByLabel: 'Your name — you are attesting you read the register',
    ahpraTypesHeading: 'Registration types (a practitioner commonly holds more than one)',
    ahpraTypeLabel: 'Type',
    ahpraSpecialtyLabel: 'Specialty',
    ahpraExpiryLabel: 'Expiry date',
    ahpraAddType: 'Add another registration type',
    ahpraSubmit: 'Record what the register says',
    ahpraNoAddressNote:
      'The register publishes the principal place of practice as SUBURB and POSTCODE only — never a street ' +
      'address, never an email, never a phone number. There is no field here for those because there is no ' +
      'field there.',
    ahpraNotChecked: 'The register has not been checked for this practitioner.',
    ahpraPermitted: 'Registered — may practise',
    ahpraRefused: 'Not permitted to practise',
    ahpraWarningsHeading: 'Worth reading',
    attestHeading: 'The ABR could not be reached — record what you saw instead',
    attestNote:
      'Open abr.business.gov.au in another tab, search this ABN, and type in what the register shows. Every ' +
      'gate still runs against these values: the ABN must be ACTIVE, the practice name must match one of the ' +
      'registered names, and a company must still yield an ACN. What changes is only who looked — and the ' +
      'record says it was you, so the reviewer approving this practice can weigh it accordingly.',
    attestLegalName: 'Entity name, exactly as the ABR shows it',
    attestTradingNames: 'Registered business names (comma separated, optional)',
    attestStatus: 'ABN status',
    attestEntityType: 'Entity type — copy what the ABR shows, do not guess',
    attestEntityTypePick: 'Select the entity type…',
    attestEntityTypeHint:
      'The ABR wording is on the right of each option. "The trustee for … Family Trust" is a TRUST, not a ' +
      'company — a trust has no ACN of its own, and choosing a company type will be refused.',
    attestGst: 'Registered for GST',
    attestSightedBy: 'Your name — you are attesting you sighted the register',
    attestOpenAbr: 'Open ABN Lookup',
    attestApiWins: 'Once ABR_API_GUID is configured the API answers and this panel is ignored — a person cannot overrule the register when the register can be asked.',
    verificationSourceApi: 'Verified against the ABR',
    verificationSourceManual: 'Attested by a person, not the ABR API — sighted by',
    legalNameLabel: 'Legal entity name',
    tradingNamesLabel: 'Registered business names',
    acnLabel: 'ACN (derived from the ABN, never asked for)',
    entityTypeLabel: 'Entity type',
    matchExact: 'Matched exactly',
    matchLoose: 'Matched only after ignoring the entity suffix — check this is the right entity',
    matchedOn: 'matched on',
    noBanking: 'No banking details are held, for anyone, ever.',
    // Step 2
    queueHeading: '2. Human validation queue',
    queueEmpty: 'No applications waiting. Practices created by the dev seed never applied, so they are not listed here.',
    reviewerLabel: 'Your name (recorded against the decision)',
    approveButton: 'Approve',
    rejectButton: 'Reject',
    rejectNoteLabel: 'Reason (required to reject)',
    validatedBy: 'Validated by',
    findHeading: 'Find a practice',
    findNote:
      'Search by name, trading name or ABN. An approved practice leaves the queue, so this is how you get ' +
      'back to one. This lists OUR customers and is platform-operator territory — unlike the practitioner ' +
      'directory, which refuses name search because a practitioner is a private individual any practice ' +
      'admin could otherwise enumerate.',
    findLabel: 'Practice name, trading name, or ABN',
    findPlaceholder: 'e.g. XLEVELUP, or 27 734 610 304',
    findNoMatches: 'Nothing matches. Only practices that applied through onboarding are listed — dev-seed practices never did.',
    findLoading: 'Loading practices…',
    staleSelection:
      'The practice this console was working on no longer exists, so the selection has been cleared. That ' +
      'happens if it was deleted, or if a test run removed it — the e2e suite clears practices using the ' +
      'three fixture ABNs every time it runs.',
    workOnThis: 'Work on this',
    locationsCol: 'Locations',
    resumeHeading: 'Or paste a practice id directly',
    resumeNote: 'If you already have the id, this skips the search.',
    resumeLabel: 'Practice id',
    resumeButton: 'Resume',
    clearButton: 'Clear selection',
    // Step 3
    locationsHeading: '3. Locations — the practice’s sites',
    locationsOwnership:
      'Addresses always belong to the PRACTICE, never to a person. A practitioner has no address of their own ' +
      'here: their “place of practice” for s 65C(5)(a) is whichever location you affiliate them to in step 5. ' +
      'That is exactly why the provider number lives on the affiliation rather than on the practitioner — a ' +
      'Medicare provider number is a property of a doctor AT A PLACE (FR-1.8).',
    addressLabel: 'Address',
    codeLabel: 'Site code (optional)',
    addLocationButton: 'Add location',
    activateButton: 'Confirm address and activate',
    locationInactive: 'INACTIVE',
    locationActive: 'Active',
    locationsEmpty: 'No locations yet.',
    departmentsHeading: 'Departments',
    departmentNameLabel: 'Department name',
    addDepartmentButton: 'Add department',
    // Step 4
    practitionersHeading: '4. Practitioners — the people',
    practitionersNoAddress:
      'No address is collected here, deliberately. The practitioner is one person across every practice they ' +
      'work at; where they practise is the affiliation in step 5.',
    ahpraLabel: 'AHPRA registration number',
    familyNameLabel: 'Family name',
    givenNamesLabel: 'Given names',
    emailLabel: 'Practitioner-owned email',
    preRegisterButton: 'Pre-register practitioner',
    directoryHeading: 'Directory lookup',
    directorySearchButton: 'Look up',
    directoryNote:
      'Exact AHPRA number only. A name is refused — it would let any practice enumerate every practitioner ' +
      'on the platform. The provider number is never returned.',
    directoryMiss: 'No practitioner with that AHPRA number is registered here.',
    // Step 5
    affiliationsHeading: '5. Affiliations',
    providerNumberLabel: 'Provider number AT THIS LOCATION',
    locationSelectLabel: 'Location — this becomes their place of practice for s 65C(5)(a)',
    inviteButton: 'Invite to this location',
    affiliationsEmpty: 'No affiliations yet.',
    canCaptureYes: 'Capture open',
    canCaptureNo: 'Capture closed',
    actAsPractitioner: 'Acting as the practitioner (development shortcut)',
    actAsNote:
      'In production this happens in the practitioner’s own session, from a link sent to their own email. ' +
      'A practice can never accept on their behalf.',
    acceptButton: 'Accept',
    rejectInviteButton: 'Reject',
    noticeHeading: 'Give notice',
    endsAtLabel: 'End date',
    giveNoticeButton: 'Give notice',
    withdrawNoticeButton: 'Withdraw notice',
    noticeNote:
      'Notice runs BEFORE the end date. The affiliation stays active and capture continues until then — at ' +
      'the end date enduring agreements cease under reg 65CA(8).',
    deregisterButton: 'Record AHPRA deregistration',
    deregisterNote: 'REQ-XFER-08 — immediate, across every affiliation, with no notice period.',
    needReviewer: 'Enter your name in step 2 first — every invitation, activation and notice records who did it.',
    statusLabel: 'Status',
    practitionerLabel: 'Practitioner',
    locationLabel: 'Location',
  },
  console: {
    title: 'Development console',
    subtitle: 'Scaffold status view — the real practice console (M12) replaces this.',
    services: 'Platform services',
    serviceUp: 'Running',
    serviceDown: 'Unreachable',
    agreements: 'Agreements',
    noAgreements: 'No agreements yet.',
    noPractice: 'No practice selected — create sample data to begin.',
    seedButton: 'Create sample practice',
    draftButton: 'Create draft agreement',
    refresh: 'Refresh',
    practiceLabel: 'Practice',
    statusLabel: 'Status',
    typeLabel: 'Type',
    createdLabel: 'Created',
    errorPrefix: 'Something went wrong:',
    journeyButton: 'Run capture journey',
    journeyLog: 'Journey log',
    syncButton: 'Sync PMS invoices',
    outstanding: 'Outstanding agreements',
    noOutstanding: 'Nothing outstanding.',
    bandLabel: 'Band',
    daysRemainingLabel: 'Days left',
    itemsLabel: 'MBS items',
    serviceDateLabel: 'Service date',
    resendLabel: 'Resend',
    revenueForgoneLabel: 'revenue forgone',
    chaseSuppressedLabel: 'chase suppressed',
    chainLabel: 'Vault chain',
    chainValid: 'verified',
    chainInvalid: 'BROKEN',
  },
  /**
   * Locations and the departments inside them.
   *
   * THE SENTENCE THIS PAGE EXISTS TO MAKE TRUE: a location's address is what
   * prints in the s 65C(5)(a) particulars block on every agreement captured
   * there. So "is this address right" is not administrative tidiness — it is
   * the difference between a valid record and one naming a place that does not
   * exist. That is why a location arrives inactive and why activating it names
   * a human.
   */
  application: {
    title: 'Your application',
    lead:
      'What this practice told us, in the order it was asked. Contact details and the head office can be ' +
      'changed here; what the ABR said cannot.',
    notLoaded: 'Your application could not be loaded',
    // Saving and loading are different failures and were sharing one heading.
    notSaved: 'That change could not be saved',
    handoverWarnTitle: 'This will sign the administrator out',
    handoverWarnBody:
      'Changing the administrator’s email is treated as a HANDOVER, not a correction: the account belongs ' +
      'to the practice, so a new address means a new person and every passkey on it is revoked. Whoever ' +
      'uses that account will have to enrol again from a link sent to the NEW address. If you only meant ' +
      'to fix a typo, it still counts — there is no way for us to tell the difference.',
    reasonLabel: 'Why are you changing this?',
    reasonHint:
      'Required. This record is what your practice was approved on, so a change to it with no stated ' +
      'reason is indistinguishable from a mistake.',
    save: 'Save the changes',
    saving: 'Saving…',
    nothingChanged: 'Nothing has changed',
    savedTitle: 'Saved',
    savedBody: 'The change is recorded against your name, with what it was before and what it is now.',
    lockedHint: 'Recorded when your application was checked. Not editable here.',
    notRecorded: 'Not recorded',
    pendingAdminEmailTitle: 'Waiting on the new administrator address',
    pendingAdminEmailBody:
      'We wrote to {email} to confirm it. The address above has NOT changed yet — it still shows the ' +
      'current one, and that keeps working until the new one confirms.',
    pendingGroupEmailTitle: 'Waiting on the new shared address',
    pendingGroupEmailBody:
      'We wrote to {email} to confirm it. The address above has NOT changed yet — it still shows the ' +
      'current one, and that keeps working until the new one confirms.',
    lockedTitle: 'Why some of this is locked',
    lockedBody:
      'The ABN, legal name and entity type are identity evidence — somebody looked them up against the ' +
      'ABR and their name is recorded against that check. If we let you edit them afterwards, a practice ' +
      'could change what was verified while keeping the verification. If any of it is wrong, tell us and ' +
      'we will check it again properly.',
  },
  summary: {
    byOrgTitle: 'Messages by practice',
    byOrgLead:
      'How much each practice is sending, and of what. These are counts only — no names and no message ' +
      'bodies, which is why this one may span practices when the message list may not.',
    bySiteTitle: 'Messages by site and department',
    bySiteLead:
      'Where this practice’s messages are going. A row with no site is addressed to the practice itself ' +
      'rather than to one of its locations.',
    backToQueue: 'Back to the queue',
    messages: 'messages',
    notLoaded: 'Those totals could not be read',
    emptyBody: 'Nothing has been queued yet. An empty queue is the normal state.',
    colOrg: 'Practice',
    colSite: 'Site',
    colTotal: 'Total',
    wholePractice: 'The practice itself',
  },
  picker: {
    label: 'Which practice?',
    hint: 'This screen shows one practice at a time.',
    choose: 'Choose a practice…',
    loading: 'Loading the list…',
    unreachableTitle: 'We cannot reach the server',
    unreachableBody:
      'Nothing is wrong with your account and nothing has been lost — this screen simply cannot load while the server is unreachable. Try again in a moment. If it keeps happening, tell us.',
    noPracticeTitle: 'We could not tell which practice you belong to',
    noPracticeBody:
      'Your session should say which practice you are with, and it does not. Sign out and in again. If that does not fix it, tell us — we are not going to offer you a list of other people’s practices.',
  },
  confirmEmail: {
    title: 'Confirm your administrator address',
    lead:
      'Somebody at your practice asked us to make this the administrator address for AoBPlatform. Nothing has '
      + 'changed yet. Enter the code from the same message to confirm it.',
    code: 'The code from the email',
    codeHint: 'Six digits. The link on its own does not confirm anything — that is deliberate.',
    confirm: 'Confirm this address',
    confirming: 'Confirming…',
    failed: 'That could not be confirmed',
    doneTitle: 'Confirmed',
    doneFallback: 'This is now the practice’s administrator address.',
    noTokenTitle: 'This page needs the link from the email',
    noTokenBody:
      'There is no confirmation to act on here. Open the link in the message we sent, rather than typing the '
      + 'address by hand — the link is what tells us which change you are confirming.',
    whatHappensTitle: 'What happens when you confirm',
    whatHappensBody:
      'From then on, this address is where the practice’s sign-in and notices go. The old address stops '
      + 'working for signing in, and we send a new sign-in link here.',
  },
  stopEmail: {
    title: 'Stop this change',
    lead:
      'Somebody asked us to change your practice’s administrator email address. Nothing has changed yet, and '
      + 'it only takes effect if the new address confirms it. If your practice did not ask for this, stop it here.',
    stop: 'Stop this change',
    stopping: 'Stopping…',
    failed: 'That could not be stopped',
    doneTitle: 'Stopped',
    doneFallback: 'The change has been stopped and the address is unchanged.',
    noTokenTitle: 'This page needs the link from the email',
    noTokenBody:
      'There is nothing to stop here. Open the link in the message we sent — it is what tells us which change '
      + 'you mean.',
    ifItWasYouTitle: 'If your practice did ask for this',
    ifItWasYouBody:
      'You do not need to do anything. The change goes through when the new address confirms it, and expires '
      + 'by itself if nobody does.',
  },
  actingAs: {
    thisPractice: 'this practice',
    start: 'Act as {practice}',
    startTitle: 'Act as somebody at this practice',
    startBody:
      'You will see and do what they see and do, and everything is recorded against you AND them. Some things '
      + 'a practice does are refused to us outright — inviting somebody, recording a departure — and this is '
      + 'how support performs them.',
    reason: 'Why',
    reasonHint: 'Chosen from a list rather than typed, so these can be counted and looked at together.',
    chooseReason: 'Choose a reason…',
    note: 'What you are about to do',
    noteHint: 'A sentence. The practice is told, and reads this.',
    confirmStart: 'Start acting as them',
    starting: 'Starting…',
    failed: 'That could not be started',
    warnTitle: 'What this does not let you do',
    warnBody:
      'Deleting, removing, withdrawing or ending anything stays refused, and an approval you make while acting '
      + 'as somebody must be re-approved by a different person. The session ends by itself after 30 minutes.',
    /*
     * THE NAME, THE REASON AND THE DEADLINE.
     *
     * This read "You are acting as 821709fb-7f89-4fcf-95c0-27c5eb55cec8",
     * because the server returned the row and the id was all it had. A UUID
     * names nothing to the person reading it, and the single job of this banner
     * is to make it impossible to forget whose console you are in.
     *
     * The reason is here because it is stated once at the start and then never
     * shown again — so a session opened to do one thing drifts into another
     * with nothing reminding anybody what they said they were doing.
     */
    bannerText: 'You are acting as {practice}. Everything you do is recorded against you and them.',
    openConsole: 'Open their console',
    bannerReason: 'Reason given: {reason}.',
    bannerExpires: 'It stops by itself at {time}.',
    end: 'Stop acting as them',
    ending: 'Stopping…',
  },
  access: {
    audience: 'AoBPlatform',
    signInTitle: 'Sign in to see this page',
    signInNoticeTitle: 'You are not signed in',
    signInBody:
      'This page shows real records, so it needs to know who you are. Sign in with your passkey using the button above — you will come back here afterwards.',
    /*
     * AN OPERATOR AT A PRACTICE PAGE. Not the generic refusal: they are neither
     * a practice nor a practitioner, and telling them the two do not mix
     * explains nothing. One sentence that resolves it, and where to start.
     */
    actingAsTitle: 'This is one of the practice’s own pages',
    actingAsBody:
      'You are signed in as AoBPlatform, and a practice’s own screens open when you act as that practice — '
      + 'which is recorded, told to them, and is what makes anything done here attributable. Start from All '
      + 'organisations. Work that is OURS rather than theirs, like checking a practitioner against the '
      + 'register, has its own door on the same list and needs no session.',
    /*
     * A PRACTICE THAT DOES NOT USE THIS PART OF AoB (D-2026-09-14-04). Its own
     * refusal, and it has to be: "that page is not for this account" would be
     * a lie about the account, which is perfectly entitled to the page — the
     * practice simply has not got that part of the product. Somebody told the
     * wrong one of those two sentences goes and checks their sign-in, which
     * cannot help them.
     *
     * IT SAYS WHERE IT IS TURNED ON (CLAUDE.md §7, "Shortcuts to the answer"),
     * and it says that nothing has been lost — the commonest fear on reading
     * this is that a feature was removed and took its records with it.
     */
    surfaceOffTitle: 'This practice does not use that part of AoB',
    surfaceOffBody:
      'Your sign-in is fine and the page is still here — this practice has not got this part of AoB switched on, '
      + 'so nothing behind it would answer. Nothing has been deleted, and anything recorded while it was on is '
      + 'still there. An administrator can turn it on under Channels.',
    surfaceOffWhich: 'The part in question is “{surface}”.',
    surfaceOffGoToChannels: 'Go to Channels',
    refusedTitle: 'That page is not for this account',
    refusedBody:
      'You are signed in, and this page belongs to a different kind of account — a practice’s own screens are '
      + 'not a practitioner’s, and the other way round. Nothing is wrong with your sign-in.',
    notFoundTitle: 'There is no such page',
    notFoundBody:
      'That address does not match anything here. It may have been mistyped, or it may be a link that has '
      + 'moved since it was written down.',
    takingYouBack: 'Taking you back',
    goNow: 'Go now',
  },
  help: {
    audience: 'AoBPlatform',
    title: 'We cannot tell what you should see',
    lead:
      'You are signed in, so we know who you are. What we do not know is which practice or which record this '
      + 'account belongs to — so there is nothing we can safely show you. That is ours to fix, not yours.',
    whoTitle: 'You are signed in as',
    whoBody:
      '{who}. If that is not the account you meant to use, sign out and in again with the right one — half the '
      + 'time that is the whole problem.',
    unknownAccount: 'an account we cannot name',
    contactTitle: 'Talk to us',
    noContactTitle: 'No contact details are configured here',
    noContactBody:
      'This environment has no support address set, so we are not going to print one that goes nowhere. If '
      + 'you are testing, set SUPPORT_EMAIL and SUPPORT_PHONE. If you are not, whoever gave you this link can '
      + 'reach us.',
    tryTitle: 'Things that are worth trying first',
    trySignOut: 'Sign out and back in. A claim added after you signed in does not appear until you get a new session.',
    tryInvite:
      'If you were invited by a practice, open the invitation again — accepting it is what connects this '
      + 'account to them.',
    tryAsk:
      'If you work at a practice, its administrator can see whether your access is set up, and can send you a '
      + 'fresh invitation.',
    notYourFault:
      'An account can end up here for ordinary reasons — created before it was linked to anything, or an '
      + 'affiliation that ended while you were signed in. None of them mean you have done anything wrong.',
  },
  /*
   * `myAffiliations`, not `affiliations` — the practice-side screen already
   * owns that key. Two keys of one name in this object means the later silently
   * wins, and which screen breaks depends on declaration order.
   */
  myAffiliations: {
    title: 'Your affiliations',
    back: 'Back to your practice work',
    lead:
      'Every practice you have been invited to, including ones that have ended. You can leave any of them '
      + 'yourself — the practice is told, not asked.',
    failed: 'That could not be done',
    doneTitle: 'Recorded',
    recorded: 'Recorded.',
    emptyTitle: 'You have no affiliations',
    emptyBody: 'Nobody has invited you to a practice yet. An invitation arrives by email, at your own address.',
    endsOn: 'Ends',
    endedOn: 'Ended',
    leave: 'Leave this practice',
    reason: 'Why are you leaving?',
    reasonHint: 'Choose the one that fits. Two of them mean the listing was wrong rather than that it is ending.',
    chooseReason: 'Choose a reason…',
    lastDay: 'Your last day',
    lastDayHint: 'Leave it blank to end it today. It cannot be in the past — see the reasons above if it should be.',
    note: 'What has happened',
    noteHint: 'In your own words. Somebody here reads this.',
    immediateTitle: 'This takes effect immediately',
    immediateBody:
      'You will be removed from this practice now, and consent can no longer be captured under your name '
      + 'there. Somebody here will look at what was captured while you were listed.',
    confirmLeave: 'Record this',
    recording: 'Recording…',
  },
  myMessages: {
    title: 'What we have sent you',
    lead:
      'Everything addressed to you, at every practice you work at, for the last two years. Yours only — the '
      + 'database enforces that, not this screen.',
    noSession: 'You are signed out, so there is nothing of yours to show.',
    totals: '{count} messages · {sent} sent · {waiting} still on their way',
    failed: 'Those could not be read',
    emptyTitle: 'Nothing has been sent to you yet',
    emptyBody:
      'That is a real answer rather than a missing one — we asked and there was nothing. Messages appear here '
      + 'once a practice you work at starts sending them.',
    grain: 'Summarise by',
    grainHint: 'The last two compare the same week or day of each month.',
    listTitle: 'The messages',
    noSubject: 'No subject recorded',
    noBodyTitle: 'We did not keep a copy of this one',
    noBodyBody:
      'This was composed and sent by {who} rather than by us — a sign-in link, which only it can create. '
      + 'We recorded that it went and when. The message itself is in your inbox.',
    period: 'Time period',
    everything: 'Everything we hold',
    when: 'When',
    subject: 'What it was about',
    state: 'State',
    view: 'Read it',
    hide: 'Close',
    listHint: 'Each one we sent you. Open any to read what it said.',
    month: 'Month',
    practice: 'From',
    sent: 'Sent',
    waiting: 'On its way',
    total: 'Total',
    builderTitle: 'Want to slice this differently?',
    builderBody: 'The report builder opens this same question, and only ever shows what your account may see.',
    builderLink: 'Open the report builder',
  },
  practicePublic: {
    title: 'The practice',
    lead:
      'How this practice publishes itself. Its own business details — not its people, and not its records.',
    failed: 'That could not be read',
    entityTitle: 'The entity',
    legalName: 'Registered name',
    tradingAs: 'Trading as',
    abn: 'ABN',
    headOfficeTitle: 'Head office',
    headOfficeNote: 'Where the entity is run from. Not necessarily where patients are seen.',
    noAddress: 'No head office address has been recorded.',
    locationsTitle: 'Their locations',
    locationsNote:
      'Every site this practice runs, not only the ones you work at — an address here is one they already put on patient notices. Who works at each is deliberately not shown.',
    noLocations: 'No active locations have been recorded.',
    unnamedSite: 'A site',
    departments: 'Departments',
    noDepartments: 'No departments recorded at this site.',
    contactTitle: 'How to contact them',
    noContactTitle: 'They have not published contact details',
    noContactBody:
      'This practice has not given us a business phone or address to show you. We are not going to show you '
      + 'their administrator’s personal address instead — that identifies a person and is where their sign-in '
      + 'lives. Ask them directly, or ask us.',
  },
  /*
   * THE MENU. Labels only — WHICH of these appear is decided by the access
   * table, so this list is never the thing that grants anybody anything.
   */
  nav: {
    title: 'Go to',
    open: 'Open the menu',
    close: 'Close the menu',
    refresh: 'Ask the server again',
    hint: 'Only the pages you can actually open are listed here.',
    hintSignedOut: 'You are not signed in, so this is everything open to anybody.',

    /*
     * WHY SOMETHING IS NOT HERE. A short list with no explanation reads as a
     * broken menu. These lines say what is missing and how to reach it, which
     * is the difference between a rule and a fault.
     */
    absentTitle: 'Not listed here',
    absentPractice:
      'A practice’s own pages — its setup, locations, practitioners and users — open when you act as that '
      + 'practice. Start from All organisations. Opening them directly would let an operator read a '
      + 'practice’s records with nothing recorded about whose behalf it was on.',
    absentPractitioner:
      'A practitioner’s pages are that person’s own and show only their affiliations and their messages. '
      + 'There is nothing there for an operator to see, which is why this platform is not a directory of who '
      + 'works where.',
    absentSignedOut: 'The rest appears once you sign in.',
    actingAsNote: 'You are acting as {practice}, so its pages are listed here too.',
    aPractice: 'a practice',
    backTo: 'Back to {page}',

    platformHeading: 'Platform',
    allOrganisations: 'All organisations',
    reviewDossiers: 'Applications to review',
    reviewQueue: 'Review queue',
    outbound: 'Messages sent',
    outboundByOrg: 'Messages by organisation',
    outboundByPlace: 'Messages by location and department',
    actingAsRegister: 'Who is acting as a practice',
    actingAsHistory: 'Acting-as history',

    practiceHeading: 'This practice',
    yourPractices: 'Your practices',
    /* The day's work, first among a practice's pages: it is where the shift is
     * done, and the rest of this group is opened occasionally. */
    today: 'Today',
    setup: 'Setup',
    entity: 'The organisation',
    application: 'Your application',
    locations: 'Locations',
    practitioners: 'Practitioners',
    affiliations: 'Invitations and departures',
    channels: 'How you reach patients',
    pms: 'Practice management system',
    users: 'Who may sign in',

    reportsHeading: 'Reports',
    reports: 'Reports',

    yoursHeading: 'Yours',
    practitionerHub: 'Your practice work',
    myAffiliations: 'Your affiliations',
    myMessages: 'What we have sent you',

    everyoneHeading: 'Everyone',
    home: 'Home',
    apply: 'Apply to join',
    help: 'Help and contact',
  },

  /*
   * THE HISTORY, which is a different page from the register on purpose.
   * The register answers "who is doing this now"; this answers "who has ever
   * done this, to whom, and why" -- a question asked months later, by somebody
   * who needs to search rather than to act.
   */
  actingAsHistory: {
    audience: 'Platform',
    title: 'Every time somebody acted as a practice',
    lead:
      'The whole record, open and ended. Who acted, for which practice, the reason they gave, and how it '
      + 'finished.',
    loading: 'Reading the history…',
    notLoaded: 'The history could not be read',
    search: 'Search',
    searchHint: 'Matches the operator, the practice, the reason and the note. One box, because the question that brings somebody here is never predictable.',
    searchPlaceholder: 'A name, a practice, a reason…',
    count: '{n} sessions.',
    countFiltered: 'Showing {shown} of {total}.',
    none: 'Nothing matches that.',
    started: 'Started',
    operator: 'Operator',
    practice: 'Practice',
    reason: 'Reason',
    ended: 'Ended',
    outcome: 'How it finished',
    stillOpen: 'Still open',
    expired: 'expired by itself',
    reapproval: 'Forced a reapproval',
    toRegister: 'Who is acting right now',
    clear: 'Clear the search',
    /*
     * WHAT THIS PAGE DOES NOT CLAIM. A session names a practice; it does not
     * record which pages were opened. Saying so is better than a "pages
     * visited" column that looks authoritative and is not.
     */
    trailTitle: 'What was actually done during a session',
    trailBody:
      'This lists the sessions, not the acts. Everything done while acting as a practice is recorded against '
      + 'that practice with its own actor and timestamp — open the practice to read its trail. A session that '
      + 'forced a reapproval still forces it, whether it was ended early or expired on its own.',
  },

  /* The register of who is acting as whom. */
  actingAsRegister: {
    audience: 'Platform',
    title: 'Who is acting as a practice',
    lead:
      'Every session an operator has opened against a practice, newest first. Open ones are at the top and '
      + 'can be stopped from here.',
    loading: 'Reading the register…',
    notLoaded: 'The register could not be read',
    openHeading: 'Open now',
    pastHeading: 'Ended',
    nobody: 'Nobody is acting as any practice at the moment.',
    /*
     * THE RULE, SAID ON THE PAGE. Somebody reading a register of open sessions
     * wants to know what stops them, and "a background job, we hope" is a much
     * weaker answer than the true one.
     */
    capNote:
      'Nothing here can run longer than {n} minutes. A session expires by the clock rather than by a sweep, '
      + 'so a failed background job cannot leave one open — there is no background job. Stopping one here '
      + 'ends it early, which is what you want the moment you notice one that should not be running.',
    operator: 'Operator',
    practice: 'Practice',
    reason: 'Reason',
    started: 'Started',
    ends: 'Ends',
    ended: 'Ended',
    endedHow: 'How it ended',
    stop: 'Stop this session',
    stopping: 'Stopping…',
    stopped: 'Stopped. The reapproval it forced still stands.',
    reapproval: 'Forced a reapproval',
    note: 'Note',
  },

  /* The two patterns that repeat across every screen. */
  history: {
    show: 'History',
    loading: 'Reading the history…',
    notLoaded: 'The history could not be read',
  },

  form: {
    /*
     * CLEARING IS NOT CANCELLING. "Cancel" implies leaving; this empties the
     * fields and leaves you where you are, which is what somebody wants after
     * a refusal they intend to answer by starting again.
     */
    clear: 'Clear the form',
    cleared: 'Cleared.',
  },

  /* EmailStatusChip — CONVENTIONS.md §9d, used wherever an email address's
     verification state is shown. */
  /* A patient approving their bulk-billing agreement from the link we sent. */
  agree: {
    /**
     * THE HEADING OVER THE TICK BOXES on the remote link (Carl, 5 Sep 2026;
     * W1). CHROME, not the instrument — the statements themselves come from
     * the server as part of the rendered document and are never in this table.
     */
    statementsHeading: 'Please read and tick each of these',
    /** HOW MANY ARE LEFT, not merely that something is (CLAUDE.md §7). */
    approveNotAffirmed: (outstanding: number) =>
      outstanding === 1 ? 'One box still to tick' : `${outstanding} boxes still to tick`,
    audience: 'Approve your bulk-billing agreement',
    checking: 'Loading…',

    verifyTitle: 'First, confirm it is you',
    verifyLead:
      'Before we show you anything, we need three details that only you would know. They are compared with ' +
      'your practice’s records and not kept.',
    familyName: 'Family name',
    givenNames: 'Given names',
    dateOfBirth: 'Date of birth',
    address: 'Address',
    addressHint: 'As your practice has it — street, suburb, state and postcode.',
    verify: 'Continue',
    verifying: 'Checking…',
    mismatchTitle: 'Those details did not match',
    mismatch: 'One or more of those details did not match what the practice holds. Check them and try again.',
    whyVerifyHeading: 'Why we ask before showing anything',
    whyVerify:
      'Links get forwarded, previewed and opened by mail scanners. Until a person has stated these details, ' +
      'this page shows nothing about anybody — not the practice, not the doctor, not your name.',
    assurance:
      'We will never ask you for a Medicare number, a password, or bank details — on this page or by message.',

    reviewTitle: 'Your bulk-billing agreement',
    reviewLead:
      'For Medicare to pay the practice directly for this visit — so that you do not pay and claim it back — ' +
      'you assign your Medicare benefit to the practice. This is what you are agreeing to.',
    patient: 'Patient',
    practice: 'Practice',
    practitioner: 'Practitioner',
    serviceDate: 'Date of service',
    item: 'Medicare item number',
    items: 'Medicare item numbers',
    noAmount:
      'No amount is shown, deliberately. An assignment of benefit is about who Medicare pays, not how much; ' +
      'the amount is fixed by the Medicare schedule for those item numbers.',
    /**
     * "IF THIS IS NOT RIGHT" — the remote link's own version of the tablet's
     * line (Carl, 7 Sep 2026).
     *
     * THE SENTENCE ABOVE IT IS THE KIOSK'S, read from `kiosk.signature` so the
     * two surfaces cannot describe one act differently. THIS one is not, and
     * cannot be: "see reception" is a person a metre away on a tablet in a
     * waiting room, and nobody at all to somebody opening a link at home.
     */
    whoNotRight: 'If this is not right, do not approve — contact the practice.',
    approve: 'I agree',
    approving: 'Recording…',
    approveFailed: 'That could not be recorded',
    whyApproveHeading: 'What happens when you tap “I agree”',
    whyApprove:
      'Your agreement is recorded against exactly the details above, stamped with the time, and a copy is ' +
      'placed in your practice’s records. The practice cannot change it afterwards, and neither can we.',
    recordRef: 'Record reference:',

    blockedTitle: 'This cannot be completed yet',
    blockedBody:
      'The rules that check an agreement before it is recorded are not switched on for this service yet, so we ' +
      'have not recorded anything. Nothing is lost — the practice will send you a fresh link when it is ready.',

    doneTitle: 'Thank you — your agreement is recorded',
    doneBody:
      'The practice can now bill Medicare directly for that visit. A copy has gone to your practice’s records.',
    // Write-back can be deferred (the practice's system unreachable, or the
    // record not yet linked to it). Say "will be", not "has gone".
    doneBodyPending:
      'The practice can now bill Medicare directly for that visit. A copy will be placed in your practice’s ' +
      'records — we keep trying until it is there.',
    nothingElse: 'There is nothing else to do. You can close this page.',

    lockedTitle: 'This link is locked',
    lockedBody:
      'Too many attempts did not match, so it has stopped accepting them. Contact the practice and they can send ' +
      'you a new one.',
    expiredTitle: 'This link has expired or already been used',
    expiredBody:
      'Links last a short time so that a copy in an old message cannot be used later, and each one works once. ' +
      'If you have not yet agreed, contact the practice for a new link.',
    invalidTitle: 'That link is not valid',
    invalidBody:
      'It may be incomplete — these links are long and messages sometimes break them across lines. Try copying ' +
      'the whole thing into the address bar. If it still does not work, contact the practice.',
    unreachableTitle: 'We could not reach the service',

    // The patient's own half of the correspondence log, from the done screen.
    messagesLink: 'See every message we have sent you',
  },

  /*
   * THE PATIENT'S LINK PAGE, WHERE THE AGREEMENT IS A DB4 (TELEHEALTH-PLAN §8
   * step 1, 12 Oct 2026). One contiguous block, so the language layer (step 5)
   * and the telehealth page (step 2) each add theirs beside it rather than
   * inside it.
   *
   * WHAT IS NOT HERE. The sheets, the ticks and the signature pad are the
   * kiosk's own screens, and their words are the kiosk's (`kiosk.particulars`,
   * `kiosk.signature`) — one set of words for one act on two devices. Only
   * the lines that would be FALSE on a phone are replaced, because on a phone
   * there is no reception a metre away.
   */
  link: {
    db4: {
      /** Under who is signing, in place of the tablet's "see reception". */
      whoNotRight: 'If this is not right, do not sign — contact the practice.',
      /**
       * THE SIGNATURE NEVER REACHED US (a network failure, not a refusal). Said
       * only for that case, because only then is "nothing was recorded" known
       * to be true and pressing sign again known to be the remedy.
       */
      notReached:
        'Your signature did not reach us, so nothing has been recorded yet. Check your connection and press sign again.',
      /** The pad had no strokes or no image to send, so nothing left this page. */
      nothingDrawn:
        'The signature pad had nothing to send, so nothing has been recorded. Sign again, or approve by tapping.',
      refusedTitle: 'Your signature was not recorded',
      /**
       * WHY, BY THE CODE THE SERVER SENT (CLAUDE.md §7c; wow.md §13). Each
       * line states what the server observed; a remedy appears only where it
       * is true for every record that reaches that code. A code with no line
       * here is shown as itself (`unmapped`), never as a guess.
       */
      reasons: {
        affirmations_missing:
          'Not every statement on the form was ticked when the signature was sent, so it was not recorded.',
        signature_capture_invalid: 'The drawn signature could not be read when it arrived, so it was not recorded.',
        already_signed: 'This form had already been signed when your signature arrived. Nothing more is needed from you.',
        not_awaiting_signature:
          'This form was no longer waiting for a signature when yours arrived, so it was not recorded. The practice can tell you why.',
        not_locked:
          'The details on this form were not locked when your signature arrived, so it could not be recorded.',
        agreement_closed_unsigned:
          'The practice closed this form as not needed before your signature arrived, so it was not recorded.',
        drawn_not_offered_on_this_link:
          'This link does not take a drawn signature, so it was not recorded.',
        link_verification_replaced:
          'Who you are was checked again after the check on this link, so a signature from this link was not recorded.',
      } as Record<string, string>,
      unmapped: (code: string) =>
        `The practice's system did not record the signature, and gave the reason code "${code}". Quote this code to the practice.`,
      /** Back to the form, for the two refusals the person can fix on this page. */
      signAgain: 'Back to the form',
      /**
       * ON RECEPTION'S QUEUE, under a link that closed because its identity
       * check locked (D-2026-10-12-01). The observation, then the remedy that
       * is true for every such row: a fresh link can be sent.
       */
      queueAttemptLocked: 'Closed: the wrong details were entered on this link too many times.',
      /** Only while the agreement is awaiting a signature: a new link cannot be opened in any other state. */
      queueAttemptLockedNewLink: 'A new link can be sent.',
    },
  },

  /*
   * ONE LOG, TWO AUDIENCES — the design handoff's M-1 (practice) and the
   * Messages tab of P-1 (patient). The same dispatch records, read by
   * different people, so the same strings: "same wording, same timestamps,
   * from their point of view".
   */
  correspondence: {
    navLabel: 'Correspondence',
    title: 'Correspondence',
    lead:
      'Every message sent in this practice’s name, what it said, and whether it arrived. The patient sees ' +
      'their own half of this same list.',
    audience: 'Practice',
    loading: 'Reading the log…',
    unreachableTitle: 'The log could not be read',
    none: 'Nothing has been sent yet.',
    summary: '{n} messages · {failures} not delivered',

    // The filter segment across the top of M-1.
    segment: 'Show',
    segments: {
      all: 'All',
      capture: 'Capture',
      reminder: 'Reminders',
      copy: 'Copies',
      notice: '89AA notices',
      failed: 'Failed',
    } as Record<string, string>,

    colWho: 'Patient',
    colPurpose: 'Purpose',
    colChannel: 'Channel',
    colSent: 'Sent',
    colState: 'Delivery',
    colAction: '',

    /*
     * THE PURPOSE SAYS WHAT THE THING ACTUALLY IS — Carl, on M-1. A label is
     * three facts joined: the agreement TYPE, whether the artefact is the
     * AGREEMENT or a reg 89AA NOTICE about one, and the TIMING. So
     * `Episodic-Agreement-Pre-Consultation`, and a chase carries its ordinal:
     * `Episodic-Agreement-Post-Consultation-Reminder-2`.
     *
     * The three facts come from the record (`describePurpose` in the domain,
     * off the agreement type the server resolves). These are only the words.
     */
    purposeParts: {
      episodic: 'Episodic',
      enduring: 'Enduring',
      treatment_plan: 'Treatment-Plan',
      agreement: 'Agreement',
      notice: 'Notice',
      pre: 'Pre-Consultation',
      post: 'Post-Consultation',
    } as Record<string, string>,
    purposeComposed: '{type}-{artefact}-{timing}',
    purposeComposedReminder: '{type}-{artefact}-{timing}-Reminder-{n}',

    /*
     * The plain labels, still used where there is no agreement behind the
     * message — a practice notice is not an agreement and is not forced into
     * the scheme above.
     */
    purposes: {
      capture: 'Capture link',
      reminder: 'Reminder',
      copy: 'Signed copy',
      // One-way, and the words say so wherever the row appears.
      notice: '89AA notice · one-way',
      practice: 'Practice message',
    } as Record<string, string>,
    reminderNumbered: 'Reminder {n}',

    states: {
      queued: 'Queued',
      sent: 'Sent',
      delivered: 'Delivered',
      failed: 'Failed',
      dead: 'Failed — not retried',
      suppressed: 'Suppressed — confidential visit',
    } as Record<string, string>,

    // A suppressed visit is a row that says why, never a row left out.
    why: 'Why',
    suppressedWhy:
      'This visit is flagged confidential, so no message was composed and none was sent. It was suppressed ' +
      'before a message existed — not filtered out of this list afterwards.',

    view: 'What we sent',
    hide: 'Close',
    noBody: 'No text was kept for this one.',
    removedTitle: 'The text was removed',
    removedBody:
      'This message reached the end of its retention period, so the words were removed. That it was sent, to ' +
      'whom, when and whether it arrived stays on the record.',
    bodiesWithheldTitle: 'States, not bodies',
    bodiesWithheldBody:
      'This is a read-only window onto one practice’s log. It shows what was sent and whether it arrived. ' +
      'What a message said belongs to the practice that sent it and the person who received it.',

    // No resend on an 89AA notice, on any surface, ever (CLAUDE.md rule 7).
    noticeNoAction: 'Nothing is asked of the patient',
    footer:
      'A reg 89AA notice is a record, not a request: nothing is asked of the patient, and it is never ' +
      'chased. The patient’s own view of this list carries the same rows and the same words.',
    costNote:
      'Per-message cost is not shown yet — nothing records what a send cost. It is the practice’s figure ' +
      'alone when it arrives, and never the patient’s.',
  },

  /* P-1, Messages tab — the same log, read by the person who received it. */
  /*
   * THE PAGE A COPY LINK LANDS ON — W6, REQ-PORT-02 (the s 65C copy-on-request
   * obligation automated).
   *
   * IT ASKS FOR NOTHING. No sign-in, no identifiers, no details: the link was
   * sent to an address the practice already held for the person who signed,
   * and it opens the ONE document they signed. A quiz in front of a copy of
   * your own signature would be harder than the signature was.
   *
   * NOTHING HERE SAYS ANYTHING IS CERTIFIED OR APPROVED (hard rule 12); the
   * permitted form is "checked against the s 65C data set". No amount appears
   * on this page or in the document behind it (hard rule 4).
   */
  patientCopy: {
    title: 'Your copy',
    heading: 'Your copy of the agreement you signed',
    lede: 'Nothing is needed from you — no account, no sign-in and no details.',
    preparing: 'Getting your copy…',
    open: 'Open your copy',
    checked:
      'The copy you open is checked against the record made when you signed it. If the two ever disagree it is not shown to you at all.',
    invalidTitle: 'This link no longer works',
    invalidBody:
      'Links expire after a while, and they only work for the person they were sent to. The practice can send you another copy or print one at the desk.',
    conflictTitle: 'This copy will not be shown',
    conflictBody:
      'It no longer matches the record made when you signed it, so we will not show it to you. Please contact the practice — your agreement itself is unaffected.',
    unreachableTitle: 'We could not reach the platform',
    unreachableBody: 'Try the link again in a moment. The practice can also give you a copy at the desk.',
  },

  patientMessages: {
    title: 'Messages we sent you',
    lead: 'The same log the practice sees — your half of it.',
    loading: 'Reading your messages…',
    none: 'We have not sent you anything yet.',
    view: 'Read exactly what we sent',
    hide: 'Close',
    invalidTitle: 'That link is not valid',
    invalidBody:
      'It may be incomplete, or it may have been closed. Contact the practice and they can send you a new one.',
    verifyTitle: 'Confirm your details first',
    verifyBody:
      'This list names you and what was said to you, so it stays closed until the details on your link have ' +
      'been confirmed. Open the link you were sent and answer the questions on it first.',
    unreachableTitle: 'We could not reach the service',
    checkerNote: 'If a message is not listed here, it did not come from us. That is what the checker is for.',
    footer: 'Every send and receipt, as recorded.',

    stopTitle: 'Stop messages',
    stopBody: 'You can stop reminders at any time and still be billed as usual.',
    stop: 'Stop reminders',
    // Disabled WITH ITS REASON rather than a control that records nothing.
    stopUnavailable:
      'This cannot be done from here yet. Nothing on the platform records a stop across every channel at ' +
      'once, and a button that stopped only some of them would be worse than none. Reply STOP to any text, ' +
      'or tell the practice, and every channel stops.',
  },

  /* The reconciliation queue — services without a stored agreement, ranked by the lodgement window (M7). */
  reconciliation: {
    title: 'Outstanding agreements',
    lead:
      'Every service billed without a stored agreement, ranked by days left on the twelve-month lodgement ' +
      'window. Most urgent first, so nothing is discovered from a report.',
    open: '{n} open',
    none: 'Nothing outstanding. Every billed service has an agreement behind it.',
    colPatient: 'Patient / service',
    colBand: 'Band',
    colDays: 'Days left',
    colAction: 'Action',
    bands: {
      standard: 'Standard',
      compressed: 'Compressed',
      urgent: 'Urgent',
      last_chance: 'Last chance',
      expired: 'Expired',
      suppressed: 'Chase suppressed',
    } as Record<string, string>,
    // Why the platform left it to a person. The word beside the item.
    reasons: {
      assignor_needs_human: 'Under 14 — who signs is a person’s choice',
      no_contact_channel: 'No email or mobile on record',
      window_closed: 'Window closed — cannot be billed',
      confidentiality_flag: 'Confidentiality flag — not contacted',
      patient_unresolved: 'Patient not matched',
      provider_unresolved: 'Provider not matched',
      enduring_covered: 'Covered by an enduring agreement',
    } as Record<string, string>,
    reasonUnknown: 'Not yet looked at',
    confidential: 'confidential',
    resend: 'Resend',
    resending: 'Sending…',
    resent: 'Sent',
    resendFailed: 'Not sent',
    needsAgreementAction: 'Needs an agreement',
    needsAgreementWhy:
      'There is no agreement to send a link for. Who signs is a person’s decision — it is made at the desk, ' +
      'not from here.',
    expiredAction: 'Record as revenue forgone',
    expiredWhy: 'The twelve-month window has closed. This item cannot be billed and is never contacted again.',
    byBand: 'All bands',
    selectBand: 'Show one band',
    bulkResend: 'Resend everything shown',
    bulkResendDone: '{sent} sent, {skipped} skipped',
    bulkSkippedWhy: 'Skipped: no agreement yet, expired, or confidentiality-flagged.',
    footer: 'Reg 89AA notices never appear here — they are one-way and never chased.',

    // R-2 — one item in full.
    detailTitle: 'What has been tried',
    attempts: 'Attempts',
    noAttempts: 'Nothing has been sent yet.',
    attemptLine: '{channel} · opened {when} · {status}',
    messageLine: '{state} to {to}',
    policy: 'What this band allows',
    policyLine: '{attempts} attempt(s), {window} apart · ladder: {ladder} · handback {handback}',
    policyNoWindow: 'no window',
    ladder: { ai: 'automated', human: 'a person', handback: 'hand back to the practice' } as Record<string, string>,
    nextStep: 'Next step',
    nextNone: 'Nothing — past the deadline.',
    nextExhausted: 'Attempts used up — hand back to the practice.',
    attemptsRemaining: '{n} attempt(s) left in this band',
    everyAttemptRecorded: 'Every attempt is a vault event.',
    close: 'Close',
    channelEmail: 'Email link',
    channelSms: 'SMS link',
    loading: 'Loading…',
    unreachableTitle: 'We could not reach the service',
    // On the setup hub and in the menu, pointing at this screen.
    hubTitle: 'Outstanding agreements',
    hubBody:
      'Services billed without a stored agreement, ranked by days left to lodge. The platform asks every ' +
      'patient it may; what is here is what it could not decide, and each says why.',
    navLabel: 'Outstanding agreements',

    // R-3 — convert-or-forgo (FR-7.3).
    decisionTitle: 'Decision needed',
    decisionLead: 'Choose explicitly. Nothing happens by default, and either choice is recorded.',
    reasonLabel: 'Reason (optional, kept with the decision)',
    convert: 'Convert to private billing',
    forgo: 'Forgo the benefit',
    keepChasing: 'Keep chasing ({n} attempt(s) left)',
    keepChasingBlockedShort: 'Nothing left to chase for',
    keepChasingBlocked: 'The lodgement window has closed or this band’s attempts are used up, so there is nothing to chase for.',
    careNeverBlocked: 'Care is never blocked by this screen. The patient has already been seen.',
    recordedWithIdentity: 'Recorded with the deciding person’s identity.',
    decisionRecorded: '{decision} — {by}, {when}',
    decisionNames: {
      convert_to_private: 'Converted to private billing',
      forgo_benefit: 'Benefit forgone',
      keep_chasing: 'Keep chasing',
    } as Record<string, string>,
    decideFailed: 'That decision could not be recorded',
    /** A `?item=` link to a service record the queue does not hold (D-2026-10-10-01). */
    itemNotOnQueueTitle: 'That item is not on this queue',
    itemNotOnQueue: (id: string) =>
      `The link asked for service record ${id}. The queue, as loaded just now, does not list it.`,
    /*
     * WHICH UNSIGNED AGREEMENT WAS THIS VISIT'S? (D-2026-10-10-09, option (b)).
     * A service was recorded and unsigned agreements made for the same visit
     * were found. Each line says what was found and on what; never why there
     * are two, which the platform does not know (wow.md §13).
     */
    associationChoice: {
      title: 'Which unsigned agreement was for this visit?',
      lead:
        'A service was recorded, and unsigned agreements for the same patient, servicing provider and day were found. ' +
        'None has been associated with the service yet. Choosing one records which agreement the visit had; ' +
        'it is associated with the service, not linked to it.',
      reasons: {
        unsigned_drafts_match_service: (n: number) =>
          `${n} unsigned agreement${n === 1 ? '' : 's'} match this service on patient, servicing provider and day. None is associated with it.`,
      } as Record<string, (n: number) => string>,
      /** AN UNMAPPED CODE SHOWS ITSELF (CLAUDE.md §7c). */
      reasonUnknown: (code: string) => `Waiting for a choice (${code})`,
      /** "Agreement before the service · Draft · for 3 October 2026 · made 3 Oct, 9:12 am". */
      candidateLine: (type: string, status: string, forDay: string, madeAt: string) =>
        `${type} · ${status} · for ${forDay} · made ${madeAt}`,
      types: {
        episodic_pre: 'Agreement before the service',
      } as Record<string, string>,
      statuses: {
        draft: 'Draft',
        verification_pending: 'Waiting for an identity check',
        verification_failed: 'Identity check did not pass',
        awaiting_signature: 'Ready to sign, not signed',
      } as Record<string, string>,
      choose: 'This one was for the visit',
      choosing: 'Recording…',
      chosen: 'Recorded. The agreement is associated with the service.',
      chooseFailed: 'That choice could not be recorded',
      viewOnly: 'Read only: choosing is done by the practice.',
      postNotAffected: 'The after-service agreement for this visit is drafted and chased as usual, whichever is chosen.',
      notLoaded: (status: string) => `Could not check for services waiting for a choice of agreement (${status}).`,
    },
  },

  /*
   * D6a ON A STAFF SURFACE (CONSULTATION-CAPTURE-PLAN section 2.4).
   *
   * THE DESCRIPTIONS THEMSELVES ARE NOT HERE, and that is the one deliberate
   * exception to REQ-LANG-01 in this table. They are the exact words the rules
   * engine matches and the renderer prints -- versioned content served by the
   * core API from `packages/domain/content/service-descriptions.json` -- so a
   * copy here would be a second list that goes stale silently, and a
   * translation here would change what C6 accepts. The screen renders what the
   * server sends, in the order it sends it.
   *
   * Nothing below says certified, approved, accredited or government-approved
   * (hard rule 12), and nothing below carries an amount (hard rule 4).
   */
  serviceDescription: {
    title: 'Service description needed',
    lead:
      'These pre-agreements cannot be completed until somebody chooses the basic description of the ' +
      'service. It is never asked for on the patient’s tablet — it is the practice’s answer, ' +
      'recorded against the person who gives it.',
    none: 'Nothing waiting. Every draft has its description.',
    count: '{n} waiting',
    colPatient: 'Patient',
    colWhen: 'Appointment',
    colDescription: 'Description',
    colAction: 'Action',
    selectLabel: 'Basic description of the service',
    selectPlaceholder: 'Choose a description…',
    listVersion: 'List {version}',
    listVersionWhy:
      'Checked against the s 65C data set. The version is recorded with the agreement, so a later question ' +
      'about what was offered has an answer.',
    set: 'Set description',
    setting: 'Setting…',
    setDone: 'Set',
    setFailed: 'That description could not be set',
    stale:
      'Set from an earlier list and no longer offered. Choose again so the agreement can be completed.',
    staleShort: 'From an earlier list',
    noSession:
      'Setting a description records who set it, so it needs a signed-in practice account. Sign in to ' +
      'the practice to use this.',
    viewOnly: 'Read-only. Setting a description is the practice’s own act.',
    stillBlocked: 'Description set. Something else still blocks this draft: {rules}.',
    notChecked: 'Description set. The rules engine could not be asked, so the draft has not been re-checked.',
    cleared: 'Description set and the draft is ready.',
    whyNotOnTablet:
      'The tablet never presents this field. A description is a validated particular of a contract, and ' +
      'the person standing at the kiosk is not the one who can answer it.',

    // The practice default, applied when the PMS supplies no appointment type.
    defaultTitle: 'Default service description',
    defaultLead:
      'Used when the practice management system supplies no appointment type, so most drafts arrive with ' +
      'their description already set.',
    defaultNone: 'No default — every draft waits for a person',
    defaultSave: 'Save default',
    defaultSaved: 'Saved',
    defaultFailed: 'That default could not be saved',
  },

  emailStatus: {
    verified: 'Verified',
    pending: 'Confirmation pending',
  },

  /* The band on a practice page opened as the platform. */
  viewOnly: {
    title: 'You are looking at this practice, not working in it',
    body:
      'Everything here is theirs, shown as they see it. The controls are switched off rather than left to '
      + 'fail — to change something, act as the practice from the organisation list.',
    toList: 'All organisations',
    toHub: 'Their setup',
  },

  /* The page a backup address's confirmation link opens. */
  confirmBackup: {
    title: 'Confirm this backup address',
    lead:
      'Somebody has named this address as their backup on AoBPlatform. Enter the code from the message to '
      + 'confirm it works and that you agree to be it.',
    code: 'The code from the message',
    codeHint: 'Six digits. It proves a person read the message — a scanner opening the link cannot.',
    confirm: 'Confirm this address',
    confirming: 'Confirming…',
    failed: 'That could not be confirmed',
    doneTitle: 'Confirmed',
    doneFallback: 'Thank you — that address is confirmed.',
    noTokenTitle: 'This link is incomplete',
    noTokenBody:
      'It should carry a token, and this one does not — the address may have been typed by hand, or a mail '
      + 'client shortened it. Open the link from the message again.',
    whatTitle: 'What being a backup means',
    whatBody:
      'Nothing routine is ever sent here. If anybody asks to change the address we use for the person who '
      + 'named you, we tell you — so a takeover cannot happen quietly. That is the whole of it.',
  },

  practitioner: {
    audience: 'Practitioner',
    title: 'Your practice work',
    lead:
      'Where you work, what we hold about you, and what we have sent you. Only yours — a practice’s other '
      + 'people and its other messages are not here.',
    failed: 'That could not be read',
    /* A refused SAVE, not a failed load — the server correctly declining a
       change (the churn limit, an invalid address) is not "we could not read
       anything", and saying so was actively misleading. */
    changeRefused: 'Your change was not accepted',
    signedOutTitle: 'Sign in to see your own record',
    signedOutBody: 'This page shows what we hold about you, so it needs you signed in.',
    deregisteredTitle: 'Your registration is recorded as ended',
    deregisteredBody:
      'While that stands, your affiliations are ended and consent cannot be captured under your name. If it '
      + 'is wrong, tell us — it is a record of what a register said, not a decision we made.',

    entitiesTitle: 'Where you work',
    entitiesBody:
      'The practices you are affiliated with, and the sites you work at. You see the practice’s name and your '
      + 'own sites — not its other people, and not its records.',
    noEntities: 'You are not affiliated with any practice at the moment.',
    unnamedPractice: 'A practice',

    detailsTitle: 'Your details',
    verifiedNote: 'Your name and AHPRA number were checked against the public register, so they are not edited here.',
    email: 'Your email address',
    emailHint:
      'Yours, not a practice’s. Invitations and sign-in links come here, so a change is held until the new '
      + 'address proves itself — nothing moves the moment you press save.',
    save: 'Ask to change this email address',
    saving: 'Sending…',
    contactSaved:
      'We have written to the new address with a code. Nothing has changed yet — enter the code from that '
      + 'message and it takes effect then.',

    /*
     * WHAT IS WAITING, shown on their own page rather than only in an email.
     * If somebody else raised this, the warning goes to an address that may be
     * exactly the one under attack; the person finds out here regardless.
     */
    pendingTitle: 'A change to your address is waiting',
    pendingBody:
      'We have asked {email} to confirm itself. Until somebody enters the code we sent there, your address is '
      + 'unchanged. It lapses on its own if nobody answers.',
    pendingStop:
      'If you did not ask for this, use the "this was not me" link in the message we sent to your other '
      + 'addresses. That link keeps working for a week after a change goes through.',

    backupTitle: 'Your backup address',
    backupHint:
      'A second address we can warn if anybody asks to change your main one. Nothing routine is sent here. It '
      + 'matters most when your main address has stopped working — which is the commonest reason people '
      + 'change it.',
    backupNone:
      'You have no backup address. If your main one stops working, there is nowhere for us to warn you that '
      + 'somebody asked to move it.',
    backupUnverified: 'Set, but nobody has answered at it yet. We have written to it to say so.',
    backupSave: 'Save backup address',
    backupSaved: 'Saved. We have written to it so its holder knows.',

    affiliationsTitle: 'Your affiliations',
    affiliationsBody:
      'Every practice you have been invited to, including ones that have ended. Leaving one is its own page: '
      + 'a departure has a date that matters and consequences for what was captured under your name.',
    endsOn: 'ends',
    openAffiliations: 'Open your affiliations',

    messagesTitle: 'What we have sent you',
    messagesBody:
      'Everything addressed to you, wherever you work, for the last two years. Yours only — the database '
      + 'enforces that, not this screen.',
    openMessages: 'Open your messages',
  },
  reports: {
    title: 'Reports',
    lead:
      'The questions people ask most, ready made. Everything here is counts of messages — no names, no '
      + 'recipients and no message content, whichever report you pick.',
    report: 'Report',
    breakdown: 'Broken down',
    breakdownHint: 'Split the same figures by where the messages went, or leave them together.',
    window: 'Covers the last two years, which is everything we keep.',
    reading: 'Reading…',
    failed: 'That report could not be read',
    noSession: 'You are not signed in, so there is nothing to report on. Sign in and try again.',
    none: 'None',
    everything: 'Everything',
    organisation: 'Organisation',
    site: 'Site',
    department: 'Department',
    placeHint: 'Narrow to one place. Different from breaking down — this shows one, that shows all of them.',
    allOrganisations: 'All organisations',
    allSites: 'All sites',
    allDepartments: 'All departments',
    chartTitle: 'See this as a chart',
    chartBody:
      'Opens this exact report — same period, same breakdown, same place — in the report builder, which draws it and lets you change the question from there.',
    chartLink: 'Chart this report',
    emptyTitle: 'Nothing to show for this period',
    emptyBody:
      'A real answer rather than a missing one — the query ran and found nothing. Try a wider report, or check '
      + 'the message list if you expected something here.',
    totalTitle: 'One number, on purpose',
    totalBody:
      'This is everything we still hold, added up. For the shape of it over time, pick one of the per-period '
      + 'reports above.',
    moreTitle: 'Need something that is not here?',
    moreBody:
      'These are the common questions, not the only ones. The report builder answers anything the data can '
      + 'support, and it only ever shows you what your account is allowed to see.',
    playground: 'Open the report builder',
  },
  report: {
    title: 'Totals over time',
    lead:
      'How much has been sent, and when. The last two tables compare the same position in each month — week 1 '
      + 'against week 1 — which a running total cannot do.',
    grain: 'Summarise by',
    grainHint: 'The last two are comparison tables rather than a list.',
    window: '{from} to {to} · {total} in total · days begin at midnight {tz}',
    loading: 'Reading the figures…',
    period: 'Period',
    organisation: 'Organisation',
    site: 'Site',
    department: 'Department',
    wholePractice: 'The practice itself',
    noDepartment: 'No department',
    month: 'Month',
    count: 'Sent',
    total: 'Total',
    everything: 'Everything we hold',
    noSuchDay: 'No such day in this month',
    failed: 'Those figures could not be read',
    emptyTitle: 'Nothing has been sent in this period',
    emptyBody:
      'That is a real answer rather than a missing one — the query ran and found nothing. Widen the period, or '
      + 'check the message list if you expected something here.',
    cappedTitle: 'Shortened to what we still hold',
    cappedBody:
      'You asked for further back than {n} years. We do not keep sending records longer than that, so this '
      + 'report starts where the records do rather than implying older ones are being withheld.',
  },
  users: {
    title: 'Your people',
    lead:
      'Who at this practice can sign in, and what they may do. Everything anybody does here is recorded against their own name — which is the point of giving people their own account rather than sharing one.',
    notLoaded: 'Your people could not be listed',
    placesLeft: 'left',
    adminTitle: 'The administrator account',
    adminBody:
      'There is exactly one, and it belongs to the PRACTICE rather than to a person. That is what makes handover work when an administrator leaves suddenly: the account stays and its passkeys are reset, instead of the practice losing access with them.',
    managePasskeys: 'Manage my passkeys',
    myPasskeysTitle: 'Your own passkeys',
    myPasskeysBody:
      'This opens the passkeys for the account YOU are signed in as — nobody can manage anybody else’s, because a passkey is bound to a device the other person is holding. To stop somebody signing in, withdraw their access above.',
    passkeyNote:
      'Up to {n} devices. Add them from a session you have already signed in to — only the FIRST passkey comes from an emailed link, and every one after it is stronger for that.',
    withAccess: 'Can sign in',
    nobodyYet: 'Nobody else has access yet. Add somebody below.',
    onStaffNoAccess: 'On staff, no sign-in',
    onStaffNote:
      'On the practice’s staff list but with no console access. Being on staff does not grant access — that is deliberate, so nobody gets a login as a side effect of being described.',
    withdrawn: 'Access withdrawn',
    withdrawnNote:
      'Kept, never deleted. Somebody who approved or confirmed something has to stay identifiable for as long as that record matters, which is longer than their employment.',
    withdrawnBy: 'Withdrawn by',
    restore: 'Give access back',
    invite: 'Send invite',
    inviteAgain: 'Send it again',
    sentTimes: 'Written to {n} times, never signed in. Worth checking the address is right.',
    inviteFailed: 'That invitation could not be sent',
    withdraw: 'Withdraw access',
    confirmWithdraw: 'Withdraw it',
    withdrawing: 'Withdrawing…',
    whyWithdraw: 'Why?',
    whyWithdrawHint: 'The practice reads this when deciding whether to restore them.',
    actionFailed: 'That could not be done',
    readOnlyTitle: 'Only the administrator can change this',
    readOnlyBody:
      'You can see who has access, so you know who to ask. Adding people, changing what they may do and withdrawing access are the administrator’s to do — deliberately, because they decide who can reach patient records.',
    addTitle: 'Give somebody access',
    addBody:
      'They get their own account, so what they do is recorded against their name rather than the practice’s.',
    addName: 'Their name',
    addEmail: 'Their email',
    addEmailHint: 'Their own address, not a shared one — this is how they will be identified.',
    addRole: 'What they may do',
    addRoleHint: 'Deliberately thin for now. More roles arrive as we learn which pages each needs.',
    roleOther: 'Ordinary access',
    roleAdmin: 'Administrator',
    addScope: 'Where',
    addScopeHint: 'The whole practice, one site, or one department within a site.',
    add: 'Add them',
    adding: 'Adding…',
    addFailed: 'They could not be added',
    addThenInvite:
      'This creates the record. Sending them an enrolment link is a separate step, so adding several people does not fire several credential links by accident.',
  },
  reviews: {
    title: 'Changes to look at',
    lead:
      'Changes a practice made to its own record that are worth a second pair of eyes. None of these is identity evidence — the ABN and legal name cannot be edited at all — but not identity evidence is not the same as nobody should look.',
    waiting: 'waiting',
    needAPerson: 'need a person',
    filterState: 'Show',
    anyOpen: 'Still open',
    resolved: 'Already decided',
    search: 'Search',
    searchHint: 'Matches the field name and both values, plus the summary and who raised it.',
    searchPlaceholder: 'An address, a field name, a name…',
    noMatchTitle: 'Nothing here matches that',
    noMatchBody:
      'There are {n} tasks loaded and none of them contain what you typed. Clear the search to see them '
      + 'again — this filters what is on screen, so a task that has not loaded yet will not be found by it.',
    filterKind: 'Kind',
    anyKind: 'Any kind',
    notLoaded: 'The review queue could not be read',
    emptyTitle: 'Nothing to look at',
    emptyBody: 'No changes are waiting. An empty queue is the normal state.',
    highStakes: 'A person must decide',
    lowStakes: 'May be checked automatically',
    /* The admin_invite_failed task's own controls. */
    inviteErrorLabel: 'The provider said:',
    retryInvite: 'Send the invitation again',
    retrying: 'Sending…',
    retryOutcome: 'What happened',
    retrySent: 'The invitation went out.',
    retryNotSent: 'It could not be sent — the reason above still stands.',
    theySaid: 'They said:',
    colField: 'Field',
    colFrom: 'Was',
    colTo: 'Now',
    wasEmpty: '(empty)',
    nowEmpty: '(cleared)',
    automatedSaid: 'An automated check said',
    confidence: 'confidence',
    adviceOnly:
      'This is advice, not a decision. It is shown here because this kind of change always needs a person — the check has flagged what it saw and you are the one deciding.',
    claimedBy: 'Being reviewed by',
    claim: 'I am reviewing this',
    claimLapsed: 'Their claim has lapsed — anybody may take this',
    decision: 'Your decision',
    chooseDecision: 'Choose…',
    note: 'Note',
    noteHint: 'Optional. What you checked, and what convinced you.',
    decide: 'Record the decision',
    deciding: 'Recording…',
    actionFailed: 'That could not be recorded',
    resolutionLabels: {
      no_change_needed: 'Looked, and it is fine',
      /*
       * NOT OFFERED IN THE DROP-DOWN — the catalogue returns only the
       * resolutions a person may choose, and this one is written by the code
       * that actually mints the replacement invitation. It is here so a task
       * closed that way READS properly wherever a resolution is shown.
       */
      reinvited: 'A new invitation was sent',
      corrected: 'Something was wrong and I fixed it',
      not_a_problem: 'Not a problem — expected change',
      escalated: 'Passing this to somebody else',
    },
  },
  queue: {
    // On the setup hub, pointing at this screen.
    hubTitle: 'Messages',
    hubBody:
      'Everything this practice has sent, and anything still waiting to go. The card nobody opens until ' +
      'somebody says they never received a notice.',
    title: 'Outbound queue',
    lead:
      'Everything waiting to leave the platform, and everything that has. This is transport: what was sent, and what happened to it, lives with the record it belongs to and is kept far longer.',
    chooseTitle: 'Choose a practice first',
    chooseBodyOperator:
      'The queue is read one practice at a time, because these messages carry patient details. Pick a practice from the list and come back.',
    chooseBodyPractice: 'We could not tell which practice you belong to. Sign in again and try once more.',
    waiting: 'waiting',
    dead: 'gave up',
    attempts: 'attempts',
    refresh: 'Refresh',
    filterMedia: 'Type',
    anyMedia: 'Any type',
    filterState: 'State',
    anyState: 'Any state',
    filterOrg: 'Organisation',
    orgPlaceholder: 'Type a few letters…',
    orgHint: 'Which practice. Type to narrow the list.',
    recipientPlaceholder: 'Anybody — or type a name',
    recipientHint: 'Pick somebody, or type any part of a name or address.',
    typeToNarrow: 'Type to narrow',
    colRecipient: 'Sent to',
    inactive: 'closed',
    filterLocation: 'Site',
    anyLocation: 'Any site',
    filterDepartment: 'Department',
    anyDepartment: 'Any department',
    filterRecipient: 'Sent to',
    anyRecipient: 'Anybody',
    filterSearch: 'Find',
    filterSearchWide: 'Name, address, or what it is about',
    resend: 'Send again',
    resendCancel: 'Cancel — do not send it again',
    resending: 'Sending…',
    resendTitle: 'Send this again',
    resendBody:
      'This copies the message and queues the copy. The original stays exactly as it is — including if it failed, because that attempt really did happen.',
    resendReason: 'Why are you sending it again?',
    resendChoose: 'Choose a reason…',
    resendNote: 'What happened',
    resendNoteHint:
      'At least {n} words. A resend is a second time we say notice was given, so the next person reading this needs to know what happened rather than that it did.',
    resendNoteShort: '{n} more word(s) needed.',
    resendReasonHint: 'Pick the one that fits. If you keep choosing “another reason”, tell us — the list is missing something.',
    resendFailed: 'It could not be sent again',
    resentTimes: 'sent again',
    resentCopy: 'a re-send',
    back: 'Back to set up',
    colType: 'Type',
    colSite: 'Site',
    colState: 'State',
    colWhen: 'When',
    colTo: 'To',
    noSite: '—',
    filterSearchHint: 'Matches the destination and what it is about — never the message body.',
    notLoaded: 'The queue could not be read',
    emptyTitle: 'Nothing here',
    emptyBody: 'No messages match those filters. An empty queue is the normal state.',
    awaitingDevice: 'waiting for a device',
    opening: 'Opening…',
    notOpened: 'That could not be opened',
    pdfInStore: 'The document is in the artefact store:',
    pdfMissing: 'This is marked as a PDF but carries no stored document.',
  },
  locations: {
    // --- The reviewer's decision -------------------------------------
    decisionLegend: 'Confirm this address, or send it back',
    rejectTitle: 'Send it back',
    rejectAction: 'Send it back to the practice',
    rejectBody:
      'The practice sees your reason and can correct the address themselves. Nothing is deleted — ' +
      'the address stays as they entered it, so they can see what we looked at.',
    reasonLabel: 'Why are you sending it back?',
    reasonHint: 'The practice sees this, so choose the one that tells them what to change.',
    reasonPlaceholder: 'Choose a reason…',
    practiceWillSee: 'The practice will read:',
    detailLabel: 'What did you find?',
    detailHint: 'Optional. Anything that would help them fix it faster.',
    detailRequiredHint: 'Required for this reason — without it the practice cannot tell what to change.',
    methodLabel: 'How did you check it?',
    methodHint: 'Recorded permanently. “Confirmed” without a method cannot be weighed by anybody later.',
    methodPlaceholder: 'Choose how it was checked…',
    documentLabel: 'The document you checked',
    documentHint: 'Required for this method. Up to 20 MB.',
    uploading: 'Uploading…',
    uploadTooLarge: 'That file is over 20 MB. Attach a smaller copy or a single relevant page.',
    noteLabel: 'Note',
    noteHint: 'Optional. What you saw, in your own words.',
    noteRequiredHint: 'Required for “something else” — the note IS the record.',
    catalogueLoading: 'Loading the check list…',
    working: 'Working…',
    // --- The practice correcting its own address ---------------------
    editTitle: 'Edit this address',
    editBody:
      'You can correct this address until somebody here confirms it. After that it may already ' +
      'appear on captured agreements, so changing it needs a review.',
    editLine1: 'Street address',
    editLine2: 'Level, unit or suite',
    editSuburb: 'Suburb',
    editState: 'State',
    editStateHint: 'NSW, VIC, QLD, WA, SA, TAS, ACT or NT.',
    editPostcode: 'Postcode',
    editCode: 'Your name for this site',
    editCodeHint: 'Optional. What your staff call it — “Main St”, “After Hours”.',
    editSave: 'Save the address',
    editFailed: 'That address could not be saved',
    // --- What the practice is told when we send one back -------------
    sentBackTitle: 'We could not confirm this address',
    sentBackBy: 'Sent back by',
    sentBackDetail: 'What we found:',
    // --- How a confirmed address was checked -------------------------
    confirmedHow: 'Confirmed by',
    confirmedVia: 'Checked by',
    confirmedDocument: 'Document on file',
    audience: 'Practice admin',
    title: 'Locations',
    lead:
      'Every place your practice works from. A location’s address is printed on each agreement captured ' +
      'there, so an address nobody has confirmed cannot host practitioners yet.',
    backToSetup: 'Back to set up',

    notLoaded: 'The locations could not be loaded',
    loading: 'Loading…',

    emptyTitle: 'No locations yet',
    emptyBody:
      'A practice needs at least one confirmed location before any practitioner can be affiliated to it, ' +
      'and therefore before any consent can be recorded. Add the first one below.',

    // --- Status ---
    active: 'Confirmed',
    inactive: 'Not confirmed',
    activeNote: 'Practitioners can be affiliated here.',
    inactiveNote:
      'No practitioner can be affiliated here, because the address has not been confirmed. It would ' +
      'otherwise appear on an agreement unchecked.',
    validatedBy: 'Confirmed by',
    noState:
      'This location has no state, so we cannot pick the right public-holiday calendar for it. Terminations ' +
      'are counted in business days, and those differ by state — fix the address before confirming.',

    // --- Adding ---
    addTitle: 'Add a location',
    addLead:
      'The street address of a place your practice works from. Type it as it appears on the building, not as ' +
      'a postal address — this is where patients are seen.',
    addressLine1: 'Street address',
    addressLine1Hint: 'Number and street, e.g. 14 Wickham Terrace',
    addressLine2: 'Suite, level or unit',
    addressLine2Hint: 'Optional.',
    suburb: 'Suburb',
    state: 'State or territory',
    statePick: 'Choose…',
    stateHint:
      'Sets the public-holiday calendar used to count business days for terminations, which differs by state.',
    postcode: 'Postcode',
    code: 'Your name for this site',
    codeHint:
      'Optional, and only for your staff — “Main St”, “After Hours”. It is never ' +
      'printed on an agreement.',
    addAction: 'Add this location',
    adding: 'Adding…',
    addFailed: 'The location could not be added',

    // --- Address checking ---
    checkedTitle: 'Address confirmed automatically',
    checkedBody: 'It matched the national address file, so this location is ready to use.',
    unconfirmedTitle: 'The address could not be confirmed automatically',
    unconfirmedBody:
      'That is common and does not mean it is wrong — new developments and consulting suites are often ' +
      'missing from the national file. Someone here can confirm it by hand instead.',
    suggestionsTitle: 'Did you mean',

    // --- Confirming by hand ---
    confirmedByUsTitle: 'AoBPlatform confirms this address, not you',
    confirmedByUsBody:
      'This address is printed on every agreement captured here, so confirming it is us CHECKING your ' +
      'evidence — and a practice cannot check its own. Somebody here verifies it against the building, your ' +
      'letterhead, or a call to you, and their name is recorded against it. Nothing is needed from you ' +
      'unless we ask.',
    confirmTitle: 'Confirm this address',
    confirmBody:
      'Confirm only if you have checked the address itself — on the building, on the practice’s own ' +
      'letterhead, or with the practice by phone. Your name is recorded against it permanently, because this ' +
      'address goes on to appear on legal records of consent.',
    confirmAs: 'This will be recorded as confirmed by',
    confirmName: 'Your name',
    confirmNameHint: 'Recorded with the confirmation. Not the practice name — yours.',
    confirmAction: 'Confirm the address',
    confirming: 'Confirming…',
    confirmFailed: 'The address could not be confirmed',
    confirmCancel: 'Cancel',

    // --- Departments ---
    departments: 'Departments',
    departmentsNone: 'No departments. Practitioners can be affiliated to the location itself.',
    departmentsLead:
      'An optional subdivision — “Emergency”, “Oncology”, “Allied Health”. ' +
      'Nothing in the legislation turns on it; it is there because large sites need it to find people.',
    departmentAdd: 'Add a department',
    departmentName: 'Department name',
    departmentAction: 'Add',
    departmentAdding: 'Adding…',
    departmentFailed: 'The department could not be added',
    departmentNeedsActive:
      'Departments can be added once the address is confirmed. Confirming is the step that makes this ' +
      'location real.',

    countOne: '1 location',
    countMany: '{n} locations',
    activeCount: '{n} confirmed',
    inactiveCount: '{n} awaiting confirmation',
  },
  /**
   * The practice's roster of practitioners.
   *
   * THE ONE FACT THIS PAGE IS ABOUT: has a human actually looked at the AHPRA
   * public register for this person, or are we repeating what somebody typed?
   * Entering a registration number proves nothing — it is the check that
   * carries weight, which is the same rule the credential score rests on
   * (IDENTITY-STRENGTH-DESIGN.md §1).
   */
  practitioners: {
    audience: 'Practice admin',
    title: 'Practitioners',
    lead:
      'The practitioners your practice works with. Adding someone here creates their identity on the ' +
      'platform; it does not put them at one of your locations — that is an affiliation, and only they can ' +
      'accept it.',
    backToSetup: 'Back to set up',
    notLoaded: 'The practitioners could not be loaded',
    loading: 'Loading…',

    emptyTitle: 'No practitioners yet',
    emptyBody:
      'Add the practitioners your practice works with. You will need each person’s AHPRA registration ' +
      'number — it is on their registration certificate, and it is what makes them one identity across ' +
      'every practice they work at.',

    countOne: '1 practitioner',
    countMany: '{n} practitioners',
    checkedCount: '{n} register checked',
    uncheckedCount: '{n} not checked',

    // --- Status on a card ---
    registerChecked: 'Register checked',
    registerNotChecked: 'Register not checked',
    registerNotCheckedNote:
      'Nobody has looked this person up on the AHPRA public register yet. Until somebody does, all we hold ' +
      'is what was typed in — and a registration number that has never been checked is worth nothing.',
    checkedBy: 'Checked by {who} on {when}',
    sourceApi: 'Checked automatically',
    deregistered: 'Not registered',
    deregisteredNote:
      'AHPRA no longer registers this practitioner. Every affiliation ended immediately — there is no notice ' +
      'period for deregistration, and nothing further can be captured in their name.',
    notAffiliated: 'Not at any of your locations yet',
    notAffiliatedNote:
      'This person exists on the platform but has not been invited to one of your locations. Nothing can be ' +
      'captured in their name until they accept an invitation.',
    affiliationSummary: '{active} active · {invited} awaiting acceptance',
    emailWithheld:
      'Another practice added this practitioner, so we do not show you their email address. Invitations are ' +
      'sent by us, and inviting is done by AHPRA number — you do not need it.',
    noEmail:
      'No email address on record, so we have nowhere to send an invitation. They would have to accept in ' +
      'the console instead.',
    invite: 'Invite to a location',

    // --- Recording the register check ---
    checkTitle: 'Record what the register says',
    /*
     * SHOWN ON THE CARD OF A PRACTITIONER WHO IS ALREADY HERE, so it must not
     * read as instructions for adding one. It ended "Add them here and enter
     * their AHPRA number", which told an existing, affiliated practitioner's
     * card how to create the record it was already sitting on.
     */
    checkedByUsTitle: 'AoBPlatform checks the register, not you',
    checkedByUsBody:
      'A register check is our evidence that somebody independent looked. It is what turns a typed-in ' +
      'registration number into something with weight, so a practice checking its own practitioner would ' +
      'be awarding itself the check. We have their AHPRA number and the check is ours to do — nothing is ' +
      'needed from you unless we ask. They can be invited and can work in the meantime; the check has to ' +
      'be recorded before consent can be captured under their name.',
    checkOpen: 'Record a register check',
    checkLead:
      'Search the AHPRA public register for this practitioner and record what it says. Your name is kept ' +
      'with it: this is our evidence that somebody looked, and evidence needs an author.',
    checkRegisterLink: 'Open the AHPRA register',
    checkStatus: 'Registration status',
    checkStatusHint: 'As the register words it. Only “Registered” permits practice.',
    checkProfession: 'Profession',
    checkProfessionHint: 'e.g. Medical Practitioner, Nurse, Physiotherapist.',
    checkDivision: 'Division',
    checkConditions: 'Conditions, undertakings or reprimands',
    checkConditionsHint:
      'Copy them across verbatim. Someone can be fully registered and still restricted in what they may do, ' +
      'and that is the thing most easily skimmed past.',
    checkSuburb: 'Principal place of practice — suburb',
    checkSuburbHint:
      'The register publishes suburb and postcode only, never a street address. If it matches the location ' +
      'you affiliate them to, a regulator has independently placed this person there.',
    checkPostcode: 'Postcode',
    checkState: 'State',
    checkTypeHeading: 'Registration held',
    checkTypeHint:
      'A practitioner commonly holds more than one at once, each with its own expiry. Record the one that ' +
      'covers the work they do here.',
    checkType: 'Type',
    checkTypeOptions: 'General | Specialist | Limited | Provisional | Non-practising',
    checkSpecialty: 'Specialty',
    checkSpecialtyHint: 'On a specialist registration, e.g. General practice.',
    checkExpiry: 'Expiry date',
    checkExpiryHint:
      'A date in the past does not necessarily mean anything is wrong — AHPRA allows a late period while a ' +
      'renewal is finalised. It is recorded as a warning, never a refusal.',
    checkSightedBy: 'Your name',
    checkSightedByHint: 'Recorded permanently against this check.',
    checkAction: 'Record this check',
    checking: 'Recording…',
    checkFailed: 'The check could not be recorded',
    checkCancel: 'Cancel',
    checkDone: 'Recorded',
    checkRefused: 'This status does not permit practice',

    // --- Adding a practitioner ---
    /*
     * WHEN THE AHPRA NUMBER IS ALREADY ON THE PLATFORM.
     *
     * This used to be a refusal: "already on this platform, invite them to your
     * practice instead" -- true, and a dead end. The practice had typed the one
     * identifier that settles who somebody is, and got told to go elsewhere and
     * do something else.
     */
    /*
     * WHICH HAT. Somebody who arrived by acting as the practice and somebody
     * who arrived from the organisation list see the same roster, and the
     * difference in what they may do is invisible without saying it.
     */
    platformModeTitle: 'You are here as AoBPlatform, not as this practice',
    platformModeBody:
      'Recording what the AHPRA register says is our check, not theirs — a practice recording its own '
      + 'practitioner as Registered would be a self-attestation wearing the name of an independent one. So '
      + 'this page is here to be checked, not added to. Adding a practitioner or inviting one is the '
      + 'practice’s act: start an "acting as" session from the organisation list if that is what you meant.',
    historyShow: 'Every check',
    historyEmpty: 'No check has been recorded against this practitioner yet.',
    historyNobody: 'nobody named',
    existsTitle: 'This practitioner is already on AoBPlatform',
    existsBody:
      'A practitioner is one identity across every practice they work at, so there is nothing to create. '
      + 'Check the details below against their registration, then invite them to one of your locations.',
    existsCheck: 'Is this the person you meant?',
    existsName: 'Name',
    existsAhpra: 'AHPRA number',
    existsType: 'Profession',
    existsStatus: 'Registration',
    existsStatusUnknown: 'Nobody has checked the register for them yet',
    existsVerified: 'Identity confirmed',
    existsUnverified: 'Identity not yet confirmed',
    existsDeregisteredTitle: 'Their registration is recorded as ended',
    existsDeregisteredBody:
      'While that stands, consent cannot be captured under their name. Invite them if you need to, but the '
      + 'block stays until the register says otherwise.',
    existsInvite: 'Invite them to a location',
    existsNotThem: 'That is not who I meant',
    /*
     * THE REGISTER ITSELF. The practice is being asked to confirm an identity,
     * and the only authority on that is AHPRA -- so the link is next to the
     * details rather than somewhere else on the page.
     */
    existsOnRegister: 'Check them on the AHPRA register',
    existsOnRegisterHint:
      'Opens the public register in a new tab. Search for {ahpra} — the name and profession there are what '
      + 'these details should match.',
    /*
     * NAME FIELDS ARE LOCKED once the practitioner exists. A practice that
     * could rename an existing practitioner could quietly point a confirmed
     * identity at a different person, and any register check already recorded
     * would go on attesting to a name that had changed underneath it.
     */
    existsNameLocked:
      'The name comes from their record and is not edited here. If it is wrong, tell us — a register check '
      + 'may have been recorded against it.',
    lookingUp: 'Checking whether we already hold this AHPRA number…',
    addTitle: 'Add a practitioner',
    addLead:
      'This creates the practitioner’s identity on AoBPlatform. One person, one record, however many ' +
      'practices they work at — which is what lets a deregistration stop them everywhere at once.',
    addAhpra: 'AHPRA registration number',
    addAhpraHint: 'Three profession letters then ten digits, e.g. MED0001234567.',
    addFamilyName: 'Family name',
    addGivenNames: 'Given names',
    addProviderType: 'Role at your practice',
    addProviderTypeHint:
      'Checked against the profession on the register. A mismatch is usually a slip, and is surfaced rather ' +
      'than blocked.',
    addEmail: 'Their email address',
    addEmailHint:
      'THEIRS, not the practice’s. Invitations go here, and that is what stops a practice accepting an ' +
      'affiliation on a practitioner’s behalf.',
    addAction: 'Add this practitioner',
    adding: 'Adding…',
    addFailed: 'The practitioner could not be added',
    addedTitle: 'Practitioner added',
    addedBody:
      'They now exist on the platform. Next, invite them to one of your locations — and then only they can ' +
      'accept it.',

    providerTypes: {
      general_practitioner: 'General practitioner',
      specialist: 'Specialist',
      nurse_practitioner: 'Nurse practitioner',
      optometrist: 'Optometrist',
      allied_health: 'Allied health',
      other: 'Other',
    } as Record<string, string>,
  },
  /**
   * The practitioner's invitation page.
   *
   * DECLINING IS AS PROMINENT AS ACCEPTING. Not a link in the small print — a
   * button of the same size beside it. A page where declining is hard is a page
   * that manufactures consent, and consent is the only thing this platform
   * sells.
   */
  invitation: {
    audience: 'Your invitation',
    checking: 'Opening your invitation…',

    title: 'You have been invited',
    invitedBy: 'Invited by {who}',
    on: 'on {when}',

    meansTitle: 'What accepting means',
    // The caveat is NOT here. It comes from the domain, through the API, so the
    // page and the invitation email cannot drift into saying two slightly
    // different things about the same limit (see invitation.ts).

    codeTitle: 'Enter the code from your invitation email',
    codeLead:
      'Six digits. The code is what answers this, not the link — so an automated scanner that opened the ' +
      'link on your behalf cannot answer for you.',
    codeLabel: 'Six-digit code',
    // An INSTRUCTION, not a restatement. The message underneath already says
    // the code was wrong and how many attempts remain -- it has to, because
    // it is the API's own error text and stands alone for callers with no
    // heading above it. A title repeating it just said the same sentence twice.
    wrongCode: 'Check the code and try again',

    accept: 'Accept — I practise here',
    decline: 'Decline this invitation',
    answering: 'Sending your answer…',

    acceptedTitle: 'Accepted',
    acceptedBody:
      '{practice} can now record patient consent naming you as the practitioner at that location. You can ' +
      'end this at any time by telling them, and they must record the date you leave.',
    acceptedProves:
      'For the record, we have written down exactly how you accepted: by opening the invitation sent to ' +
      'your email address and typing the code from it. That proves access to your inbox, not who was at ' +
      'the keyboard — and we would rather say so than overstate it.',

    declinedTitle: 'Declined',
    declinedBody:
      'We have told {practice} that you declined. Nothing has been recorded in your name, and nothing ' +
      'further will be.',
    declinedMistake:
      'If that was a mistake, ask the practice to invite you again. A declined invitation cannot be ' +
      'reopened from this link — deliberately, because a decline that anybody holding the link could undo ' +
      'would not be worth much.',

    deadTitle: 'This invitation cannot be answered',
    unexpectedTitle: 'Not expecting this?',
    unexpectedBody:
      'You can decline it, or simply ignore it — it expires on its own. Nothing is recorded in your name ' +
      'unless you accept. If you think it was sent to you in error, tell the practice.',

    notLoaded: 'This invitation could not be loaded',
  },
  /**
   * Affiliations — the edge between a practitioner and a place.
   *
   * THE DISTINCTION THIS PAGE EXISTS TO KEEP VISIBLE: invited is not accepted.
   * A practice looking at "four practitioners" will read that as four
   * practitioners who can have consent captured in their name, and it is not —
   * an invitation nobody has answered is worth nothing. So every row says where
   * it has got to, and says whether capture is actually open.
   */
  /**
   * WHOSE PROVIDER NUMBER THE CLAIM GOES UNDER (Carl, 5-7 Sep 2026; TODO.md
   * "Billing role on the affiliation").
   *
   * KEYED BY THE ROLE, and the keys come from versioned content
   * (packages/domain/content/billing-roles.json). The screens render the
   * content file in file order and look the words up here (REQ-LANG-01/-02):
   * a translated word must never be able to change who may be named on a
   * contract, so the mapping lives in the file and the words live here.
   *
   * "PROVIDER", NOT "GP" (CLAUDE.md section 3) -- except inside the label for
   * a role that is about general practice, where the word IS the fact.
   */
  billingRoles: {
    label: 'Billing role',
    hint:
      'Who the claim goes under at this location. The provider named on an agreement is the servicing '
      + 'provider whose provider number goes on the claim — not, of itself, whoever delivered the service.',
    /** The display words, keyed by content key. */
    names: {
      servicing_provider: 'Servicing provider',
      works_under_provider: 'Works under a provider',
      not_billable: 'Not billable to Medicare',
    } as Record<string, string>,
    /** One line each, so somebody choosing can tell which is theirs. */
    describe: {
      servicing_provider:
        'Bills under their own provider number here. May be named as the provider on an agreement.',
      works_under_provider:
        'A practice nurse on “for and on behalf of” items. The claim goes under the provider they '
        + 'work under, so an agreement names that provider, never them.',
      not_billable:
        'Generates no Medicare claim from the practice — a phlebotomist, or administrative staff. Never on '
        + 'an agreement.',
    } as Record<string, string>,
    /** A role this build does not know. Shown, never swallowed (Carl, 4 Sep 2026). */
    unknown: (key: string) => `Unrecognised billing role (${key}). Please tell support this code.`,
    saving: 'Saving…',
    saveFailed: 'The billing role could not be changed',
    /**
     * CARL'S SECOND RULING, IN THE PRACTICE'S OWN WORDS. A servicing provider
     * with no provider number recorded is ALLOWED — s 65C(5)(a) identifies
     * the professional by name and the address of the place of practice —
     * and FLAGGED, so a practice that meant to record one can see that it did
     * not. It is a note, never a block.
     */
    noProviderNumberFlag: 'No provider number recorded',
    noProviderNumberNote:
      'No provider number recorded — agreements will identify this provider by name and practice address.',
  },

  affiliations: {
    externalNoticeTitle: 'This date has already passed',
    externalNoticeBody:
      'We cannot have given notice through AoBPlatform before a date that has gone by. If the ' +
      'practitioner was told another way, say so and we will record that — the agreements ceased on ' +
      'their last day either way, and leaving this unrecorded would keep showing them as still ' +
      'working here.',
    externalNoticeTick: 'Notice was given outside AoBPlatform',
    externalNoticeMeansLabel: 'How were they told?',
    externalNoticeMeansPlaceholder: 'Choose how…',
    externalNoticeGivenAt: 'When were they told?',
    externalNoticeGivenAtHint: 'The date notice was actually given, not the date you are recording it.',
    externalNoticeNote: 'Note',
    externalNoticeNoteHint: 'Optional, unless you chose “something else”.',
    practiceOnlyTitle: 'Only the practice can invite a practitioner',
    practiceOnlyBody:
      'An invitation is the practice saying this person works here, and it is how they come to be ' +
      'named on consent records at that location. AoBPlatform does not send it for them — otherwise ' +
      'the practice’s own records would show them inviting somebody they never did. Ask the practice ' +
      'to send it from their console.',
    audience: 'Practice admin',
    title: 'Affiliations',
    lead:
      'Which practitioners work at which of your locations. A practitioner’s Medicare provider number ' +
      'belongs to a place, not to a person, so this is where it lives — and only the practitioner can ' +
      'accept one of these.',
    sortLabel: 'Order',
    sortAttention: 'What needs attention',
    sortRecent: 'Most recent first',
    sortOldest: 'Oldest first',
    sortHint:
      'By default the ones that cannot capture consent come first, because that is the question this page '
      + 'answers. Sort by date when you are looking for something you did rather than something to do.',
    backToSetup: 'Back to set up',
    notLoaded: 'The affiliations could not be loaded',
    loading: 'Loading…',

    emptyTitle: 'No affiliations yet',
    emptyBody:
      'Nothing can be captured until at least one practitioner has accepted an affiliation at a confirmed ' +
      'location. Invite one below.',

    countOne: '1 affiliation',
    countMany: '{n} affiliations',
    captureOpen: '{n} capture open',
    awaiting: '{n} awaiting an answer',

    // --- Status ---
    statusInvited: 'Awaiting their answer',
    statusNotSent: 'Not sent yet',
    statusActive: 'Accepted',
    statusEnding: 'Ending',
    statusEnded: 'Ended',
    statusRejected: 'Declined',

    notSentNote:
      'Nobody has told this practitioner they have been invited. Until an invitation goes out, this is ' +
      'waiting on you and not on them.',
    sentNote: 'Invitation sent {when}. Only the practitioner can answer it.',
    expiresNote: 'It stops working on {when}.',
    acceptedNote: 'Accepted {when}.',
    endingNote: 'Notice given. This ends on {when}, and capture continues until then.',
    endedNote: 'Ended {when}. Enduring agreements at this location ceased on that date.',
    rejectedNote: 'The practitioner declined this invitation.',
    /* One affiliation's whole life, next to the row it belongs to. */
    historyShow: 'What happened to this one',
    historyEmpty: 'Nothing has been recorded against this affiliation yet.',
    howAccepted: 'How it was accepted',

    providerNumber: 'Provider number',
    noProviderNumber: 'No provider number',
    noProviderNumberNote:
      'Not a problem in itself — the law identifies a practitioner by name and the address of the place of ' +
      'practice, OR by the provider number for that place. The confirmed address covers it.',

    // --- Actions ---
    send: 'Send the invitation',
    resend: 'Send it again',
    sending: 'Sending…',
    sendFailed: 'The invitation could not be sent',
    sentTitle: 'Invitation sent',
    resendNote:
      'Sending again replaces the previous link, so the old one stops working immediately. That is ' +
      'deliberate: every re-send would otherwise leave another live invitation in an inbox.',

    notice: 'Record their departure',
    noticeLead:
      'The date they actually leave, as agreed with them. Enduring agreements at this location cease on ' +
      'that date — they do not lapse quietly, they cease, and the evidence is kept in full.',
    noticeDate: 'Last day at this location',
    noticeBy: 'Your name',
    noticeReason: 'Reason',
    noticeReasonHint: 'Optional. Kept with the record.',
    noticeAction: 'Record it',
    noticing: 'Recording…',
    noticeFailed: 'That could not be recorded',
    withdraw: 'Withdraw the notice',
    withdrawing: 'Withdrawing…',
    cancel: 'Cancel',

    // --- Inviting ---
    inviteTitle: 'Invite a practitioner to a location',
    inviteLead:
      'This creates the invitation. It does not make them active — only they can do that, from a link sent ' +
      'to their own email address.',
    invitePractitioner: 'Practitioner',
    invitePractitionerHint: 'Somebody already on your list. Add them there first if they are not.',
    invitePractitionerPick: 'Choose…',
    inviteLocation: 'Location',
    inviteLocationHint: 'Only confirmed locations can host a practitioner.',
    inviteLocationPick: 'Choose…',
    inviteNoLocations:
      'None of your locations has a confirmed address yet, so there is nowhere to affiliate anybody. ' +
      'Confirm one first.',
    inviteNoPractitioners:
      'You have no practitioners on your list yet. Add one before inviting them anywhere.',
    inviteDepartment: 'Department',
    inviteDepartmentNone: 'None',
    inviteProviderNumber: 'Their provider number here',
    inviteProviderNumberHint:
      'Optional, and it belongs to this location specifically — a practitioner has one per place of ' +
      'practice. It is never shown to another practice.',
    inviteBy: 'Your name',
    inviteByHint: 'Recorded as the person who invited them.',
    inviteAction: 'Invite them',
    inviting: 'Inviting…',
    inviteFailed: 'The invitation could not be created',
    invitedTitle: 'Invited',
    invitedBody: 'Now send them the invitation, using the button on their row above.',

    toPractitioners: 'Manage practitioners',
    toLocations: 'Manage locations',
  },
  /**
   * How a practice reaches a patient, and what it asks them.
   *
   * THE SENDER ID IS ONBOARDING, NOT SETTINGS. Registering one with ACMA has a
   * lead time measured in weeks, and until it is done every message shows to
   * patients as "Unverified" and is grouped by the handset alongside scams. A
   * practice that discovers that after going live has already trained its
   * patients to ignore it.
   */
  channels: {
    audience: 'Practice admin',
    title: 'Capture channels',
    lead:
      'How consent requests reach your patients, and what they are asked to confirm. These settings decide ' +
      'whether a request is trusted, read, and answered.',
    backToSetup: 'Back to set up',
    notLoaded: 'The channel settings could not be loaded',

    /*
     * WHICH PARTS OF AoB THIS PRACTICE USES (D-2026-09-14-04).
     *
     * ON THIS PAGE RATHER THAN A NEW ONE. The idle timeout and the enduring
     * default already live here, this page already saves through
     * `PATCH /practices/:id/config`, and a practice-wide switch on its own
     * screen is a screen nobody ever finds.
     *
     * IT SAYS "SWITCHED OFF", NEVER "REMOVED". The whole decision is that
     * these stay built: turning one on is this control, not a rebuild, and
     * everything recorded while a part was on is still there afterwards. A
     * person reading a list of things their practice does not have needs to
     * know which of those two it is.
     */
    surfacesTitle: 'Which parts of AoB this practice uses',
    surfacesLead:
      'Not every practice uses every part of AoB. What is switched off is hidden from your staff and refused '
      + 'by the server, so nothing half-works — and nothing is removed: switching a part back on brings it and '
      + 'everything it recorded straight back.',
    surfacesLabel: 'Parts in use',
    surfacesHint: 'Changing this changes what your staff can open. It is recorded, with who changed it.',
    surfacesOn: 'Switched on',
    surfacesOff: 'Switched off',
    /** Keyed by profile key, so the words never decide what a profile means. */
    surfaceProfileNames: {
      full: 'Everything',
      db4: 'The DB4 path only',
      standard: 'Everything except the DB4 path',
    } as Record<string, string>,
    /**
     * KEYED BY SURFACE KEY (REQ-LANG-01/-02), never in the content file. The
     * JSON decides what a surface COVERS; these decide what it is called, and
     * a translated word must never be able to change what a practice may
     * reach. An unmapped key falls back to the key itself so a new surface is
     * diagnosable rather than invisible.
     */
    surfaceNames: {
      db4: 'The DB4 path',
      kiosk_walk_up: 'Walk-up at the waiting-room tablet',
      enduring_agreements: 'Ongoing agreements and 89AA notices',
      queue_rails: 'The front desk’s queue rails',
      portal: 'The patient portal',
      practitioner_pages: 'The practitioners’ own pages',
    } as Record<string, string>,
    loading: 'Loading…',
    saved: 'Saved',
    saveFailed: 'That could not be saved',
    save: 'Save',
    saving: 'Saving…',

    // --- SMS sender ID ---
    smsTitle: 'SMS sender ID',
    smsLead:
      'The name patients see a message from. Registering one with ACMA takes weeks, and it is not something ' +
      'that can be hurried later.',
    smsUnregistered: 'Not registered',
    smsRegistered: 'Registered',
    smsWhy:
      'Until a sender ID is registered, Australian carriers show your messages as coming from an ' +
      '“Unverified” sender, and handsets group those with scams. Patients do not open them. That does not ' +
      'stop you capturing consent — it quietly destroys how often anyone answers.',
    smsMark: 'ACMA has registered our sender ID',
    smsMarkHint:
      'Tick this only once ACMA has confirmed it. It is an assertion by your practice, recorded as such — ' +
      'we cannot check it for you.',

    // --- Link expiry ---
    expiryTitle: 'How long a consent link lives',
    expiryLead:
      'A request sent to a patient stops working after this. Shorter is safer; too short and a patient who ' +
      'reads their messages in the evening finds a dead link and rings the practice instead.',
    expiryLabel: 'Hours',
    expiryHint: 'Between 1 and 168 (a week).',

    // --- Identifiers ---
    identifiersTitle: 'What a patient is asked to confirm',
    identifiersLead:
      'Before consent is recorded, a patient confirms who they are. Choose which details are asked for — ' +
      'at least three.',
    identifiersFloor: 'At least three must be chosen.',
    identifiersNever:
      'The Medicare card number is NOT on this list and never will be. Cards are shared between family ' +
      'members, so the number identifies a household rather than a person — and we do not store it ' +
      'anywhere, at all.',
    identifierNames: {
      name: 'Name',
      date_of_birth: 'Date of birth',
      gender: 'Gender',
      address: 'Address',
      patient_record_number: 'Patient record number',
      ihi: 'Individual Healthcare Identifier',
    } as Record<string, string>,
    identifierNotes: {
      name: 'Family and given names together count as one.',
      date_of_birth: '',
      gender: 'As the patient identifies it, not as recorded elsewhere.',
      address: '',
      patient_record_number: 'Your own number for them, from your PMS.',
      ihi: 'The 16-digit national identifier. Not everyone knows theirs.',
    } as Record<string, string>,

    // --- Kiosk ---
    //
    // Reads the same `/devices` list the setup hub's Tablets card does, so
    // the two can never disagree about how many tablets are paired (see
    // `DevicesSummary` in ChannelsView.tsx). This used to say "Not built
    // yet" long after pairing existed and tablets were actually paired.
    kioskTitle: 'Kiosk',
    kioskDone: 'Paired',
    kioskNeedsWork: 'Needs work',
    kioskNone: 'No tablet paired yet',
    kioskSummary: (paired: number, revoked: number) =>
      `${paired} tablet${paired === 1 ? '' : 's'} paired · ${revoked} revoked`,
    // WHAT AN OPERATOR SEES INSTEAD OF A COUNT, viewing this read-only.
    // `GET /devices` is `@PracticeScoped`, so a platform session with no
    // practice claim is refused — and a wrong "0 paired" would read as "no
    // tablets", which may simply be untrue.
    kioskUnavailable: 'Act as the practice to see which tablets are paired.',
    kioskManage: 'Manage tablets',

    /*
     * --- RETURN TO THE START WHEN THE TABLET IS UNTOUCHED (Carl, 4 Sep 2026).
     *
     * SET IN MINUTES, STORED IN SECONDS. Nobody standing at this page thinks
     * "three hundred"; the tablet counting down does. The conversion happens
     * here rather than in the API so the server keeps one unit.
     *
     * THE HELPER SAYS WHY, not what. A practice reading "returns to the start"
     * will lengthen it to be kind to slow readers unless somebody tells them
     * what the number is actually protecting — a walked-away patient's name,
     * date of birth and address, on a device on a counter, in a room full of
     * strangers.
     */
    idleTitle: 'Return a tablet to the start when nobody is using it',
    idleLead:
      'A patient is called in part-way through, or simply walks off. Until the tablet returns to the start '
      + 'their name, date of birth and address are still on the screen, and the next person to pick it up is '
      + 'a stranger. Any touch resets the clock, and a quiet warning appears thirty seconds before it happens.',
    idleLabel: 'Minutes of no activity',
    idleHint: 'Between 1 and 30. Five is the default — long enough to read an agreement standing up.',
    /*
     * CLOSE UNSIGNED AGREEMENTS NOBODY NEEDED (D-2026-10-10-09, option 3; Carl:
     * "N is 7 days - make N a configurable setting"). What the sweep does is
     * said exactly, including what it never closes.
     */
    closeTitle: 'Close unsigned agreements when no service was recorded',
    closeLead:
      'An agreement nobody signed, for a visit with no service recorded, is closed after this many days as '
      + '"not needed: no service recorded". It is kept, not deleted, and the closure is recorded. An agreement '
      + 'linked or associated with a service, matched by one, on a tablet, or with a live link is never closed this way.',
    closeLabel: 'Days after the visit',
    closeHint: (min: number, max: number, defaultDays: number, version: string) =>
      `Between ${min} and ${max}. Leave empty to use the default, ${defaultDays} days (${version}).`,

    /**
     * WHICH AGREEMENT THE PRE-STEP OFFERS FIRST (Carl, 4 Sep 2026; GA-PLAN B6).
     *
     * THE LABEL IS THE RULING'S OWN WORDS, kept verbatim. It says "GP
     * practices" in the label itself because the alternative — a practice
     * manager at a specialist clinic ticking it and wondering why nothing
     * changed — is exactly the confusion the parenthesis prevents. Enduring is
     * GP-only and per practitioner × patient however this is set (hard rule 6,
     * REQ-END-01/-01a), and the hint says that too rather than leaving a
     * setting to look like a permission.
     *
     * NO BENEFIT OR DOLLAR AMOUNT anywhere in this copy (hard rule 4), and
     * nothing here claims any of it is certified or approved (hard rule 12).
     */
    enduringTitle: 'What the tablet offers first',
    enduringLabel:
      'Offer an ongoing bulk-billing agreement by default (GP practices). Patients who decline get an '
      + 'agreement for the visit instead.',
    enduringHint:
      'A default, not a permission. Ongoing agreements are for general practitioners only, and are always '
      + 'between one provider and one patient — never practice-wide.',
    enduringLead:
      'An ongoing agreement is signed once and covers that provider’s bulk-billed services from that day '
      + 'until the patient or the provider ends it, so there is nothing to sign after each visit. Turn this '
      + 'off and the tablet offers an agreement for the visit every time.',

    /**
     * --- THE PRACTICE'S TIMEZONE (D-2026-10-10-03).
     *
     * WHAT IT DECIDES, IN THE PRACTICE'S WORDS: when "today" starts on the
     * desk and the tablet, and so which unsigned agreements move to "earlier
     * days". The zone list is content (`practice-timezones.json`); these are
     * only its names, keyed by IANA zone, and an unmapped zone shows its key.
     */
    timezoneTitle: 'Your practice’s time zone',
    timezoneLead:
      'Today’s list on the desk and the tablet starts at midnight in this time zone. Unsigned agreements '
      + 'from before that midnight move to “Unsigned from earlier days”.',
    timezoneLabel: 'Time zone',
    timezoneHint: 'Changing this moves where each day starts. It is recorded, with who changed it.',
    timezoneNames: {
      'Australia/Sydney': 'Sydney, Canberra (NSW, ACT)',
      'Australia/Melbourne': 'Melbourne (VIC)',
      'Australia/Brisbane': 'Brisbane (QLD)',
      'Australia/Adelaide': 'Adelaide (SA)',
      'Australia/Darwin': 'Darwin (NT)',
      'Australia/Perth': 'Perth (WA)',
      'Australia/Hobart': 'Hobart (TAS)',
      'Australia/Broken_Hill': 'Broken Hill (NSW, on South Australian time)',
      'Australia/Lindeman': 'Whitsunday Islands (QLD)',
      'Australia/Eucla': 'Eucla (WA, central western time)',
      'Australia/Lord_Howe': 'Lord Howe Island (NSW)',
    } as Record<string, string>,

    /**
     * --- D6a, THE PRACTICE DEFAULT (Carl, 5 Sep 2026; GA-PLAN B10).
     *
     * THE WORDS THEMSELVES ARE NOT IN HERE, and that is the point. The
     * descriptions are versioned content served by `GET
     * /service-descriptions` — the exact strings the rules engine matches,
     * case-sensitively — so they cannot live in a string table or a component
     * (hard rule 14). What is here is the copy AROUND the list: what the
     * setting does, and what happens when it is not set.
     *
     * THE LEAD SAYS THE CONSEQUENCE, not the mechanism. "Without one, arrivals
     * wait on the queue" is the sentence a practice manager needs; "the
     * appointment sweep does not populate `serviceDescription`" is not.
     *
     * NOTHING HERE CLAIMS ANY OF IT IS CERTIFIED, APPROVED OR ACCREDITED (hard
     * rule 12): the permitted phrase is "checked against the s 65C data set",
     * and there is no benefit or dollar amount anywhere in it (hard rule 4).
     */
    d6aTitle: 'Default service description for agreements made at reception',
    d6aLead:
      'Every agreement created when a patient arrives is locked with this description. Without one, '
      + 'arrivals wait on the queue until reception sets it on the row.',
    d6aLabel: 'Description',
    d6aHint:
      'Chosen from the current list, which is checked against the s 65C data set. The version is recorded '
      + 'with every agreement it decides, so a later question about which list was in force has an answer.',
    d6aNone: 'No default',
    /** Which list these words came from — shown beside them, never inferred. */
    d6aVersion: (version: string) => `from mapping ${version}`,
    d6aSave: 'Save default',
    d6aSaving: 'Saving…',
    d6aSaved: 'Default saved',
    d6aFailed: 'That default could not be saved',
    d6aUnavailable: 'The service descriptions could not be loaded, so the default cannot be changed here.',
    /*
     * SHORTCUTS TO THE ANSWER, NOT DIRECTIONS TO A SCREEN (Carl, 4 Sep 2026).
     * The count is the specific reason and the link lands on the page holding
     * the rows — saving a default does NOT reach back and change drafts that
     * already exist, so this says how many are still waiting rather than
     * letting the practice assume they were swept up.
     */
    d6aPending: (n: number) =>
      `${n} agreement${n === 1 ? '' : 's'} on the queue ${n === 1 ? 'has' : 'have'} no description yet — `
      + 'set them on their rows.',
    d6aPendingLink: 'Open the queue',

    /**
     * THE DOCUMENT ITSELF LIVES ELSEWHERE, and this is the signpost. A
     * practice setting up capture will look for the letterhead here; a link
     * costs nothing and a second copy of the settings would cost a divergence.
     */
    documentTitle: 'The agreement document',
    documentLead:
      'The letterhead at the top of every agreement, your logo, and the words the patient reads and ticks.',
    documentOpen: 'Open the agreement document',
  },
  /**
   * WHAT THE AGREEMENT LOOKS LIKE AND WHAT IT SAYS (Carl, 5 Sep 2026; W1).
   *
   * A NAMESPACE OF ITS OWN, and a page of its own, because it is not a
   * channel. `channels` is how a request reaches a patient; this is the
   * document — the letterhead at the top of it and the words in it, which are
   * read at different times by different people and have a platform review
   * queue behind them.
   *
   * THE INSTRUMENT'S OWN WORDS ARE NOT IN HERE. They are versioned content
   * (`packages/domain/content/agreement-templates.json`) served by the API, so
   * a copy in this table would be a second, unversioned copy of the operative
   * text of a contract. What is here is the copy AROUND them.
   *
   * NOTHING BELOW SAYS "certified", "approved" or "accredited" about our forms
   * (hard rule 12) and nothing carries an amount (hard rule 4).
   */
  templates: {
    audience: 'Practice admin',
    navLabel: 'Agreement document',
    title: 'The agreement document',
    lead:
      'What appears at the top of every agreement this practice makes, and the words in it. The details '
      + 'are read from your practice record; the logo and the wording are set here.',
    backToChannels: 'Back to capture channels',
    loading: 'Loading…',
    notSet: 'Not set',

    // --- Letterhead ---
    letterheadTitle: 'Letterhead',
    letterheadLead: 'These print at the top of every agreement, and on the copy the patient can download.',
    /*
     * WHY THEY CANNOT BE EDITED HERE, said once and plainly. A practice that
     * is not told will look for the edit control, not find it, and conclude
     * the page is broken.
     */
    letterheadWhereFrom:
      'These come from your practice record — the legal name, trading name and ABN as they were checked '
      + 'against the Australian Business Register. Change them there and the letterhead follows.',
    fieldLegalName: 'Legal name',
    fieldTradingName: 'Trading as',
    fieldAddress: 'Address',
    fieldPhone: 'Phone',
    fieldEmail: 'Email',
    fieldAbn: 'ABN',

    // --- Logo ---
    logoTitle: 'Logo',
    logoLead:
      'PNG or JPEG, up to 512 KB. It is drawn at a fixed size, so the file’s own dimensions do not change '
      + 'the page.',
    logoPresent: 'On the letterhead',
    logoAbsent: 'None',
    logoChoose: 'Choose a logo file',
    logoRemove: 'Remove the logo',
    logoDetail: (width: number, height: number, hash: string) => `${width} × ${height} pixels · ${hash}`,
    logoTooLarge: (kb: number) => `That file is ${kb} KB. A logo may be at most 512 KB.`,
    logoUnreadable: 'That file could not be read.',
    /*
     * THE ONE THING SOMEBODY WILL WORRY ABOUT before pressing Remove, answered
     * before they press it. Agreements already signed embed those exact bytes
     * and are re-checked against them every time they are shown.
     */
    logoKeepsWorking:
      'Removing the logo stops it printing on new agreements. Agreements already signed keep the logo '
      + 'they were signed with — the image stays in the record so those copies still verify.',

    // --- Wording ---
    wordingTitle: 'Wording',
    wordingLead:
      'Every agreement is written from a template. The standard wording is checked against the s 65C data '
      + 'set; a practice that wants different words can propose its own.',
    /*
     * WHY THERE IS NO ACTIVATE BUTTON HERE. Said as a fact about how the
     * process works rather than as a refusal, because a practice reading this
     * has not yet done anything wrong.
     */
    wordingReviewed:
      'Wording you propose is read by AoBPlatform before it is used, because it is the operative text of a '
      + 'legal agreement. You will see the reviewer’s notes here.',
    typeName: {
      episodic: 'Agreement for a visit',
      enduring: 'Ongoing agreement',
    } as Record<string, string>,
    statusName: {
      draft: 'Draft — not yet submitted',
      in_review: 'With AoBPlatform for review',
      active: 'In use',
      retired: 'Retired',
    } as Record<string, string>,
    usingGenericWording: (version: string) => `Using the standard wording (${version}).`,
    usingPracticeWording: (version: string, reviewer: string) =>
      `Using this practice’s wording (${version}), reviewed by ${reviewer}.`,
    showGeneric: (version: string) => `Show the standard wording (${version})`,
    showVariant: 'Show this wording',
    statementsHeading: 'What the person signing ticks',
    reviewerSaid: (reviewer: string, note: string) => `${reviewer}: ${note}`,
    propose: 'Propose our own wording',
    retire: 'Withdraw this wording',
    cancel: 'Cancel',
    saveDraft: 'Save as a draft',
    submitForReview: 'Submit for review',
    proposeSaved: 'Saved.',
    /*
     * THE EDITOR IS A FORM NOW, NOT A JSON TEXTAREA (Carl, 7 Sep 2026): "make
     * this custom text a form and then you put it together in the right JSON
     * format". What used to be one `editorLabel` over a box of braces is the
     * block below.
     */
    editorLead:
      'Rewrite the wording in your own words. The shape is fixed — the same sections and the same '
      + 'statements to tick — and every element of the s 65C data set must still appear. The checks beside '
      + 'the form run as you type.',
    /*
     * GENERATED, NOT TYPED (Carl, 7 Sep 2026). The version name still has to
     * satisfy `TEMPLATE_VERSION_PATTERN` — lower case, hyphens, ending in a
     * number — but that is a fact about the pattern, not a form a practice
     * manager should have to fill in correctly. `versionGenerated` is shown
     * read-only; the input and its hint below only appear once "Change" is
     * pressed, for the rare case somebody wants a different name.
     */
    versionGenerated: (version: string) => `Version: ${version}`,
    versionChange: 'Change',
    versionLabel: 'Version name',
    versionPlaceholder: 'e.g. our-clinic-episodic-1',
    versionHint:
      'Lower case, words joined by hyphens, ending in a number. A rewrite mints a new one, so an agreement '
      + 'already signed still says what it was made from.',

    titleLabel: 'Title',
    titleHint: 'One line, at the top of the document.',

    sectionsHeading: 'Sections',
    sectionsHint:
      'The sections are fixed and appear in this order. You write the heading and the paragraphs under it.',
    sectionKeyLabel: (key: string) => `Section: ${key}`,
    sectionHeadingLabel: 'Heading',
    paragraphLabel: (n: number) => `Paragraph ${n}`,
    addParagraph: 'Add a paragraph',
    removeParagraph: 'Remove',

    statementsFormHeading: 'What the person signing ticks',
    /*
     * WHY THE COUNT IS FIXED, said as a fact about review rather than as a
     * refusal. The keys are what a signature records, so adding or removing a
     * statement changes what a signature MEANS.
     */
    statementsFormHint:
      'These are the statements the person signing ticks, one box each. You can change the words; the '
      + 'number of statements is fixed, because the tick is recorded against the statement it was given '
      + 'for. Adding or removing one is a change we would need to look at with you.',
    statementKeyLabel: (key: string) => `Statement: ${key}`,

    footerHeading: 'Footer',
    footerHint: 'The small print at the bottom. One line here is one line on the document.',

    /* --- The placeholder picker --- */
    insertDetail: 'Insert detail',
    insertDetailChoose: 'Insert detail…',
    insertOnlyWhen: 'Only when…',
    /*
     * PICKED, NEVER TYPED. `{{patientNam}}` renders literal braces onto a
     * contract; a menu cannot produce one that does not exist.
     */
    insertHint:
      'The details are filled in when the agreement is made. Put the cursor where you want one and choose '
      + 'it from the menu — do not type the braces yourself.',
    onlyWhenIf: (label: string) => `Only when ${label}`,
    onlyWhenUnless: (label: string) => `Only when NOT ${label}`,
    /** How each placeholder reads to a person. Keyed by the content file's own key. */
    placeholderLabels: {
      patientName: 'The patient’s name',
      agreementDate: 'The date of the agreement',
      providerDetails: 'The provider’s details',
      providerName: 'The provider’s name',
      serviceDate: 'The date of the service',
      basicServiceDescription: 'A description of the service',
      mbsItemNumbers: 'The item numbers',
      mappingVersion: 'The service-description list version',
      assignorName: 'The name of the person signing',
      assignorRelationship: 'Their relationship to the patient',
      enduringPathway: 'How the ongoing agreement is registered',
      coveredServiceScope: 'What the ongoing agreement covers',
      notificationMethod: 'How the patient is told',
      terminationMethod: 'How the agreement is ended',
      commencementDate: 'The date it starts',
    } as Record<string, string>,
    /** The two branches, in words. Keyed by the content file's own condition key. */
    conditionLabels: {
      isPreAgreement: 'the agreement is made before the service',
      assignorIsPatient: 'the patient is signing for themselves',
    } as Record<string, string>,

    /* --- The live checks --- */
    checksHeading: 'Checks',
    checksPassing: 'Everything the s 65C data set needs is here, and nothing that is not allowed.',
    checksBlocked: (n: number) =>
      n === 1 ? '1 thing to fix before this can be saved' : `${n} things to fix before this can be saved`,
    /*
     * THE STICKY BAR'S ONE LINE (Carl, 7 Sep 2026: "the yellow box need to be
     * fixed"). Pinned to the foot of the form so it is on screen while
     * scrolling; collapsed, this is the whole of it, and it says both the
     * count and what pressing it does.
     */
    checksSummaryBlocked: (n: number, expanded: boolean) =>
      `${n === 1 ? '1 thing to fix' : `${n} things to fix`} — ${expanded ? 'hide' : 'show'}`,
    /*
     * A MISSING ELEMENT IN WORDS (Carl, 7 Sep 2026). "it never renders
     * {{patientName}}" is the loader talking to a developer; this is what a
     * practice manager needs to read.
     */
    checkMissingElement: (label: string) => `${label} is not mentioned yet.`,
    checkMissingElementUnlabelled: (key: string) => `The agreement must still mention {{${key}}}.`,
    checkNeedsTitle: 'The document needs a title.',
    checkNeedsVersion:
      'The version name must be lower case, words joined by hyphens, and end in a number — for example '
      + 'our-clinic-episodic-1.',
    checkNeedsStatementText: (key: string) => `The statement “${key}” has no words in it.`,
    saveBlocked: 'Save and Submit open once the checks above pass.',

    /* --- Preview --- */
    previewShow: 'Preview with sample data',
    previewHide: 'Close the preview',
    /*
     * IT IS NOT THE DOCUMENT, AND IT SAYS SO ON ITSELF. The signed agreement
     * is rendered once, on the server, and hashed there (hard rule 13). This
     * is the wording with obviously fake values in it, so a practice can read
     * their own sentences as a person will.
     */
    previewNotice: 'Preview — not the signed document. The details below are made-up samples.',
    previewBranchNote:
      'A document takes one branch of each “only when”. This preview shows an agreement made before '
      + 'the service, signed by someone for the patient.',
    previewLetterhead: 'Your letterhead prints here',
    previewFailed:
      'The preview could not be drawn from this wording yet. The checks above say what is outstanding.',
    /** Obviously fake, for the preview only. No amount, and no Medicare number. */
    sampleValues: {
      patientName: 'Jamie Sampleton',
      agreementDate: '7 September 2026',
      providerDetails: 'Dr Sample Provider, 1 Example Street, Sampletown NSW 2000',
      providerName: 'Dr Sample Provider',
      serviceDate: '7 September 2026',
      basicServiceDescription: 'General practitioner attendance',
      mbsItemNumbers: '23',
      mappingVersion: 'sample-mapping-1',
      assignorName: 'Alex Sampleton',
      assignorRelationship: 'Parent',
      enduringPathway: 'MyMedicare registration',
      coveredServiceScope: 'general practitioner attendances with this provider',
      notificationMethod: 'a text message to the mobile we hold',
      terminationMethod: 'telling reception, in writing or in person',
      commencementDate: '7 September 2026',
    } as Record<string, string>,
    sampleFallback: (key: string) => `sample ${key}`,
  },

  /**
   * THE PLATFORM'S SIDE OF THE SAME THING — the review queue (W1).
   *
   * A SEPARATE NAMESPACE FROM `templates`, because the audience is different
   * and so is the act. A practice proposes; an operator READS THE WORDS and
   * decides whether patients may be shown them. The copy here is about that
   * decision and says what activating actually does.
   */
  platformTemplates: {
    audience: 'Platform admin',
    title: 'Agreement wording review',
    lead:
      'Wording practices have proposed for the agreements their patients sign. Activating it puts these '
      + 'words in front of patients, so read them.',
    loading: 'Loading…',
    notLoaded: 'The review queue could not be loaded',
    empty: 'Nothing is waiting to be read.',
    waitingCount: (n: number) => `${n} waiting`,
    submittedBy: (name: string, when: string) => `Submitted by ${name}, ${when}`,
    inUse: (version: string) => `In use: ${version}`,
    /*
     * WHAT THE CHECKS ALREADY DID, so a reviewer knows what is left for THEM.
     * The loader has refused an amount, a practitioner signature line, the
     * approval words and a missing data element before this row existed; what
     * a person is here for is whether the sentences are true and fair.
     */
    alreadyChecked:
      'Already checked mechanically: every element of the s 65C data set appears, and there is no amount, '
      + 'no practitioner signature line and no claim of approval. What is left is whether the words are '
      + 'accurate and fair to the patient.',
    activate: 'Activate this wording',
    requestChanges: 'Send back with notes',
    notesLabel: 'Notes for the practice',
    notesRequired: 'Say what needs to change. A refusal with no reason is not a review.',
    activated: 'Activated.',
    sentBack: 'Sent back to the practice.',
    failed: 'That could not be saved',
  },

  /**
   * The two identity dashboards (IDENTITY-STRENGTH-DESIGN.md §7).
   *
   * PLATFORM OPERATOR ONLY. Each answers one operational question, and the copy
   * keeps saying which: "which applications are stuck, and on what" and "whose
   * verification is going stale, and who is moving unusually". A dashboard that
   * shows numbers without an operational question is a report nobody opens.
   */
  identity: {
    audience: 'Platform admin',
    title: 'Identity strength',
    lead:
      'What we actually know about the practices and practitioners on the platform — and, while enforcement ' +
      'is soft, what turning it on would have cost.',
    notLoaded: 'The dashboard could not be loaded',
    loading: 'Loading…',
    backToQueue: 'Back to the review queue',

    tabPractices: 'Practices',
    tabPractitioners: 'Practitioners',

    // --- Soft mode ---
    softTitle: 'Enforcement is soft',
    softBody:
      'Nothing here refuses anybody. The “would fail” count is what hard enforcement would have cost today — ' +
      'how many real practices we would have turned away. That is the number that decides when the ' +
      'threshold is safe to switch on, and it is invisible unless soft mode runs first: you cannot ' +
      'calibrate a threshold you are already enforcing, because you never see the outcomes of the ' +
      'applications you rejected.',
    wouldFail: '{n} would fail under hard enforcement',
    wouldPass: '{n} would pass',

    // --- Practices ---
    practicesQuestion: 'Which applications are stuck, and on what?',
    practiceScore: 'Score',
    practiceChecks: '{passed} passed · {failed} failed · {incomplete} could not complete',
    // Singular and plural kept as separate strings rather than assembled from
    // a pluralisation rule. "1 days" is the kind of thing that makes a screen
    // look unfinished, and en-AU only needs two forms -- a rule engine here
    // would be more machinery than the problem.
    practiceQueue: 'Waiting {n} days',
    practiceQueueOne: 'Waiting 1 day',
    practiceDecided: 'Decided after {n} days',
    practiceDecidedOne: 'Decided after 1 day',
    practiceQueueToday: 'Decided the same day',
    practiceWaitingToday: 'Arrived today',
    practiceNoChecks: 'No checks have been recorded at all. Nothing is known about this applicant beyond what they typed.',
    practiceWouldPass: 'Would pass',
    practiceWouldFail: 'Would fail',
    practiceArtefacts: '{n} artefacts',
    practiceCredentials: '{verified} of {total} credentials verified',
    practiceOpen: 'Open the dossier',

    // --- Practitioners ---
    practitionersQuestion: 'Whose verification is going stale, and who is moving unusually?',
    strengthScore: 'Strength',
    ofPotential: 'of {n} if checked today',
    sightedDays: 'Register checked {n} days ago',
    sightedOne: 'Register checked yesterday',
    sightedToday: 'Register checked today',
    sightedNever: 'Register never checked',
    stale: 'Stale',
    decaying: 'Decaying',
    fresh: 'Fresh',
    blocked: 'Blocked',
    restricted: 'Restricted',
    moving: 'Moving unusually',
    affiliations: '{active} active of {total}',
    acceptedBy: 'Accepted by: {passkey} passkey · {email} emailed code',
    // The fact only a cross-practice view can see.
    allOnOneInbox:
      'Every one of this practitioner’s affiliations rests on access to a single email inbox. That is a fact ' +
      'about the whole set, not about any one of them, and it is only visible from here.',
    nothingOutstanding: 'Nothing outstanding.',

    // --- Filters ---
    search: 'Search',
    searchHintPractices: 'Name, legal name or ABN.',
    searchHintPractitioners: 'Name or AHPRA number.',
    showing: 'Showing',
    of: 'of',
    clear: 'Clear',
    noMatch: 'Nothing matches that',
    filters: {
      all: 'All',
      would_fail: 'Would fail',
      waiting: 'Still waiting',
      no_checks: 'No checks',
      blocked: 'Blocked',
      never_checked: 'Never checked',
      stale: 'Going stale',
      restricted: 'Restricted',
      moving: 'Moving unusually',
    } as Record<string, string>,
  },
  /**
   * The entity, read-only — and read-only is the point.
   *
   * The ABN is a LOCKED field (amendment.ts). A different ABN is a different
   * legal entity, and a different legal entity is a different application, not
   * an edit. Showing a form here would imply otherwise.
   */
  entity: {
    audience: 'Practice admin',
    title: 'The entity',
    lead:
      'What the register says about the entity behind this practice, and how we checked it. Held as the ' +
      'record of who was approved — none of it can be edited here.',
    backToSetup: 'Back to set up',
    notLoaded: 'The entity could not be loaded',
    loading: 'Loading…',

    scoreAtDecision: 'Identity strength {n} at approval',
    contactsTitle: 'Who we contact',
    contactsLead:
      'The only part of this page that can be changed here. A contact detail is not evidence — it is how we ' +
      'reach you, and the commonest thing wrong with an approved practice is a mistyped address.',
    adminContact: 'Practice administrator',
    managerContact: 'Second contact',
    contactsEdit: 'Correct these details',
    contactsEditLead:
      'Your name and a reason are recorded with the change. This is the record of who was approved, and a ' +
      'change to it with no stated reason is indistinguishable from a mistake.',
    contactsSaved: 'Contact details updated.',
    adminName: 'Name',
    adminEmail: 'Email',
    adminEmailHint: 'Everything we send about this practice goes here, including sign-in invitations.',
    adminPhone: 'Phone',
    managerName: 'Name',
    managerEmail: 'Email',
    managerEmailHint:
      'Must reach a different inbox from the administrator. One inbox is not two contacts — the second ' +
      'contact exists so a reviewer has somebody to call who is not the applicant.',
    managerPhone: 'Phone',
    recordedAs: 'This will be recorded as changed by',
    changedBy: 'Your name',
    changedByHint:
      'Asked only because practice sign-in does not exist yet. It identifies nobody and is recorded as an ' +
      'assertion.',
    noSessionName:
      'Nobody is signed in, so the name below is typed rather than known. It is recorded as an assertion, ' +
      'not as an identity — and it stops being asked for the moment practice sign-in exists.',
    changeReason: 'Why',
    changeReasonHint: 'One line. It is kept with the change and shown in the trail below.',
    emailWillUnverify:
      'The administrator email is changing, so it stops being confirmed. The old address had been proved to ' +
      'reach somebody; the new one has not, and carrying that across would claim a round trip that never ' +
      'happened. Send the sign-in invitation again afterwards.',
    save: 'Save the change',
    saving: 'Saving…',
    saveFailed: 'That could not be saved',
    cancel: 'Cancel',
    resendInvitation: 'Send the sign-in invitation again',
    resending: 'Sending…',

    checksTitle: 'What has been checked',
    checksLead:
      'Every check performed on this practice, oldest first. Append-only: performing one again adds an ' +
      'entry rather than replacing it, so a correction never hides what it corrected.',
    checksSummary: 'Score {score} · {passed} of {performed} passed',
    checksNone: 'No checks have been recorded.',

    credentialsTitle: 'Credentials',
    credentialsLead:
      'Entering a credential is worth nothing on its own — anybody can type a number. It counts once ' +
      'somebody has actually checked it, and the record says who.',
    credentialsSummary: '{verified} of {total} verified',
    credentialsNone: 'No credentials recorded.',
    credentialVerifiedBy: 'Checked by {who} — {how}.',
    credentialUnverified: 'Not checked yet, so it counts for nothing.',
    verified: 'Checked',
    unverified: 'Not checked',

    locationsTitle: 'Locations',
    locationsSummary: '{active} of {total} confirmed',
    confirmed: 'Confirmed',
    unconfirmed: 'Not confirmed',
    manageLocations: 'Manage locations',

    auditTitle: 'Everything that has happened',
    auditSummary: 'Every change, check and file, oldest first.',
    legalName: 'Legal name',
    tradingAs: 'Trading as',
    abn: 'ABN',
    acn: 'ACN',
    entityType: 'Entity type',
    abnStatus: 'ABN status',
    headOffice: 'Head office',
    approvedBy: 'Approved by',
    approvedOn: 'on',
    notApproved: 'Not yet approved',

    verifiedHow: 'How the ABN was checked',
    verifiedAbr: 'Checked against the Australian Business Register.',
    verifiedAttested:
      'ATTESTED, not checked. {who} stated these details and a reviewer accepted them; the register itself ' +
      'was not reachable at the time. That is weaker than a lookup and is recorded as such.',

    /*
     * PROVENANCE AND DATE TOGETHER. An ABN check is a fact about a day: "the
     * register said ACTIVE" with no date is a claim with no shelf life, and a
     * date with no source does not say whether the register or a colleague was
     * the one who said it.
     */
    verifiedSource: 'Source',
    verifiedSourceUnknown: 'not recorded',
    verifiedOn: 'as at {date}',
    verifiedNever: 'no check date recorded',

    recheckButton: 'Re-check with the Australian Business Register',
    recheckBusy: 'Asking the register…',
    recheckLead:
      'Asks the register again, now. An ABN status can change after approval, and a re-check also replaces ' +
      'a typed attestation with the register’s own answer. It cannot change the ABN itself — a different ' +
      'ABN is a different entity, and that is a new application.',
    recheckUnchanged: 'The register still shows {status}. Nothing changed.',
    recheckStatusChanged: 'The register now shows {status}. That is a change, and it has been recorded.',
    recheckUpgraded: 'The typed attestation has been replaced by the register’s own answer.',
    recheckEntityTypeChanged:
      'The register now describes this entity as {type}, which is not what the application was assessed ' +
      'against. It has been recorded and left for a person to look at rather than quietly rewritten.',
    recheckFailed: 'The register could not be asked, so nothing was changed.',
    recheckUnknownReason: 'The reason code was {code} — quote it if you contact us.',
    recheckReasons: {
      no_record: 'The register now holds no entity against this ABN, which is unusual enough to be looked at by a person.',
      invalid_search_text: 'The register would not accept the stored ABN as an ABN.',
      register_refused: 'The register declined our request. That is a fault at our end and is already logged.',
      not_configured: 'This environment has no connection to the register configured.',
      timeout: 'The register did not answer in time.',
      network: 'We could not reach the register.',
      http_error: 'The register answered with an error.',
      unparseable: 'The register answered with something we could not read.',
    } as Record<string, string>,

    lockedTitle: 'Why none of this can be edited',
    lockedBody:
      'The ABN identifies the legal entity that was approved. A different ABN is a different entity, so it ' +
      'is a new application rather than a correction — and every consent record captured here names this ' +
      'entity. If something is genuinely wrong, tell us and it is handled as a correction with its own trail.',

    emailVerified: 'Practice-admin email confirmed',
    emailUnverified: 'Practice-admin email NOT confirmed',
    emailUnverifiedBody:
      'Nobody has proved they can read mail at that address. Everything we send about this practice goes ' +
      'there, including sign-in invitations.',
  },
  /**
   * The PMS connection.
   *
   * DELIBERATELY UNFINISHED, and says so. How results are written back is an
   * open decision (D-01), and a card that looked complete would be promising
   * something that does not exist.
   */
  pms: {
    audience: 'Practice admin',
    title: 'PMS connection',
    lead: 'How AoBPlatform exchanges data with your practice management system.',
    backToSetup: 'Back to set up',
    notLoaded: 'The connection could not be loaded',

    systemLabel: 'Your system',
    stateLabel: 'Connector',
    stateUnpaired: 'Not connected',
    stateUnpairedBody:
      'The site connector has not been paired with this practice yet. Nothing is exchanged until it is.',

    howTitle: 'How the connector works',
    howBody:
      'It runs on a Windows machine inside your practice and dials OUT only. Nothing listens for an inbound ' +
      'connection, so it opens no port on your network and there is nothing for anyone outside to connect to.',

    unsettledTitle: 'What is not settled yet',
    unsettledBody:
      'How results are written back into your PMS is an open decision. Until it is made, this promises a ' +
      'download and nothing more — an unfinished page is better than a finished-looking one that does not ' +
      'work. It is tracked as D-01.',

    downloadTitle: 'What you can rely on today',
    downloadBody:
      'Consent records can be exported from AoBPlatform and kept alongside your own records. Nothing is ' +
      'written into your PMS automatically, and nothing will be until that decision is made and told to you.',
  },
  /**
   * THE KIOSK (C2) — the waiting-room ceremony at `/kiosk`.
   *
   * Ported from `apps/kiosk` (Expo), which is retired: one codebase, one theme,
   * one string table, one lint config (Carl, 3 Sep 2026). Every word the tablet
   * can render lives under this key and nowhere else (REQ-LANG-01).
   *
   * THREE RULES ARE ENFORCED OVER THIS SUBTREE BY NAMED TESTS, and they are
   * asserted against `strings.kiosk` alone rather than the whole table, because
   * this is the surface a patient reads:
   *
   *   NO "certified", "approved", "accredited" or "government-approved" about
   *   our forms (REQ-65C-05, hard rule 12). The permitted phrasings are
   *   "checked against the s 65C data set" and "self-assessment", and they are
   *   used below. "Approve" as the PATIENT'S action is a different word doing a
   *   different job and is fine.
   *
   *   NO DOLLAR AMOUNT anywhere (REQ-REG-04, hard rule 4). Not a fee, not a
   *   benefit, not a gap. The 89AA notice is the one artefact in the platform
   *   that carries one and the kiosk never shows an 89AA notice.
   *
   *   NO PRACTITIONER SIGNATURE FIELD (rule 3, abolished 1 July 2026). The one
   *   permitted mention is the tag that says there is not one.
   *
   * UK/AU spelling throughout (CLAUDE.md §3). "Provider", not GP; "service",
   * not consult; "assignor" is never silently called the patient.
   *
   * `identifierNames` is read dynamically by type — the server sends
   * `identifierTypes` and the screen renders from that list. Only the approved
   * six have entries, deliberately: there is no key for a card number because
   * there is no field for one (REQ-VER-02).
   */
  /*
   * THE PRACTICE'S TABLETS — the console side of device pairing.
   *
   * THE WORDS AVOID "LOGIN" AND "PASSWORD" THROUGHOUT, and that is a decision
   * rather than a style. Pairing is a device credential, in the sense a
   * payment terminal is paired to a merchant; calling it a login would invite
   * somebody to reason about it as one — to share it, to write it down, to
   * expect it to expire when a person leaves. It is a thing a device holds and
   * a thing the practice takes back.
   *
   * AND IT NEVER SAYS "CERTIFIED", "APPROVED" OR "ACCREDITED" (hard rule 12).
   */
  devices: {
    title: 'Tablets',
    lead:
      'The waiting-room tablets paired to this practice. Pairing is what lets a tablet see who is checking '
      + 'in; revoking one takes that back on its next request.',
    audience: 'Practice',
    notLoaded: 'The tablets could not be loaded',
    loading: 'Loading…',
    none: 'No tablet is paired to this practice yet.',
    noneHint: 'Add one, then type the code it shows into the tablet at /kiosk.',

    /*
     * "ADD A TABLET" AT THE TOP, RIGHT OF THE HEADING (Carl, 4 Sep 2026 —
     * "Add a tablet is buried"). The list is what the reader came to check;
     * the button opens the same name form inline, above the list, rather than
     * in a section people had to scroll past everything else to find.
     */
    addToggleAction: 'Add a tablet',
    addTitle: 'Add a tablet',
    addHint: 'Give it a name somebody could find it by — "Reception tablet 1".',
    labelLabel: 'What this tablet is called',
    addAction: 'Add tablet',
    addBlocked: 'Add tablet — give it a name first',
    adding: 'Adding…',

    /*
     * WHEN THE SERVER ASKS WHO IS THERE (AUTH-TIERS.md §5.2, D-2026-09-12-11).
     *
     * A SHORTCUT TO THE ANSWER, NOT DIRECTIONS TO A SCREEN (CLAUDE.md §7).
     * The fix for a stale session is not on another page, so there is no link
     * — there is a control, right here, that re-runs the sign-in and comes
     * back to this list. The other code has no control, because signing in
     * again would not help: the account has no second factor to present, and
     * the sentence says what would.
     *
     * `stepUpUnmapped` is the defect case made visible. A reason code this
     * build has not met shows its own code rather than a soothing generic
     * sentence, so it can be diagnosed instead of guessed at.
     */
    stepUpTitle: 'Confirm it is you',
    stepUpReauthenticate:
      'Revoking a tablet cannot be undone, so it needs a sign-in from the last few minutes. Confirm it is you '
      + 'and this list comes straight back.',
    stepUpAction: 'Confirm it is you',
    stepUpSecondFactorMissing:
      'This account signs in with a password and nothing else, so it cannot revoke a tablet. Add an '
      + 'authenticator app or a passkey to the account, then try again.',
    stepUpMethodUnrecorded:
      'The sign-in service did not say how this sign-in was made, so the server cannot confirm a passkey was used, and '
      + 'revoking a tablet needs that. Nothing was changed.',
    stepUpUnmapped: (code: string) =>
      `The server refused this and gave a reason this screen does not recognise: ${code}. Nothing was changed.`,

    /*
     * THE CODE, SHOWN ONCE. The screen says so, because a code that cannot be
     * fetched again is a surprise unless it was announced — and the way out of
     * having lost it is Re-Pair Tablet (the rotate act; renamed by Carl,
     * 10 Oct 2026, because "Rotate" read as turning the screen), which is named
     * here rather than left to be discovered.
     */
    codeHeading: 'Type this code into the tablet',
    codeShownOnce: 'This code is shown once. If it is lost, re-pair the tablet for a new one.',
    codeWhere: 'On the tablet, open /kiosk and enter the code.',
    codeExpires: (minutes: number) =>
      minutes <= 0
        ? 'This code has expired. Re-pair the tablet for a new one.'
        : minutes === 1
          ? 'Expires in 1 minute'
          : `Expires in ${minutes} minutes`,
    codeDone: 'Done',
    codeCopyAction: 'Copy',
    codeCopied: 'Copied',
    /*
     * A WAITING ROW NAMED ITS CODE (Carl, 4 Sep 2026 — "how do I pair these
     * tablets?"). The row used to say only that a code was outstanding, never
     * the code itself, which left the person reading it with nothing to type
     * into the tablet. This is shown only for as long as THIS page has held
     * the code in memory — never fetched back from the server, which still
     * shows it exactly once.
     */
    codeExpiredLabel: 'Code expired',
    newCodeAction: 'New code',

    states: {
      awaiting_pairing: 'Waiting to be paired',
      paired: 'Paired',
      /** Reception's switch, not a security state — see `outOfUseHint`. */
      inactive: 'Not in use',
      revoked: 'Revoked',
    } as Record<string, string>,

    columnDevice: 'Tablet',
    columnState: 'State',
    columnLastSeen: 'Last seen',
    columnBuild: 'Build',
    addedBy: (name: string, when: string) => `Added by ${name} · ${when}`,
    pairedAt: (when: string) => `Paired ${when}`,
    revokedAt: (name: string, when: string) => `Revoked by ${name} · ${when}`,
    neverSeen: 'Never',
    noBuild: 'Not reported yet',
    codeOutstanding: (when: string) => `A pairing code is outstanding until ${when}`,

    /*
     * THE TEST-DEVICE TOGGLE (Carl, 4 Sep 2026 — "a toggle for test data to be
     * shown in the list if on; if off show what the user will see at the
     * kiosk").
     *
     * IT IS A DISCLOSURE SWITCH, AND THE COPY SAYS SO IN ITS FIRST BREATH. The
     * warning is not a footnote under the control; it is the point of the
     * control. What it turns on is other patients' names on a screen anybody
     * in a waiting room can read, and the person flipping it should be told
     * that before they flip it rather than discover it afterwards.
     *
     * "Next poll" is a promise this page can keep: `hidden` rides the tablet's
     * existing poll and is inside its ETag, so the change reaches a tablet
     * already sitting on its idle screen within seconds — no re-pairing, no
     * reload, nobody walking to the device.
     */
    testDeviceLabel: 'Test device: shows the waiting list',
    testDeviceWarning:
      'On, this tablet displays other patients’ names in a list. Off — the default, and what a patient '
      + 'actually sees — it shows nobody and finds the one person by the details they type. Takes effect on '
      + 'the tablet’s next poll.',
    testDeviceSaving: 'Saving…',

    /*
     * DOES THIS TABLET ACCEPT WALK-UPS? (Carl, 12 Sep 2026, looking at the
     * kiosk idle screen: "if the reception is pushing to the tablet (not kiosk
     * mode where the patient enters all their details) then it should not say
     * Begin (it will confuse the user/patient) as the user will press begin
     * and it will go to kiosk mode. It should say 'Please wait. Loading your
     * details'".)
     *
     * IN A RECEPTIONIST'S WORDS, NOT THE DOMAIN'S. Nobody at a front desk
     * thinks "walk-up capture path"; they think "the one on the counter" and
     * "the one I hand over". So the hint describes the two tablets rather than
     * the two flows, and says what the patient sees in each case — which is
     * the thing the person flipping this is actually deciding.
     *
     * ON IS THE DEFAULT AND THE COPY SAYS SO, because every tablet already in
     * a practice is on, and a setting whose default is invisible is a setting
     * somebody turns off by accident while exploring.
     *
     * "Next poll" is a promise this page can keep: the flag rides the
     * heartbeat, which runs on every screen, so the change reaches a tablet
     * already sitting on its idle screen within seconds — no re-pairing, no
     * reload, nobody walking to the device.
     */
    walkUpsLabel: 'Anyone can start on this tablet',
    walkUpsHint:
      'On — the default — is the tablet that sits on the counter: it says Begin, and the patient types '
      + 'three details so we can find them. Turn it off for a tablet you hand to one patient after sending '
      + 'their form to it: it then says “Please wait. Loading your details” and there is nothing for them '
      + 'to press. Takes effect on the tablet’s next poll.',

    revokeAction: 'Revoke',
    /*
     * REVOKING IS THE SECURITY ACT ON THIS PAGE, so it asks — and the
     * confirmation says what actually happens rather than "are you sure". A
     * revoked tablet stops on its NEXT REQUEST, which is seconds, and nothing
     * about it touches whether patients can be seen.
     */
    revokeConfirm: (label: string) =>
      `Revoke ${label}? It stops working on its next request. Reception carries on as normal — nothing about `
      + 'this affects patients being seen or billed.',
    revokeReasonLabel: 'Why (optional)',
    revokeReasonHint: 'A tablet taken out of service and one lost in a taxi are different stories.',
    revokeConfirmAction: 'Revoke this tablet',
    cancelAction: 'Cancel',
    revoking: 'Revoking…',

    rotateAction: 'Re-Pair Tablet',
    rotateConfirm: (label: string) =>
      `Re-pair ${label}? Its current credential stops working immediately and you will get a new code to type `
      + 'into it.',
    rotateConfirmAction: 'Re-pair and show a new code',
    rotating: 'Re-pairing…',

    /*
     * THE BUILD FLOOR — staged rollout with instant rollback. Written for
     * somebody doing support, and it says what pressing it DOES: every tablet
     * below the floor reloads within seconds.
     */
    buildTitle: 'Kiosk build',
    buildLead:
      'Tablets load the current build from the cloud on every session. Set a minimum build to make every '
      + 'tablet below it reload — that is how a release is rolled back without touching a device.',
    buildLabel: 'Minimum build',
    buildHint: 'A release id such as 2026.09.03-2. Leave empty for no minimum, which reloads nothing.',
    buildSave: 'Save minimum build',
    buildSaving: 'Saving…',
    buildSaved: 'Saved. Tablets below this build reload on their next poll.',
    buildCleared: 'Cleared. No tablet will be asked to reload.',

    /**
     * THE THREAT MODEL, ON THE SCREEN. The person reading this page is the
     * person who decides what to do when a tablet goes missing, and the
     * answer — one revocable credential, nothing else on the device — is
     * worth them knowing before it happens.
     */
    threatNote:
      'A tablet holds one credential and nothing else: no patient details, no practice records, nothing that '
      + 'survives being revoked. If one goes missing, revoke it here.',

    /*
     * WHERE THE TABLET IS, IN ONE LINE (Carl, 4–5 Sep 2026; TODO.md "Tablet
     * heartbeat and Return to Begin"). Rendered on `/practice/devices` and on
     * `/practice/tablet` from one shared builder, so the two pages cannot
     * describe the same tablet differently.
     *
     * A SCREEN NAME AND A TIME — NEVER A PATIENT. The heartbeat carries a word
     * from a fixed list and an opaque session id, and nothing here looks a
     * person up to decorate a device row: reception already has the name on
     * the session row beside it, and a second copy on a second line is a
     * second place a name sits on a screen at the front counter (REQ-VER-04,
     * hard rule 9).
     *
     * "NOT SEEN" IS THE SERVER'S WORD, not this page's arithmetic. Staleness
     * is two missed heartbeats at the cadence the server is currently handing
     * out, computed there and sent as a boolean — a console that guessed the
     * cadence would be a second place for it to be wrong, in the direction
     * that calls a live tablet dead.
     */
    activity: {
      screens: {
        begin: 'On Begin',
        list: 'Showing the waiting list',
        verify: 'Checking identity',
        assignor: 'Choosing who signs',
        particulars: 'Reading the agreement',
        signature: 'Signing',
        'check-details': 'Checking details',
        complete: 'Finished — thank-you screen',
        handover: 'Sent to reception',
        outage: 'Cannot reach the platform',
      } as Record<string, string>,
      /** "On Begin · seen 4 s ago" — a tablet between patients, alive. */
      seen: (where: string, ago: string) => `${where} · seen ${ago} ago`,
      /** "Checking details · session f431e2a4" — a pushed ceremony. */
      inSession: (where: string, sessionTag: string) => `${where} · session ${sessionTag}`,
      /** "Walk-up in progress · checking identity" — nobody pushed this one. */
      walkUp: (where: string) => `Walk-up in progress · ${where.toLowerCase()}`,
      /** Two missed heartbeats. The tablet may be asleep, off, or off the wifi. */
      notSeen: (ago: string) => `Not seen for ${ago}`,
      neverSeen: 'Never seen — this tablet has not called in yet',
      /** Deliberately coarse: nobody needs "seen 4.312 s ago". */
      agoSeconds: (n: number) => `${n} s`,
      agoMinutes: (n: number) => (n === 1 ? '1 min' : `${n} min`),
      agoHours: (n: number) => (n === 1 ? '1 hour' : `${n} hours`),
      agoDays: 'over a day',
    },

    /*
     * SEND IT BACK TO THE START (Carl, 4–5 Sep 2026). The button reception
     * reaches for when a tablet is stuck on somebody who has gone — including
     * a WALK-UP, which recall could never reach because a walk-up is nobody's
     * session.
     *
     * THE HINT SAYS WHAT THE PATIENT SEES, because the person pressing this may
     * be about to take a screen off somebody standing in front of them, and
     * they should know that before the press rather than after.
     */
    returnToBeginAction: 'Return to Begin',
    returnToBeginBusy: 'Sending…',
    returnToBeginHint:
      'Clears the tablet and takes it back to the Begin screen. If somebody is part-way through, they see '
      + '“Please see reception. Your appointment is not affected.” first. Nothing on the agreement changes.',
    returnToBeginSent: 'Sent. The tablet returns to Begin on its next check-in.',

    /*
     * OUT OF USE — RECEPTION'S SWITCH, NOT AN ADMINISTRATOR'S REVOKE (Carl,
     * 4–5 Sep 2026; TODO.md "Tablets: make one inactive").
     *
     * The copy has to draw that distinction on the screen, because the two
     * controls sit next to each other and only one of them costs a rotate and
     * a walk to the device. "Take out of use" is for a flat battery; "Revoke"
     * is for a tablet in the back of a taxi.
     */
    outOfUseAction: 'Take out of use',
    backInUseAction: 'Put back in use',
    outOfUseBusy: 'Saving…',
    outOfUseHint:
      'For a flat battery, a tablet out for repair, or one on the wrong desk. Nothing is sent to it and it '
      + 'shows “This tablet is not in use”. The credential is untouched, so one press brings it back — '
      + 'unlike Revoke, which needs a new pairing code typed in at the device.',
    outOfUseSince: (who: string, when: string) => `Out of use — ${who}, ${when}`,
  },

  /*
   * THE AOBPRINTER HOST PAGE (PRINTER-HEARTBEAT.md §4, D-2026-10-10-02).
   *
   * EVERY STATE SAYS WHAT THE PLATFORM OBSERVED, and offers a remedy only
   * where it is true for that record (CLAUDE.md §7c, wow.md §13). Most of
   * these states have no remedy a practice can apply, so most of them say
   * none: a regression is cleared only by a platform operator, and saying
   * "restart the host" under a failure it would not fix sends somebody to
   * their computer instead of to our defect. Codes this page has no words for
   * show the code. Hashes are shown as their first 8 characters, followed by
   * an ellipsis, so a reader can match them against the host without the
   * page pretending to show the whole thing.
   */
  aobprinterHost: {
    title: 'AOBPRINTER host',
    lead:
      'The program on the practice’s computer that sends printed DB4s to AoB and files the signed ones back. '
      + 'This page shows whether it is reporting, what it holds at each stage, and whether its audit log still '
      + 'matches what the platform last saw.',
    audience: 'Practice',
    platformAudience: 'Platform',
    loading: 'Loading…',
    notLoaded: 'The AOBPRINTER host could not be loaded',

    /* The card on the setup hub. */
    hubOpen: 'Open the AOBPRINTER host',
    hubBody: 'Whether this practice’s AOBPRINTER is reporting, and whether its audit log still matches what the platform last saw.',

    /* One position in an audit log: an event number and the first 8 characters of its hash. */
    point: (seq: number, hash8: string) => `event ${seq} (hash ${hash8}…)`,
    pointNoHash: (seq: number) => `event ${seq} (no hash)`,
    hostHeading: (chain8: string) => `Audit log ${chain8}…`,

    liveness: {
      live: 'Reporting',
      stale: 'Late',
      offline: 'Not reporting',
      never_reported: 'Never reported',
    },

    /*
     * 1. REGRESSED. One sentence per kind, each naming what the platform held
     * and what the host sent. `regressedStays` is true of every regressed
     * record (decision 4), which is why it may be said under all of them.
     */
    regressedTitle: 'The audit log no longer matches what the platform last saw',
    regression: {
      went_backwards: (expected: string, received: string, at: string) =>
        `On ${at} the host reported its audit log ending at ${received}. The platform had already seen it reach ${expected}, so events it had reported are no longer there.`,
      same_seq_different_hash: (expected: string, received: string, at: string) =>
        `On ${at} the host reported ${received}. The platform had already seen ${expected}: the same event with a different hash, so an event already reported has changed.`,
      anchor_mismatch: (expected: string, received: string, at: string) =>
        `On ${at} the platform asked the host for the event it last verified, ${expected}, and the host answered ${received}. An event the platform had verified has changed or gone.`,
      chain_replaced: (expected: string, received: string, at: string) =>
        `On ${at} a host began reporting an audit log the platform has never seen, starting at ${received}. This practice already has an audit log starting at ${expected} that has not been retired, so no replacement has been accepted.`,
    },
    regressionUnmapped: (code: string, at: string) =>
      `On ${at} the platform recorded a regression of a kind this page has no words for: ${code}.`,
    regressedStays: 'This stays flagged until a platform operator re-baselines it. A practice cannot clear it from this page.',

    /* 2. TWO HOSTS. */
    secondHostTitle: 'Two audit logs are reporting at the same time for this practice',
    secondHostBody: (minutes: number) =>
      `Two different audit logs are both reporting: each has reported since the other first appeared, and both in the last ${minutes} minutes. A practice runs one AOBPRINTER. Each row below says when its log last reported.`,

    /* 3. THE HOST'S OWN CHECK. */
    localCheckTitle: 'The host’s own check of its audit log failed',
    localCheck: {
      link: (seq: number) => `The host checked its audit log and found that event ${seq} does not link to the event before it.`,
      content: (seq: number) => `The host checked its audit log and found that event ${seq} no longer matches its own hash.`,
    },
    localCheckUnmapped: (seq: number, why: string) =>
      `The host reported that its audit log check failed at event ${seq}, for a reason this page has no words for: ${why}.`,

    /* 4. OFFLINE / STALE. The age comes from `deviceSeenAgo`; the server decides which state applies. */
    offlineTitle: 'Not reporting',
    offline: (at: string, ago: string) =>
      `Not heard from since ${at} (${ago} ago). The last report it sent is kept below.`,
    staleTitle: 'Reporting late',
    stale: (at: string, ago: string) =>
      `Not heard from since ${at} (${ago} ago), longer than three of its own reporting intervals. The last report it sent is kept below.`,

    /* 5. OPEN EXCEPTIONS (decision 13). */
    exceptionsTitle: (n: number) => (n === 1 ? 'One item is held as an exception on the host' : `${n} items are held as exceptions on the host`),
    exceptionStage: {
      parse_exception: 'A print could not be read',
      send_exception: 'A print could not be sent',
      received_exception: 'A signed return could not be read',
      filing_exception: 'A signed return could not be filed',
    },
    exceptionReason: {
      incomplete_pdf: 'the PDF was incomplete',
      no_text_layer: 'the PDF has no text to read',
      not_a_db4: 'it is not a DB4',
      unsafe_name: 'its file name was not safe to use',
      download_failed: 'the download from AoB failed',
      hash_mismatch: 'the file did not match its hash',
      write_failed: 'it could not be written to the folder',
      write_verify_failed: 'it was written but did not read back the same',
    },
    exceptionSince: (at: string) => `Since ${at}.`,
    printHeld: (hash8: string) =>
      `Print ${hash8}… is held on the host. No platform page shows a print job, so it is named by the first 8 characters of its hash.`,
    returnOpenPatient: 'Open the patient',
    returnNoPatient: 'The platform found no patient for this agreement.',

    /* 6. FILED BUT NOT RECORDED AS CONFIRMED — the platform's verdict, one sentence per case. */
    filedTitle: (n: number) => (n === 1 ? 'One return is filed on the host but not recorded as confirmed' : `${n} returns are filed on the host but not recorded as confirmed`),
    filed: {
      written_back: 'The platform has recorded this return as written back. The host marks it confirmed on its next report.',
      written_back_different_file:
        'The platform has recorded a return as written back for this agreement, but its file has a different hash from the one filed on the host. '
        + 'The host keeps a return filed while the hashes differ, so it will not mark this one confirmed.',
      offered: 'The platform has not recorded this return as written back, and is still offering it for collection.',
      not_offered: 'The platform has not recorded this return as written back, and is no longer offering it for collection.',
    },
    filedUnmapped: (code: string) => `The platform answered for this return with a verdict this page has no words for: ${code}.`,

    /* 7. OLD QUEUE. `staleQueued` is the host's own count. */
    oldQueueTitle: 'Prints have waited too long to be sent',
    oldQueue: (n: number, ago: string) => `${n} queued on the host longer than it expects. The oldest has waited ${ago}.`,
    oldQueueNoAge: (n: number) => `${n} queued on the host longer than it expects.`,

    /* 8. CLOCK SKEW (decision 15). */
    skewTitle: 'The host’s clock is out',
    skewAhead: (minutes: number) => `At its last report the host’s clock was ${minutes} minutes ahead of the platform’s. Times the host records are out by the same amount.`,
    skewBehind: (minutes: number) => `At its last report the host’s clock was ${minutes} minutes behind the platform’s. Times the host records are out by the same amount.`,

    /* 9. HEALTHY. */
    healthyTitle: 'Reporting normally',
    healthy: (ago: string) => `Last reported ${ago} ago, with nothing held and nothing out of step.`,

    /* A retired chain: a quiet line, not a card. Its silence is expected (decision 7). */
    retired: (chain8: string, at: string) =>
      `Audit log ${chain8}… was retired on ${at}, when a platform operator accepted another audit log as this practice’s. It has not reported since.`,

    /* 10. NEVER REPORTED — neutral, not an outage. */
    neverTitle: 'No AOBPRINTER has reported for this practice',
    never: 'Nothing has reported yet, so there is nothing to be offline. This page fills in after the first report.',

    /* The last report, always kept on screen with its age. */
    reportTitle: (ago: string) => `As last reported, ${ago} ago`,
    versionsTitle: 'Versions',
    printerVersion: 'AOBPRINTER',
    templateVersion: 'Template',
    schemaVersion: 'Database schema',
    runtimeVersion: 'Runtime',
    startedAt: 'Running since',
    interval: (seconds: number) => `Reports every ${seconds} s`,
    collecting: 'Collecting signed returns',
    retention: 'Keeps copies after sending',
    queueCount: 'Files waiting in the folder',
    yes: 'Yes',
    no: 'No',
    stagesTitle: 'What the host holds at each stage',
    stageColumn: 'Stage',
    countColumn: 'Count',
    printsHeading: 'Prints',
    returnsHeading: 'Signed returns',
    printStages: {
      received: 'Received',
      parse_exception: 'Could not be read',
      queued: 'Queued',
      sent: 'Sent',
      send_exception: 'Could not be sent',
    },
    returnStages: {
      received: 'Received',
      received_exception: 'Could not be read',
      filed: 'Filed',
      filing_exception: 'Could not be filed',
      confirmed: 'Confirmed',
    },
    chainTitle: 'Audit log',
    chainHead: (point: string) => `Head: ${point}.`,
    chainStatus: {
      unverified: 'Not verified yet. The platform checks it against each report.',
      consistent: 'Matches what the platform last saw.',
      regressed: 'Flagged: no longer matches what the platform last saw.',
    },
    anchorVerified: (at: string, seq: number) => `Anchor verified ${at}, at event ${seq}.`,
    anchorNotVerified: 'The anchor has not been verified yet.',

    /*
     * RE-BASELINE — the platform's act alone (decision 7), so it is never on
     * the practice's page. The reason list is versioned content
     * (`aobprinter-rebaseline-reasons.json`); these are its labels, keyed by
     * the file's keys and rendered in the file's order.
     */
    rebaseline: {
      title: (chain8: string) => `Re-baseline audit log ${chain8}…`,
      lead: 'Accepts the host’s audit log as it now stands and clears the flag. Recorded in the vault with the reason chosen here and who chose it.',
      reasonLabel: 'Reason',
      reasonPlaceholder: 'Choose a reason',
      reasons: {
        reinstalled: 'AOBPRINTER was reinstalled',
        database_restored: 'The host’s database was restored from a backup',
        investigated: 'Investigated, and the change is explained',
      },
      action: 'Re-baseline',
      blocked: 'Re-baseline — choose a reason first',
      busy: 'Re-baselining…',
      done: 'Re-baselined. The flag is cleared and the next report starts a fresh check.',
      refused: 'The re-baseline was refused',
      stepUpTitle: 'Confirm it is you',
      stepUpReauthenticate:
        'Re-baselining accepts a practice’s evidence afresh, so it needs a sign-in from the last few minutes. Confirm it is you '
        + 'and this page comes straight back.',
      stepUpAction: 'Confirm it is you',
      stepUpSecondFactorMissing:
        'This account signs in with a password and nothing else, so it cannot re-baseline. Add an authenticator app or a '
        + 'passkey to the account, then try again.',
      stepUpMethodUnrecorded:
        'The sign-in service did not say how this sign-in was made, so the server cannot confirm a passkey was used, and '
        + 're-baselining needs that. Nothing was changed.',
      stepUpUnmapped: (code: string) =>
        `The server refused this and gave a reason this screen does not recognise: ${code}. Nothing was changed.`,
    },

    /* `/platform/aobprinter-hosts` — every practice's host, worst first. */
    overview: {
      navLabel: 'AOBPRINTER hosts',
      title: 'AOBPRINTER hosts',
      lead: 'Every practice’s AOBPRINTER host, worst first. Counts, versions, times and status only; open a row for that practice’s page.',
      audience: 'Platform',
      notLoaded: 'The AOBPRINTER hosts could not be loaded',
      none: 'No practice has an AOBPRINTER host yet.',
      practiceColumn: 'Practice',
      stateColumn: 'State',
      lastSeenColumn: 'Last report',
      versionColumn: 'Version',
      lastSeen: (ago: string) => `${ago} ago`,
      neverSeen: 'Never',
      states: {
        regressed: 'Audit log no longer matches',
        second_host: 'Two audit logs at once',
        local_check_failed: 'Host’s own check failed',
        offline: 'Not reporting',
        stale: 'Reporting late',
        open_exceptions: 'Exceptions held',
        filed_unconfirmed: 'Filed, not confirmed',
        old_queue: 'Prints waiting too long',
        clock_skew: 'Clock out',
        healthy: 'Reporting normally',
        never_reported: 'Never reported',
      },
    },
  },

  /*
   * SEND TO THE TABLET — reception's half of the push (`/practice/tablet`).
   *
   * WRITTEN FOR A RECEPTIONIST WITH A PATIENT IN FRONT OF THEM, which sets the
   * tone for everything below: short sentences, no rule numbers on screen, and
   * every refusal followed by what to do instead. The words a PATIENT reads are
   * in the `kiosk` branch; nothing here is ever shown on a tablet.
   *
   * NOTHING HERE CLAIMS CERTIFICATION — not "approved", not "certified", not
   * "accredited" (REQ-65C-05, hard rule 12). Note in particular that a session
   * state is "signed" and never "approved": nothing on this platform is
   * approved by anybody official, and the word would be a claim we may not
   * make.
   */
  /*
   * PRACTICE FRONTDESK — the page a person on their first shift can work
   * (Carl, 12 Sep 2026; FRONT-DESK-PAGE.md).
   *
   * THE WORDS ARE THE FEATURE, not a coat of paint on one. The existing desk
   * is correct and expert: its strings carry "enduring", "affiliation",
   * "particulars", "assignor", "artefact" and "attestation", every one of them
   * the right word for the regulator and none of them a word a nineteen-
   * year-old has heard before Tuesday. This surface says the same facts in the
   * words the job is done in, and the vocabulary table in §5 of the plan is
   * the list it may not reach for. Nothing here says "certified", "approved",
   * "accredited" or "government-approved" either (hard rule 12).
   *
   * THE RAIL SAYS A NAME, A TIME AND A GROUP, AND STOPS. It stands at a
   * counter facing a waiting room, which is the same reasoning that keeps the
   * waiting list off the tablet — so there is no string here for a reason, a
   * condition, a provider's opinion or a status chip, because there is no such
   * thing on the rail to write one for.
   */
  /*
   * THE DAY'S WORK (PRACTICE-NAVIGATION.md §2; Carl, 12 September 2026).
   *
   * FIVE DESTINATIONS AND ONE SENTENCE, and the sentence is the one §7 asks
   * for: with two desks side by side, somebody has to be told which is which
   * or they will learn it by opening the wrong one twice.
   *
   * THE WORDS ARE THE ROOM'S, NOT THE REGULATOR'S, the same rule the front
   * desk page follows (FRONT-DESK-PAGE.md §5). Nothing here says assignor,
   * particulars, episodic or artefact — this is the first screen of a shift
   * and none of those is a word a new starter has heard.
   */
  today: {
    title: 'Today',
    audience: 'Practice',
    lead: 'Everything you need during a shift. Setup, reports and the rest are in the menu.',

    frontdeskTitle: 'The front desk',
    frontdeskBody:
      'Who is here, who is next, and the single next thing to do for each of them — one patient at a time.',
    frontdeskLink: 'Open the front desk',

    waitingTitle: 'Who is waiting',
    waitingBody:
      'Every practitioner’s list, grouped by practitioner, and whether the paperwork is done. It reports '
      + 'only, and it never holds anybody up.',
    waitingLink: 'Open who is waiting',

    tabletTitle: 'Send to the tablet',
    tabletBody: 'The whole desk at once: every patient waiting, every control, and what each tablet is doing.',
    tabletLink: 'Open the tablet desk',

    patientsTitle: 'Patients',
    patientsBody:
      'The patients with something open today. Open one to do everything for them in one place — their '
      + 'details, their agreements, the tablet, follow-up and what has been sent.',
    patientsLink: 'Open the patients',

    messagesTitle: 'Messages',
    messagesBody: 'Every message sent in this practice’s name, what it said, and whether it arrived.',
    messagesLink: 'Open the messages',

    /*
     * THE ONE SENTENCE §7 ASKS FOR. Both desks are today's work and both stay;
     * what separates them is how much of the domain is on screen, which is a
     * question about the person reading rather than about the job.
     */
    twoDesks:
      'Two ways into the same morning: the front desk takes one patient at a time in plain words, and the '
      + 'tablet desk shows everybody at once for somebody who knows their way around it.',

    /*
     * NOT AN ERROR AND NOT AN EMPTY PAGE. Every destination here is gated by
     * the same rule the page behind it applies, so an account that may open
     * none of them is told why rather than shown a heading with nothing under
     * it.
     */
    nothingOpen: 'Nothing here is open to this account',
    nothingOpenWhy:
      'Each of these pages decides for itself who may open it, and this sign-in reaches none of them. Ask '
      + 'whoever looks after your practice’s accounts to check what you have been given.',
  },

  frontdesk: {
    title: 'Practice Frontdesk',
    lead:
      'Who is at the desk, who has a tablet, and who is still to come in. Choose a name on the left to see what '
      + 'happens next for them.',
    audience: 'Practice',
    notLoaded: 'This page could not be loaded',
    /*
     * HARD RULE 8, IN THE WORDS A FIRST-DAY STARTER NEEDS. They are the person
     * most likely to think a screen saying something is wrong means a patient
     * cannot be seen.
     */
    neverBlocks:
      'Nothing on this page holds anybody up. Patients are seen and billed as usual, whatever this screen says.',
    /*
     * AND WHEN THE PLATFORM ITSELF CANNOT BE REACHED (§6 rule 5, hard rule 8).
     * An outage slows the evidence and never the service — said in as many
     * words to the person most likely to think a broken screen means a patient
     * has to wait.
     */
    seeThemAnyway:
      'See the patient anyway — we will catch the paperwork up. An outage here never stops anybody being '
      + 'seen or billed.',

    rail: {
      label: 'Today’s queue',
      /*
       * THE THREE GROUPS, TOP TO BOTTOM, AND THE ORDER IS THE POINT: who is in
       * front of you, who is mid-way through, who is still to come.
       */
      hereNow: 'Here now',
      onATablet: 'On a tablet',
      expected: 'Expected',
      /*
       * THE THREE GROUPS THAT MAKE THE COLUMN ADD UP (Carl, 12 September 2026:
       * *"Both pages have to reconcile. Have another list if you have to on
       * frontdesk as every patient has to be seen."*).
       *
       * WHY "NEEDS A LOOK" IS THE IMPORTANT ONE. Somebody who came in, has not
       * signed and has nothing waiting for them used to appear on no screen at
       * all. Two of them were sitting in the day's fifteen on the morning this
       * was written. A person who owes a signature and is on no list is the
       * worst thing this desk can hold, so the list exists even on the many
       * days it is empty.
       *
       * "NOT ARRIVED TODAY" IS NOT AN ACCUSATION. It is paperwork open at the
       * desk with nobody recorded as walking in for it today — usually a
       * correction made after midnight on yesterday's visit, sometimes a form
       * made ready for a booking before the patient gets here. It is shown
       * only when it has somebody in it.
       */
      finished: 'Finished',
      needsALook: 'Needs a look',
      /*
       * SIGNED, AND STILL WAITING FOR THE PRACTITIONER (D-2026-09-12-20; Carl,
       * 12 September 2026: *"on /frontdesk the patient goes to 'Finished list'
       * yet on /waiting the dr has not seen the patient as yet."*).
       *
       * NOTHING IS WRONG WITH ANYBODY ON THIS LIST, which is why they are not
       * under "Needs a look", and there is nothing for the desk to do, which is
       * why they are not under "Here now". They are the middle of the morning.
       */
      waitingToBeSeen: 'Waiting to be seen',
      notArrived: 'Not arrived today',
      /*
       * THE COUNT IS THE LIVE REGION, NOT THE ROWS (§12.3). A person moving
       * from Expected to Here now is worth announcing; every poll is not — so
       * the announcement is a countable fact rather than a list of names read
       * out again every few seconds.
       *
       * `count` IS THE SPOKEN ONE AND STAYS WHOLE. What is DRAWN is the number
       * on its own — bold, in the one accent this product has — beside its
       * word (Carl, on the group headings: *"Make the font bold and a diff
       * colour for the number - so it stands out"*). A screen reader hears the
       * sentence; an eye scanning between patients finds the digit.
       */
      count: (n: number) => (n === 1 ? '1 person' : `${n} people`),
      countUnit: (n: number) => (n === 1 ? 'person' : 'people'),
      /** Booked for today with no time on the booking. Sorts last, says so. */
      noTime: 'No time given',
      hereNoneYet: 'Nobody is waiting at the desk.',
      tabletNoneYet: 'No tablet is being used right now.',
      finishedNoneYet: 'Nobody has finished yet today.',
      waitingToBeSeenNoneYet: 'Nobody is waiting for a provider right now.',
      needsALookNoneYet: 'Nobody is unaccounted for. This is how it should look.',
      needsALookWhy:
        'These people came in and have not signed, and there is nothing waiting for them to sign. Nobody '
        + 'has been held up — they were seen as usual — but their paperwork still has to be caught up.',
      /*
       * THE NUMBER THE WHOLE COLUMN HAS TO ADD UP TO, and the sentence that
       * says so out loud. Two screens quietly disagreeing about the same
       * morning is what this is here to make impossible to miss: the desk said
       * three and "who came in" said fifteen, both were right, and neither
       * said why.
       */
      dayTotalUnit: (n: number) => (n === 1 ? 'person came in today' : 'people came in today'),
      dayTotalWhy:
        'Here now, on a tablet, needs a look, waiting to be seen and finished add up to this. Expected are '
        + 'not counted — they have not come in yet.',
      notArrivedWhy:
        'There is paperwork open for these people, but nobody has been recorded as coming in for it today. '
        + 'They are not counted in the number above.',
      /*
       * THE EMPTY STATE THAT CARRIES MOST OF THIS GROUP'S VALUE (§12.1).
       * Appointments reach us only when the practice's software sends them, so
       * this list is legitimately empty in every practice today. A blank box
       * would read as broken, and a practice asking "why can't I see my
       * bookings" would have to ask a person. This answers from the screen.
       */
      expectedNoneYet: 'No appointments received from the practice software.',
      expectedWhy:
        'When your practice’s software starts sending its booking list, the people booked in today will show '
        + 'here before they arrive. Nothing is missing from your work in the meantime — everybody who walks in '
        + 'still appears above.',
      /** Said out loud for a screen reader, never drawn as a chip. */
      chosen: 'Chosen',
      /*
       * EXACTLY ONE ROW IS MARKED "DO THIS NEXT" (§4). Not a priority scheme
       * and not a status: the top of the list, said out loud, so there is no
       * decision to make on a first shift.
       */
      next: 'Do this next',
      /*
       * THE WAY OUT OF THE THREE RAILS AND INTO THE DAY (Carl, 12 September
       * 2026: *"Add a button here with a link to show all Patients seen at this
       * practice today."*).
       *
       * BELOW THE RAILS, NOT AMONG THEM. The three groups above are the
       * morning as it stands; this is the day as a whole, including everybody
       * the rails have already finished with and dropped. A fourth group would
       * have said they were the same kind of thing.
       *
       * IT IS A LINK AND IT ACTS ON NOTHING, which is the rule the whole rail
       * is built on (§12.3): nothing in this column sends, recalls or confirms.
       */
      dayRegister: 'Everybody seen today',
      dayRegisterWhy: 'The whole day, including the people already finished with — and any earlier day.',
      /*
       * SEEING EVERYONE AT ONCE (Carl, 12 September 2026: *"provide a button
       * to go look at all patients here now (like we have in section [1] of
       * /tablet page)."*).
       *
       * THE SAME PAIR OF DOORS THE TABLET DESK ALREADY HAS, pointing the other
       * way. That page carries "Work one patient at a time →" to the patients
       * list; this is its opposite, and the words are the same shape on
       * purpose so the two read as one product rather than two.
       *
       * IT IS A LINK AND IT ACTS ON NOTHING, which is the rule the whole rail
       * is built on (§12.3).
       */
      seeEveryone: 'See everyone here at once →',
      seeEveryoneWhy:
        'The tablet desk lists everybody waiting today on one page, with every control beside them.',
      /**
       * THE NUMBER ON THE CARD IN THEIR HAND (`QUEUE-TICKETS.md`; Carl, 12
       * September 2026). Spoken with the word, because a bare "12" read out
       * beside a name says nothing; drawn as the number alone, because the
       * card in their hand says nothing else either.
       *
       * NOTHING ELSE ON THIS PAGE CALLS IT AN IDENTIFIER, and it is not one
       * (hard rule 1, REQ-VER-02) — it is a label for a place in a queue on
       * one day, and it is not the running order (§5a).
       */
      ticket: (value: string) => `Number ${value}`,
    },

    /*
     * TODAY'S PAPERWORK FOR THE CHOSEN PERSON — VISIT-CHECKLIST.md §2, the
     * four rows that are OURS. The other four steps of Carl's list (seeing the
     * provider, a blood test, seeing the nurse, paying) belong to the practice
     * and are not directed from here.
     *
     * "NOTHING TO SIGN" IS THE FOURTH WORD, and it is deliberately the same
     * one the practitioner's waiting list already uses, so a phlebotomist's
     * visit reads identically wherever it is looked at.
     *
     * NEVER "APPROVED" ABOUT ONE OF OUR FORMS (hard rule 12). "Signed" is what
     * happens and "Done" is what it becomes; nothing on this page is described
     * as certified, checked off by anybody official, or blessed.
     */
    checklist: {
      /*
       * CARL'S NAME FOR IT (`VISIT-CHECKLIST.md` §3a, 12 September 2026):
       * *"What you call 'Paper work' per patient, I call the patient service
       * list. We need a patient service list, just like a car has service list
       * when taken to the service centre."*
       *
       * THE SCOPE DID NOT WIDEN WITH THE NAME. It records what the practice
       * said would happen and whether it happened — never a reason, a finding,
       * a note, a triage category or a duration. It is not a care plan and it
       * gates nothing (hard rule 8).
       */
      title: 'Patient service list',
      /*
       * SAID ONCE, SO NOBODY LOOKS FOR A TICK BOX. Every row is worked out
       * from the record; there is nothing here for a person to mark, and a
       * first-day starter who thinks otherwise will spend the morning
       * hunting for the control.
       */
      lead: 'Worked out from the record. There is nothing here to tick.',
      state: {
        done: 'Done',
        outstanding: 'Still to do',
        notNeeded: 'Nothing to sign',
        /*
         * DROPPED, WHICH IS NOT THE SAME AS NEVER NEEDED
         * (`VISIT-CHECKLIST.md` §3a). *Nothing to sign* was never required;
         * *cancelled* was on the list and was let go — the patient declined,
         * or ran out of time. Both mean nothing more is owed and both let the
         * patient reach "Finished"; they are different answers to an auditor.
         * Nothing produces it yet — the computed rows cannot be dropped — and
         * the word is here so the state can be added without a second guess at
         * what it should say.
         */
        cancelled: 'Cancelled',
      },
      rows: {
        needed: 'Does today’s visit need an agreement?',
        made: 'The agreement is ready to sign',
        signed: 'Signed on a tablet',
        /*
         * HAS THE PATIENT BEEN SEEN? (D-2026-09-12-20; Carl, 12 September
         * 2026: *"on /frontdesk the patient goes to 'Finished list' yet on
         * /waiting the dr has not seen the patient as yet."*)
         *
         * "SEEN BY THE PROVIDER", NOT "CONSULTATION COMPLETED". Carl's own
         * words were the second, and CLAUDE.md §3 is the reason they are not
         * used: it is "service", never "consult" (REQ-MP-01), and "provider",
         * never "GP". These are also the plainer words of the two for a first
         * shift, which is what this page is for.
         */
        consultation: 'Seen by the provider',
        after: 'Signed after the visit',
      },
      detail: {
        todaysVisit: (provider: string | null) =>
          provider
            ? `Yes — a one-off agreement for today’s visit with ${provider}.`
            : 'Yes — a one-off agreement for today’s visit.',
        /*
         * AN ONGOING AGREEMENT IS NAMED UNDER ITS PROVIDER, always (hard rule
         * 6, REQ-END-01). There is no such thing as one that covers the whole
         * practice, and a sentence that left the name out would imply there
         * was.
         */
        ongoing: (provider: string | null) =>
          provider
            ? `Yes — an ongoing agreement with ${provider}.`
            : 'Yes — an ongoing agreement with the provider they are seeing.',
        /*
         * AND THE VISIT'S OWN STATE, IN THE WORDS OF THE VERSIONED LIST. The
         * key comes from `visit-states.json` and the label from the practitioner
         * queue's own table, so the front desk and the practitioner read one
         * word for one state — which is the whole point of D-2026-09-12-20.
         * An unmapped key shows its key (CLAUDE.md §7).
         */
        noVisitToSee: 'There is no visit for this to be about.',
        /*
         * THE DOMAIN'S OWN NAME FOR THE KIND OF AGREEMENT, IN BRACKETS, AND
         * ONLY OUTSIDE PRODUCTION (Carl, 12 September 2026: *"Should say
         * (enduring / episodic) at least while we are testing."*).
         *
         * THE PLAIN WORDS ALWAYS SHIP and are what a practice sees: "an
         * ongoing agreement", "a one-off agreement for today's visit".
         * FRONT-DESK-PAGE.md §5 bans the domain terms on this surface because
         * the page has to be learnable on day one by somebody who has never
         * heard them, and Carl's "at least while we are testing" is the way
         * through: this is a DEVELOPMENT AFFORDANCE gated on
         * `NODE_ENV !== 'production'`, the same gate the renderer's draft
         * marker uses, and never a change to the copy.
         *
         * A FUNCTION OF ITS ARGUMENT, so no banned word is written down here
         * and the vocabulary lint over this block stays honest.
         */
        devAgreementType: (type: string) => ` (${type})`,
        afterService: 'Yes — an agreement for a service they have already had.',
        nothingToSign: 'No. There is nothing for this person to sign for this visit.',
        /*
         * WHY "LOCKED" IS SAID OUT LOUD. Nobody may be asked to sign a
         * half-finished form (REQ-REG-06), and the person sending it is
         * entitled to know the platform will not let that happen.
         */
        ready: 'Filled in, checked and locked, so nobody can be asked to sign a half-finished form.',
        beingPrepared: 'Not finished yet. What it is waiting for is written below.',
        nothingToMake: 'Nothing to make.',
        notSignedYet: 'Not yet. Ask them on a tablet beside you.',
        withThemNow: (device: string | null) =>
          device ? `They have the ${device} now.` : 'They have one of your tablets now.',
        signedAndStored: 'Signed and stored.',
        nothingBilledYet:
          'Nothing has been billed after this visit, so there is nothing to sign afterwards.',
        afterOutstanding: 'Something was billed after the visit and still needs signing.',
      },
      /*
       * THE VERSIONED POLICY'S OWN ANSWER, IN OUR WORDS — and the rule key
       * itself where this screen has no wording for it yet. A generic sentence
       * would hide the one string somebody could quote down the phone
       * (CLAUDE.md §7), so an unmapped key shows itself.
       */
      why: {
        covered_by_todays_agreement: 'They already signed for it on the way in.',
        covered_by_an_ongoing_agreement: 'Their ongoing agreement with the provider covers it.',
      } as Record<string, string>,
      whyUnknown: (code: string) => `Decided by the rule “${code}”.`,
    },

    panel: {
      /*
       * NOTHING CHOSEN YET. It says what the list is for and, in the same
       * breath, that looking at it is safe — which is the first thing somebody
       * on their first shift needs to be told.
       */
      nothingChosen: 'Choose a name on the left',
      nothingChosenLead:
        'Choosing a name only shows you what happens next for that person. It never sends anything, takes '
        + 'anything back or changes anything.',

      /*
       * THE TWO IDS UNDER THE NAME COME FROM `strings.recordId` (Carl, 12
       * September 2026: *"patientid is diff on /tablet and /frontdesk"*, then
       * *"ok. In that case show both ids."*). Two surfaces a receptionist uses
       * in the same minute disagreeing about which identifier to print is
       * exactly what one shared pair of words fixes.
       *
       * THESE TWO KEYS REMAIN AND DELEGATE, rather than being deleted, because
       * more than one surface already reads them and a rename is a change to
       * every one of them at once (wow.md §10: extend behind the existing
       * name). They are the same string, from one place.
       */
      patientRecordNumber: (number: string) => recordIdWords.practiceNumber(number),
      patientRecordNumberUnknown: recordIdWords.practiceNumberUnknown,

      hereNow: (name: string) => `${name} is waiting at the desk.`,
      hereNowNext: 'The next step is to send their agreement to a tablet beside you.',
      /*
       * THE DEVICE LABEL ALREADY SAYS WHAT IT IS. Practices name their tablets
       * "Blue tablet", "Front desk tablet"; a sentence that appended the word
       * again read "has the Blue tablet tablet". The label is printed as the
       * practice wrote it and nothing is added to it.
       */
      onATablet: (name: string, device: string) => `${name} has the ${device}.`,
      onATabletUnnamed: (name: string) => `${name} has one of your tablets.`,
      onATabletNext: 'Wait for them to finish, or take the tablet back.',
      expected: (name: string) => `${name} is booked in for today and has not arrived yet.`,
      expectedNext: 'There is nothing to do until they walk in. Nobody can sign before they are here.',

      /*
       * THE SITUATION, AS THE SENTENCE SOMEBODY WOULD SAY OUT LOUD (§4). One
       * per person, never a list of possibilities, and never a code.
       */
      whoIsSigning: (name: string) => `Who is signing for ${name}?`,
      readyToSend: (name: string, provider: string | null) =>
        provider
          ? `${name} needs to agree to bulk billing for today’s visit with ${provider}.`
          : `${name} needs to agree to bulk billing for today’s visit.`,
      /*
       * TYPES, NEVER VALUES (hard rule 9, REQ-VER-04). "their address" — never
       * the address itself, on a screen at a counter that faces the room.
       */
      detailWrong: (name: string, what: string) =>
        `${name} says their ${what} is wrong. Fix it, then send it again.`,
      /*
       * SOMETHING IS IN THE WAY. The sentence says so and points DOWN the
       * page, where the reason and its own fix are — never sideways to
       * another screen, and never a generic "see the queue" (CLAUDE.md §7).
       */
      waiting: (name: string) =>
        `Something has to be sorted out before ${name} can be asked to sign. It is written just below, with the way to fix it.`,

      /*
       * WHERE THE PANEL DRAWS ITS OWN BUTTON. A live tablet does NOT: Carl,
       * 12 Sep 2026 — *"Why are you not just copying the existing logic."* —
       * so a session on a tablet is answered by the tablet desk's own
       * `SessionActions` (Recall, Correct, No change needed, Re-send), word
       * for word, rather than by a simplified button that says a different
       * thing about the same act. This one is for the case with no session at
       * all, where the patient mentioned a wrong detail across the counter.
       */
      fixTheirDetails: 'Fix their details',
      /*
       * WHEN THE DEVICE LIST HAS NOT LANDED. The row knows a tablet is holding
       * the agreement before the read that names it comes back, and "one of
       * your tablets" is true where inventing a name would not be.
       */
      someTablet: 'one of your tablets',

      /*
       * THE PAYOFF MOMENT (§4's last row). A row leaves the desk the instant
       * it is signed, so the panel used to go blank under somebody's hand and
       * a first-day starter could not tell "it worked" from "I lost my place".
       * It names the person, says there is nothing left, and gives them the
       * one press that moves on.
       *
       * IT SAYS "NOTHING LEFT TO DO" RATHER THAN CLAIMING A SIGNATURE. A row
       * can also leave because the visit was cancelled or another desk dealt
       * with it, and this page cannot tell those apart from the queue alone —
       * so it states what it knows and nothing more.
       */
      finished: (name: string) => `Nothing left to do for ${name}.`,
      finishedLead:
        'Their row has left the desk. If they still need something, they will come back onto the list on '
        + 'their own.',
      nextPatient: 'Next patient',

      /*
       * ONE CONTROL FOR EVERYTHING ELSE (§4: "Secondary actions live behind
       * one More control, never beside the primary one"), and it is called
       * "Get help" in the one situation §4's table calls "cannot proceed" —
       * the same control, named for what the reader is actually after.
       *
       * IT REVEALS, IT DOES NOT NAVIGATE (§13, Carl 12 Sep 2026: "Everything
       * to do with the patient must be on this page - no going to another
       * page"). The expert controls are the same ones the tablet desk has, and
       * they open here, under the same patient.
       */
      more: 'More',
      moreClose: 'Close',
      getHelp: 'Get help',
      expertTitle: 'The full set of controls',
      expertLead:
        'These are the same controls the tablet desk has, for this person only. Nothing here takes you off '
        + 'this page.',
    },
  },

  /*
   * THE FRONT DESK ON A SMALL SCREEN — `/practice/frontdesksmall` (Carl,
   * 12 September 2026: *"If the Practice has small screens, we will need to go
   * to a different design."* SESSION-HANDOVER.md, "A proposal for the
   * small-screen version").
   *
   * ONLY WHAT THIS PAGE SAYS THAT THE WIDE DESK DOES NOT. The state names, the
   * counts, the checklist, every sentence about a patient and the outage
   * reassurance are read straight from `frontdesk` above — one list and five
   * rails are two arrangements of one morning, and two vocabularies for it
   * would be exactly the drift the reconciliation test exists to prevent. Ten
   * keys here; everything else is shared.
   *
   * THE SAME VOCABULARY LINT COVERS BOTH BLOCKS (`check-strings.mjs`). It is
   * the same job on a smaller screen, read by the same person on the same
   * first shift, so nothing here may say assignor, ongoing-agreement jargon,
   * or any of hard rule 12's four words.
   */
  frontdeskSmall: {
    /*
     * NAMED FOR THE DIFFERENCE, because the choice on the setup card is
     * between two desks and a receptionist has to be able to make it without
     * opening the wrong one twice. It is the same work — the words say
     * "screen", not "job".
     */
    title: 'The front desk on a small screen',
    audience: 'Practice',
    lead:
      'Everybody here today in one list, in the order they arrived, with what is happening for each of them. '
      + 'Open a name to do their work without leaving the list.',
    /*
     * HARD RULE 8 IN ONE LINE. The wide desk says this in a banner; three
     * stacked notices push the work a third of the way down a small screen, so
     * here it is a sentence in the strip — and it becomes a banner again the
     * moment the platform cannot be reached, which is when it is worth the
     * room.
     */
    neverBlocks: 'Nothing here holds anybody up.',
    listLabel: 'Everybody here today',
    /*
     * THE CHIPS ARE A FILTER AND THEY SAY SO. A row of counts that also
     * happens to be pressable is a control nobody finds; naming the group
     * tells a screen reader what pressing one would do.
     */
    filtersLabel: 'Show only one kind — tap again to show everybody',
    showingOnly: (what: string) => `Showing only “${what}”.`,
    showAll: 'Show everybody',
    nobodyYet: 'Nobody has come in yet today.',
    /*
     * NO DEAD END. An empty filter is the one place somebody on a first shift
     * decides the page is broken, so it names what is empty and the control
     * that undoes it sits beside this sentence.
     */
    noneOfThose: (what: string) => `Nobody is in “${what}” right now.`,
  },

  /*
   * THE PRACTICE'S DAY REGISTER — `/practice/day` (Carl, 12 September 2026, on
   * the front desk page: *"Add a button here with a link to show all Patients
   * seen at this practice today. You could put a filter on this to search for
   * any day. Default to today."*).
   *
   * A RECORD, NOT A WORK LIST, AND THE WORDS SAY SO. Every other list at this
   * practice is phrased as something to do; nothing here asks for anything.
   * Hard rule 8 is stated out loud rather than left to be inferred, because a
   * screen full of "Not yet" is exactly where a first-day starter would go
   * looking for a rule that stops a patient being seen.
   *
   * NEVER "CERTIFIED", "APPROVED" OR "ACCREDITED" ABOUT ONE OF OUR FORMS (hard
   * rule 12). "Signed" is what happens; "Signed and stored" is what it becomes.
   *
   * THE PRACTICE'S OWN NUMBER IS THE ONLY IDENTIFIER ON THE PAGE, and it is
   * labelled for the reason the front desk labels it: a bare run of digits
   * under a name could be read as anything, and what it must never be read as
   * is a Medicare card number (hard rule 1, REQ-VER-02).
   */
  dayRegister: {
    audience: 'Practice',
    title: 'Who came in',
    lead:
      'Everybody the practice took in on one day, in the order they arrived, and what happened about their '
      + 'agreement. Change the day to look back.',
    notLoaded: 'This day could not be loaded',
    /* Hard rule 8, said to the person most likely to read a table as a rule. */
    neverBlocks:
      'This is a record of what happened. Nothing on it holds anybody up — patients are seen and billed as '
      + 'usual, whatever it says.',

    dateLabel: 'Day',
    dateHint: 'Any day you like. Leave it on today to watch this morning fill up.',
    today: 'Back to today',
    /*
     * WHICH CLOCK THE DAY WAS MEASURED IN, said on the page rather than
     * assumed. A register headed "12 September" that quietly meant the UTC day
     * would be wrong for the whole of a Sydney morning, and nobody reading it
     * would be able to tell.
     */
    timezoneNote: (zone: string) => `A day starts and ends by the practice’s clock (${zone}).`,
    count: (n: number) => (n === 1 ? '1 person' : `${n} people`),
    nobody: 'Nobody was taken in on this day.',

    columnName: 'Patient',
    columnArrived: 'Arrived',
    columnSeenBy: 'Came to see',
    columnAgreement: 'Agreement',
    columnSigned: 'Signed',
    columnVisit: 'Visit',
    tableCaption: (date: string) => `Patients taken in on ${date}`,

    /* The same words, and the same reasoning, as the front desk’s own rows. */
    patientRecordNumber: (number: string) => `PMS patient ID ${number}`,
    /*
     * SOMEBODY WALKED IN AND WE COULD NOT MATCH THEM TO A RECORD. Listed
     * anyway — a register that quietly dropped them would be wrong without
     * saying so — and named by the practice’s own number, which is the handle
     * reception has in front of them.
     */
    noPatientRecord: 'No patient record matched',
    /*
     * WHOSE AGREEMENT IT IS, where that is somebody other than the person the
     * patient came to see (ARRIVAL-WHO-IS-SEEN.md §6a). Shown only when the two
     * differ, so a name here always marks a real difference.
     */
    agreementUnder: (name: string) => `${name}’s agreement`,
    /* Nobody is named on the arrival, or nobody we could resolve. */
    seenByUnknown: 'Not recorded',
    /*
     * NO AGREEMENT AT ALL, AND THAT IS TWO DIFFERENT THINGS SAID IN ONE
     * HONEST SENTENCE: a visit that needs none (no Medicare claim, so no
     * benefit to assign) and one where none has been drafted yet. The page
     * cannot tell them apart from what the server sends, so it does not
     * pretend to.
     */
    noAgreement: 'None on this visit',
    signedYes: 'Signed',
    signedNo: 'Not yet',
    /* Nothing to sign, so neither answer applies. */
    signedNotApplicable: 'Nothing to sign',
    /* Nobody recorded where the visit got to. Not a warning; it gates nothing. */
    visitNotSaid: 'Nobody said',
    /*
     * A LIFECYCLE STATE IN THE WORDS THE DESK USES — not the patient portal's,
     * which are written to the patient ("Waiting for your signature").
     *
     * A STATE WITH NO ENTRY SHOWS ITS OWN CODE, never a blank and never a
     * generic fallback (CLAUDE.md §7): a blank cell in this column would read
     * as "there is no agreement", which is the most dangerous thing this page
     * could say by accident.
     */
    statuses: {
      draft: 'Draft',
      verification_pending: 'Identity check running',
      verification_failed: 'Identity check did not pass',
      awaiting_signature: 'Waiting for a signature',
      signed: 'Signed',
      validated: 'Signed, checked against the s 65C data set',
      stored: 'Signed and stored',
      active: 'Ongoing agreement in place',
      claim_linked: 'Signed, and a claim has been made',
      declined: 'Declined',
      expired: 'Expired',
      verbal_recorded: 'Recorded verbally',
      void: 'Void',
      ceased: 'Ended',
      registration_pending: 'Waiting on registration',
      registered: 'Registered',
      registration_overdue: 'Registration overdue',
      legal_hold: 'On legal hold',
      retention_expiry_scheduled: 'Scheduled for deletion',
    } as Record<string, string>,
  },

  /*
   * WHO IS WAITING FOR ME, AND IS THEIR PAPERWORK DONE
   * (PRACTITIONER-QUEUE-PAGE.md; Carl, 12 September 2026).
   *
   * "PROVIDER" AND "PRACTITIONER", NEVER "DOCTOR" OR "GP" (CLAUDE.md §3,
   * REQ-MP-01) — and never "certified", "approved" or "accredited" about a
   * form (hard rule 12). "Done" means signed and stored, and the word on
   * screen is "Done".
   *
   * EVERY WORD ON THIS PAGE IS A REPORT. Hard rule 8 is not left to be
   * inferred anywhere in here: `neverBlocks` says it out loud, and no string
   * below is phrased as a permission, a hold or a requirement.
   */
  practitionerQueue: {
    audience: 'Practitioner',
    notLoaded: 'This page could not be loaded',

    landing: {
      title: 'Your page at this practice',
      /**
       * WITH THE PRACTICE NAMED (Carl, 12 Sep 2026). The address is the
       * location's own single line as the register holds it; when it is not
       * known the title stops at the name rather than showing a blank.
       */
      titleAt: (practice: string, address: string | null) =>
        address ? `Your page at Practice: ${practice}, ${address}` : `Your page at Practice: ${practice}`,
      /*
       * WHY THIS PAGE EXISTS, SAID ON IT. §1: the setup hub is the
       * administrator's page, and sending a provider there is how a person
       * learns to ignore their own home screen.
       */
      lead: 'Your own starting point here. Everything about you across practices is on your practitioner page.',
      signedInAs: (name: string) => `Signed in as ${name}.`,
      atPractice: (practice: string) => `You are working at ${practice}.`,
      /*
       * MORE THAN ONE PRACTICE IS ORDINARY, not an error. A practitioner works
       * at several and which ones changes, so the page asks rather than picks
       * — and it asks with the names in front of them, not in prose.
       */
      choosePractice: 'You work at more than one practice. Choose the one you are at today.',
      noPractice: 'You have no current affiliation with a practice, so there is nothing here yet.',
      noPracticeWhy:
        'A practice adds you by inviting you to one of its locations, and you accept from the message it '
        + 'sends. If you were expecting to see a practice here, ask them to check your listing.',
      waitingTitle: 'Who is waiting for you',
      waitingBody:
        'Today’s patients, in the order they arrived, and whether their paperwork is done. It never holds '
        + 'anybody up.',
      waitingLink: 'Open your waiting list',
      /** Their cross-practice page, which answers a different question (§1). */
      aboutYouTitle: 'About you',
      aboutYouBody: 'Your details, where you work, and what has been sent to you — across every practice.',
      aboutYouLink: 'Open your practitioner page',
    },

    waiting: {
      title: 'Patients waiting for consultation',
      lead: 'Today’s patients, in the order they arrived, and whether their paperwork is done.',
      /*
       * HARD RULE 8, IN AS MANY WORDS RATHER THAN LEFT TO BE INFERRED (§4.1).
       * The person reading this is the one who could act on a doubt, so the
       * doubt is answered before it is had.
       */
      neverBlocks:
        'Nothing on this page holds anybody up. See your patients exactly as you always would — this page '
        + 'only reports whether the paperwork is done, and it never stops a consultation.',
      /*
       * NO BACK STRING HERE. The way back moved into the shell's header with
       * every other page's (Carl, 12 Sep 2026), and it is named for its
       * destination there — `nav.backTo` and the destination page's own title,
       * so this page cannot drift out of step with what `today` is called.
       */
      /*
       * THE BOUNDARY, SAID ON THE SCREEN (§2). A page called "who is waiting"
       * is the likeliest place in the product to quietly become a second
       * waiting room, and the honest thing is to say what it is not.
       */
      paperworkOnly:
        'Paperwork only. Why somebody is here, and everything clinical about them, stays in your practice '
        + 'software.',

      /*
       * THE COLUMNS (§3). There is deliberately no card-number column: the
       * practice’s queue ticket is not recorded yet, and a column that is
       * always blank is worse than no column at all.
       */
      columnName: 'Name',
      columnWaitingSince: 'Waiting since',
      columnPaperwork: 'Paperwork',

      /*
       * THE THREE WORDS, PLUS THE ONE FOR A VISIT THAT NEEDS NO AGREEMENT.
       * "Done" is a signature, stored — never "approved", "certified" or
       * "accredited" (hard rule 12).
       */
      paperwork: {
        done: 'Done',
        with_the_patient_now: 'With the patient now',
        not_yet: 'Not yet',
        nothing_to_sign: 'Nothing to sign',
      } as Record<string, string>,
      /*
       * AND WHAT EACH WORD MEANS, once, beneath the table rather than as a
       * tooltip nobody opens.
       */
      paperworkKey:
        'Done means signed and stored. With the patient now means somebody is signing on a tablet. Not yet '
        + 'means nobody has signed — see them anyway, and the front desk will sort it out.',

      /*
       * WHOSE AGREEMENT IT IS, where that is somebody else (§6a). Shown only
       * when it differs, because saying "your agreement" to a nurse would not
       * be honest and repeating a provider’s own name to them would be noise.
       */
      agreementUnder: (provider: string) => `${provider}’s agreement`,

      /*
       * THE STATUS CONTROL (§3a; Carl, 12 Sep 2026: *"Need buttons or drop down
       * to say 1. With patient now 2. Pending (patient in queue) 3. Completed
       * (consultation completed) 4. Reassign (to a different Doctor)"*).
       *
       * ONE LABELLED SELECT PER ROW, NOT FOUR BUTTONS (§3a rule 7): *"four
       * buttons across fifteen rows is sixty targets on a screen a doctor
       * glances at."* Every select is labelled with the patient it is about, so
       * a screen reader reads "Status for Jamie Sampleton" rather than the
       * fifteenth unnamed combo box on the page (WCAG 2.2 AA, 4.1.2).
       */
      columnStatus: 'Status',
      /** The accessible name for one row's control. Never visible; never generic. */
      statusFor: (patient: string) => `Status for ${patient}`,
      /*
       * THE FOUR WORDS, KEYED BY THE CONTENT FILE'S OWN KEYS
       * (`packages/domain/content/visit-states.json`). The screen renders that
       * file in FILE ORDER and never carries the list itself, so the list
       * changes without a code change (CLAUDE.md §7). "Completed" means the
       * consultation is over — never "approved", "certified" or "accredited",
       * which are forbidden about anything of ours (hard rule 12).
       */
      visitState: {
        pending: 'Pending',
        with_patient_now: 'With patient now',
        completed: 'Completed',
        reassign: 'Reassign',
      } as Record<string, string>,
      /*
       * WHAT THE FOUR WORDS MEAN, once, beneath the table. "Reassign never
       * reassigns" is said in as many words because a control that sounds like
       * it moves somebody and does not is worse than no control (§3a rule 4).
       */
      visitStateKey:
        'Pending is where every visit starts and nobody sets it. Completed means the consultation is over. '
        + 'Reassign asks the front desk to find somebody else — it moves nobody by itself, and the desk '
        + 'checks the paperwork before anything changes.',
      /* Hard rule 8 again, about the control rather than the list. */
      visitStateNeverBlocks: 'Setting a status holds nobody up, and leaving one unset holds nobody up either.',
      /** While the press is in flight. Rows stay readable; nothing is torn down. */
      visitStateSaving: 'Saving…',
      /*
       * SHORTCUTS TO THE ANSWER, NOT DIRECTIONS TO A SCREEN (CLAUDE.md §7). A
       * refusal says what happened and what to do, and an unmapped code SHOWS
       * ITS CODE so it can be diagnosed rather than rendering as silence.
       */
      visitStateFailed: (why: string) => `That status was not saved: ${why}`,
      /*
       * WHAT "COMPLETED" CAME TO. Every one of these is a report, never a
       * refusal: the status IS saved in all of them (hard rule 8).
       */
      renderedOutcome: {
        raised: 'Completed. The after-visit agreement has been raised for the front desk.',
        already_decided: 'Completed. This visit’s after-visit paperwork was already settled.',
        /*
         * THE ORDINARY CASE, AND IT SAYS WHY WITHOUT BLAMING ANYBODY. An
         * after-visit agreement needs the item numbers from the practice’s own
         * invoice, and this platform never invents them.
         */
        awaiting_item_numbers:
          'Completed. The after-visit agreement is raised once your practice software sends the invoice — '
          + 'it carries the item numbers, and we never guess them.',
        provider_not_named:
          'Completed. No claim is recorded against this visit yet, so there is nothing to sign.',
        not_raised:
          'Completed. The after-visit paperwork could not be worked out just now — the front desk can '
          + 'still capture it after the visit.',
      } as Record<string, string>,
      /** Reassign, once it has landed. It says plainly that nobody moved. */
      reassignRaised:
        'The front desk has been asked to find somebody else for this patient. Nobody has been moved yet.',

      /*
       * MOVING A LIST TO SOMEBODY ELSE — the sick-practitioner morning (Carl,
       * 12 September 2026). RECEPTION ONLY: the practitioner's own view of this
       * page has no such control, because deciding who sees a patient instead
       * is the front desk's act (§3a rule 4) and a control somebody will never
       * legitimately use is one that will one day be pressed by mistake (§3).
       */
      move: {
        title: 'Move patients to another practitioner',
        /*
         * WHAT IT ACTUALLY DOES, ON THE SCREEN, because the person pressing it
         * is changing a legal record: the agreement names the practitioner, so
         * moving the patient replaces it with one naming the new practitioner.
         * The old one is kept exactly as it is.
         */
        whatItDoes:
          'An agreement names the practitioner who will see the patient, so moving somebody replaces theirs '
          + 'with one naming the practitioner they are moving to. The original is kept exactly as it is and '
          + 'nothing is billed under it.',
        /*
         * THE PATIENT HAS NOT BEEN ASKED, SAID OUT LOUD (D-2026-09-12-03: a
         * substitution is two questions, in order, and this action asks
         * neither). Leaving reception to assume it had been asked is how the
         * two questions get bundled into one.
         */
        notAsked:
          'The patient has not been asked. This changes the paperwork only — ask each person at the desk '
          + 'whether they are happy to be seen by somebody else.',
        /* Hard rule 8, about this control rather than about the list. */
        neverBlocks: 'Moving somebody holds nobody up, and a patient nobody can move is still seen as usual.',
        /** The accessible name for one row's box. Never generic — one per patient. */
        selectFor: (patient: string) => `Select ${patient}`,
        /** The sick-practitioner case in one press: everybody in this group. */
        selectEveryone: (practitioner: string) => `Select everybody waiting for ${practitioner}`,
        chooseLabel: 'Move the selected patients to',
        choosePlaceholder: 'Choose a practitioner',
        /** The same practitioner at two sites is two choices, and the site tells them apart. */
        choiceAt: (name: string, location: string) => `${name} — ${location}`,
        button: (n: number) => (n === 1 ? 'Move 1 patient' : `Move ${n} patients`),
        moving: 'Moving…',
        /** Nothing is selected, or nobody is chosen to move them to. */
        nothingChosen: 'Choose the patients to move, and the practitioner to move them to.',
        /** The whole press failed — the server was unreachable, or refused it outright. */
        failed: (why: string) => `Nobody was moved: ${why}`,
        /*
         * WHAT THE PRESS CAME TO, IN COUNTS. Partial failure is never silent:
         * the refused are counted here and each one says why on its own row.
         */
        summaryMoved: (n: number) => (n === 1 ? '1 patient moved.' : `${n} patients moved.`),
        summaryRefused: (n: number) =>
          n === 1 ? '1 could not be moved — see the row.' : `${n} could not be moved — see their rows.`,
        summarySignAgain: (n: number) =>
          n === 1
            ? '1 of them had already signed and signs again at the desk.'
            : `${n} of them had already signed and sign again at the desk.`,
        /** On the row itself, so the answer is where the patient is. */
        outcomeMoved: 'Moved.',
        outcomeSignAgain:
          'Moved. They had already signed for the practitioner they are leaving, so they sign again at the '
          + 'desk when they come in.',
        /*
         * WHY A ROW WAS NOT MOVED, KEYED BY THE SERVER'S REASON CODE — with
         * what to do about it, not a description of the failure (CLAUDE.md §7).
         */
        refusal: {
          arrival_not_found:
            'This visit is not on today’s list any more. Refresh the page and look for them again.',
          arrival_not_received:
            'This arrival is still waiting for somebody to be named as the provider, which is fixed on the '
            + 'patients queue.',
          already_with_that_practitioner: 'This patient is already here to see that practitioner.',
          target_cannot_be_a_provider:
            'The claim does not go under that practitioner’s number at this location, so a list cannot be '
            + 'moved to them. Choose the practitioner the visit will be billed under.',
          target_not_at_that_location:
            'That practitioner is not working at the location this patient came to. Choose somebody at the '
            + 'same location.',
          no_location_on_the_arrival:
            'This visit does not say which location the patient came to, so there is nothing to match a '
            + 'practitioner against. The front desk can send the arrival again.',
          agreement_not_moved:
            'This patient’s agreement changed while the list was open, so nothing was moved. Refresh the '
            + 'page and try again.',
          move_failed:
            'Something went wrong before anything was changed for this patient. Nobody else was affected — '
            + 'try them again.',
          /*
           * THE HALF-DONE ONE, SAID PLAINLY. The agreement moved and the visit
           * row did not, so the two disagree — and the fix is the same button,
           * which settles it rather than moving them a second time.
           */
          move_not_recorded:
            'This patient’s agreement was moved and their visit was not, so the two disagree. Press Move '
            + 'again for this patient to settle it — nothing will be duplicated.',
        } as Record<string, string>,
        /** The destination for the one refusal whose fix is on another page. */
        refusalLink: { arrival_not_received: '/practice/patients' } as Record<string, string>,
        refusalLinkLabel: 'Open the patients queue',
        /*
         * AN UNMAPPED CODE SHOWS ITS CODE. A generic fallback is a defect: it
         * tells the person nothing and hides the diagnosis (CLAUDE.md §7).
         */
        refusalUnknown: (code: string) => `Not moved (${code}).`,
      },

      nobodyWaiting: 'Nobody is waiting for you at the moment.',
      nobodyWaitingPractice: 'Nobody is waiting at the moment.',
      /** A group whose arrival named nobody we could match to a practitioner. */
      unmatched: 'Not yet matched to a practitioner',
      /** Reception’s view: one group per practitioner (Carl, 12 Sep 2026). */
      everyone: 'Everyone waiting, by practitioner',
      count: (n: number) => (n === 1 ? '1 person' : `${n} people`),
    },
  },

  tablet: {
    title: 'Send to the tablet',
    lead:
      'You have checked the patient at the desk. Send their agreement to the tablet beside you — they '
      + 'check their details, read it, and approve. They never have to find themselves or type anything.',
    audience: 'Practice',
    notLoaded: 'This page could not be loaded',
    loading: 'Loading…',
    refresh: 'Refresh',

    /*
     * WHAT SENDING ACTUALLY DOES, on the screen, because the person pressing
     * the button is making a legal record and should know it. Two facts: the
     * check they just did across the desk is what gets recorded against their
     * name (REQ-VER-03/-04), and the patient cannot be handed an unfinished
     * agreement (REQ-REG-06).
     */
    whatItDoes:
      'Sending records that you checked this patient’s name, date of birth and address at the desk, against '
      + 'your name. The agreement is completed and locked before it reaches the tablet, so nobody can be '
      + 'asked to sign a draft.',
    /** Hard rule 8 in the words a receptionist needs: none of this holds anybody up. */
    neverBlocks:
      'None of this affects the patient being seen. If they walk away, the visit carries on and you can bill '
      + 'privately or ask again after the service.',

    todayTitle: 'Waiting to be signed today',
    todayLead: 'Today’s agreements. The ones that cannot go yet say what they are waiting for.',
    todayNone: 'Nothing is waiting to be signed today.',
    todayCount: (n: number) => (n === 1 ? '1 agreement' : `${n} agreements`),
    unbooked: 'No appointment time',
    d6aLabel: 'Service',
    d6aMissing: 'Not set',
    d6aStale: 'From an older list',

    /*
     * THE SECOND MOMENT, ON THE SAME DESK (Carl, 11 Sep 2026; TODO.md "Two
     * front doors" (b)).
     *
     * A POST-AGREEMENT SAYS THE DAY AND THE ITEMS, NOT A DESCRIPTION. D6a is a
     * pre-agreement particular and D6b — the MBS item numbers — is the
     * post-agreement's (REQ-REG-01; s 65C(4) table item 6), so the row states
     * what the agreement actually carries rather than a blank "Service: Not
     * set" that would read as something missing.
     *
     * AND NO AMOUNT. There is no benefit or dollar figure on any agreement
     * artefact and none on the row that names one (hard rule 4, REQ-REG-04).
     */
    postServiceLabel: 'Post-service',
    postServiceItems: (items: string) => `items ${items}`,
    postServiceItem: (item: string) => `item ${item}`,
    postServiceNoItems: 'no item numbers recorded',
    postServiceFact: (when: string, items: string) => `Post-service · ${when} · ${items}`,

    /*
     * TODAY'S VISITS THAT NEEDED NO SECOND SIGNATURE — a quiet history line,
     * never a Send (Carl, 11 Sep 2026, step 4).
     *
     * IT NAMES WHAT COVERED THE VISIT AND LINKS THERE ("shortcuts to the
     * answer", CLAUDE.md section 7): a receptionist seeing a patient walk out
     * with nothing on screen about them cannot tell "already covered" from "we
     * forgot", and a line with no destination would only half fix that.
     *
     * NOTHING HERE CALLS OUR FORMS certified, approved or accredited (rule 12).
     */
    coveredTitle: 'Covered already today',
    coveredLead:
      'These visits were billed and need no second signature. Nothing is waiting on the patient.',
    coveredNone: 'Nothing has been covered by an earlier agreement today.',
    coveredCount: (n: number) => (n === 1 ? '1 visit' : `${n} visits`),
    /** The reason codes the post-service table can give, in a receptionist's words. */
    coveredReason: {
      covered_by_todays_agreement: 'Covered by today’s agreement',
      covered_by_an_ongoing_agreement: 'Covered by an ongoing agreement',
    } as Record<string, string>,
    /**
     * AN UNMAPPED CODE SHOWS ITSELF (CLAUDE.md section 7). A newer server
     * deciding for a newer reason must reach reception as something they can
     * quote down the phone, never as a generic sentence that hides it.
     */
    coveredReasonUnknown: (code: string) => `Covered (${code})`,
    coveredOpenAgreement: 'Open the agreement that covers it →',

    /*
     * UNSIGNED FROM EARLIER DAYS (D-2026-10-10-01, option 1). An agreement
     * still unsigned at midnight used to drop off this page with no word.
     *
     * EACH LINE SAYS WHAT THE PLATFORM OBSERVED AND NOTHING MORE (wow.md §13):
     * whether a service record names the agreement and, if so, whether it is on
     * the Reconciliation queue. No "please follow up": what to do depends on the
     * visit, and the link goes to the place where that is decided.
     */
    earlierSummary: (n: number) => `Unsigned from earlier days: ${n}`,
    earlierLead: 'Not signed on the day they were for. Each line says what the platform found about its service.',
    /** The day it was for, and the provider — "3 October 2026 · Dr Example Provider". */
    earlierFor: (day: string, provider: string | null) => (provider ? `${day} · ${provider}` : day),
    earlierReason: {
      service_in_reconciliation: 'Service recorded, in Reconciliation',
      /* D-2026-10-10-09, option (b): associated with the visit's service, never linked to it. */
      service_associated:
        'Service recorded for this visit; this agreement was not signed before it and is associated with that service',
      service_choice_needed: 'Service recorded for this visit; waiting for someone to choose its agreement in Reconciliation',
      service_associated_other: 'Service recorded for this visit; a different agreement is associated with it',
      no_service_recorded: 'No service recorded',
    } as Record<string, string>,
    /** A service record names it, and a Reconciliation decision took it off the queue. */
    earlierDecided: (decision: string) => `Service recorded; Reconciliation decision: ${decision}`,
    /** AN UNMAPPED CODE SHOWS ITSELF (CLAUDE.md §7c). */
    earlierReasonUnknown: (code: string) => `Unsigned (${code})`,
    earlierToReconciliation: 'Open it in Reconciliation →',
    earlierCapped: (shown: number, total: number) => `Showing the oldest ${shown} of ${total}.`,
    earlierUnreachable: 'the service could not be reached',
    earlierNotLoaded: (status: string) => `Could not check for unsigned agreements from earlier days (${status}).`,
    /*
     * WHO IS SIGNING, SAID ON THE ROW (Carl, 7 Sep 2026, twice: "it does not
     * ask me who is approving", "no who is signing").
     *
     * IT NAMES PEOPLE NOW. The line used to read "Signing: The patient", which
     * is a category rather than an answer -- reception looking at Kim's row
     * could not tell from it that Kim is the one who will sign, and the fact
     * they actually need on the morning somebody else is signing ("Alex, for
     * Kim") was not on the row at all. Both shapes name the person, in the
     * order a receptionist would say them out loud.
     *
     * ONE COPY, read by the tablet desk and by the patient work page's
     * Agreements card, because both render the same `Row` -- two screens with
     * two wordings for D7 is two screens that can disagree about a particular
     * of a contract.
     *
     * NO CAPACITY LANGUAGE, here or anywhere near it (REQ-VUL-05). The line
     * states who; it never asks anybody to judge whether they may.
     */
    signingLabel: 'Signing',
    signingPatient: 'the patient',
    signingOther: (assignorName: string, patientName: string, relationship: string) =>
      relationship
        ? `${assignorName} for ${patientName} — ${relationship}`
        : `${assignorName} for ${patientName}`,
    signingUnset: 'Not decided yet',
    /**
     * PRESSING THE LINE IS HOW YOU CHANGE IT, and the accessible name says so
     * WITHOUT losing the visible words (WCAG 2.2, 2.5.3 Label in Name): the
     * fact is spoken first, this is appended.
     */
    signingChange: 'change who is signing',
    onTabletNow: (label: string) => `On ${label} now`,
    /**
     * THE ROW SAYS WHAT WENT WRONG AND CARRIES YOU TO IT (Carl, 11 Sep 2026;
     * CLAUDE.md §7 "Shortcuts to the answer, not directions to a screen").
     *
     * The queue line at the top of the desk knew the patient had crossed a
     * detail and said nothing about it, while the panel that FIXES it sat far
     * down the same page behind its own heading. Reception had to know the
     * page to find the thing the page already knew. So the chip names the
     * fault and links to the exact card.
     *
     * TYPES, NEVER VALUES (REQ-VER-04). What is named here is that a detail is
     * disputed — never which value the patient says is wrong.
     */
    liveFaultDetail: 'A detail is wrong',
    liveFaultSignature: 'The signature was refused',
    liveFaultGoTo: (label: string) => `go to ${label}`,
    /**
     * THE SESSION'S OWN ID, SHORT (Carl, 4 Sep 2026). The tablet's footer
     * shows the same eight characters, so a receptionist and a tablet can be
     * matched by eye — during testing, and later when somebody asks the
     * evidence which screen a signature came off.
     *
     * AN ID IS NOT A DETAIL ABOUT ANYBODY. It names a session row, which is
     * the same thing the vault events name; nothing about the patient is
     * added to a screen by putting it here.
     */
    sessionTag: (shortId: string) => `session ${shortId}`,

    /*
     * WHO IS SIGNING — set at the DESK, before the push, and never on the
     * tablet. D7 is explicit and is never inferred (CLAUDE.md §3): the patient
     * signs for themselves, or somebody with them signs for them, and the
     * agreement prints whichever it is.
     *
     * THE SCREEN ASKS THE RELATIONSHIP, NEVER THE AUTHORITY BASIS, for the same
     * reason the tablet does: "co-resident relative 18+" is the statute's
     * vocabulary and nobody else's. The options and their order come from
     * versioned content, not from this table (hard rule 14) — only the WORDS
     * live here, and they are the kiosk's own, read from one place so a
     * translation cannot mean two different things on two screens.
     */
    whoTitle: 'Who is signing',
    whoOpen: 'Who is signing?',
    whoClose: 'Close',
    whoPatient: 'The patient is signing',
    whoOther: 'Someone else is signing for them',
    whoName: 'Their full name',
    whoRelationship: 'Their relationship to the patient',
    whoRelationshipPlaceholder: 'Choose…',
    whoDescribe: 'Please describe',
    /** Composed from MIN_AGE_ASSIGN_FOR_OTHER — the threshold is never typed here. */
    whoAgeConfirm: (minimumAge: number) => `They confirm they are ${minimumAge} or over`,
    /*
     * THE SAME DECLARATION, ALREADY GIVEN (Carl, 10 Sep 2026). Reopening a row
     * whose assignor was saved with this attestation states it instead of
     * asking for it again — it was declared at Save and it is on the record.
     * A statement of fact, in the past tense, with no control beside it; it
     * says nothing about anybody's capacity, because nobody was ever asked
     * (REQ-VUL-05).
     */
    whoAgeOnRecord: (minimumAge: number) => `They confirmed they are ${minimumAge} or over.`,
    whoContactHint: 'A mobile or an email, so their copy of the agreement can reach them.',
    whoMobile: 'Mobile',
    whoEmail: 'Email',
    /*
     * THE THREE STEPS, NUMBERED, ON EVERY ROW (Carl, 7 Sep 2026: "change the
     * workflow to 'who is signing' only -- after that is actioned, enable the
     * select tablet and send button").
     *
     * WHY THE ROW SAYS IT RATHER THAN A HELP PAGE. Carl pushed Kim to a tablet
     * and told us twice that the desk never asked who was signing. The controls
     * were all there and all live at once, so nothing on the row said which one
     * came first -- and the one that mattered looked optional beside a Send
     * that went straight away. Numbering them makes the order the row's own
     * fact instead of something a receptionist has to be taught.
     *
     * THREE WORDS EACH, because this line is read a hundred times a morning and
     * never studied once.
     */
    stepsLabel: 'Steps to send',
    stepWhoIsSigning: 'Who is signing',
    stepChooseTablet: 'Choose a tablet',
    stepSend: 'Send',
    /** Spoken, not shown — the number and the tick already say it on screen. */
    stepDone: 'done',
    stepNow: 'do this next',
    whoSave: 'Save who is signing',
    whoSaving: 'Saving…',
    whoSaved: 'Saved.',
    /*
     * A CORRECTED MOBILE OR EMAIL, SAID AS WHAT IT IS (Carl, 11 Sep 2026 —
     * D-2026-09-11-01). How the signer is REACHED is a delivery detail and not
     * one of the s 65C particulars, so no new agreement was prepared and the
     * row on screen is still the one being signed. Saying only "Saved." beside
     * a row that supersedes for every other edit left reception unsure which
     * of the two had just happened.
     */
    whoSavedContact: 'Contact details updated.',
    /*
     * AND WHAT HAPPENS ON A ROW THAT IS ALREADY PREPARED (Carl, 7 Sep 2026).
     *
     * An arrival locks its particulars as reception posts it, so by the time
     * the patient is at the desk every row here is prepared — and who signs is
     * one of the LOCKED particulars (hard rule 2, REQ-REG-06). It can still be
     * changed; what it cannot be is edited. So the panel says, before anybody
     * types, exactly what pressing Save will do: a second agreement with the
     * same details and the new signer, and the first one left on the record
     * saying what it always said (HARD-02).
     *
     * IT NEVER SAYS "APPROVED", "CERTIFIED" OR "ACCREDITED" about our forms
     * (hard rule 12). "Prepared" is what happened: the details were checked
     * against the s 65C data set and written down.
     */
    whoLockedLead:
      'This agreement is already prepared. Changing who signs prepares a new one with the same '
      + 'details; the first stays on record.',
    whoSavedSuperseded:
      'Saved. A new agreement is ready with the new signer, and it is on the list below. The first '
      + 'one stays on record and can no longer be signed.',
    /*
     * WHY IT COULD NOT BE CHANGED, IN RECEPTION'S WORDS AND WITH THE NEXT ACT
     * IN THEM (CLAUDE.md §7). The server sends a CODE; an unmapped one is
     * SHOWN rather than swallowed, because a generic sentence would hide the
     * one string that lets somebody diagnose a refusal this list has not met.
     */
    whoRefusals: {
      already_signed:
        'This agreement has already been signed, so who signed it cannot be changed — it is a record '
        + 'of something that happened. If the wrong person signed, tell us; the patient is unaffected '
        + 'and can still be bulk billed.',
      agreement_moved_on:
        'This agreement has moved on — it has been superseded, declined or has expired — so there is '
        + 'nothing here to change. Use the patient’s current row on this list instead.',
      /*
       * THE PATIENT IS SIGNING, so there is no third party to reach and the
       * patient's own mobile and email are not this screen's to change — the
       * message says where they ARE changed rather than only what was refused
       * (CLAUDE.md section 7).
       */
      patient_contact_lives_on_the_patient_record:
        'The patient is signing this agreement, so there is nobody else to reach. A patient’s own '
        + 'mobile and email are changed on their record, not here. Nothing was changed.',
    } as Record<string, string>,
    /*
     * THE RULES VERDICT, NAMED (CLAUDE.md section 7; Carl, 12 Sep 2026).
     *
     * A party change SUPERSEDES, and the successor is drafted, validated and
     * re-locked. When that validation refuses, the server answers with a
     * `failures` array — "C6: D6a: a pre-agreement requires a Basic Service
     * Description" — and this screen used to throw all of it away and show
     * only the summary line, which named no rule, no field and nowhere to go.
     * That is the generic dead end CLAUDE.md section 7 calls a defect.
     *
     * THE FAILING RULES ARE SHOWN AS THE SERVER NAMED THEM. They are the one
     * string somebody can act on or quote, and inventing a friendlier sentence
     * per rule would be a second copy of a versioned rule set (hard rule 14).
     * The sentence around them is ours; the diagnosis is the engine's.
     *
     * AND IT SAYS NOTHING WAS CHANGED, because nothing was: the save is one
     * transaction and a refused re-lock leaves the record exactly as it stood.
     * The patient is bulk billed either way (hard rule 8).
     */
    whoRefusalRules: (failures: string) =>
      `That could not be saved because the form would not be complete: ${failures}. Nothing was changed, `
      + 'and the patient can still be bulk billed.',
    whoRefusalUnmapped: (code: string) =>
      `The server reported “${code}”, which this screen does not have wording for yet. Tell us the `
      + 'code — nothing was changed, and the patient can still be bulk billed.',
    /*
     * EACH REFUSAL SAYS WHAT TO DO NEXT. The staff block is NAME-BASED and can
     * therefore hit an innocent namesake, so it states the match and offers the
     * desk rather than accusing anybody — and it never says which name matched
     * (REQ-VUL-04, and Carl's ruling of 3 Sep 2026).
     */
    whoBlockedName: 'Enter their full name.',
    whoBlockedRelationship: 'Choose their relationship to the patient.',
    whoBlockedDescribe: 'Describe the relationship.',
    whoBlockedAge: 'They must confirm they are old enough to sign for someone else.',
    whoBlockedContact: 'Enter a mobile or an email.',
    whoBlockedStaff:
      'That name matches a member of practice staff, who cannot sign on a patient’s behalf. If this is a '
      + 'different person with the same name, take this one at the desk.',

    tabletsTitle: 'Your tablets',
    tabletsLead: 'What each paired tablet is showing right now. This is a status, not a copy of the screen.',
    tabletsNone: 'No tablet is paired to this practice yet.',
    tabletsNoneHint: 'Pair one under Tablets, then it will appear here.',
    tabletIdle: 'Ready',
    tabletRevoked: 'Revoked — re-pair it under Tablets to bring it back',
    /** Reception's own switch. One press on Tablets brings it back — no code, no walk. */
    tabletOutOfUse: 'Not in use — put it back in use under Tablets',
    tabletUnpaired: 'Waiting to be paired',
    /** "Showing to Jamie Sampleton — reading". A name on a staff screen, and nothing else about them. */
    tabletShowing: (patientName: string, state: string) => `Showing to ${patientName} — ${state}`,
    pushedAt: (name: string, when: string) => `Sent by ${name} · ${when}`,

    sendAction: 'Send to tablet',
    sendChoose: 'Choose a tablet',
    sending: 'Sending…',
    sendBlocked: 'Cannot be sent yet',
    recallAction: 'Recall',
    recalling: 'Recalling…',

    /** The session states, as reception reads them. */
    states: {
      pushed: 'sent, not opened yet',
      reading: 'reading',
      details_confirmed: 'details confirmed',
      /*
       * NOT "FAILED" AND NOT "REJECTED". The patient did exactly what the
       * screen asked and told us something we hold is wrong — which is useful
       * work, not an error. The word reception reads decides whether they turn
       * to the patient with an apology or with a correction.
       */
      details_disputed: 'a detail is wrong',
      signed: 'signed',
      walked_away: 'walked away',
      /*
       * TWO CLOCKS, TWO WORDS (Carl, 4 Sep 2026). `timed_out` is the TABLET's
       * own inactivity clock: the patient's record sat on the screen and
       * nobody touched it, so the tablet reset itself and said so.
       * `expired` is the SERVER giving up after thirty minutes in which no
       * request reached it at all — the backstop for a tablet that was
       * killed, went offline, or crashed before it could post its own
       * timeout. Reception acts differently on the two (the first is a
       * patient who wandered off; the second is a tablet worth looking at),
       * so they must not read as the same word — which is what "timed out"
       * on BOTH of them used to do.
       */
      timed_out: 'Timed out',
      recalled: 'recalled',
      expired: 'Ended by the server',
      /*
       * NOT "DECLINED" ON ITS OWN, AND NOT "REFUSED" (Carl, 4 Sep 2026). The
       * patient declined the ONGOING agreement and nothing else -- they have
       * not refused bulk billing, they have not refused care, and the next
       * thing to do is offer them today's visit, which is the button beside
       * this word. A receptionist who reads "declined" alone would reasonably
       * reach for a private bill.
       */
      declined_enduring: 'Declined ongoing — offer today’s visit instead',
      /*
       * NOT "SIGNATURE FAILED" (Carl, 7 Sep 2026). The person signed; the
       * platform did not record it. "Failed" reads as something the patient
       * did, and the first thing reception will do with this row is speak to
       * them. The reason and the next act sit beside it.
       */
      signature_failed: 'Signature not recorded',
    } as Record<string, string>,

    /**
     * WHY A SIGNATURE WAS NOT RECORDED, IN RECEPTION'S WORDS AND WITH THE NEXT
     * ACT IN THEM (Carl, 7 Sep 2026; "Shortcuts to the answer", CLAUDE.md §7).
     *
     * THE SERVER SENDS A CODE AND THIS TURNS IT INTO A SENTENCE SOMEBODY CAN
     * ACT ON. Every mapped code says what happened AND what to do; the row
     * itself carries "Send again", which is the destination for most of them.
     *
     * AN UNMAPPED CODE SHOWS THE CODE — `signatureFailedUnmapped` below — and
     * that is the design principle rather than a gap. A generic fallback
     * sentence would be a defect: it would hide the one string that lets
     * somebody diagnose a refusal this list has not met yet.
     */
    signatureFailedTitle: 'Signature not recorded',
    signatureFailedReasons: {
      /*
       * THE ONE CARL HIT, and the copy names the actual fix. A tablet running
       * a build from before the statements existed signs without them and is
       * refused every time; the kiosk reloads itself once when it sees this,
       * so most of the time it is already healed by the time this is read.
       */
      affirmations_missing:
        'The tablet did not send the ticked statements. Reload the tablet and send again.',
      not_locked:
        'The agreement was not complete and locked when it was signed, so nothing could be recorded. '
        + 'Send it again — it is locked before it reaches the tablet.',
      already_signed:
        'This agreement has already been signed, so there was nothing left to record. Nothing is '
        + 'outstanding for this patient.',
      not_awaiting_signature:
        'This agreement is not at the signing step — it may have been declined, superseded or expired. '
        + 'Check the agreement before sending anything again.',
      /* D-2026-10-10-09 option 3: what was recorded, and no remedy this screen cannot know is true. */
      agreement_closed_unsigned:
        'This agreement was closed as not needed: no service was recorded for its visit within the practice’s '
        + 'set number of days. Nothing was signed.',
      signature_capture_invalid:
        'The signature did not arrive with the tablet’s request. Send it again, and offer '
        + '“approve by tapping” if the pad is not responding.',
      storage_validation_failed:
        'The agreement did not pass its final check against the s 65C data set, so it was not stored. '
        + 'Tell us about this one — the patient is unaffected and can still be bulk billed.',
    } as Record<string, string>,
    /** The design principle: an unmapped code is shown, never swallowed. */
    signatureFailedUnmapped: (code: string) =>
      `The tablet reported “${code}”, which this screen does not have wording for yet. Tell us the code and `
      + 'send it again.',
    /** Hard rule 8, said on the one row that most looks like a failure. */
    signatureFailedNeverBlocks:
      'Nothing happened to the agreement and nothing happened to the appointment. The patient is seen '
      + 'either way, and you can send it again, bill privately, or ask again after the service.',

    /**
     * AND THE ONE PRESS THAT ANSWERS IT (Carl, 4 Sep 2026; GA-PLAN B5).
     *
     * "Shortcuts to the answer, not directions to a screen" (CLAUDE.md
     * section 7): the row that says the patient would rather agree each visit
     * carries the control that makes that happen -- a fresh agreement for
     * today's visit, for the same provider and patient, sent to the same
     * tablet they are still standing at.
     */
    offerEpisodicAction: 'Create agreement for today’s visit',
    offerEpisodicBusy: 'Creating…',
    offerEpisodicLead:
      'They would rather agree each visit. This creates an agreement for today’s visit with the same '
      + 'provider and sends it to the same tablet. Their appointment is not affected and they can still be '
      + 'bulk billed today.',
    offerEpisodicDone: 'Sent. They can sign for today’s visit now.',

    /**
     * AND THE SAME ANSWER WHERE THE PATIENT WAS NEVER ASKED (Carl, 5 Sep 2026;
     * CLAUDE.md section 7, second instance).
     *
     * The band that says the enduring rule set is awaiting authoring used to
     * state the problem and stop. Reception cannot author a rule set; what
     * they CAN do is get the person in front of them an agreement for today,
     * and stop the practice drafting ongoing ones until the rule set exists.
     * Both are on the band, so neither is a screen somebody has to go and find.
     *
     * IT DOES NOT SAY "SENT". Unlike the decline, there is no tablet and no
     * patient standing at one -- the draft joins today's list and reception
     * sends it when they are ready.
     */
    offerEpisodicInsteadAction: 'Create an agreement for this visit instead',
    offerEpisodicInsteadBusy: 'Creating…',
    offerEpisodicInsteadDone:
      'Created. The agreement for today’s visit is on the list below, ready to send to a tablet.',
    /**
     * THE SETTING, NOT A SCREEN TO GO HUNTING ON. It lands on the Kiosk card
     * where "offer an ongoing agreement first" is ticked, so the next arrival
     * is drafted as an agreement for the visit instead of joining the queue of
     * blocked ongoing ones.
     */
    toChannelsForOffer: 'Change what the tablet offers first →',

    /**
     * ONGOING AGREEMENTS ARE NAMED UNDER THEIR PROVIDER, NEVER PRACTICE-WIDE
     * (hard rule 6, REQ-END-01). The row heading is the one place a
     * receptionist would otherwise read "this practice", so it says the
     * provider or says plainly that none is set.
     */
    enduringRow: (provider: string) => `Ongoing agreement · ${provider}`,
    enduringRowNoProvider: 'Ongoing agreement · provider not set',

    /*
     * WHAT THE PATIENT SAID IS WRONG (Carl, 4 Sep 2026: "the
     * practice-reception-user ... should be able to see the same screen and be
     * told what the patient did not agree to").
     *
     * THE TYPES, IN OUR WORDS, AND NEVER THE VALUES ON THE WIRE. The server
     * sends `address,mobile`; the words are here, keyed by the same five types
     * the tick-boxes use (REQ-LANG-01). The VALUES are fetched only when
     * somebody opens the correction control — reception is watching a status,
     * not mirroring a tablet at the front counter.
     */
    disputedTitle: 'Patient says wrong',
    disputedList: (details: string) => `Patient says wrong: ${details}`,
    disputedLead:
      'They have been told to see you. Fix the detail below and send it again — their appointment is not '
      + 'affected either way.',

    correctAction: 'Correct',
    correctClose: 'Close',
    correctHeading: 'Check and correct this patient’s details',
    /**
     * ALL FIVE DETAILS, NOT ONLY THE CROSSED ONES (Carl, 4 Sep 2026: "just in
     * case the patient says my mobile is also wrong but I ticked yes").
     *
     * A patient answering five rows on a tablet is not a reliable narrator of
     * which ones are wrong — they tick along and mention the rest across the
     * desk. Opening only the crossed row would make reception close the panel
     * and go looking for another screen for the detail the patient just said
     * out loud. The crossed ones are MARKED, so the panel still says what the
     * tablet reported; it simply does not hide the rest.
     */
    correctAllLead:
      'The details the patient crossed are marked. The rest are here too, in case they have told you about '
      + 'another one — only what you change is saved.',
    /** Beside a field the patient actually crossed. Says what happened, not who was wrong. */
    correctDisputedTag: 'Patient says this is wrong',
    correctLoading: 'Reading the current details…',
    /** Shown in the panel itself in place of `correctLoading` once the read
     *  has actually failed — Carl, 7 Sep 2026: a panel opened from the banner
     *  above sat on "Reading the current details…" forever with the real
     *  reason (his session had expired) sitting in a separate notice he never
     *  scrolled to. */
    correctLoadFailedTitle: 'Could not load the details',
    correctLoadFailed: (reason: string) => reason,
    correctSave: 'Save the correction',
    correctSaving: 'Saving…',
    /**
     * THE WAY OUT OF THE PANEL (Carl, 7 Sep 2026, testing the work page).
     *
     * There was none beside Save. The panel could be shut by pressing "Correct"
     * again, which is a toggle nobody reads as "cancel" — and the red "Nothing
     * was changed" band survived it, so a receptionist who opened the panel by
     * mistake was left with a refusal on screen about something they had not
     * done.
     *
     * IT DISCARDS, and it is a secondary: the whole panel is a staff edit to a
     * patient's own record, so leaving without saving must be one press and
     * must not look like the thing to press.
     */
    correctCancel: 'Cancel',
    correctSaved: 'Saved. Now send it to the tablet again.',
    correctNoChange: 'Nothing was changed.',
    correctBlockedEmpty: 'Change at least one detail first.',
    correctedAt: (when: string) => `Last corrected here at ${when}`,
    /**
     * CARL'S CAVEAT, VERBATIM AND ON THE SCREEN (TODO.md, 4 Sep 2026 — "the
     * console's correction control says so on screen"). It is here rather than
     * in help because the person who needs it is the person typing, at the
     * moment they type: the PMS is the source of truth (REQ-DATA-10) and until
     * the Medtech write-back exists (D-01) nothing carries this correction
     * home.
     *
     * DO NOT SOFTEN IT. "The next sync will bring the old value back" is the
     * consequence, stated plainly; anything vaguer would be a warning nobody
     * acts on.
     */
    correctPmsCaveat:
      'Also update this in your practice software — the next sync will bring the old value back otherwise.',
    /** The six correctable columns, by the words a receptionist reads. */
    correctFields: {
      givenNames: 'Given names',
      familyName: 'Family name',
      dateOfBirth: 'Date of birth',
      address: 'Address',
      mobile: 'Mobile',
      email: 'Email',
    } as Record<string, string>,

    resendAction: 'Re-send',
    resending: 'Sending again…',
    /**
     * HARD-02 IN THE WORDS OF SOMEBODY AT A DESK. A locked agreement whose
     * particulars have been corrected cannot be edited — the artefact was
     * rendered and hashed against the old ones — so a fresh agreement replaces
     * it. Reception is told, because the row's id changes under them and a
     * silent replacement is how people stop trusting a screen.
     */
    resendSuperseded:
      'Sent again. The details are part of the agreement, so a new agreement replaced the old one — the old '
      + 'one is kept exactly as it was.',
    resent: 'Sent to the tablet again.',

    /**
     * THE SECOND WAY TO CLOSE A DISPUTE (Carl, 4 Sep 2026): the patient
     * crossed a row that was RIGHT.
     *
     * It happens — a person mis-taps, or reads their old address and says it
     * is wrong before remembering they moved. Without this, reception's only
     * way out of a dispute is to "correct" a detail that needs no correction,
     * which would put a `patient.details_corrected` event in the vault saying
     * somebody changed something when nobody did.
     *
     * IT IS RECORDED, AND AGAINST A NAME. "Nothing was wrong after all" is a
     * claim somebody may be asked about later, so it is a staff-attributed
     * event carrying the TYPES and no values — never a quiet dismissal that
     * leaves the cross unexplained in the evidence.
     */
    /**
     * ONCE RECEPTION HAS ANSWERED THE CROSS (Carl, 4 Sep 2026). The row stops
     * repeating "a detail is wrong" at somebody who has already dealt with it
     * and says what is true now: the dispute is answered and the thing left to
     * do is send it again.
     *
     * IT STILL NAMES WHAT WAS CROSSED, in secondary text. Reception may be a
     * different person from the one who fixed it — a shift changes, a colleague
     * covers a break — and "Resolved" with nothing else would ask them to take
     * it on trust. The TYPES are on the row already (REQ-VER-04); the values
     * are not, and are not added here.
     */
    resolvedTitle: 'Resolved — ready to re-send',
    resolvedWas: (details: string) => `The patient had crossed: ${details}`,
    resolvedCorrected: 'You corrected it here.',
    resolvedPatientError: 'Recorded as right already — nothing was changed.',
    resolvedAt: (when: string) => `Resolved at ${when}`,
    noChangeAction: 'No change needed — the details were right',
    noChangeNote: 'Recorded against your name, with the details the patient crossed. Nothing is changed.',
    noChangeRecorded: 'Recorded. Now send it to the tablet again.',
    /** The correction saved, but the reason it was made did not reach the record. */
    resolveNotRecorded:
      'Saved, but the reason could not be recorded. Send it again, then tell support.',

    /**
     * SEND AGAIN, ON A TABLET WHOSE LAST SESSION ENDED (Carl, 4 Sep 2026).
     *
     * Walking away, timing out, being recalled and expiring all leave the
     * AGREEMENT untouched (hard rule 8, REQ-REC-04) — so the ordinary next
     * thing is to hand the same patient the same tablet again, and it should
     * be one press on the row that just told reception it ended rather than a
     * hunt back through the waiting list. `signed` is the one ending with
     * nothing left to send.
     */
    tabletLastSession: (patientName: string, state: string) => `Last: ${patientName} — ${state}`,
    sendAgainAction: 'Send again',
    sendAgainTitle: 'Send this one again',

    /**
     * D6a, SET ON THE BLOCKED ROW ITSELF (Carl, 4 Sep 2026). The one thing
     * standing between this patient and the tablet is a description of the
     * service, and the fix belongs where the block is stated rather than two
     * screens away — "shortcuts to the answer, not directions to a screen"
     * (CLAUDE.md §7).
     *
     * THE WORDS COME FROM THE SERVER, NEVER FROM HERE. They are the exact
     * strings the rules engine matches, and they are versioned content (hard
     * rule 14) — a list in this file would be a second copy that goes stale
     * silently. Only the LABELS are here, and the version is shown so
     * somebody can see which list they are choosing from.
     */
    d6aSetLabel: 'Description of the service',
    d6aSetPlaceholder: 'Choose…',
    d6aSetAction: 'Set description',
    d6aSetting: 'Setting…',
    d6aSetDone: 'Set. This one can go to a tablet now.',
    d6aListVersion: (version: string) => `List ${version}`,

    /**
     * WHY A PUSH WAS REFUSED — one sentence per reason, each naming the rule
     * and what to do about it, and none of them repeating anything about the
     * patient. The server sends a CODE; these are the words (hard rule 9's
     * reasoning applied to a staff surface).
     *
     * EVERY REASON POINTS SOMEWHERE, not just at a sentence (Carl, 4 Sep
     * 2026 — the tablet was pushable, the push refused, and the band told
     * reception nothing true and sent them to "the practice queue", which
     * does not exist). `device_busy` names the tablet and the patient
     * already on it and offers Recall inline; `service_description_missing`
     * and `agreement_not_pushable` link to the reconciliation screen;
     * `device_revoked` and `device_not_paired` link to Tablets. A reason
     * this build has not met yet still shows its own CODE — never swallowed
     * into a sentence that sends somebody looking for a screen that is not
     * there.
     */
    blocked: {
      device_unknown: 'That tablet is not registered to this practice.',
      device_revoked: 'That tablet has been revoked and holds no credential.',
      device_not_paired: 'That tablet has not been paired yet.',
      /*
       * RECEPTION'S OWN SWITCH, AND THE FIX IS ONE PRESS BY THE PERSON READING
       * THIS (Carl, 4–5 Sep 2026). Not a revoke, not an administrator, not a
       * walk to the device — so the sentence names the act and the band carries
       * the link to the page it is on ("shortcuts to the answer, not directions
       * to a screen", CLAUDE.md §7).
       */
      device_out_of_use:
        'That tablet has been taken out of use, so it is showing “not in use”. Put it back in use, or send '
        + 'to another tablet.',
      /** "Reception tablet 1 is still showing Jamie Sampleton — recall it to send this one." */
      device_busy: (deviceLabel: string, patientName: string) =>
        `${deviceLabel} is still showing ${patientName} — recall it to send this one.`,
      /** Used only when a busy refusal cannot be matched to a live session by id or by device. */
      device_busySomeone: 'another patient',
      agreement_not_found: 'That agreement is no longer available.',
      agreement_not_pushable: 'This agreement has moved on and cannot be sent to a tablet.',
      /*
       * D-2026-10-10-09 option 3, at the desk: the closure sweep closed it between
       * the list being drawn and Send. What was recorded, and nothing sent.
       */
      agreement_closed_unsigned:
        'This agreement was closed as not needed: no service was recorded for its visit within the practice’s '
        + 'set number of days. Nothing was sent to the tablet.',
      service_description_missing:
        'This agreement still needs a description of the service, chosen from the current list — the tablet '
        + 'never asks a patient for it.',
      who_is_signing_unset:
        'Say who is signing before you send this one — use “Who is signing?” on this row.',
      /*
       * NOBODY HAS BEEN ASKED YET (Carl, 7 Sep 2026: "change the workflow to
       * 'who is signing' only -- after that is actioned, enable the select
       * tablet and send button").
       *
       * A DIFFERENT FAULT FROM THE ONE ABOVE, and the copy has to say so.
       * `who_is_signing_unset` is an agreement naming a third party with no
       * party recorded -- something is missing. This one is an agreement that
       * says the patient is signing because every agreement says that when it
       * is drafted: nothing is missing, and nobody has been asked.
       *
       * THE CONTROL IS IN THE BAND, not a direction to a screen (CLAUDE.md §7)
       * -- `fixFor` puts "Who is signing?" here, and it opens with the patient
       * already ticked, so the common answer is one press.
       */
      assignor_not_confirmed:
        'Confirm who is signing first. This one still has the default — the patient signing for '
        + 'themselves — and nobody has confirmed it. It opens with the patient already ticked, so '
        + 'confirming takes one press. The appointment is not affected either way.',
      patient_confidential:
        'This patient’s record is flagged confidential, so nothing about them goes on a waiting-room screen. '
        + 'Take this one on paper or after the service.',
      /**
       * THE BOUNDARY, IN A RECEPTIONIST'S WORDS AND WITH SOMEWHERE TO GO
       * (Carl, 4 Sep 2026; GA-PLAN B5 -- it replaces the blanket
       * `enduring_not_supported`).
       *
       * It says WHAT is missing rather than "not supported", because the two
       * suggest different things to the person reading: one is a feature
       * nobody built, the other is a rule set waiting to be written, and only
       * the second explains why the same practice can send episodic
       * agreements all morning. The link lands on the rule-set versions,
       * which is where the answer changes.
       */
      enduring_rules_not_authored:
        'Ongoing agreements are not yet enabled — the enduring rule set is awaiting authoring. You can '
        + 'send an agreement for today’s visit instead, or change what the tablet offers first so new '
        + 'arrivals get one automatically.',
      /**
       * THE AGREEMENT NAMES SOMEBODY WHO CANNOT BE THE PROVIDER ON ONE
       * (Carl, 5-7 Sep 2026; the billing role).
       *
       * It says WHOSE NUMBER the claim goes under rather than "not allowed",
       * because that is the fact reception has to act on -- and the fix is a
       * real screen, so the band carries the link to it.
       */
      provider_not_servicing:
        'This agreement names somebody who cannot be the provider on one. The claim goes under the '
        + 'servicing provider’s number, so the agreement has to name them. Correct the billing role, or '
        + 'make the agreement under the provider the claim will go under.',
      /** Hard rule 6 / REQ-END-01a: permanent, not pending. */
      enduring_not_gp:
        'Ongoing agreements are for general practitioners only. For this provider, send an agreement for '
        + 'this visit or a Treatment Plan Assignment.',
      /** Hard rule 6 / REQ-END-01: one provider, one patient, never practice-wide. */
      enduring_not_per_provider:
        'An ongoing agreement is between one provider and one patient, and this one names no single '
        + 'provider. Send an agreement for this visit instead.',
      /**
       * THE PRINTED FORM BEHIND THIS AGREEMENT IS NOT ONE WE CAN REPRODUCE
       * (Carl, 27 September 2026, from a live tablet: “If no $ do not allow the
       * approval to progress. Check all details when the reception pushes to
       * the tablet.”).
       *
       * IT MUST NOT READ AS A STATUTORY FAULT, AND THAT IS THE WHOLE
       * DIFFICULTY OF THIS COPY. No dollar amount is in the s 65C data set
       * (hard rule 4, REQ-REG-04), so an agreement with no amount anywhere
       * near it is COMPLETE and there is nothing wrong with it. What is in
       * doubt is OUR OWN READING of the practice’s printed form. So the
       * subject of every sentence here is our reading — never the agreement,
       * never the practice, and never the patient — and the words
       * “invalid”, “rejected” and “failed” appear nowhere, along with
       * everything hard rule 12 forbids.
       *
       * AND IT SAYS WHAT TO DO IN THE SAME BREATH (hard rule 8, REQ-REC-04).
       * The person reading this has somebody standing in front of them, so it
       * names all three ways forward and says plainly that the appointment is
       * unaffected. The first — reprint it — is the one that ends the problem,
       * and it happens in the practice’s own software rather than on any
       * screen of ours, which is why this reason carries no link: there is
       * nowhere in this console to send anybody (CLAUDE.md §7 — a link that
       * goes nowhere useful is worse than the sentence alone).
       */
      /**
       * THE BAND'S OWN HEADING (Carl, 27 September 2026, choosing it: *"blocked
       * state on the row - 'Form needs reprinting'"*).
       *
       * IT NAMES THE ACT, NOT THE STATE. Every other blocked band is headed
       * "Cannot be sent yet", which is right for a row waiting on something at
       * this desk. This one is waiting on a reprint in the practice's own
       * software, and somebody scanning a list of rows should be able to see
       * which one needs a walk to the printer without reading four sentences.
       *
       * NO FAULT IS ASSIGNED AND NONE IS IMPLIED (hard rule 12, and hard rule
       * 4's reasoning): not "PMS data error", which would name the practice's
       * software as the culprit when the likeliest cause is our own parser
       * template against a changed PracSoft layout — and not "invalid", which
       * would say something untrue about a complete agreement.
       */
      print_record_incompleteTitle: 'Form needs reprinting',
      print_record_incomplete:
        'We could not read enough of the printed form to show the patient a copy of it, so this one has '
        + 'not gone to the tablet. The agreement itself is fine — this is about our reading of the form. '
        + 'Reprint it from your practice software and it will come through again, or take this one on '
        + 'paper or after the service. The patient is seen and billed either way.',
      /**
       * SERVICE LINES WE SAW AND COULD NOT READ (D-2026-10-11-05) — used IN
       * PLACE OF the two above whenever that check is in the list.
       *
       * IT DOES NOT SAY "REPRINT" (wow.md §13). The same layout prints the
       * same lines, so a reprint comes back with the same lines unread; telling
       * reception to reprint would send them round a loop that cannot end. The
       * fix is ours — a parser template that reads that layout — and the check
       * line below names the form and links to support.
       */
      print_record_service_lines_unreadTitle: 'Some service lines could not be read',
      /**
       * THE PRINTED NAME DIFFERS FROM THE PATIENT ON RECORD (D-2026-10-11-06)
       * — used in place of the sentences above whenever that check is in the
       * list, because "reprint it" is only one of its two possible fixes.
       */
      print_record_patient_name_differsTitle: 'Is this the right patient?',
      print_record_patient_name_differs:
        'The printed form names somebody other than the patient on record for its PMS patient ID, so this '
        + 'one has not gone to the tablet: the patient would have been shown a form in another name. Nothing '
        + 'has been sent and nothing has changed. The patient is seen and billed either way.',
      print_record_service_lines_unread:
        'The printed form has service lines we could not read, so this one has not gone to the tablet: the '
        + 'patient would have been shown a copy missing a service. The agreement itself is fine — this is '
        + 'about our reading of the form, and reprinting prints the same lines, so it will not help. Take '
        + 'this one on paper or after the service. The patient is seen and billed either way.',
      /** A code this build has not met yet. Shown, never swallowed (Carl, 4 Sep 2026). */
      other: (code: string) => `Could not send (${code}). Please tell support this code.`,
      /** The rarer case of a refusal that carries no code at all — the server's own sentence, as it came. */
      otherNoCode: 'Could not send. Please tell support what you were doing.',
    },

    /**
     * WHICH PARTS OF THE FORM WE COULD NOT READ — one short line each, under
     * the sentence above, in the order the server reported them.
     *
     * WHY A LIST AND NOT ONE SENTENCE. Reception fixes the form once rather
     * than pressing Send five times to be told five things (CLAUDE.md §7),
     * so the refusal carries every failed check and the band shows every one.
     *
     * EACH LINE NAMES A FIELD AND CARRIES NO VALUE (hard rule 9, REQ-VER-04).
     * “No amount against any service”, never which service and never what
     * the amount was — the codes on the wire cannot carry a value and neither
     * can the words rendered from them.
     *
     * “WE”, NOT “THE FORM”. Every line is a statement about our reading,
     * because a line reading “the form has no date of service” would be this
     * platform telling a practice their paperwork is wrong on the strength of
     * a parse we have just said we do not trust.
     */
    printRecordChecks: {
      print_record_patient_unidentified: 'We could not read a name or a PMS patient ID',
      /**
       * CARL’S SECOND CASE (27 September 2026), AND THE COPY HAS TO SAY WHICH
       * HALF IS MISSING. “The IRN” alone would send a receptionist looking at
       * a card number that is plainly there; the line names the pair, because
       * the fault is a card number read WITHOUT its IRN and the reprint is
       * what fixes both.
       *
       * “BESIDE THE NAME”, because IRN means nothing to most people — the
       * same reason the patient’s own note on the tablet says it that way.
       */
      print_record_irn_missing:
        'We read a Medicare number but no IRN — the digit beside the name on the card',
      print_record_services_missing: 'We could not read any services',
      /**
       * TWO LINES, NOT ONE (Carl, 28 September 2026: *“IRN, provider’s name
       * or provider number (be specific - which one)”*). The old single line
       * named both halves and joined them with “or”, which on a form where
       * the number is printed and the name is blank sends a receptionist
       * hunting for a fault that is not there.
       */
      print_record_servicing_provider_name_missing:
        'We could not read the provider’s name',
      print_record_servicing_provider_number_missing:
        'We could not read the provider’s provider number',
      print_record_service_date_missing: 'We could not read a date of service',
      /** Carl’s own case, and the only one of the five that reaches a real agreement today. */
      print_record_benefit_missing: 'We could not read an amount against any service',
      /**
       * THE FALLBACK ONLY — for a refusal that arrived without its count.
       * The line reception normally reads is `printRecordServiceLinesUnread`,
       * which names how many and on which form.
       */
      print_record_service_lines_unread: 'We saw service lines we could not read, so the copy would be missing a service',
    } as Record<string, string>,
    /**
     * THE NAME QUESTION, PUT TO RECEPTION (Carl, 11 October 2026: *"STOP and
     * tell Reception that PMS is sending a diff name for PMSID xxx. Is this
     * correct?"*; D-2026-10-11-06).
     *
     * BOTH REMEDIES, BECAUSE EITHER SIDE CAN BE THE WRONG ONE (wow.md §13).
     * If our record's name is wrong, it is corrected on the patient; if the
     * form was printed against the wrong PMS patient ID, that is fixed in the
     * practice software and the form printed again. We cannot tell which, so
     * the line asks rather than asserts.
     *
     * THE PRINTED NAME IS NOT REPEATED HERE. It is on the paper in reception's
     * hand; the refusal carries codes, never a patient's name (hard rule 9).
     */
    printRecordPatientNameDiffers: (pmsPatientId?: string | null, recordName?: string | null) =>
      'Your practice software printed a different name for '
      + (pmsPatientId ? `PMS patient ID ${pmsPatientId}` : 'this PMS patient ID')
      + ' from the one on record here'
      + (recordName ? ` (${recordName})` : '')
      + '. Is this the right patient? If the name on record is wrong, correct it on the patient. If the '
      + 'PMS patient ID on the form is wrong, fix it in your practice software and print the form again.',
    /**
     * HOW MANY LINES, ON WHICH FORM, READ BY WHICH TEMPLATE (D-2026-10-11-05;
     * CLAUDE.md §7c, shortcuts to the answer). A count, a form reference and a
     * template version — none of them a patient's (hard rule 9), and never the
     * line itself, which never left the practice.
     *
     * THE REMEDY IS TRUE FOR EVERY RECORD THAT REACHES THESE WORDS (wow.md
     * §13): whatever the unread line was, a reprint prints it again the same
     * way, and what fixes it is a parser template that reads it — which is
     * ours to ship, so the line sends the reference to support.
     */
    printRecordServiceLinesUnread: (count: number, formReference?: string, templateVersion?: string) =>
      `We could not read ${count === 1 ? '1 service line' : `${count} service lines`} on `
      + (formReference ? `form ${formReference}` : 'this form')
      + ', so the patient’s copy would be missing '
      + (count === 1 ? 'it' : 'them')
      + '. Send support the form reference'
      + (templateVersion ? ` and the parser template (${templateVersion})` : '')
      + ' so the reading can be fixed.',
    /** The link beside that line. `/help` is where the support contact details live. */
    printRecordServiceLinesUnreadLink: 'Contact support',
    /*
     * WHY THE s 65C CHECK REFUSED, AND WHAT TO DO ABOUT IT (Carl, 28
     * September 2026: *"why the 65c validation failed - we need context in
     * the error message and the steps to resolve it"*).
     *
     * THE ANSWER WAS ALREADY ON THE WIRE AND WAS BEING DROPPED. A refused
     * lock answers with a summary line AND a `failures` array of the rules
     * engine's own named verdicts - "C7: D6b: a post-agreement requires at
     * least one valid MBS item number." The who-is-signing path read it; the
     * PUSH paths destructured everything except it, so reception met "s 65C
     * validation failed", which names no rule, no field and no fix. That is
     * the dead end CLAUDE.md section 7 forbids.
     *
     * THE VERDICT IS SHOWN VERBATIM, because it is the rule set speaking and
     * paraphrasing a versioned instrument would be us restating it (hard rule
     * 14). The FIX beside it is ours, and it is keyed on the rule code, so an
     * unmapped rule still shows its own line and its code rather than a shrug.
     */
    rulesRefusedTitle: 'The particulars are not complete yet',
    rulesRefused:
      'Before the particulars are locked they are checked against the s 65C data set, and part of it is not there yet. Nothing has been sent and nothing has changed. What the check said, and what to do about it, is below. The patient is seen and billed either way.',
    rulesRefusedLead: 'What the check said:',
    /**
     * WHAT TO DO, PER RULE. Only the rules whose fix is knowable from here
     * carry one; the rest fall to `ruleFixOther`, which is honest about
     * saying less rather than inventing a screen (CLAUDE.md section 7).
     */
    ruleFix: {
      C1: "The patient's name is not on their record. Add it on the patient, then send again.",
      C2: "The agreement's own date is missing or too far ahead. That date is ours and not the practice's, so please tell support what you were doing.",
      C4: 'The provider has neither a provider number nor a place-of-practice address on their affiliation. Add one of the two and send again.',
      C5: 'The date of service is missing, or it falls on the wrong side of the date of the agreement. Correct it in your practice software and it will come through again.',
      C6: 'Choose the Basic Service Description on this row — the control is right here.',
      C7: 'No item numbers have been recorded for this visit. They arrive with the invoice from your practice software: record what was billed and this row clears when it comes through. There is no screen here to type them in yet.',
      C8: 'Step 1, who is signing, has not been answered in full. Somebody signing for another person needs a name and a relationship.',
    } as Record<string, string>,
    ruleFixOther:
      'Fix this where the fact lives — in your practice software, or on the record the line names — and the row clears when it comes through.',
    /** The line that introduces the list. Plain, because the sentence above has done the explaining. */
    printRecordChecksLead: 'What we could not read:',
    /**
     * WHICH FORM TO REPRINT (Carl, 27 September 2026: *“message needs to say
     * what data is missing on the print and also some unique id to identify
     * the print and the location of the file”*, then *“we must have some
     * unique ref from AOBPrinter which we must be storing for audit”*).
     *
     * “REPRINT IT” IS NOT AN INSTRUCTION UNTIL SOMEBODY KNOWS WHICH ONE. A
     * practice prints all morning. The list above says what could not be
     * read; this says which page it was, so the band is a shortcut to the
     * answer rather than a longer way of saying no (CLAUDE.md §7).
     *
     * THE FORM REFERENCE FIRST, BECAUSE IT IS PRINTED ON THE PAGE. It matches
     * the paper in somebody’s hand and the record in PracSoft; the hash and
     * the job id are for support, and are last for that reason.
     *
     * NOTHING HERE IS A PATIENT’S (hard rule 9) — a reference, a queue, two
     * clocks, a template version and a hash describe the document and the
     * machinery that read it.
     */
    printRecordId: {
      /** The disclosure's own label. No colon: it is a control, not a heading over a list. */
      lead: 'Which form this was',
      formReference: 'Form reference',
      /** `queueName`/`queueLabel` — attribution, never PII. The nearest thing to a location that exists. */
      queue: 'Printed from',
      captured: 'Captured',
      received: 'Received',
      parserTemplateVersion: 'Parser template',
      /**
       * AOBPRINTER’S OWN REF, AND THE AUDIT KEY. `sourceSha256` is what makes
       * the same document printed twice the same job; it is the ref to quote.
       * Labelled for the person reading rather than by its field name —
       * “sourceSha256” means nothing at a front desk.
       */
      sourceSha256: 'Print reference (AOBPRINTER)',
      printJobId: 'Record ID',
      /**
       * WHY THERE IS NO FILE PATH, SAID ONCE RATHER THAN LEFT AS A GAP. Carl
       * asked for “the location of the file” and there is none to give: the
       * driver parses at the practice and sends the record plus a hash of the
       * source bytes — *provenance without possession* — so no file, path or
       * spool id is ever captured or stored. Saying so beats a blank field,
       * and beats a plausible-looking path much more.
       */
      noFileNote:
        'We hold the reading of the form and a reference to it, never the file itself — so reprint from '
        + 'your practice software rather than looking for a document.',
      /**
       * THE SAME FACT WITHOUT THE REPRINT, for a form with unread service
       * lines — where a reprint brings the same lines back unread (wow.md §13).
       */
      noFileNoteNoReprint:
        'We hold the reading of the form and a reference to it, never the file itself — quote the form '
        + 'reference above to support rather than looking for a document.',
    },
    /**
     * A CHECK THIS BUILD HAS NOT MET YET — shown with its code, never
     * swallowed and never rendered as a blank bullet (Carl, 4 Sep 2026; the
     * same construction as `blocked.other`). A newer server may report a check
     * this console has no words for, and the code is what makes that
     * diagnosable rather than a shrug.
     */
    printRecordCheckOther: (code: string) => `Another detail we could not read (${code}) — please tell support this code.`,

    /**
     * THE NAME PRINTED ON THE DB4 IS NOT THE PATIENT RECORD'S NAME
     * (D-2026-10-10-11; Carl, 10 October 2026: *"B and tell the user to
     * resend to AOBPrinter from PMS"*).
     *
     * A WARNING BESIDE A REFUSAL, SINCE D-2026-10-11-06. The same comparison
     * now also stops Send to tablet (`print_record_patient_name_differs`);
     * never the visit (hard rule 8). A staff-only band, so it shows both names;
     * never on a tablet.
     *
     * THE OBSERVATION FIRST, THEN THE REMEDY, AND THE REMEDY'S LIMIT (wow.md
     * §13). Reprinting changes only the PRINTED name: the patient record here
     * is not updated from a DB4 (it comes from the arrival, or a correction
     * typed in this console). So "this notice clears" is promised only for
     * the case where it is true — the reprinted name matches the record — and
     * the other case is stated as what it is, without a guessed remedy.
     */
    printedName: {
      title: 'Name on the DB4 differs from the patient record',
      observed:
        'The patient name printed on this DB4 is not the name in the practice’s patient record. '
        + 'The DB4 was matched to this patient by PMS patient ID.',
      printedLabel: 'Printed on the DB4',
      recordedLabel: 'In the patient record',
      notPrinted: '(not printed)',
      parts: {
        given_names: 'given names',
        family_name: 'family name',
      } as Record<string, string>,
      differs: (list: string) => `What differs: ${list}`,
      /**
       * WHAT THE NAME DIFFERENCE DOES TO THE ROW, SINCE D-2026-10-11-06 (Carl,
       * 11 October 2026: stop the send, and keep this band). It replaced
       * "Send to tablet still works", "This note on its own does not stop Send
       * to tablet" and "The patient will see the printed name on their DB4…",
       * all three of which became false the moment the push refused (wow.md
       * §13).
       *
       * "WHILE", NEVER "UNTIL". True on every row that carries the band, a row
       * blocked for another reason included: the names differing stops the
       * send, but the names matching is not by itself what frees the row.
       */
      stopsSend:
        'Send to tablet is stopped while the two names differ, so the patient is never shown a DB4 in '
        + 'another name. They are seen and billed either way.',
      /**
       * EITHER SIDE MAY BE THE WRONG ONE, as the refusal on the same row says.
       * The PracSoft half is the reprint; the record half is a correction on
       * the patient, which the refusal links to.
       */
      fix:
        'If the name printed here is the wrong one, correct it in PracSoft, then print the DB4 again from '
        + 'PracSoft. AOBPrinter sends the reprint, and this notice clears once the newly printed name '
        + 'matches the patient record. If the patient record is the wrong one, correct it on the patient.',
      limit:
        'Printing again changes only the name on the DB4 — the patient record here is not updated from a '
        + 'DB4. If PracSoft already shows the right name, printing again will not clear this notice.',
      /** A notice code this build has not met. Shown, never swallowed. */
      other: (code: string) => `A note about this form (${code}) — please tell support this code.`,
    },

    /**
     * WHY "WHO IS SIGNING?" IS DEAD ON THIS ROW (Carl, 28 September 2026:
     * *"Who is signing should not be enabled if we have print errors"*).
     *
     * IT SAYS WHY, NOT JUST THAT. A control that is greyed with no
     * explanation is the thing CLAUDE.md §7 forbids; the row's band already
     * states the problem at length, so this is the one-line version attached
     * to the control somebody just tried to press.
     */
    whoBlockedByPrintRecord:
      'Reprint the form first — this agreement cannot be sent, and a reprint starts a new one, so an '
      + 'answer saved here would not carry over.',
    /** The same control, where the printed name and the record disagree (D-2026-10-11-06). */
    whoBlockedByPatientNameDiffers:
      'Check the patient first — this agreement cannot be sent while the printed form and the patient on '
      + 'record have different names.',
    /** The same control, where a reprint would not help (D-2026-10-11-05). */
    whoBlockedByUnreadServiceLines:
      'This agreement cannot be sent — the form has service lines we could not read — so an answer saved '
      + 'here would not reach a tablet.',

    /** Enduring's own extra line where the provider is not a GP (hard rule 6, REQ-END-01a). */
    enduringOfferOther: 'Offer an episodic agreement or a Treatment Plan Assignment instead.',
    /**
     * Where each linked refusal sends reception. D6a's is now the SECONDARY
     * route — the description is set inline on the row above it (Carl, 4 Sep
     * 2026) — so the link says what it is for rather than duplicating the
     * control beside it.
     */
    toReconciliationForD6a: 'Or open the record on the reconciliation screen →',
    toReconciliationRow: 'Open it on the reconciliation screen →',
    toDevices: 'Open Tablets →',
    /** Where a billing-role refusal is actually fixed. */
    toAffiliations: 'Open Affiliations →',
    /**
     * THE CONFIDENTIAL FLAG HAS SOMEWHERE TO GO NOW (Carl, 4 Sep 2026). Until
     * the work page existed there was no per-patient page in this console, so
     * that band carried no link on purpose rather than one that would 404.
     */
    toPatient: 'Open this patient →',

    /**
     * ENDURING IS GP-ONLY (REQ-END-01/-01a, hard rule 6). Per practitioner ×
     * patient, never per practice, and never offered for a specialist, allied
     * health or optometry — the offer there is a Treatment Plan Assignment.
     */
    enduringGpOnly:
      'Enduring agreements are for general practitioners only. For this provider, offer an episodic '
      + 'agreement or a Treatment Plan Assignment.',
  },

  /**
   * ARRIVALS WAITING FOR A PROVIDER (Carl, 5-7 Sep 2026; the billing role).
   *
   * A patient is at the desk, the practice's software named somebody the claim
   * cannot go under, and the arrival was refused. There is no agreement, so
   * there is no work-page row and nothing on the tablet queue -- which is
   * exactly why this section exists: a refusal nobody can see is a refusal
   * that stalls a walk-in. The row carries the reason and the fix, on the row
   * (Carl, 4 Sep 2026: shortcuts to the answer, not directions to a screen).
   */
  needsProvider: {
    title: 'Needs a provider',
    lead:
      'The practice management system named somebody the claim cannot go under. Pick the provider it will '
      + 'go under and we will carry on with the arrival — nothing has been changed for the patient yet.',
    /** "{provider} works under a provider here" -- the reason, naming the role. */
    reason: (provider: string, role: string) => `${provider} is recorded as “${role}” here.`,
    /**
     * The provider named matches no practitioner at any of this practice's
     * locations, so an agreement naming them could not say who signed for whom
     * or where. Reception picks the practitioner instead.
     */
    notAnchoredReason: (provider: string) =>
      `${provider} is not linked to a practitioner at any of your locations.`,
    unknownReason: (code: string) => `Refused (${code}). Please tell support this code.`,
    /** When we have never seen this patient, the practice's own handle stands in. */
    recordNumber: (number: string) => `Record number ${number}`,
    pickLabel: 'The practitioner the claim will go under',
    pickPlaceholder: 'Choose a practitioner…',
    /** Two sites, one person: the label that tells the two choices apart. */
    choiceAtLocation: (name: string, location: string) => `${name} — ${location}`,
    submit: 'Carry on with this arrival',
    submitting: 'Sending…',
    failed: 'That arrival could not be re-sent',
    noneToChoose:
      'No servicing practitioner is recorded at any of your locations yet. Add an affiliation, or set its '
      + 'billing role, first.',
    count: (n: number) => (n === 1 ? '1 arrival needs a provider' : `${n} arrivals need a provider`),
  },

  /**
   * RECEPTION'S OWN WORK LIST — the patients with something open today, and
   * everything about one of them in one place (TODO.md "Reception-centric: the
   * patient work page", Carl 4 Sep 2026).
   *
   * THE WORDS FOR THE TABLET CONTROLS ARE NOT REPEATED HERE. Send, Recall,
   * Re-send, Correct, "Patient says wrong", every refusal — all of them read
   * from `strings.tablet`, because they are the same controls rendered by the
   * same components (`pushDesk.tsx`). A second set of words for one button is
   * how two screens come to describe one act differently.
   *
   * NOTHING HERE NAMES A DOLLAR AMOUNT (hard rule 4) OR A MEDICARE NUMBER
   * (hard rule 1), and no copy claims anything is certified, approved or
   * accredited (hard rule 12).
   */
  patients: {
    title: 'Patients',
    navLabel: 'Patients',
    audience: 'Practice',
    lead:
      'The patients with something open today. Open one to do everything for them in one place — their '
      + 'details, their agreements, the tablet, follow-up and what has been sent.',
    /** On `/practice/tablet`, pointing at the same work organised by person. */
    fromTablet: 'Work one patient at a time →',
    /** On the work page, back to the list. */
    toQueue: '← All patients with something open today',
    loading: 'Loading…',
    notLoaded: 'This page could not be loaded',
    refresh: 'Refresh',
    count: (n: number) => (n === 1 ? '1 patient' : `${n} patients`),
    none: 'Nobody has anything open today.',
    noneHint: 'A patient appears here as soon as an agreement is waiting or a tablet session starts.',
    /**
     * TYPE-TO-FIND, AND THE LIST IS ALREADY THIS PRACTICE'S OWN. The filter
     * runs in the browser over rows the server already scoped by RLS — it
     * narrows what is on screen and asks the server nothing, so it can never
     * become a way to search for somebody who is not on the list.
     */
    findLabel: 'Find a patient',
    findPlaceholder: 'Start typing a name',
    noMatch: (term: string) => `No patient waiting today matches “${term}”.`,
    open: (n: number) => (n === 1 ? '1 thing open' : `${n} things open`),

    /*
     * THE ONE LINE ON A ROW — the freshest true thing about this patient. Each
     * of these has a matching control on the work page, so the line says what
     * is happening rather than where to go (CLAUDE.md §7).
     */
    /*
     * THE PATIENT ASKED FOR SOMETHING, FROM THEIR OWN PAGE (Carl, 4 Sep 2026).
     * The row names the DETAIL they say is wrong, because "a patient asked for
     * a correction" tells reception nothing they can act on and "their mobile
     * number" tells them what to ask about across the desk. The value itself is
     * never here: they were not asked for one.
     */
    summaryCorrection: (detail: string) => `Patient asked for a correction: ${detail}`,
    /*
     * THE PORTAL INVITATION LOCKED (Carl, 5 Sep 2026). The patient was told to
     * ask the practice; this is the row that means they do not have to. It says
     * what is wrong and what it needs, and never which detail anybody typed
     * wrongly — the platform does not hold that and would not show it if it did
     * (REQ-VER-04, hard rule 9).
     */
    summaryLocked: 'Portal invitation locked — needs a new one',
    summaryAwaiting: 'Awaiting signature · not yet sent',
    summaryBlocked: 'Awaiting signature · cannot be sent yet',
    summaryEnded: (state: string) => `Last session: ${state}`,
    summaryNothing: 'Nothing open',

    /* The work page's cards. */
    workLead: 'Everything open for this patient. Nothing here holds up their appointment.',
    notFound: 'That patient has nothing open today.',
    notFoundHint: 'They may have been seen already, or the agreement has moved on.',

    /*
     * WHAT HAPPENS WHEN THE PATIENT PRESSES THE BUTTON (Carl, 4 Sep 2026): it
     * appears at the top of their own work page, naming the detail and when
     * they asked, with the correction already open on that field.
     *
     * IT SAYS "asked", NOT "reported an error". The patient may be right or the
     * PMS may be; what is certain is that they asked, and the person at the
     * desk is the one who finds out which. Nothing here asks staff to judge
     * anybody, and nothing shows a value the patient never gave us.
     */
    correctionRequestTitle: 'The patient asked for a correction',
    correctionRequestBody: (detail: string, when: string) =>
      `The patient asked for a correction to their ${detail}, ${when}.`,
    correctionRequestLead:
      'They asked from their own page and were not asked for a new value — check it with them, change it '
      + 'here and in your practice software, then mark it done.',
    correctionRequestOpen: 'Correct it now',
    correctionRequestDone: 'Mark as done',
    correctionRequestDoing: 'Marking…',
    correctionRequestDoneOutcome: 'Marked as done. The patient’s request is closed.',
    correctionRequestFailed: 'That could not be marked as done',
    /** On the review queue, straight to the patient this is about. */
    correctionRequestToPatient: 'Open this patient’s page →',

    /*
     * THE OTHER BANNER ON THIS CARD (Carl, 5 Sep 2026): three failed attempts
     * on the activation link and the invitation is finished.
     *
     * IT NAMES NO DETAIL AND BLAMES NOBODY. Which identifier did not match is
     * not something this platform tells the practice (REQ-VER-04, hard rule 9),
     * and it does not matter to the remedy: check the details with the patient,
     * then send a new invitation. It says "locked", not "failed" — the person is
     * not locked out, one link is, and the way back is one press away rather
     * than a queue somewhere else (CLAUDE.md §7).
     */
    lockedTitle: 'Their portal invitation is locked',
    lockedBody: (when: string) =>
      `This patient’s portal invitation locked after three failed attempts on ${when}. Check their details `
      + 'with them, then send a new invitation.',
    lockedSend: 'Send a new invitation',
    lockedSending: 'Sending…',
    lockedDismiss: 'Dismiss',
    lockedDismissing: 'Dismissing…',
    lockedSent: 'A new invitation has been sent. It starts again with three attempts.',
    lockedDismissed: 'Dismissed. Nobody is waiting on this now.',
    lockedFailed: 'That could not be done',
    /*
     * THE REASON, NOT A DEAD BUTTON. An invitation is minted against a SIGNED
     * agreement (FR-1.14), so a patient with none cannot be re-invited yet —
     * and the thing that fixes it is the agreements card immediately below.
     */
    lockedNoAgreement:
      'A new invitation is sent against a signed agreement, and this patient has none yet. It is offered '
      + 'at the end of their next signature.',

    identityTitle: 'Their details',
    identityLead:
      'What we hold, and what the tablet shows them. Correcting one here records who did it — the type '
      + 'only, never the value.',
    identityCorrect: 'Correct a detail',
    identityClose: 'Close',
    identityNotHeld: 'Not held',
    /**
     * THE RECORD NUMBER IS AN IDENTIFIER TYPE ON THE APPROVED SET (REQ-VER-02),
     * and the Medicare card number is not one and is not held anywhere in this
     * platform (hard rule 1). Neither value is shown here: this card carries
     * the five details the patient is asked to check, and nothing else.
     */

    agreementsTitle: 'Agreements',
    agreementsLead: 'What is waiting to be signed today, and the tablet it can go to.',
    agreementsNone: 'Nothing is waiting to be signed for this patient today.',
    /**
     * ENDURING IS PER PRACTITIONER × PATIENT, NEVER PER PRACTICE (hard rule 6,
     * REQ-END-01). The card lists an enduring agreement UNDER ITS PROVIDER for
     * that reason: a heading that read "practice-wide" would be the rule
     * broken in the one place a receptionist would believe it.
     */
    enduringUnder: (provider: string) => `Enduring · ${provider}`,
    enduringNoProvider: 'Enduring · provider not set',
    episodicToday: 'Episodic · today’s service',
    treatmentPlan: 'Treatment Plan Assignment',
    sessionsTitle: 'On the tablet',
    sessionsNone: 'No tablet session for this patient today.',
    sessionOn: (device: string, state: string) => `${device} — ${state}`,
    /**
     * A SESSION WHOSE AGREEMENT HAS MOVED ON IS HISTORY, NOT WORK (Carl, 7 Sep
     * 2026, from testing: Alex had signed on the tablet and his work page still
     * offered "Send again" on the session he walked away from an hour earlier,
     * whose only possible outcome was the server's refusal "This agreement has
     * moved on and cannot be sent to a tablet").
     *
     * SO THE ROW LOSES ITS CONTROLS AND KEEPS ITS FACTS. It still says what
     * happened and names the session, because the sequence is exactly what
     * somebody reconstructing a visit needs; what it no longer does is offer an
     * act that cannot succeed. A control whose only outcome is a refusal is the
     * fault CLAUDE.md §7 names, seen from the other end.
     */
    sessionHistory: (state: string, shortId: string) => `${state} · session ${shortId}`,
    sessionHistorySigned: 'this agreement was later signed',
    /** Superseded, cancelled, expired — moved on, and the row does not guess which. */
    sessionHistoryMovedOn: 'this agreement has since moved on',

    followUpTitle: 'Follow-up',
    followUpLead: 'Where managed follow-up has got to for this patient’s open agreements.',
    followUpNone: 'Nothing is being followed up for this patient.',
    /**
     * THE BAND IS THE DEADLINE, NOT THE ELAPSED TIME (REQ-CHASE-05/-06). It
     * rises as the twelve-month lodgement window closes, and nothing is chased
     * past it (REQ-CHASE-08).
     */
    followUpBands: {
      standard: 'Standard',
      compressed: 'Compressed',
      urgent: 'Urgent',
      last_chance: 'Last chance',
      expired: 'Window closed — not chased',
    } as Record<string, string>,
    followUpDays: (days: number) => `${days} days left to lodge`,
    followUpAttempts: (made: number, allowed: number) => `${made} of ${allowed} attempts made`,
    followUpNext: (step: string) => `Next: ${step}`,
    followUpSteps: {
      ai: 'an automated reminder',
      human: 'somebody at the practice',
      handback: 'hand back to the practice',
    } as Record<string, string>,
    followUpNoneLeft: 'No further attempt is due.',
    followUpLast: (when: string, channel: string, outcome: string) =>
      `Last attempt ${when} · ${channel} · ${outcome}`,
    /**
     * RECORDING AN ATTEMPT IS THE RECONCILIATION SCREEN'S, and this says so
     * with a link rather than duplicating a form. A reg 89AA notice is never
     * chased and never appears here (hard rule 7, REQ-CHASE-02).
     */
    followUpToReconciliation: 'Record an attempt on the reconciliation screen →',

    correspondenceTitle: 'Messages',
    correspondenceLead:
      'What has been sent to this patient, and what happened to it. States only — open the message log '
      + 'to read one.',
    correspondenceNone: 'Nothing has been sent to this patient.',
    correspondenceRow: (channel: string, state: string, when: string) => `${channel} · ${state} · ${when}`,
    correspondenceToLog: 'Open the message log →',

    historyTitle: 'History',
    historyLead: 'What has happened, most recent first. Types and times — never the details themselves.',
    historyNone: 'Nothing has happened for this patient yet.',
    /**
     * THE WORDS FOR EACH TIMELINE TYPE. The server sends a CODE and these are
     * the words (REQ-LANG-01); an unmapped code is shown AS the code rather
     * than swallowed, so a type added later is visible instead of invisible.
     */
    historyTypes: {
      agreement_created: 'Agreement started',
      agreement_superseded: 'Replaced by a corrected agreement',
      particulars_locked: 'Particulars completed and locked',
      agreement_signed: 'Signed',
      capture_opened: 'Asked to sign',
      capture_closed: 'Request closed',
      verification: 'Identity checked',
      session_pushed: 'Sent to a tablet',
      session_details_confirmed: 'Patient confirmed their details',
      session_details_disputed: 'Patient said a detail was wrong',
      session_dispute_resolved: 'Reception answered it',
      session_ended: 'Tablet session ended',
      details_corrected: 'A detail was corrected here',
      portal_correction_requested: 'The patient asked for a correction',
      portal_correction_resolved: 'The patient’s request was dealt with',
      portal_activation_locked: 'Their portal invitation locked',
      portal_reinvited: 'A new portal invitation was sent',
    } as Record<string, string>,
    historyDetail: (detail: string) => `· ${detail}`,
    historyTypesList: (types: string) => `· ${types}`,
  },

  /**
   * RECEPTION TYPES AN AGREEMENT BY HAND (Carl, 7 Sep 2026;
   * PMS_to_AoB_Workflow.md case 4, row W2).
   *
   * WHOSE WORDS THESE ARE. A STAFF surface, on the staff side of the desk —
   * which is exactly why it may present fields at all. Nothing on the PATIENT
   * surface asks a patient to type a detail on the practice's behalf (Carl,
   * 3 Sep 2026), and this form is the other side of that rule rather than an
   * exception to it: the person filling it in works here.
   *
   * WHAT THE COPY NEVER SAYS. Nothing is "certified", "approved",
   * "accredited" or "government-approved" (hard rule 12, REQ-65C-05); no
   * benefit and no dollar amount appears anywhere (hard rule 4); and there is
   * no field, label or hint anywhere below for a Medicare card number, which
   * is not an identity identifier and is not held in this platform at all
   * (hard rule 1, REQ-VER-02). UK/AU spelling throughout.
   *
   * AND WHAT IT NEVER ASKS. It does not ask what KIND of agreement the visit
   * needs — the versioned visit policy decides that and the form shows the
   * answer (hard rules 6 and 14) — and it does not ask anybody to judge
   * whether a patient can consent (REQ-VUL-05). Both absences are
   * requirements.
   */
  newAgreement: {
    open: 'New agreement',
    close: 'Close',
    title: 'New agreement',
    lead:
      'For a walk-in your practice software has not sent us — because it is down, is not connected, or '
      + 'has no record of this person yet. Type what you would have sent and the platform drafts the '
      + 'agreement exactly as it would have.',
    /** The read-only twin's banner: the same one every practice screen shows. */

    // --- 1. Who the patient is -------------------------------------------
    patientHeading: 'Which patient',
    patientExisting: 'Somebody we already hold',
    patientNew: 'New patient',
    findLabel: 'Find them by name or record number',
    findPlaceholder: 'Start typing a name',
    findHint: 'At least two characters. This searches your practice’s own records and nobody else’s.',
    findSearching: 'Looking…',
    findNone: (term: string) => `No patient at this practice matches “${term}”. Choose “New patient” instead.`,
    findResult: (name: string, born: string) => `${name} · born ${born}`,
    findResultNoRecordNumber: 'no record number held',
    chosen: (name: string) => `Chosen: ${name}`,
    changePatient: 'Choose somebody else',

    familyName: 'Family name',
    givenNames: 'Given names',
    dateOfBirth: 'Date of birth',
    dayLabel: 'Day',
    monthLabel: 'Month',
    yearLabel: 'Year',
    address: 'Address',
    addressHint: 'One line, as it is written in your practice software.',
    mobile: 'Mobile number',
    email: 'Email address',
    contactHint: 'Optional. Used to send this patient their copy, never to identify them.',
    /**
     * THE ONE FIELD THAT IS ALWAYS REQUIRED, AND THE HINT SAYS WHY. It is the
     * practice's own handle for this person and the key an arrival is matched
     * on, so a typed walk-in with the wrong number becomes a second copy of a
     * patient when the practice management system comes back.
     */
    recordNumber: 'Your patient record number',
    recordNumberHint:
      'Your practice’s own number for this patient. It is how this is matched to their record in your '
      + 'practice software later, so it has to be the one on your screen.',

    // --- 2. The provider --------------------------------------------------
    providerHeading: 'Which provider',
    providerLabel: 'The provider the claim will go under',
    providerPlaceholder: 'Choose a provider',
    /**
     * WHOSE NUMBER THE CLAIM GOES UNDER. Only servicing providers are offered
     * — somebody recorded as working under another provider, or as not
     * billable, cannot be the provider on an agreement and is not in this list
     * at all. A picker that offered them would be a picker that can produce a
     * draft the server then refuses.
     */
    providerHint:
      'Only providers who bill under their own number are listed. A nurse or anyone working under '
      + 'another provider is not offered here — the claim, and so the agreement, goes under the '
      + 'provider’s number.',
    providerAt: (name: string, location: string) => `${name} — ${location}`,
    providerNumberIs: (number: string) => `provider number ${number}`,
    providerNumberNone: 'no provider number recorded',
    providerNone:
      'No provider at this practice is recorded as billing under their own number yet, so there is '
      + 'nobody an agreement could name.',
    providerToAffiliations: 'Set up who works here →',

    // --- 3. The visit -----------------------------------------------------
    visitHeading: 'The visit',
    serviceDate: 'Date of the service',
    serviceDateHint: 'Today, unless you are typing up an earlier visit.',
    serviceDescription: 'What the service is',
    serviceDescriptionHint: (version: string) =>
      `Chosen from your practice’s list, never typed. List version ${version}.`,
    serviceDescriptionDefault: '(your practice’s default)',
    serviceDescriptionNone:
      'Your practice has not chosen a default description yet, so this agreement will wait on your '
      + 'queue until one is set on it.',

    // --- 4. Who is signing ------------------------------------------------
    signingHeading: 'Who is signing',
    signingPatient: 'The patient',
    signingOther: 'Someone else, for the patient',
    signingName: 'Their full name',
    signingRelationship: 'Their relationship to the patient',
    signingRelationshipPlaceholder: 'Choose',
    signingDescribe: 'Please describe',
    signingAge: (minimumAge: number) => `They have told you they are ${minimumAge} or over`,
    /**
     * A DECLARATION, NOT A DATE OF BIRTH. Reg 65CB(5) records what the person
     * acting for another SAYS about their age; nobody verifies it and no birth
     * date for an assignor is asked for or stored anywhere in this platform
     * (REQ-AGE-01, REQ-VUL-02) — the same answer the tablet and the kiosk give.
     */
    signingAgeHint:
      'Recorded as what they told you. Nobody checks it and no date of birth is stored for them.',
    signingContactHeading: 'So we can send them their copy',
    signingContactHint:
      'One of these is enough. Their copy of the agreement, and anything that follows, goes here. It is '
      + 'not used to identify them.',
    /** A patient of 14 or over may sign for themselves — the UI never asks staff to assess capacity. */
    signingSelfHint: (minimumAge: number) =>
      `A patient aged ${minimumAge} or over may sign for themselves. Nothing here asks you to judge `
      + 'whether somebody can consent.',

    // --- 5. What the visit needs (read, never chosen) ---------------------
    decisionHeading: 'What this visit needs',
    decisionLead:
      'Decided by the current rule set from the provider and the patient — not chosen here. It is shown '
      + 'before you submit so nothing is a surprise afterwards.',
    decisionAsking: 'Working it out…',
    decisionNeedsProvider: 'Choose a patient record number and a provider to see this.',
    decisionEnduring: (provider: string) => `Ongoing agreement — first visit with ${provider}`,
    decisionEpisodic: 'Agreement for today’s service',
    decisionNone: (provider: string) =>
      `Covered by an ongoing agreement with ${provider} — nothing to sign`,
    decisionNoneOpen: 'Open the agreement that covers them →',
    decisionVersion: (version: string) => `Rule set ${version}`,
    /**
     * THE REFUSALS, AS ANSWERS. Each names the reason and what fixes it right
     * here — never "see the practice queue" (CLAUDE.md §7). An unmapped code
     * shows itself so it can be diagnosed rather than disappearing into a
     * generic sentence.
     */
    decisionBlocked: {
      provider_not_servicing: (provider: string, role: string) =>
        `${provider} is recorded as “${role}” here and cannot be the provider on an agreement — the `
        + 'claim goes under somebody else’s number. Choose the provider the claim will go under.',
      provider_not_anchored: (provider: string) =>
        `${provider} is not linked to a practitioner at one of your locations, so an agreement naming `
        + 'them could not say who signed for whom or where. Choose somebody else.',
    } as Record<string, (provider: string, role: string) => string>,
    decisionBlockedUnknown: (reason: string) =>
      `This provider cannot be used yet. The platform gave the reason code “${reason}” — quote it to `
      + 'support if it does not make sense here.',
    decisionBlockedTitle: 'This provider cannot be named on an agreement',

    // --- 6. Submit --------------------------------------------------------
    submit: 'Create the agreement',
    submitting: 'Creating…',
    submitBlockedTitle: 'Not ready to create yet',
    /** Live, before anybody presses — a control that only explains itself after a press is inert. */
    needPatient: 'Choose a patient, or fill in a new one.',
    needFamilyName: 'The patient’s family name is needed.',
    needGivenNames: 'The patient’s given names are needed.',
    needDateOfBirth: 'The patient’s date of birth is needed.',
    needAddress: 'The patient’s address is needed.',
    needRecordNumber: 'Your practice’s patient record number is needed.',
    needProvider: 'Choose the provider the claim will go under.',
    needServiceDate: 'The date of the service is needed.',
    needProviderUsable: 'This provider cannot be named on an agreement — choose another.',
    needNothingToSign: 'Nothing is needed for this visit, so there is nothing to create.',
    /**
     * A RELATIONSHIP THAT MAPS TO NO AUTHORITY BASIS. Unreachable from a
     * correct `assignor-relationships.json`, and shown WITH ITS KEY when it
     * happens — the content file can change without a code change (hard rule
     * 14), so the code says which option is wrong rather than failing silently
     * or blaming the person who chose it.
     */
    needRelationshipBasis: (key: string) =>
      `The relationship “${key}” does not map to a legal authority to sign for somebody else, so it `
      + 'cannot be used. Choose another, and quote that word to support — the relationship list needs '
      + 'fixing.',

    createdTitle: 'Agreement created',
    created: (name: string) => `${name} is on the queue, ready to send to a tablet.`,
    createdBlocked: (name: string) =>
      `${name} is on the queue. It cannot be sent yet — their row says why and carries the fix.`,
    createdNothing: (name: string) =>
      `Nothing was drafted for ${name}: an ongoing agreement already covers this provider.`,
    createdOpen: 'Open their page →',
    failed: 'That could not be created',
  },

  kiosk: {
    /** The wordmark in the tablet's footer. Repeated here so the ceremony reads one namespace. */
    appName: 'AoBPlatform',
    chrome: {
      stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
      /*
       * THE SAME TWO LINES ON TOP OF EVERY PAGE OF THE CEREMONY (Carl, 7 Sep
       * 2026, testing the pushed flow: "on top of each page of this workflow it
       * should say 'Agree to bulk billing'; on the next line it should say by
       * who -- Name of Person").
       *
       * LINE ONE IS CONSTANT AND CARRIES NO QUALIFIER. Each step used to head
       * itself with the agreement type's own sentence -- "Agree to bulk billing
       * for today's visit" on three of the four types, "Agree to bulk billing"
       * on the fourth -- so what a patient read at the top changed shape as
       * they moved through one act. The qualifier is still true and is still
       * shown; it is `ceremonySubHeading` below, a smaller line under the two.
       *
       * LINE TWO NAMES THE PARTY, and it is the answer to the question a
       * tablet handed across a desk actually raises: whose agreement is this.
       * It is built by `signingByLine` in `rules/who-is-signing.ts`, which is
       * the SAME branch K-4's fuller statement goes through -- one reading of
       * D7 for the whole ceremony, never two.
       *
       * NO RELATIONSHIP ON THIS LINE, deliberately. "by Kim Fictional for Alex
       * Fictional" is who; "as their Mother" is on what footing, and that
       * belongs where the pen is (K-4's `signingByOther`), not repeated at the
       * top of five screens.
       */
      ceremonyTitle: 'Agree to bulk billing',
      signingBy: (assignorName: string) => `by ${assignorName}`,
      signingByFor: (assignorName: string, patientName: string) =>
        `by ${assignorName} for ${patientName}`,
      /**
       * THE DEFENSIVE BRANCH: the record says somebody other than the patient
       * signs, and has not said who.
       *
       * IT NAMES THE PATIENT AND CLAIMS NOTHING ABOUT THE SIGNER. Falling back
       * to "by <patient>" would be the header ASSERTING D7 is the patient when
       * the record says it is not -- a wrong fact, printed at the top of every
       * page, which is worse than a line that says less. This says the one
       * thing that is known; K-4 still states the pairing above the pad.
       */
      signingForPatient: (patientName: string) => `for ${patientName}`,
      /**
       * THE QUALIFIER THE HEADING USED TO CARRY, by agreement type, as a third
       * and smaller line. Empty for an ongoing agreement, which is not about a
       * visit -- and an empty string draws no line at all rather than an empty
       * one.
       */
      ceremonySubHeading: {
        episodic_pre: "for today's visit",
        episodic_post: "for today's visit",
        treatment_plan: "for today's visit",
        enduring: '',
      } as Record<AgreementType, string>,
      /**
       * "ONE MOMENT" -- WHAT A TRANSIENT FAILURE SAYS WHILE IT IS BEING RETRIED
       * (Carl, 7 Sep 2026, after a core restart under the dev watcher threw a
       * patient's five answers away mid-send).
       *
       * IT IS NOT AN ERROR AND MUST NOT READ AS ONE. Nothing has gone wrong
       * that the patient can act on, their answers are still on the screen, and
       * in a second or two this will simply move on. If the retries do run out
       * the existing see-reception path takes over and says so plainly -- so
       * this line's whole job is to fill the gap without teaching somebody to
       * press something.
       */
      oneMoment: 'One moment…',
      stepDetails: 'your details',
      stepSigning: 'who is signing',
      complete: 'Complete',
      allSynced: 'All signatures sent',
      offline: 'No connection — the practice can still see you now',
      checkedAgainstDataSet: 'Checked against the s 65C data set',
      staffHelp: 'A staff member can help you at any point',
      /*
       * THE WAY OUT, on every screen of the ceremony (Carl, 3 Sep 2026).
       * Neutral and short. It does not say "cancel" or "quit" — nothing is being
       * cancelled, and a patient who wants to talk to a person is not abandoning
       * anything. It also does not promise that leaving finishes the job.
       */
      leaveAction: 'See reception',
      leaveHeading: 'Our reception staff can help',
      leaveBody:
        'They will finish this with you at the desk. Nothing has been signed, and your appointment is not '
        + 'affected.',
      /*
       * RECEPTION HAS ASKED FOR THE TABLET BACK (Carl, 4–5 Sep 2026; TODO.md
       * "Tablet heartbeat and Return to Begin").
       *
       * IT IS SHOWN BEFORE THE SCREEN CLEARS, NOT INSTEAD OF CLEARING. Somebody
       * may be half-way through proving who they are when this arrives, and a
       * patient watching their own details vanish mid-sentence is the worst
       * version of being helped. So they are told, for a few seconds, and then
       * the tablet is Begin again.
       *
       * IT EXPLAINS NOTHING AND APOLOGISES FOR NOTHING, deliberately. Reception
       * is standing right there — they pressed the button because they want the
       * tablet — so the screen's whole job is to point at the person who already
       * knows, and to say the one thing the patient actually needs (hard rule 8,
       * REQ-REC-04). "The tablet is needed elsewhere" would be an explanation
       * nobody asked for and, half the time, the wrong one.
       */
      returnToBeginHeading: 'Please see reception',
      returnToBeginBody: 'Your appointment is not affected.',
      /*
       * BACK IS NAVIGATION, NOT AN EXIT (Carl, 3 Sep 2026 live test). It moves
       * one step up the ceremony and calls nothing — a different thing from
       * `leaveAction`, which hands the patient to a person. It sits beside the
       * step's own primary rather than in the header, so it can never be
       * mistaken for the way out, and it never reaches a PREVIOUS patient:
       * the done screen and the idle reset clear everything before the tablet
       * is handed on.
       */
      backAction: 'Back',
      /*
       * WHICH TABLET AM I (Carl, 4 Sep 2026). Support fielding a call about a
       * tablet already asks "which one is this" — the label a person gave it
       * on `/practice/devices`, and enough of its id to tell two tablets with
       * the same label apart without reading a whole UUID down the phone.
       * Quiet, muted, at the foot of every screen — never a disclosure of
       * anything a patient did not already know just by looking at the
       * tablet in front of them.
       */
      deviceIdentity: (label: string, idPrefix: string) => `${label} · ${idPrefix}`,
      /*
       * WHICH SESSION IS THIS (Carl, 4 Sep 2026) — an audit/testing aid, not a
       * disclosure: an opaque id, never a name or a value, and reception sees
       * the SAME id on the console row that pushed it. Shown on every pushed
       * screen (K-P1, K-3, K-4, done) beside the device identity, and nowhere
       * when there is no pushed session — a walk-up ceremony has none to show.
       */
      sessionIdentity: (shortId: string) => `session ${shortId}`,
      /*
       * WHICH PATIENT RECORD IS THIS (Carl, 7 Sep 2026) — "every page must
       * have the patient GUID from AoBPlatform somewhere, so we can see which
       * record has the issue".
       *
       * AN ID WE MINTED, AND NOTHING ELSE. It is opaque, it is ours, and it is
       * not a Medicare number — there is no column for one of those anywhere in
       * this system and it is not an identity identifier in any case (hard rule
       * 1, REQ-VER-02). Shown IN FULL rather than shortened, because the point
       * is matching a record exactly against the console and the vault; the
       * session id above stays short because eight characters are read across a
       * desk, and this one is read off a screen into a support ticket.
       *
       * ONLY DURING A PUSHED SESSION. Before verification the tablet knows
       * nothing about any person and there is no record to name — the walk-up
       * screens show nothing here.
       */
      patientIdentity: (id: string) => `patient ${id}`,
      /*
       * WHICH PRINT RUN THIS FORM CAME OFF (Carl, 27 Sep 2026 — "the print job
       * id, that hash ... show this in the footer with the other audit ids").
       *
       * TEST DEVICES ONLY, behind the same flag as the parser template version
       * and the "ready to sign" panel: on a patient's screen an internal id is
       * a developer's note. Both are identifiers rather than content (hard rule
       * 9) — they name a queue row and a set of printed bytes, never a person
       * — and neither is a link. The record they name stays on a workstation,
       * because it carries the unmasked card number (`db4-form-view.ts`).
       */
      printJobIdentity: (shortId: string) => `print job ${shortId}`,
      printSourceIdentity: (shortHash: string) => `form ${shortHash}`,
    },

    /*
     * RETURNING TO THE START WHEN NOBODY IS THERE (Carl, 4 Sep 2026).
     *
     * QUIET, AND IT ASKS RATHER THAN ANNOUNCES. "Still there?" is the whole of
     * it: a patient who IS still there taps anywhere and it goes away, and one
     * who has gone never reads it. It does not say "session", "timeout" or
     * "expired" — nothing is expiring, the tablet is tidying itself up — and
     * it must never suggest the appointment or the agreement is affected,
     * because neither is (REQ-REC-04, hard rule 8).
     *
     * THE COUNT IS IN SECONDS AND IS SPELLED "s", because the number changes
     * every second and a word that changes with it ("seconds"/"second") reads
     * as movement on a screen that is meant to be calm.
     */
    inactivity: {
      heading: 'Still there?',
      countdown: (seconds: number) => `Returning to the start in ${seconds} s`,
      /** Announced once, to a screen reader, rather than re-read on every tick. */
      announcement: 'Still there? The tablet will return to the start shortly. Touch the screen to carry on.',
      dismissHint: 'Touch the screen to carry on',
    },

    idle: {
      /*
       * "AGREE", NOT "CHECK IN" (Carl, 4 Sep 2026 copy pass). The ceremony
       * captures consent to bulk billing, not attendance — reworded across
       * every patient-facing string on this screen so none of them promise a
       * simple check-in. "Doctor" is avoided throughout for the same reason
       * the domain terminology rule exists (CLAUDE.md §3): this screen also
       * serves specialists, allied health and optometry.
       */
      heading: 'Agree to bulk billing',
      // No subtitle: heading and Begin are the whole screen (Carl, 4 Sep 2026) -- the steps explain themselves.
      start: 'Begin',
      /*
       * THERE IS NO COUNT ON THIS SCREEN, AND THAT IS THE ENTRY (Carl, 4 Sep
       * 2026): "Remove the 'x people ready to sign' text — this is a security
       * feature."
       *
       * `waitingCount` used to live here and said "3 people are ready to
       * sign". It named nobody, which is why it survived the first pass — but
       * a tablet on a counter announcing how many patients are in the room is
       * still telling everyone in the room something about the people in it,
       * and on a quiet morning "1 person is ready to sign" plus one person
       * standing at the desk is not anonymous at all. It is gone rather than
       * softened; this comment is what stops it coming back.
       *
       * `nobodyWaiting` STAYS, and only appears on the test-device list where
       * names appear anyway — a list with a heading and no rows under it reads
       * as broken.
       */
      nobodyWaiting: 'Nobody is waiting to sign just now.',
      /** Idle screen, in place of Begin, when the server says nobody is waiting (a boolean, never a count). */
      nobodyWaitingIdle: 'Nobody is waiting to sign just now. Please see reception.',
      /**
       * K-1 ON A TABLET THAT DOES NOT ACCEPT WALK-UPS — Carl's own words,
       * 12 Sep 2026, and they are quoted rather than reworded on purpose.
       *
       * The patient holding this tablet has just been handed it by reception,
       * who have their details on screen and are pushing the agreement across
       * as they speak. "Begin" told that person to type in details the
       * practice already holds, and pressing it took them into the walk-up
       * flow — the wrong one. This sentence replaces the heading AND the
       * button: the screen has nothing to press, because there is nothing for
       * the patient to do but wait a second or two.
       *
       * IT PROMISES ONLY WHAT THE NEXT POLL DELIVERS. Not "your form is on its
       * way", which the tablet cannot know, and no reassurance about the
       * appointment, which is not in doubt. If the push never comes, reception
       * still has every other way to capture (hard rule 8) and Return to Begin
       * puts the tablet back.
       */
      waitingForDetails: 'Please wait. Loading your details',
      /*
       * BEGIN, REPLACED RATHER THAN DISABLED (Carl, 4 Sep 2026). A walk-up
       * tablet with nobody staged has nothing for Begin to open, and a
       * greyed-out button invites a tap that goes nowhere. `/kiosk/me`'s poll
       * answers `anyoneWaiting` as a boolean only — no count, no name — so
       * this message is the honest state of the room without being a second
       * disclosure. Begin returns on its own, no reload, the moment the next
       * poll finds somebody staged.
       */
      beginUnavailable: 'Nobody is waiting to sign just now. Please see reception.',
      /** Matches `assignor.heading` below deliberately — K-1's list and K-5 ask the same question. */
      listHeading: 'Who is signing today?',
      listHint: 'Tap your name. If it is not here, please see reception.',
      walkIn: 'No appointment time',
      backToIdle: 'Back',
      loadFailed: 'The list could not be loaded. Please see reception — your appointment is not affected.',
      retry: 'Try again',
      /**
       * THE QUIET TAG ON AN UNSIGNABLE ROW (TODO.md, "Two rulings from
       * pairing day", 4 Sep 2026). The row stays tappable — see
       * `needsReceptionHeading` — this is only the hint that saves the tap:
       * a patient who reads it before tapping learns the same thing sooner,
       * and one who taps anyway still lands on a screen that names them and
       * hands them over cleanly, no verification attempted for nothing.
       */
      pleaseSeeReception: 'Please see reception',
      /**
       * THE PERMANENT BANNER OVER THE LIST (Carl, 4 Sep 2026 — "the list page
       * is only for testing purposes").
       *
       * A device the console has flagged still shows the waiting room, and it
       * says so, permanently, in the plainest words available. Anybody who
       * walks past a tablet showing patient names should be able to tell at a
       * glance whether that is a configuration mistake or a test rig — and
       * "TEST DEVICE" is the sentence that answers it without a manual.
       *
       * It is deliberately NOT a dismissible notice: a banner that can be
       * closed is a banner that is closed.
       */
      testDeviceBanner: 'TEST DEVICE — names visible',
    },

    /*
     * K-P1 — "Please check your details", the FIRST screen of the pushed
     * ceremony (TODO.md "Two front doors", Carl 4 Sep 2026).
     *
     * IT IS A DATA CHECK AND THE COPY MUST NEVER READ AS AN IDENTITY CHECK,
     * which is the single thing most likely to go wrong in this wording. The
     * verification already happened, across the desk, with a named staff
     * member's identity on it (REQ-VER-03) — the push refuses without it. A
     * value displayed on a screen and ticked by whoever is holding the tablet
     * proves nothing about who is holding it, so `lede` says out loud that
     * staff have already confirmed who this is and that what is being asked
     * for here is whether the details are RIGHT.
     *
     * TWO OF THE FIVE ROWS ARE CONTACT DETAILS, NEVER IDENTIFIERS. A mobile
     * number and an email address are shown and confirmed here, and are never
     * counted toward the statutory three — that would be the Medicare-number
     * mistake one step sideways (REQ-VER-02, hard rule 1). Nothing in this
     * namespace calls any of them an identifier.
     *
     * THE HEADING IS NOT HERE. It is `particulars.headingByAgreementType`,
     * keyed by the session's own agreement type, so reading and signing carry
     * the same words as the screens that follow rather than a fourth variant.
     */
    checkDetails: {
      lede: 'Please check these are right. Our staff have already confirmed who you are.',
      /**
       * The five confirmable types, by the words a patient reads. Keyed by
       * `CONFIRMABLE_DETAIL_TYPES` so a screen renders the domain's list and
       * never a list of its own — a key with no entry here renders its raw key,
       * which is ugly and visible, and is the right failure for a missing word.
       */
      detailNames: {
        name: 'Name',
        date_of_birth: 'Date of birth',
        address: 'Address',
        mobile: 'Mobile number',
        email: 'Email address',
      } as Record<string, string>,
      /**
       * THE TWO ANSWERS, ONE PER BUTTON (Carl, 4 Sep 2026). Short, because
       * they sit under a glyph on a control roughly a thumb wide, and because
       * a patient scanning five rows should read four words in total rather
       * than forty.
       *
       * THE CROSS IS NOT AN APOLOGY AND NOT A WARNING. "That's wrong" is what
       * somebody would say out loud; anything softer ("this needs checking")
       * would make a patient hesitate to press the button that is the entire
       * point of the screen.
       */
      right: "That's right",
      wrong: "That's wrong",
      continueAction: 'Continue',
      continueBlocked: (count: number) =>
        count === 1 ? 'Continue — 1 detail still to check' : `Continue — ${count} details still to check`,
      /**
       * THE BAND, and it is deliberately in the present tense. By the time it
       * shows, the crossed types have already reached reception's screen, so
       * the patient is not being given an errand — they are being told what is
       * happening. And it says the appointment is unaffected, because that is
       * the question somebody who has just been stopped by a screen actually
       * has (hard rule 8, REQ-REC-04).
       */
      disputeBand:
        'Please see reception — they will fix this and send it again. Your appointment is not affected.',
      /**
       * THE SCREEN IS LOCKED, once the cross has actually reached reception
       * (Carl's ruling, 4 Sep 2026): "the tablet would be signing against
       * details mid-correction" if a patient could change their answer after
       * reception has started fixing it. Present tense, same as the band
       * above — reception is already on it, not something the patient still
       * has to arrange.
       */
      waitBand:
        'Please wait for reception — they are fixing this and will send it again. Your appointment is not '
        + 'affected.',
      /**
       * THE WAY OUT, STATED WHERE THE PATIENT IS DECIDING (REQ-REC-04). If a
       * row is wrong there is nothing to correct on this device — the tablet
       * offers no field, on the same reasoning K-3 offers none — so the honest
       * instruction is the one person standing a metre away.
       */
      somethingWrong:
        'If anything here is wrong, please see reception. Your appointment is not affected.',
      saveFailed:
        'We could not record that here. Please see reception — your appointment is not affected.',
      /** d MMMM yyyy — "4 September 1962". Month by NAME; nobody should have to translate "09". */
      dateFormat: (day: string, monthName: string, year: string) => `${day} ${monthName} ${year}`,
      footer: 'A check that your details are right — our staff confirmed who you are at the desk',
    },

    verify: {
      heading: 'Confirm your details',
      lede: (count: number) => `${count} details, so we know it is you before anything is shown.`,
      continueAction: 'Continue',
      attemptOf: (attempt: number, total: number) =>
        `Attempt ${attempt} of ${total} · a staff member can help you unlock this`,
      /**
       * THE ONLY THING A FAILED ATTEMPT EVER SAYS. It does not name the
       * identifier that did not match — naming it tells whoever is standing
       * there which of the details they guessed right (REQ-SEC-07).
       */
      mismatchHeading: "Some details don't match",
      mismatchBody: 'Please check them and try again, or ask our reception staff to help.',
      tryAgain: 'Try again',
      lockedHeading: 'Please see our reception staff',
      lockedBody: 'They can confirm your identity in person and continue this on the desk.',
      lockedReassurance: 'Your appointment is not affected.',
      lockedFooter: 'Practice notified · staff-assisted unlock available at the desk',
      incomplete: 'Please fill in every detail above.',
      failedToStart:
        'We could not start the check just now. Please see reception — your appointment is not affected.',
      annotationKicker: 'REQ-VER-02',
      annotationBody:
        'There is no Medicare card field on this screen, and no setting that adds one. The identifiers we '
        + 'may use are name, date of birth, gender, address, patient record number and IHI.',
      /** The six permitted types and no others (REQ-VER-02). There is deliberately no card-number entry. */
      identifierNames: {
        name: 'Your full name',
        date_of_birth: 'Date of birth',
        gender: 'Gender, as you identify it',
        address: 'Your home address',
        patient_record_number: 'Patient record number — on your appointment reminder',
        ihi: 'Individual Healthcare Identifier',
      } as Record<string, string>,
      /*
       * HINTS ARE FOR THE FREE-TEXT IDENTIFIERS. Address is the one entry here
       * (Carl, 3 Sep 2026 — a single line; see kiosk/rules/verify-fields.ts): a
       * placeholder inside the box, not a second label, so it does not repeat
       * `identifierNames.address` above it. Kept as a table because
       * `identifierFieldsFor` reads it by type.
       */
      identifierHints: {
        address: 'Street, suburb and postcode',
      } as Record<string, string>,

      /*
       * THE STRUCTURED SUB-FIELDS (Carl, 3 Sep 2026). Two of the six approved
       * identifiers are composite, and a single free-text box for each asked the
       * patient to guess our formatting: "YYYY-MM-DD". The parts are collected
       * separately and joined for the server — the wire contract still sends
       * one string per identifier type. Address is NOT one of them: a
       * server-side address-validation endpoint is coming and splitting it here
       * would be redone there.
       */
      nameFamily: 'Family name',
      nameGiven: 'Given name(s)',
      dobDay: 'Day',
      dobMonth: 'Month',
      dobYear: 'Year',
      /** Months by NAME. A patient reading "08" has to translate it; nobody should have to. */
      monthNames: [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ] as readonly string[],
      /** The empty option on every picker, so nothing is pre-chosen on the patient's behalf. */
      chooseOption: 'Choose',
      /**
       * The disabled Continue label. It says what is missing in kind, never
       * which identifier — the same rule the mismatch copy obeys.
       */
      continueBlocked: 'Continue — some details still needed',
    },

    assignor: {
      heading: 'Who is signing today?',
      self: (patientName: string) => `${patientName} — I am signing for myself`,
      other: (patientName: string) => `Someone else is signing for ${patientName}`,
      /**
       * "About you" (Carl, 3 Sep 2026 live test), not "if someone else signs" —
       * whoever is filling this in is holding the tablet, so the form addresses
       * them directly, not a hypothetical third person.
       */
      panelHeading: 'About you',
      otherName: 'Your full name',
      /**
       * THE PERSON IS ASKED WHAT THEY ARE, NOT WHAT THE STATUTE CALLS IT
       * (Carl, 3 Sep 2026). The screen used to show reg 65CB(5)'s own list —
       * "co-resident relative 18+", "enduring power of attorney (health)" — to
       * a daughter who had driven her father to the surgery, and asked her to
       * classify herself under it. The two answers a form gets out of that are
       * a guess and a wrong guess.
       *
       * THE OPTIONS AND THEIR ORDER ARE NOT HERE. They come from
       * `packages/domain/content/assignor-relationships.json` — versioned
       * content, so the list and the legal mapping behind it change without a
       * code change (hard rule 14). This table holds only the WORDS, keyed by
       * the content file's key, because the words will be translated and a
       * translated word must never be able to move a legal mapping
       * (REQ-LANG-01/-02). A key with no entry here renders its raw key, which
       * is ugly and visible — the right failure for a missing translation.
       */
      relationship: (patientName: string) => `Your relationship to ${patientName}`,
      relationshipNames: {
        father: 'Father',
        mother: 'Mother',
        spouse: 'Spouse',
        carer: 'Carer',
        grandparent: 'Grandparent',
        family_member: 'Family member',
        friend: 'Friend',
        other: 'Other',
      } as Record<string, string>,
      /** Revealed by the one option the content file marks `freeText`. */
      relationshipDescribeLabel: 'Please describe',
      /** Composed from MIN_AGE_ASSIGN_FOR_OTHER — the threshold is never typed here. */
      otherAgeConfirm: (minimumAge: number) => `I am ${minimumAge} or over`,
      /**
       * CONTACT, FRAMED AS CONTACT (C7.2 / REQ-REG-08). A mobile number is not
       * one of the six approved identifiers and this copy must never imply it
       * is: it says what the number is FOR — your copy of the agreement, and
       * anything that follows — and nothing about proving who you are.
       */
      contactHeading: 'So we can send you your copy',
      contactHint:
        'One of these is enough. Your copy of the agreement, and anything we need to send you afterwards, '
        + 'goes here. It is not used to identify you.',
      mobileLabel: 'Mobile number',
      emailLabel: 'Email address',
      continueAction: 'Continue',
      /**
       * THE GUARDED-BUTTON REASONS (Carl, 3 Sep 2026 live test). Live, before
       * anybody presses Continue — a disabled control that only explains itself
       * after a tap is inert, not unreachable (CLAUDE.md §6). `continueBlocked`
       * is the label ON the button; the `reason*` strings are the itemised list
       * beneath it. None of them name an identifier value.
       */
      continueBlocked: (count: number) =>
        count === 1 ? 'Continue — 1 detail still needed' : `Continue — ${count} details still needed`,
      reasonNameNeeded: 'Your full name is needed',
      reasonRelationshipNeeded: (patientName: string) => `Your relationship to ${patientName}`,
      reasonDescribeNeeded: 'Please describe your relationship',
      reasonContactNeeded: 'A mobile number or an email address is needed',
      reasonAgeNeeded: 'Confirm you are 18 or over',
      reasonStaffBlocked: 'Practice staff cannot sign for a patient',
      /**
       * THE STAFF REFUSAL (Carl, 3 Sep 2026). The match is NAME-BASED and can
       * hit an innocent namesake, so the copy states the match rather than
       * making an accusation — and it still never says WHICH name matched or
       * how, which is the half of REQ-VUL-04 worth protecting. Earlier copy
       * pointed at reception and stopped there, which left a legitimately
       * refused staff member unable to tell a rule from a broken tablet.
       */
      blockedHeading: 'Please ask our reception staff',
      blockedBody:
        'That name matches a member of practice staff, who cannot sign for a patient. If that is not you, '
        + 'please see reception.',
      tooYoungSelf: 'Please ask our reception staff to continue this with you.',
      /** Fallback only — `evaluateAssignorGate` always returns at least one of the `reason*` strings above. */
      detailsNeeded: 'Please give your name and your relationship to the patient.',
      /**
       * The server refused the change. It names the rule and never echoes the
       * name that was typed; the tablet shows its own sentence and offers the
       * desk, because a refusal here must not become a dead end (REQ-REC-04).
       */
      saveFailed:
        'We could not record that here. Please see reception — your appointment is not affected.',
      /*
       * `lockedNotice` USED TO LIVE HERE AND HAS BEEN DELETED (Carl, 4 Sep
       * 2026), because the screen it explained no longer exists.
       *
       * K-5 rendered the self option, then — exactly where "Someone else is
       * signing for …" belongs — a box explaining that who signs is locked,
       * then a Continue. Carl read the box AS the second option, which is the
       * only sensible reading of a panel sitting in an option's place. The fix
       * was not better wording: when the particulars are locked there is
       * nothing to choose, so the ceremony SKIPS K-5 entirely and goes from
       * verification to K-3, whose "Signing" line already states who signs.
       * The one fact worth keeping moved with it —
       * `particulars.assignorLockedNote`.
       *
       * The rule this leaves behind: never render an option-shaped box that is
       * not an option.
       */
      railAgeKicker: 'Age gates',
      railAgeBody:
        'A patient of the qualifying age or over may sign for themselves. Anyone signing for another person '
        + 'must be of full age — checked before the branch continues.',
      railAbsentKicker: 'Not on this screen',
      railAbsentBody:
        'No capacity question, and nothing that asks staff to judge whether the patient can consent.',
    },

    particulars: {
      /**
       * K-3'S OWN HEADING, KEYED BY AGREEMENT TYPE, CARRIED ONTO K-4 (Carl,
       * 4 Sep 2026 copy follow-up to the pairing-day ruling). Reading (K-3)
       * and signing (K-4) are one act about one agreement, so both steps use
       * this same lookup rather than a component ever writing
       * `type === 'enduring' ? … : …` itself — a Record, the same pattern
       * `identifierNames` and `relationshipNames` already use above.
       *
       * Replaces the old static `documentTitle`/`heading` strings, which
       * said "Assignment of Medicare benefit" regardless of what kind of
       * agreement it was.
       *
       * "VISIT" IS DELIBERATE PATIENT-FACING PLAIN LANGUAGE (Carl's choice).
       * The domain and every regulatory surface keep saying "service"
       * (REQ-MP-01, CLAUDE.md §3) — this is the one word in the table that
       * trades that precision for a word a patient reads without pausing on
       * it, and it names nothing the s 65C data set itself calls a "visit".
       *
       * ENDURING NEVER REACHES A LIVE TABLET TODAY — kiosk enduring is out
       * of scope (README.md, "Not built here") — so that branch is exercised
       * only by `heading_follows_agreement_type`. `treatment_plan` takes the
       * episodic wording on the same reasoning `enduring` does not: one
       * agreement still authorises one signing occasion here, even where the
       * plan behind it spans six months. That is unconfirmed copy, not a
       * regulatory fact, and is worth revisiting once that module (build-plan
       * item 10) actually reaches the kiosk.
       */
      headingByAgreementType: {
        episodic_pre: "Agree to bulk billing for today's visit",
        episodic_post: "Agree to bulk billing for today's visit",
        treatment_plan: "Agree to bulk billing for today's visit",
        enduring: 'Agree to bulk billing',
      } as Record<AgreementType, string>,
      patient: 'Patient',
      provider: 'Provider',
      placeOfPractice: 'Place of practice',
      serviceDate: 'Date of service',
      service: 'Service',
      /*
       * D6b — THE MBS ITEM NUMBER(S), POST-AGREEMENTS ONLY (REQ-REG-01;
       * s 65C(4) table item 6). Carl, 11 Sep 2026.
       *
       * The row is drawn only when the server sent item numbers, which it does
       * only for a post-agreement — so a pre-agreement's screen is unchanged
       * and shows its Basic Service Description as it always did (D6a is
       * "pre-agreements only").
       *
       * AND NO AMOUNT BESIDE IT. The patient is being asked to assign the
       * benefit, not to approve a figure: the s 65C data set contains no
       * benefit and no dollar amount, and putting one on this screen would put
       * it on an agreement artefact (hard rule 4, REQ-REG-04).
       */
      items: 'Medicare item numbers',
      item: 'Medicare item number',
      agreementDate: 'Date of this agreement',
      assignor: 'Signing',
      assignorIsPatient: 'The patient is signing',
      assignorIsOther: (name: string, relationship: string) => `${name} · ${relationship}`,
      /**
       * WHERE THE LOCKED EXPLANATION WENT (Carl, 4 Sep 2026), and it is one
       * line rather than a panel.
       *
       * K-5 is skipped on a locked agreement — there is nothing to choose, and
       * a box in an option's place reads as an option. But the fact still
       * matters to whoever is standing there: who signs was decided at the
       * desk, and if it is wrong a person can fix it. So it sits under K-3's
       * "Signing" line, which is already stating who signs, and it points at a
       * human rather than at a control.
       *
       * It does not say "locked", "refused" or "cannot" — the patient is not
       * being told off, and nothing about their appointment is affected
       * (REQ-REC-04).
       */
      assignorLockedNote: 'Set at reception — ask our staff if this is wrong',
      /**
       * THE LAST INLINE COPY OF THE INSTRUMENT'S OWN WORDS, kept only for
       * agreements locked before the wording became versioned content (Carl,
       * 5 Sep 2026; W1).
       *
       * WHAT REPLACED IT. The sentences the patient ticks now come back from
       * the server as part of the rendered document — the same object the PDF
       * is drawn from and hashed against — so the tablet and the contract
       * cannot say different things. A sentence in this table was a second
       * copy of the operative words of a contract, unversioned, free to drift
       * from the one that was signed, and impossible to answer "what did they
       * actually agree to in March" from.
       *
       * IT IS NOT DELETED, because agreements locked before today have no
       * statements on their record and this is what they were shown.
       */
      consentText:
        'I assign my right to the Medicare benefit for the service described above to the provider named '
        + 'above, who accepts that assigned benefit as full payment for that service.',
      /**
       * The heading over the tick boxes. CHROME, not the instrument — the
       * statements themselves are content and are never in this table.
       */
      statementsHeading: 'Please read and tick each of these',
      versions: (ruleSet: string, mapping: string) => `Rule set ${ruleSet} · mapping ${mapping}`,
      /** Which wording produced the statements (hard rule 14). */
      wordingVersion: (template: string) => ` · wording ${template}`,
      hashLine: (hash: string) => `SHA-256 ${hash}`,
      tagNoAmount: 'No amount shown',
      /**
       * THE TAG THAT REPLACES `tagNoAmount` WHERE THE PRACTICE'S OWN FORM IS
       * ON THE SCREEN (D-2026-09-27-01; hard rule 4 as narrowed by
       * D-2026-09-14-02).
       *
       * WHY IT HAD TO CHANGE. The three tags exist so a reviewer standing at
       * the tablet can SEE a rule being kept rather than take it on trust — and
       * a tag that says "No amount shown" beside a column of amounts is the
       * opposite of that. It would teach the reader that the tags are
       * decoration.
       *
       * WHAT IT CLAIMS INSTEAD is the thing hard rule 4 actually forbids: AoB
       * never ORIGINATES or COMPUTES a figure. The number on the screen is the
       * string PracSoft printed, carried through unparsed and unformatted, and
       * this tag says exactly that and nothing more. It is drawn only where an
       * amount is actually on screen; a print record that carries none keeps
       * `tagNoAmount`, which is still true.
       */
      tagAmountIsThePractices: 'Amount as the practice printed it — never calculated by us',
      tagNoProviderSignature: 'No provider signature field',
      tagHashBeforeSigning: 'Hash written before signing',
      /**
       * THE FORM THE PRACTICE PRINTED, AS THE PATIENT READS IT ON GLASS
       * (D-2026-09-27-01: *"patient sees the db4 with the cost on it"*).
       *
       * LABELS AND CHROME ONLY, AND THAT LINE IS THE WHOLE POINT. Every word of
       * the form itself — the heading lines, the privacy notice, the assignment
       * statements, the descriptions and the amounts — arrives on the lock
       * response inside `Db4FormView` and is rendered as it came. Nothing in
       * this block is operative wording, for the reason K-3's own module note
       * gives: a sentence written here would be a second copy of the words that
       * were signed, free to drift from them.
       *
       * THE LABELS MATCH `packages/domain/content/signed-db4.json` WORD FOR
       * WORD, by hand rather than by import, with one exception noted below.
       * That file is the wording baked into a hashed document and a screen must
       * never be able to move it (hard rule 13); this is the screen's own copy
       * of the same words, so the tablet and the chart folder call the same
       * value the same thing.
       */
      db4: {
        /** Names the region for a screen reader arriving at it. */
        regionLabel: 'The form your practice printed',
        /**
         * WHOSE PAGE THIS IS (hard rule 12, the same answer the Signed-DB4's
         * footer gives). The form's own heading lines say the GOVERNMENT's form
         * is the prescribed one, and they are reproduced verbatim because they
         * are the practice's printed record — so this line sits under them and
         * says plainly who drew the screen. It makes no claim about our own
         * wording, which is the claim rule 12 forbids.
         */
        provenance:
          'This is AoBPlatform showing you the form your practice printed. It is not the prescribed form itself.',
        formReference: 'Form reference',
        serviceDate: 'Date of service',
        /**
         * THE HEADING OVER THE TWO FACTS THAT ARE OURS (Carl, 28 September
         * 2026: *"move Date of this agreement and Signing below Date of
         * service"*).
         *
         * IT EXISTS BECAUSE THE FACTS MOVED INTO THE FORM. Everything else in
         * this region is the practice's printed record reproduced; the date of
         * THIS agreement and who is signing are not on their paper at all.
         * While the two sat in a band of their own below both columns that
         * distinction was made by the layout. Inside the practice's left
         * column it has to be made in words, or the screen quietly attributes
         * two of our facts to their form — the same care `provenance` above
         * takes for the same reason (hard rule 12).
         */
        thisAgreement: 'This agreement',
        servicingLocation: 'Servicing location',
        patient: 'Patient',
        dateOfBirth: 'Date of birth',
        address: 'Address',
        patientRecordNumber: 'Chart number',
        /**
         * THE ONE LABEL THAT DOES NOT MATCH THE FORM'S, AND IT IS DELIBERATE.
         *
         * `signed-db4.json` calls this "Medicare card number" and the paper
         * does too. The kiosk string table may not: `medicare_number_rejected_
         * as_identifier` asserts that the words "medicare card" appear EXACTLY
         * ONCE in everything this device can say, in the annotation panel that
         * states there is no such field — the guard that keeps hard rule 1
         * visible. A second occurrence here would fail it, and that test is the
         * guard working rather than an obstacle.
         *
         * "Medicare number" names the same thing in the same words a patient
         * uses, so nothing is lost on the screen. Raised with Carl as a finding:
         * if the paper's exact label is wanted here, that is his call about the
         * guard, not a quiet edit to it.
         *
         * THE KEY AVOIDS THE FORBIDDEN NAME FOR THE SAME REASON. The root
         * ESLint config refuses any identifier matching `medicareNumber` or
         * `medicareCardNumber` outside one scoped type file, and a string-table
         * key is an identifier.
         */
        maskedCardNumber: 'Medicare number',
        /**
         * WHY IT LOOKS DIFFERENT FROM THEIR CARD (D-2026-09-27-01 part 3). A
         * patient who cannot see their whole number should be told why before
         * they wonder whether we hold the wrong one — and told that the form in
         * the chart folder is unaffected.
         */
        /**
         * AND WHAT TO DO ABOUT IT (Carl, 27 September 2026, from a live
         * tablet): *"Validate you are the right number on the medicare card -
         * or something to this effect."*
         *
         * THE INTENT IS REAL AND WORTH THE LINE. A family Medicare card
         * carries ONE card number and several people, told apart only by the
         * IRN beside each name. Reception picking the wrong IRN puts the claim
         * against the wrong family member, and the patient holding the card is
         * the only person in the building who can see that at a glance.
         *
         * THE WORDING IS DELIBERATELY NOT HIS, AND THIS IS WHY. "Validate you
         * are the right number" asks the patient to establish WHO THEY ARE
         * from the Medicare number, and hard rule 1 (REQ-VER-02) is that the
         * Medicare card number IS NOT AN IDENTITY IDENTIFIER — the one design
         * mistake CLAUDE.md names as most likely in this product. Copy is
         * where that rule gets broken first: a screen that tells a patient to
         * prove themselves with their card number has taught the practice to
         * do it, whatever the validators say.
         *
         * SO IT ASKS ABOUT THE FORM, NOT ABOUT THE PERSON. "Check what is
         * shown here against the card" is a DATA-ACCURACY check on a printed
         * particular, which is exactly what the DB4 affirmation already asks
         * for ("I confirm the details above are correct"). Nobody is
         * identified by it, nothing is verified by it, and no outcome turns on
         * it beyond telling staff the form is wrong.
         *
         * "BESIDE YOUR NAME" BECAUSE "IRN" MEANS NOTHING TO A PATIENT. The
         * field above is labelled IRN because the form labels it IRN; the
         * sentence says where to look for it on the card.
         */
        maskedCardNote:
          'Part of your Medicare number is hidden on this screen — your form carries it in full. '
          + 'Please check what is shown here against the card you have with you, including the IRN '
          + 'beside your name, and tell our staff if anything does not match.',
        irn: 'IRN',
        providers: 'Providers',
        servicingProvider: 'Servicing provider',
        payeeProvider: 'Payee provider',
        providerNumber: 'Provider number',
        services: 'Services',
        /** The table's accessible name. Announced, never drawn. */
        servicesCaption: 'The services on this form, with the amount your practice printed beside each one',
        columnDate: 'Date',
        columnItem: 'Item',
        columnDescription: 'Description',
        columnBenefit: 'Benefit assigned',
        privacyNotice: 'Privacy notice',
        assignment: 'Assignment',
        /**
         * WHICH PARSER READ THE FORM — a developer's note, behind the same TEST
         * flag as the "ready to sign" panel and for the same reason (Carl, 4 Sep
         * 2026). On a patient's screen it is noise.
         */
        parserTemplate: (version: string) => `Form template ${version}`,
        /**
         * ONE DB4 READ AS THREE PAGES (Carl, 27 Sep 2026, from a live tablet:
         * *"I think we need to break this down into maybe four pages from step
         * 2"*). A whole form on one tablet page is more than anybody reads at
         * once, and a patient who scrolls past the service rows to reach the
         * tick boxes has not read the service rows.
         *
         * WHERE THE NUMBERS COME FROM. `rules/db4-pages.ts` owns the order and
         * this owns the sentence, exactly as `rules/ceremony-steps.ts` and
         * `chrome.stepOf` already divide that work (REQ-LANG-01).
         *
         * IT IS NOT THE STEP CHIP AND MUST NEVER READ LIKE ONE. The chip says
         * which STEP of the ceremony the patient is on and keeps saying the same
         * number across all three pages, because pages within a step are not
         * steps (`rules/ceremony-steps.ts`). This line says which page of one
         * document is on screen, and it sits by the screen's own heading rather
         * than in the chip.
         */
        pageOf: (page: number, total: number) => `Page ${page} of ${total}`,
        /**
         * THE HEADING THAT NAMES EACH PAGE, and the element focus moves to when
         * the page turns (WCAG 2.2 AA — a page change nobody is told about is a
         * page change a screen-reader user misses).
         *
         * 2A IS NOT HERE, because 2A's heading is the FORM's own title line,
         * reproduced — the right name for that page is the one the practice
         * printed. `header` below is the fallback for a print record whose
         * heading lines the parser could not read; without it that page would
         * have no heading at all and nothing to move focus to.
         *
         * 2B AND 2C ARE THIS FILE'S WORDS, and they are chrome in exactly the
         * sense the column headings and section names above are: they name a
         * part of the form, they are not operative wording, and they say
         * nothing about what is being agreed. They reuse the section labels
         * already on those pages so the patient reads one vocabulary.
         */
        pageHeading: {
          header: 'Your details on this form',
          services: 'Providers and services',
          legal: 'Privacy and assignment',
        } as Record<'header' | 'services' | 'legal', string>,
        /**
         * ON TO THE NEXT PAGE OF THE FORM, and deliberately not "Continue to
         * sign". Only the last page offers signing; a Continue on 2A that read
         * like the one on 2C would tell a patient they were about to sign a
         * document they had read a third of.
         */
        continueToNextPage: 'Continue',
        /**
         * THE PAGE'S OWN GATE (Carl, 27 September 2026: *“on page 1 or 3
         * Continue button should be enabled after the box is ticked. Same
         * rule on the next page”*).
         *
         * IT SAYS WHAT TO DO, NOT WHAT WENT WRONG. The box is on the screen
         * directly above the control, so there is nowhere to send anybody and
         * nothing to explain — the shortest true sentence is the right one
         * (CLAUDE.md §7).
         *
         * SINGULAR AND PLURAL, because a page may carry more than one
         * statement and “1 boxes” on a patient-facing screen is the kind of
         * detail that makes somebody trust the rest of it less.
         */
        continueNotTicked: (outstanding: number) =>
          outstanding === 1 ? 'Tick the box above to continue' : `Tick the ${outstanding} boxes above to continue`,
        /**
         * THE SHORTCUT TO THE BOX THAT IS STILL OUTSTANDING (CLAUDE.md §7 —
         * shortcuts to the answer, not directions to a screen).
         *
         * WHY IT IS A SEPARATE CONTROL. `GuardedButton`'s blocked branch is a
         * real `button[disabled]` with no handler at all, and that is
         * load-bearing — it must stay unpressable (hard rule 2: the signature
         * path may not open early). So the blocked primary still states HOW
         * MANY are left, and this sits beside it and TAKES the patient to the
         * page holding the first one, rather than leaving them to find it.
         *
         * DRAWN ONLY WHEN THE BOX IS SOMEWHERE ELSE. An outstanding tick on the
         * page the patient is already looking at needs no travel, and a control
         * that went nowhere would be the "direction to a screen" this exists to
         * replace.
         */
        goToOutstanding: 'Take me to the box still to tick',
        /**
         * THE PAYLOAD PANEL, TEST DEVICES ONLY (Carl, 27 Sep 2026). He asked for
         * the DB4 Print Record itself on the tablet; the raw record carries the
         * UNMASKED card number, so it stays on a workstation and this is what
         * the tablet may show instead — the masked block exactly as this device
         * received it, so somebody checking a rendering can see whether the
         * screen drew what it was given.
         */
        payloadHeading: 'As this tablet received it',
        payloadBody:
          'The form block this device was sent, unchanged. The print record behind it is not reachable from '
          + 'a tablet — open it from a workstation.',
      },
      validating: 'Checking the details…',
      validatedHeading: 'Ready to sign',
      validatedBody: 'Particulars are locked. Changing one voids this render and produces a new hash.',
      /** THE ONE PRIMARY ON K-3. Reading is a step; signing is the next one. */
      continueToSign: 'Continue to sign',
      continueNotReady: 'Continue to sign — not ready yet',
      /**
       * HOW MANY ARE LEFT, not merely that something is (CLAUDE.md §7 —
       * shortcuts to the answer). The boxes are on the same screen, so the
       * count IS the direction: there is nowhere else to go and nobody to ask.
       */
      continueNotAffirmed: (outstanding: number) =>
        outstanding === 1
          ? 'Continue to sign — one box still to tick'
          : `Continue to sign — ${outstanding} boxes still to tick`,
      /**
       * K-3 NEVER ASKS THE PATIENT FOR A PARTICULAR (Carl, 3 Sep 2026 — this
       * supersedes the staff-entry box the Expo build carried).
       *
       * D6a comes from the PMS appointment type through the practice's
       * versioned mapping (CONSULTATION-CAPTURE-PLAN §2.4). It does not come
       * from the tablet, and it must not: the box that used to sit here was a
       * free-text field on a patient-facing screen, in a waiting room, that
       * wrote a validated particular of a contract. Anyone walking past could
       * type into it, and what they typed was matched exactly against a
       * mapping they could not see — so the honest outcomes were a refusal
       * nobody understood or, worse, a particular somebody guessed.
       *
       * EVERY C-RULE FAILURE ON K-3 IS TREATED THE SAME WAY: state the
       * situation, hand over, change nothing. Staff fix it on a STAFF surface
       * — the practice queue or reconciliation — where the mapping, the
       * booking and the audit trail all are.
       */
      /**
       * TAKES THE NAME (TODO.md, "Two rulings from pairing day", 4 Sep
       * 2026). Carl chose Jamie on the list, passed all three identifiers on
       * K-2, and only then reached this hand-over — on a screen with no name
       * on it, so reception had no way to tell who needed fixing. The name is
       * safe to show here for the same reason it is safe on the list: the
       * patient (or whoever picked them) just tapped it on a screen that
       * already showed it to them, so nothing is newly disclosed.
       */
      needsReceptionHeading: (patientName: string) => `${patientName} — one more detail is needed from reception`,
      needsReceptionBody:
        'We need one more detail from reception before this can be signed. Please see reception — your '
        + 'appointment is not affected.',
      /**
       * A FAULT ON OUR SIDE IS NOT A DETAIL THE PATIENT CAN FIX (Carl, 3 Sep
       * 2026 live test). The Expo build rendered a core 500 as "1 detail still
       * needed — 01 Internal server error": it put our failure in the list of
       * things the person standing at the tablet was being asked to correct,
       * and it printed the server's own words at them. The raw message never
       * reaches the screen — it is not written for a patient, and nobody has
       * checked that it is free of detail we would not want in a waiting room.
       */
      serverFaultHeading: 'Something went wrong on our side',
      serverFault:
        'This is not something you can fix, and it is not about your details. Please see reception — your '
        + 'appointment is not affected.',
      /**
       * WHAT AN ONGOING AGREEMENT ACTUALLY COVERS, in the words a patient
       * reads standing at a desk (Carl, 4 Sep 2026; GA-PLAN B5; REQ-PORT-03
       * "plain-language explanation").
       *
       * IT IS ON THE SCREEN BECAUSE THE COMMITMENT IS BIGGER THAN THE VISIT.
       * An episodic agreement covers today. This one covers every in-scope
       * service this provider bulk bills from today until somebody ends it
       * (REQ-END-06a), which is a thing a person should be told plainly before
       * they sign it rather than after.
       *
       * EVERY LINE IS A DOCUMENTED FACT, not reassurance:
       *  - the scope and its open end — REQ-END-06a;
       *  - ending it, by either party, in writing, effective two BUSINESS days
       *    later, and the patient may end it even where somebody else entered
       *    it for them — REQ-END-06. "Any time" without "two business days"
       *    would be a promise the regulation does not make;
       *  - one provider, not the practice — REQ-END-01, hard rule 6. A patient
       *    who read this as "bulk billed at this clinic" would be wrong in the
       *    way that costs them money.
       *
       * NO BENEFIT AND NO DOLLAR AMOUNT (hard rule 4, REQ-REG-04): "bulk
       * billed" is what is promised, and there is no figure anywhere near it.
       * Nothing here calls the form certified or approved (hard rule 12).
       */
      enduringCoverageHeading: 'What you are agreeing to',
      enduringCoverage: [
        'This covers the bulk-billed services this provider gives you, from today until it is ended. You do '
          + 'not have to agree again each visit.',
        'You can end it whenever you like. Tell us in writing and it stops two business days later. The '
          + 'provider can end it the same way. If someone else agreed to this for you, you can still end it '
          + 'yourself.',
        'It is with this one provider. It does not cover other providers here, and it does not cover other '
          + 'practices.',
      ] as readonly string[],
      /**
       * THE QUIET SECOND OPTION (Carl, 4 Sep 2026). A patient who would rather
       * be asked each time may say so, and it costs them nothing: reception is
       * told, and offers an agreement for today's visit instead.
       *
       * SECONDARY AND UNDERSTATED, deliberately. It sits beside Continue and
       * is not styled to compete with it — but it IS on the screen, because a
       * standing agreement offered with no way to say "not that one" is not
       * really being offered. It is not a refusal of bulk billing and not a
       * refusal of care, and the confirmation says so (hard rule 8,
       * REQ-REC-04).
       */
      enduringDeclineAction: 'I’d rather agree each visit',
      enduringDeclinedHeading: 'No problem — reception will sort this out',
      enduringDeclinedBody:
        'You will be asked to agree for each visit instead. Please hand the tablet back — your appointment '
        + 'is not affected, and you can still be bulk billed today.',
      footer: 'Checked against the s 65C data set',
    },

    signature: {
      heading: 'Sign here',
      /**
       * WHO IS SIGNING, SAID ON THE SCREEN WITH THE PEN ON IT (Carl, 7 Sep
       * 2026, from testing the pushed flow: "did not ask who is signing").
       *
       * IT IS A STATEMENT AND NEVER A QUESTION. D7 is a LOCKED PARTICULAR by
       * the time this screen draws (hard rule 2, REQ-REG-06): it was settled at
       * reception before the push and it moves only by correct → supersede on a
       * staff surface. A control here that could change it would be a tablet
       * editing a particular of a contract, which is the whole thing K-3 has no
       * field for.
       *
       * BUT IT HAD TO BE SAID. K-3's "Signing" row is one line inside a
       * document somebody is reading; K-4 said nothing at all, so the person
       * actually holding the pen was never told whose signature this is. On the
       * other-party branch it names all three facts a wrong pairing would show
       * up in — who is signing, who for, and on what footing.
       *
       * THE RELATIONSHIP IS THE RECORD'S OWN WORD, passed through the kiosk's
       * `relationshipLabel` so a key-shaped value from an older record still
       * reads as a word. The list itself is versioned content
       * (`assignor-relationships.json`, hard rule 14); only the words are here.
       */
      signingByPatient: (patientName: string) => `${patientName} is signing.`,
      signingByOther: (assignorName: string, patientName: string, relationship: string) =>
        `${assignorName} is signing for ${patientName} as their ${relationship}.`,
      /**
       * THE SAME SENTENCE WITH THE RELATIONSHIP LEFT OUT, for a record that
       * carries a name and no relationship. "as their ." is worse than silence,
       * and inventing a word for a legal footing nobody declared is worse than
       * both.
       */
      signingByOtherUnstated: (assignorName: string, patientName: string) =>
        `${assignorName} is signing for ${patientName}.`,
      /**
       * AND THE WAY OUT IF IT IS WRONG (REQ-REC-04, hard rule 8). It offers no
       * correction, because there is nothing on this device that could make
       * one; it points at the person a metre away who can, and says the one
       * thing that matters in the meantime — do not sign.
       */
      whoNotRight: 'If this is not right, do not sign — see reception.',
      validatedBanner: 'All particulars are complete and locked. Checked against the s 65C data set.',
      padHint: 'Sign with your finger above this line',
      padLabel: 'Signature area. Sign with your finger, or use approve by tapping below.',
      clear: 'Clear',
      /** The enabled label. The disabled one is composed by GuardedButton from the reasons. */
      signAction: 'I agree and sign',
      signBlocked: (count: number) =>
        count === 1 ? 'Sign — 1 detail still needed' : `Sign — ${count} details still needed`,
      signBlockedGeneric: 'Sign — not ready yet',
      tapToApprove: 'Or tap to approve instead',
      tapToApproveAction: 'I agree — approve by tapping',
      tapToApproveHint: 'Offered where signing on glass is difficult. Either way is a signature.',
      binding:
        'Signing records the document you were shown, the check we did on your details, the time, and this tablet.',
      needsInk: 'Please sign above, or use approve by tapping.',
      submitting: 'Recording your signature…',
      /**
       * A REQUEST THAT NEVER LANDED, and only that (Carl, 7 Sep 2026).
       *
       * This used to be shown for a REFUSAL too, and the screen then sat there
       * with the same payload and the same button. A refusal now ends the
       * ceremony and hands over (`notRecordedHeading` below), so what is left
       * here is the case where the tablet does not know what happened —
       * nothing reached the server — and the patient is on a screen they can
       * still act on.
       */
      failed: 'Your signature was not recorded. Please see reception — your appointment is not affected.',
      /*
       * THE SERVER REFUSED IT, so the tablet closes the page (Carl, 7 Sep
       * 2026: "If the message is to see reception then close this page and go
       * back to Begin").
       *
       * THE SAME WORDS AS "RETURN TO BEGIN", and that is not laziness. Both
       * are the tablet ending a ceremony for a reason the patient did not
       * cause and cannot fix, so both say the one thing that is true and
       * useful — see reception, nothing has happened to your appointment —
       * and neither explains itself. The REASON goes to reception's row, in
       * their vocabulary, with the control that fixes it; putting it on this
       * screen would hand a patient a diagnosis they can do nothing with
       * (hard rule 8, REQ-REC-04).
       *
       * IT DOES NOT SAY "FAILED" OR "ERROR". Nothing was signed, nothing was
       * lost, and the person did nothing wrong.
       */
      notRecordedHeading: 'Please see reception',
      notRecordedBody: 'Your appointment is not affected.',
      footer: 'Vector and raster capture · tap-to-approve offered where signing on glass is difficult',
    },

    complete: {
      heading: (givenName: string) => `Signed. Thank you, ${givenName}.`,
      /*
       * IT NO LONGER PROMISES A COPY (W6, 11 Sep 2026). Until "send me a
       * copy" existed this sentence ended "A copy is on its way to you", and
       * nothing sent one. The offer below is now the place a copy is
       * promised, and it promises one only after it has been queued.
       */
      body: 'Reception has been told you are ready.',
      /**
       * AND WHAT IT MEANS FOR NEXT TIME, on an ONGOING agreement only (Carl,
       * 4 Sep 2026, wording kept as given).
       *
       * It is the one thing that is different about having signed this rather
       * than an agreement for the visit, and the moment to say it is now. It
       * names the PROVIDER, because that is the whole of hard rule 6 in the
       * one place a patient would otherwise assume "this practice": an ongoing
       * agreement is per practitioner × patient and never practice-wide
       * (REQ-END-01).
       *
       * "UNLESS SOMETHING CHANGES" is deliberately not a list. An ongoing
       * agreement also ends automatically on events the tablet cannot see —
       * MyMedicare deregistration or transfer, leaving an ACCHO/AMS, discharge
       * from residential care, the patient turning 14 (REQ-END-07, 65CA(8)) —
       * and reciting them at a waiting-room screen would be a page of law
       * where a sentence belongs. The patient's own page carries the full
       * explanation (REQ-PORT-03).
       */
      enduringBody: (providerName: string) =>
        `You will not be asked again for ${providerName} at this practice unless something changes.`,
      done: 'Done',
      returning: (seconds: number) => `Returns to the start in ${seconds}s`,
      writeBackQueued: 'Being written back to the practice system',

      /*
       * "SEND ME A COPY" — W6, REQ-PORT-02, which automates the s 65C
       * copy-on-request obligation.
       *
       * THE OPTION LABELS ARE KEYED BY THE CONTENT FILE'S KEYS
       * (`packages/domain/content/copy-delivery-channels.json`), per REQ-LANG-02
       * and Carl's 3 Sep rule: the list is content, the words are the string
       * table, and a translated word can never change which channel is used.
       *
       * THE ADDRESS IN THESE LABELS IS ALWAYS THE MASKED ONE (D-2026-09-11-03).
       * It arrives from the server already masked; there is no unmasked value
       * anywhere on this device to interpolate even by mistake.
       *
       * NOTHING HERE PROMISES ANYTHING ABOUT CARE OR BILLING, and nothing
       * says a copy is required. A patient who says no thanks has finished
       * exactly as completely as one who says yes (hard rule 8).
       */
      copy: {
        question: 'Would you like a copy of what you signed?',
        options: {
          email: (masked: string) => `Email it to ${masked}`,
          sms: (masked: string) => `Text it to ${masked}`,
          not_now: 'No thanks',
        } as Record<string, string | ((masked: string) => string)>,
        sending: 'Sending…',
        sentEmail: 'On its way to your email.',
        sentSms: 'On its way to your phone.',
        declined: 'No copy sent. You can ask reception for one at any time.',
        /*
         * SHORTCUTS TO THE ANSWER (Carl, 4 Sep 2026) on a surface with no
         * links: every reason names what is wrong AND where it is fixed, and
         * on patient glass the destination is always a person at the desk —
         * never a box to type an address into (D-2026-09-11-03).
         */
        reasons: {
          no_contact_on_file:
            'We do not have a way to send you a copy. Reception can print one for you or add your details.',
        } as Record<string, string>,
        /** An unmapped code SHOWS ITS CODE so it can be diagnosed, never a generic sentence. */
        unmappedReason: (code: string) => `Reception can give you a copy. (${code})`,
        /*
         * THE OFFER ITSELF COULD NOT BE BUILT — the request never landed, so
         * the platform knows nothing about whether a contact is on file and
         * must not claim there is none. It says the true thing instead, which
         * is that the desk can hand one over.
         */
        offerUnavailable: 'Reception can give you a copy of what you signed.',
        failed: 'That did not send just now. Reception can give you a copy — your agreement is signed either way.',
      },
    },

    errors: {
      /** Never blocks care (REQ-REC-04): every failure ends at the desk, not at a dead end. */
      generic: 'Something went wrong here. Please see reception — your appointment is not affected.',
      seeReception: 'See reception',
      startOver: 'Start again',
    },

    /*
     * PAIRING — the screen a tablet shows before it is anybody's tablet.
     *
     * WRITTEN FOR A STAFF MEMBER, NOT A PATIENT, and it is the only screen in
     * the kiosk that is. Nobody hands a patient an unpaired tablet: this is
     * seen once, at a desk, by whoever is setting the device up. So it may say
     * "practice console" and "pairing code", words the ceremony screens would
     * never use — and it still says nothing about any practice, because an
     * unpaired tablet does not know which practice it is and must not guess.
     *
     * IT NEVER SAYS WHY A CODE FAILED. Wrong, expired, already used and
     * revoked are one sentence, because telling somebody their code was right
     * but stale is telling them their guess was right.
     */
    pairing: {
      heading: 'Pair this tablet',
      lede:
        'A staff member can set this up. In the practice console, open Tablets, add this device, and type '
        + 'the code it shows below.',
      codeLabel: 'Pairing code',
      /** Eight characters, and the field says so rather than letting somebody discover it. */
      codeHint: 'Eight letters and numbers. Capitals and hyphens do not matter.',
      pairAction: 'Pair this tablet',
      pairBlocked: 'Pair this tablet — enter the code first',
      pairing: 'Pairing…',
      /** One sentence for every way a code can fail. */
      refused:
        'That code cannot be used. Codes last ten minutes and work once — ask for a new one in the practice '
        + 'console.',
      unreachable: 'This tablet cannot reach the platform just now. Check the connection and try again.',
      /*
       * PAIRED, AND THE ONE THING WORTH SAYING ABOUT WHERE IT WENT: the
       * credential is revocable from the console and nothing else is kept
       * here. Said plainly because the person reading it is the person who
       * will have to revoke it when the tablet goes missing.
       */
      paired: (practiceName: string) => `Paired to ${practiceName}.`,
      pairedBody: 'This tablet can be revoked from the practice console at any time. Nothing else is stored on it.',
      /*
       * THE BROWSER REFUSED TO REMEMBER IT — private browsing, or a locked
       * down profile. The tablet works for now and will need pairing again
       * after a restart, which is worth knowing at the desk rather than on a
       * Monday morning.
       */
      notRemembered:
        'This browser would not remember the pairing, so the tablet will need pairing again after it '
        + 'restarts. A staff member can check the browser is not in private mode.',
      continueAction: 'Continue',
    },

    /*
     * UNPAIRED — where a revoked tablet lands, mid-morning, with a patient
     * possibly standing at it.
     *
     * IT ADDRESSES THE PATIENT, unlike the pairing screen, because this one
     * can appear while somebody is holding the device. It says the appointment
     * is unaffected (REQ-REC-04, hard rule 8), it offers reception, and it
     * offers no retry: the credential is dead and pressing anything would only
     * ask the server the same refused question again.
     */
    unpaired: {
      heading: 'This tablet needs to be paired',
      body: 'Please see reception. Your appointment is not affected, and nothing you did has been lost.',
      /** For the staff member who comes over. Names no practice and no device. */
      staffNote: 'Staff: pair this tablet again from the practice console.',
      pairAction: 'Pair this tablet',
    },

    /*
     * OUTAGE — core stopped answering (TODO.md "Outage screen on the
     * tablet", Carl 4 Sep 2026: "hide everything and say, Please contact
     * reception."). Two sentences and nothing else: no field, no half-drawn
     * agreement, no patient detail. No retry — the screen offers nothing to
     * press, because there is nothing on this device that pressing anything
     * could fix; it clears itself the moment the server answers again.
     */
    outage: {
      heading: 'Please contact reception',
      body: 'Your appointment is not affected.',
    },

    /*
     * TAKEN OFF THE FLOOR BY RECEPTION (Carl, 4–5 Sep 2026; TODO.md "Tablets:
     * make one inactive") — a flat battery, a tablet going out for repair, one
     * on the wrong desk.
     *
     * QUIET, NOT ALARMING. This is housekeeping, not a fault: nothing has gone
     * wrong with the platform and nothing has gone wrong for the patient. Two
     * sentences, no button — there is nothing on this device that pressing
     * anything could fix, and the way back is one press on the console.
     *
     * IT SAYS THE APPOINTMENT IS UNAFFECTED because somebody may be holding the
     * tablet when it appears (hard rule 8, REQ-REC-04).
     */
    outOfUse: {
      heading: 'This tablet is not in use',
      body: 'Please see reception. Your appointment is not affected.',
    },

    /**
     * THE VERSION BANNER SUPPORT CAN READ (TODO.md "Zero-footprint kiosk").
     * Small, in the footer, and the only reason it is on a patient-facing
     * screen at all: when a practice rings up, the first question is which
     * build the tablet is running, and the alternative is asking somebody to
     * find it in a browser menu.
     */
    build: (build: string) => `build ${build}`,
  },
  /*
   * THE PATIENT'S OWN PAGE — `/patient/portal` (C8, REQ-PORT-01..08).
   *
   * THE VOICE IS DIFFERENT FROM EVERY OTHER NAMESPACE HERE and deliberately
   * so. The console is read by somebody doing their job; this is read by a
   * person who did not choose to use our software, may be unwell, and cannot
   * ring our support line. Short sentences, no jargon, "you" not "the
   * patient", and every consequence said before the button rather than after.
   *
   * NEVER "certified", "approved", "accredited" or "government-approved"
   * (hard rule 12, REQ-65C-05) — held by the named test
   * `portal_copy_never_claims_approval`, which reads this whole namespace.
   * "Checked" is the permitted word and the honest one.
   *
   * "PROVIDER", NOT "GP"; "SERVICE", NOT "CONSULT" (REQ-MP-01, CLAUDE.md §3).
   * UK/AU spelling throughout.
   *
   * NO AMOUNT ANYWHERE EXCEPT `notices` (hard rule 4). The 89AA notices card
   * is the one place a benefit amount belongs, which is why it has a
   * namespace of its own rather than a line inside `agreements`.
   */
  portal: {
    title: 'Your bulk-billing record',
    /** THE PERSON'S NAME IN THE HEADER (Carl, 4 Sep 2026), once the details have loaded. */
    titleFor: (name: string) => `${name} — your bulk-billing record`,
    lead: 'Everything AoBPlatform holds about you, and what we do with it.',
    loading: 'Loading…',
    signOut: 'Sign out',
    /**
     * THE SESSION BAR, IN THE SAME STYLE AS THE CONSOLE'S (Carl, 4 Sep 2026:
     * "Put this style of button for sign-in/out with the person's GUID next
     * to the button so we know it is not a scam"). The record id is the
     * portal account's own opaque id -- shown in full so a page that claims
     * to be this one can be checked against a message that quoted it.
     */
    session: {
      audience: 'AoBPlatform',
      recordId: (id: string) => `Your record ID ${id}`,
    },
    /*
     * ONE CARD FAILED, NOT THE PAGE. Said inside the card that failed, and it
     * says the rest still works — because somebody who came here to check
     * whether a text message was genuine needs to know the answer is still on
     * this page somewhere.
     */
    cardError: 'This part could not be loaded just now. Everything else on this page still works.',
    common: {
      cancel: 'Cancel',
    },
    signedOut: {
      heading: 'Your bulk-billing record',
      body: 'This page shows what each of your practices holds about you, so it needs to know who you are.',
      unreachable: 'We cannot reach your record just now. Please try again shortly. Nothing about your care or your appointments is affected.',
      /*
       * THE SENTENCE THIS SCREEN EXISTS FOR (REQ-PORT-08). A person who has
       * been sent an agreement to sign, and who lands here, must not conclude
       * that they have to make an account first. They do not, and never will.
       */
      neverNeeded: 'You never need to sign in to sign a bulk-billing agreement. This page is only for looking at your own record afterwards.',
      devHeading: 'Development only',
      devHint: 'Add ?patientIds=… to the address bar, then open the page as those patients. This control does not exist in a real build.',
      devAction: 'Open as a test patient',
      devFailed: 'That did not work. Check that core is running and that it is configured for development.',
    },

    /*
     * THE ACTIVATION PAGE — what the invitation link opens (FR-1.14,
     * REQ-PORT-08). `/patient/portal/activate/<token>`.
     *
     * THE ASK IS FRAMED AS A CHECK, NOT AS A SIGN-UP. Nothing here says
     * "create an account", "register" or "verify your identity": the patient is
     * being asked for details their practice already holds, and the sentence
     * says so and says where they last gave them ("the same ones they asked
     * when you signed"). A person who cannot remember what a practice holds is
     * being asked a fair question; a person being asked to "prove" themselves
     * to a website is being asked something else.
     *
     * IT NEVER NAMES THE IDENTIFIER THAT FAILED. One sentence for every
     * mismatch, at every attempt (REQ-SEC-07): telling somebody the date was
     * right and the address was wrong is telling whoever is holding a
     * forwarded link exactly what to work on.
     *
     * EVERY REFUSAL HAS A NEXT STEP, and it is the practice rather than us —
     * they are the only ones who can mint a new invitation (Carl, 4 Sep 2026,
     * "shortcuts to the answer"). An unmapped reason code shows its own code
     * so it can be read out to support rather than becoming a shrug.
     *
     * AND CARE IS NEVER AFFECTED, said on the locked screen where somebody is
     * most likely to fear otherwise (hard rule 8).
     */
    activate: {
      /**
       * THE GROUP HEADINGS, IN THE PATIENT'S OWN TERMS (Carl, 5 Sep 2026: "use
       * the friendlier wording"). Keyed by identifier type; anything the server
       * names that is not here falls back to the shared identifier label, so a
       * practice's configured set always renders (REQ-VER-02 set only).
       */
      groupLabels: {
        name: 'Your full name',
        date_of_birth: 'Your date of birth',
        gender: 'Your gender, as you identify it',
        address: 'Your home address',
        patient_record_number: 'Your patient record number — it is on your appointment reminder',
        ihi: 'Your Individual Healthcare Identifier (IHI)',
      } as Record<string, string>,
      title: 'See your bulk-billing record',
      loading: 'Opening your invitation…',
      /* The offer, and the ask, in the order they make sense. */
      offer: (practiceName: string) =>
        `${practiceName} has offered you a way to see your bulk-billing record.`,
      ask: 'To make sure it is you, tell us the details your practice holds — the same ones they asked when you signed.',
      /* The nudge that this is optional, carried over from the signed-out screen. */
      optional: 'You never need to do this to sign a bulk-billing agreement. This page is only for looking at your own record afterwards.',
      expires: (when: string) => `This invitation is open until ${when}.`,
      attemptsRemaining: (left: number) =>
        left === 1 ? 'You have one more try.' : `You have ${left} more tries.`,
      nameGiven: 'Given name',
      nameFamily: 'Family name',
      nameNote: 'Your family and given names count as one detail.',
      /*
       * THE THREE DATE PICKERS HAVE THEIR OWN WORDS HERE, not the kiosk's
       * (Carl, 5 Sep 2026). The kiosk's copies live under `kiosk.verify` and
       * this page reads the app-level table, so pointing at them left three
       * unlabelled boxes on screen. They double as the placeholder option on
       * each select — "Day" says what to choose, where an em dash says only
       * that nothing is chosen yet.
       */
      dobDay: 'Day',
      dobMonth: 'Month',
      dobYear: 'Year',
      continueAction: 'Continue',
      continueBusy: 'Checking…',
      continueBlocked: 'Fill in every box first',
      /* ONE SENTENCE, NAMING NOTHING (REQ-SEC-07). */
      mismatchHeading: 'Some of these details do not match what your practice holds',
      mismatchBody: 'Check what you have typed and try again. We cannot tell you which one it was.',
      /* The server was unreachable, or answered something we do not map. */
      failed: 'We could not check that just now. Nothing has changed — please try again shortly.',
      unmappedReason: (code: string) =>
        `This link cannot be opened (${code}). Ask your practice for a new invitation, and tell them that code.`,
      reasons: {
        token_unknown: {
          heading: 'This link does not work',
          body: 'It may have been copied incompletely, or it may not be ours. Ask your practice for a new invitation.',
        },
        token_expired: {
          heading: 'This link has already been used, or it has run out',
          body: 'Ask your practice for a new invitation. If you have already set this up, you can open your record with your passkey.',
        },
        token_locked: {
          heading: 'This link is now locked',
          body: 'Ask your practice for a new invitation.',
        },
      } as Record<string, { heading: string; body: string }>,
      lockedHeading: 'This link is now locked',
      lockedBody: 'Ask your practice for a new invitation.',
      lockedReassurance: 'Nothing about your care or appointments is affected.',
      backToPortal: 'Go to your record',
      /* Dev only, and it says so. See `fixtures.ts`. */
      fixtureHeading: 'Development only',
      fixtureHint: (answers: string) =>
        `No core is running, so this page is answering from fixtures. It accepts: ${answers}`,
    },

    /*
     * THE ONE-LINE WELCOME after an activation, shown ONCE (Carl, 5 Sep 2026).
     * It exists to point at the passkey card, which is the next thing worth
     * doing and the only thing that stops the next visit needing another
     * invitation — and it is state rather than storage, so a reload drops it
     * and the tablet rule is untouched.
     */
    welcome: "You're in. Add a passkey below so you can come back without a new invitation.",
    welcomeDismiss: 'Dismiss',

    /*
     * SHOWING ONE PRACTICE, OR ALL OF THEM (Carl, 5 Sep 2026).
     *
     * Only rendered where the account is linked to more than one practice —
     * see `PracticeFilter`. "Showing" rather than "Filter" because the word
     * describes the page's state, which is what somebody scanning for their
     * own practice needs to read, and because "filter" is software's word for
     * it rather than a person's.
     */
    filter: {
      label: 'Showing',
      all: 'All practices',
    },

    /* ---------------------------------------------------------------- 1 */
    details: {
      heading: 'My details',
      /*
       * WHY TWO PRACTICES CAN DISAGREE, said plainly. Their system is the
       * master of their record; ours is not, and a patient who saw two
       * addresses with no explanation would reasonably think one of them was
       * our mistake.
       */
      lead: 'Each practice keeps its own copy of your details, so they can differ. What you see here is what that practice holds.',
      empty: 'No practice details to show yet.',
      notHeld: 'Not held',
      name: 'Name',
      dateOfBirth: 'Date of birth',
      address: 'Address',
      mobile: 'Mobile',
      email: 'Email',
      recordNumber: 'Their record number for you',
      /**
       * OUR OWN ID FOR THIS PRACTICE'S ROW (Carl, 7 Sep 2026), beside the
       * practice's own record number and doing a different job.
       *
       * THE ACCOUNT ID IS ALREADY ON THIS PAGE and is NOT this. That one names
       * the person signed in; this names the patient row a single practice
       * holds, and a support call has to be able to say which — a patient
       * linked to two practices has one account and two of these.
       *
       * IT IS NOT CORRECTABLE and is not offered as such, for the same reason
       * the record number is not: it identifies a row, it is not a fact about
       * the person, and there is nothing anybody could change it to.
       */
      patientIdAt: (practiceName: string) => `Patient ID at ${practiceName}`,
      correctAction: 'Ask the practice to correct this',
      asked: 'The practice has been asked. They will confirm the correct value with you.',
      confirmTitle: 'Ask the practice to correct this?',
      confirmBody: (field: string, practiceName: string) =>
        `We will tell ${practiceName} that your ${field.toLowerCase()} needs correcting.`,
      /*
       * NO NEW VALUE IS SENT AND THE COPY SAYS SO. The practice owns the
       * record; the correction is confirmed with the patient by the people who
       * can actually make it. Promising an edit here would be promising
       * something this page cannot do.
       */
      confirmNote: 'We do not send them a new value. They will confirm the correct one with you.',
      confirmAction: 'Ask them to correct it',

      /*
       * WHEN TWO PRACTICES HOLD DIFFERENT THINGS (Carl, 5 Sep 2026).
       *
       * THE VALUES ARE NOT REPEATED HERE, and that is the whole design of this
       * block. Both are already on screen in the practice blocks below it;
       * printing them again would say the same address twice on a page read on
       * a phone, and would make the notice longer than the thing it is about.
       * It names the detail and the practices, and the reader looks down.
       *
       * IT DOES NOT SAY WHICH ONE IS WRONG, because we do not know. Each
       * practice's own system is the master of its own record (the card's
       * lead says so), and somebody who has moved has a right address and a
       * stale one rather than an error. The next step is the same either way:
       * tell the practice holding the old copy, which is why the tag sits
       * beside the existing "Ask the practice to correct this" link.
       */
      differHeading: 'Your practices hold different details for you.',
      /* Two practices — the ordinary case, and the words it deserves. */
      differPair: (field: string, first: string, second: string) =>
        `${field}: ${first} has one ${field.toLowerCase()}, ${second} has another.`,
      /*
       * Three or more. Deliberately weaker than "each holds a different one",
       * which would be untrue where two of the three agree.
       */
      differMany: (field: string, practiceNames: string) =>
        `${field}: ${practiceNames} do not all hold the same ${field.toLowerCase()}.`,
      /* The list separator for that sentence: "A, B and C". */
      differAnd: 'and',
      /* The tag beside the detail itself, in the block that holds the odd copy. */
      differsFrom: (practiceName: string) => `Differs from ${practiceName}`,
      differsFromSeveral: (count: number) => `Differs from ${count} of your other practices`,
    },

    /* ---------------------------------------------------------------- 2 */
    agreements: {
      heading: 'My agreements',
      lead: 'Every bulk-billing agreement you are part of, and the copy you signed.',
      empty: 'No agreements yet.',
      signedOn: (when: string) => `Signed ${when}`,
      notSignedYet: 'Not signed yet',
      serviceOn: (when: string) => `service on ${when}`,
      noServiceDescription: 'No service description recorded',
      viewAction: 'View as signed (PDF)',
      types: {
        enduring: 'Ongoing agreement',
        episodic: 'For one visit',
      } as Record<string, string>,
      channels: {
        in_practice: 'Signed at the practice',
        remote_link: 'Signed from a link we sent you',
        verbal: 'Given verbally',
        paper: 'Signed on paper',
        print: 'Signed on paper',
      } as Record<string, string>,
      /*
       * A LIFECYCLE STATE IN THE PATIENT'S WORDS. None of these claims that
       * anybody has endorsed the form: "checked" is what we do (REQ-65C-05).
       * A state with no entry shows as its own code rather than as nothing.
       */
      statuses: {
        draft: 'Not finished',
        verification_pending: 'Waiting on an identity check',
        verification_failed: 'The identity check did not pass',
        awaiting_signature: 'Waiting for your signature',
        signed: 'Signed',
        validated: 'Signed, and checked against the s 65C data set',
        stored: 'Signed and stored',
        claim_linked: 'Signed, and a claim has been made',
        verbal_recorded: 'Recorded verbally',
        declined: 'Declined',
        expired: 'Expired',
      } as Record<string, string>,
    },

    /* ---------------------------------------------------------------- 3 */
    enduring: {
      heading: 'Ongoing bulk-billing agreements',
      /*
       * PER PROVIDER, said in the lead, because the alternative reading —
       * "an agreement with the practice" — is wrong in law and would mislead
       * a patient about eight other doctors at the same address
       * (REQ-END-01, hard rule 6).
       */
      lead: 'These are with one provider each, not with the practice. They keep going until you or the provider end them.',
      empty: 'You have no ongoing agreements.',
      activeSince: (when: string) => `In place since ${when}`,
      /*
       * THE PLAIN-LANGUAGE EXPLANATION REQ-PORT-03 ASKS FOR, in the words of
       * the obligation itself (REQ-END-06a, FAQ p. 39): while the agreement
       * stands, the provider bulk bills the services it covers. No amount, and
       * no promise about services it does not cover.
       */
      coverage: (providerName: string) =>
        `While this is in place, ${providerName} bulk bills you for the services it covers, so you are not charged for them.`,
      endAction: 'End this agreement',
      endsOn: (when: string) => `Ends ${when}`,
      confirmTitle: 'End this agreement?',
      confirmBody: (providerName: string) =>
        `You are ending your ongoing bulk-billing agreement with ${providerName}.`,
      /* Both facts come from the regulation, not from us (REQ-END-06, FR-5.3). */
      confirmTiming: 'It ends two business days from now.',
      confirmNotice: 'We will send you a written notice, and tell the practice.',
      /* Hard rule 8, said where somebody is most likely to fear otherwise. */
      confirmCare: 'This does not affect your appointments or your care. You can make a new agreement at any time.',
      confirmFailed: 'We could not end it just now. Nothing has changed. Please try again shortly.',
      confirmAction: 'End this agreement',
    },

    /* ---------------------------------------------------------------- 4 */
    notices: {
      heading: 'Medicare claim notices',
      lead: 'When a provider claims a Medicare benefit for a service you assigned, they must tell you. These are those notices.',
      empty: 'No claim notices yet.',
      /*
       * ONE-WAY, AND THE COPY IS THE ENFORCEMENT (hard rule 7, FR-6.3). No
       * approve, no decline, no "waiting on you", and never a chase. It says a
       * service was billed and asks nothing.
       */
      oneWayNote: 'These are for your information only. There is nothing for you to do, and nobody will ask you about them.',
    },

    /* ---------------------------------------------------------------- 5 */
    visits: {
      heading: 'Where I have been',
      /*
       * THE MOST IMPORTANT LINE ON THE CARD. A list of dates and places reads
       * like the start of a medical history; this product holds none
       * (CLAUDE.md §8) and has to say so before the list, not after.
       */
      lead: 'Visits where a bulk-billing agreement was made. This is not a medical record — we hold nothing about your health.',
      empty: 'No visits recorded.',
    },

    /* ---------------------------------------------------------------- 6 */
    messages: {
      heading: 'Messages sent to me',
      lead: 'That we sent it, when, and how. We do not keep a copy of what it said.',
      empty: 'No messages yet.',
      waitingHeading: 'Waiting for you',
      /*
       * THE ANTI-PHISHING ANSWER (REQ-PORT-06), and it works because the
       * patient got here by their own route. A reassuring sentence inside a
       * text message proves nothing — a forger writes those too. A list they
       * reached themselves does.
       */
      genuineQuestion: 'Is this message genuine?',
      genuineAnswer: 'If it is listed here, it came from your practice through AoBPlatform.',
      /*
       * THE SECOND HALF OF THE ANSWER (Carl, 4 Sep 2026). The listing above
       * proves a message we DID send; this proves one we did NOT. Every
       * genuine message about this record quotes the same id that is at the
       * top of this page and in the password manager beside the passkey, so a
       * message without it is not ours -- a check the reader can apply on
       * their phone, to a message we never see.
       */
      recordIdCheck: (id: string) =>
        `Every genuine message from us quotes your record ID ${id}. If a message about your record does not, `
        + 'do not act on it — ask your practice.',
      purposes: {
        signature_request: 'Asking you to sign an agreement',
        capture_request: 'Asking you to sign an agreement',
        portal_invitation: 'The invitation to this page',
        agreement_copy: 'Your copy of an agreement',
        reminder: 'A reminder to sign',
        notice_89aa: 'A Medicare claim notice',
        termination_notice: 'Notice that an agreement has ended',
      } as Record<string, string>,
      channels: {
        sms: 'Text message',
        email: 'Email',
        letter: 'Letter',
      } as Record<string, string>,
      states: {
        queued: 'Waiting to be sent',
        sent: 'Sent',
        delivered: 'Delivered',
        failed: 'Could not be delivered',
        stopped: 'Stopped at your request',
      } as Record<string, string>,
    },

    /* ---------------------------------------------------------------- 7 */
    people: {
      heading: 'People who act for me, and people I act for',
      lead: 'Somebody can sign a bulk-billing agreement for you, and you can sign for somebody else.',
      actsForMeHeading: 'People who can act for me',
      actsForMeEmpty: 'Nobody acts for you.',
      iActForHeading: 'People I act for',
      iActForEmpty: 'You do not act for anybody.',
      since: (when: string) => `since ${when}`,
      removeAction: 'Remove',
      removed: 'Removed.',
      /*
       * THE WORDS FOR THE VERSIONED RELATIONSHIP LIST, keyed by the key in
       * `packages/domain/content/assignor-relationships.json` (hard rule 14).
       * A key with no word renders its own key, which is ugly and visible —
       * the right failure for a missing translation.
       */
      relationshipNames: {
        father: 'Father',
        mother: 'Mother',
        spouse: 'Spouse',
        carer: 'Carer',
        grandparent: 'Grandparent',
        family_member: 'Family member',
        friend: 'Friend',
        other: 'Other',
      } as Record<string, string>,
      confirmTitle: 'Remove this person?',
      confirmBody: (name: string) => `${name} will no longer be able to sign a bulk-billing agreement for you.`,
      /*
       * NO REASON IS ASKED FOR, AND THE DIALOG SAYS SO. Where a relationship
       * has gone wrong, being asked to justify this is worse than unhelpful.
       */
      confirmNoReason: 'You do not need to give a reason.',
      confirmAction: 'Remove them',
    },

    /* ---------------------------------------------------------------- 8 */
    data: {
      heading: 'What happens to my data',
      whatWeHold: 'We hold your name, date of birth, address, mobile and email as your practice gave them to us, the bulk-billing agreements you are part of, and a record of every message we sent you.',
      whyWeHold: 'We hold it for one reason: to make and keep the record that you agreed to bulk billing, and to prove it later if anybody asks. We hold nothing about your health.',
      whoSeesIt: 'Your practice sees its own record of you and nothing from any other practice. We never sell it, and we never use it for advertising.',
      /*
       * WRITTEN BY CARL, 4 SEPTEMBER 2026, and sourced rather than inferred.
       * REQ-REG-09 (aob-requirements.md line 110): "2 years from the date of
       * the related claim — not from the service date". The placeholder that
       * stood here until now was the right answer while nobody had read that
       * line; it is the wrong answer once somebody has.
       *
       * THE ANCHOR IS AN EVENT WE MAY NOT OBSERVE (REQ-INT-04). The sentence
       * therefore says what the law requires of the practice, which is true
       * whatever our claim linkage turns out to see — it does not promise a
       * deletion date this platform can compute today. How the retention
       * module handles an unobserved claim is its own item (TODO.md).
       *
       * Held word-for-word by `portal_data_retention_is_not_invented`.
       */
      retentionPeriod:
        'We keep the record of each bulk-billing agreement for two years from the date of the related Medicare claim, as the law requires. After that it is destroyed or de-identified.',
      yourRights: 'You can ask your practice to correct anything it holds about you, and you can end an ongoing agreement from this page at any time.',
      accessLogHeading: 'Who has looked',
      accessLogLead: 'Every time somebody opens or changes your record, it is written down. This is that list.',
      accessLogEmpty: 'Nothing has happened to your record yet.',
      actors: {
        practice_staff: 'Practice staff',
        patient: 'You',
        system: 'AoBPlatform',
      } as Record<string, string>,
      /*
       * WHAT HAPPENED, IN WORDS. An unmapped key shows as its own code so it
       * can be read out to support rather than disappearing — the "shortcuts
       * to the answer" principle applied to a timeline (Carl, 4 Sep 2026).
       */
      actions: {
        record_viewed: 'Looked at your record',
        details_corrected: 'Corrected one of your details',
        correction_requested: 'Asked the practice to correct a detail',
        agreement_created: 'Started an agreement',
        agreement_signed: 'Signed an agreement',
        agreement_viewed: 'Looked at a signed agreement',
        agreement_terminated: 'Ended an ongoing agreement',
        message_sent: 'Sent you a message',
      } as Record<string, string>,
    },

    /* ---------------------------------------------------------------- 9 */
    later: {
      heading: 'Coming later',
      lead: 'Not built yet, and named here so you know they are missing rather than hidden.',
      appointments: 'Your appointments',
      referrals: 'Your referrals',
    },

    /* --------------------------------------------------------------- 10 */
    /*
     * SIGN-IN AND SECURITY — FR-8.2 passkeys (Carl, 4 Sep 2026).
     *
     * "PASSKEY" IS THE ONE PIECE OF JARGON, and it is unavoidable: it is the
     * word the patient's own phone will use in the prompt, so a page that
     * called it something friendlier would be teaching a term that does not
     * appear anywhere else in the ceremony. Everything around it is plain:
     * face, fingerprint, PIN, phone. No "authenticator", no "credential", no
     * "WebAuthn", no "biometrics".
     *
     * NOTHING HERE PROMISES SECURITY IT CANNOT DELIVER, and nothing claims a
     * certification of any kind (hard rule 12). It says what happens, not how
     * safe it is.
     *
     * THE TWO SENTENCES THAT MATTER MOST ARE `optional` AND `lastOne`. Portal
     * access is never a precondition of anything (REQ-PORT-08), so the offer
     * has to read as an offer; and removing the last passkey is allowed, so
     * the warning before it has to say what happens next rather than trying to
     * talk somebody out of it.
     */
    passkeys: {
      heading: 'Sign-in and security',
      lead: 'How you get back into this page next time.',
      optional: 'This is optional. You never need it to sign a bulk-billing agreement, and you can remove it at any time.',
      /*
       * WHAT A PASSKEY IS, IN ONE SENTENCE A PERSON CAN PICTURE. Not "a
       * public-key credential bound to this origin" — the thing they will
       * actually experience is their own phone asking for their face.
       */
      whatItIs: 'A passkey lets you open this page with the same face, fingerprint or PIN you use to unlock your phone. There is no password to remember, and nothing to type.',
      whereItLives: 'The passkey stays on your own phone or computer. We only keep the part that lets us check it, and we can never use it to unlock anything of yours.',
      addAction: 'Add a passkey',
      addBusy: 'Waiting for your phone…',
      labelLabel: 'What should we call this device? (optional)',
      labelPlaceholder: 'My phone',
      addFailed: 'That did not work. Your phone or browser may have cancelled it — you can try again, and nothing has changed.',
      unsupported: 'This browser cannot use passkeys. You can still open this page the way you did today.',
      empty: 'You have not added a passkey yet.',
      unnamed: 'Unnamed device',
      added: (when: string) => `Added ${when}`,
      lastUsed: (when: string) => `Last used ${when}`,
      neverUsed: 'Not used yet',
      removeAction: 'Remove',
      removeFailed: 'That could not be removed just now. Nothing has changed — please try again.',
      confirmTitle: 'Remove this passkey?',
      confirmBody: (name: string) => `${name} will no longer open this page.`,
      /*
       * REMOVING THE LAST ONE IS ALLOWED (REQ-PORT-08). The sentence says what
       * happens afterwards, so the decision is informed rather than blocked —
       * and it says the route back, which is the practice, not us.
       */
      lastOne: 'This is your only passkey. After you remove it, you will need a new invitation from your practice to open this page again. Your agreements and your care are not affected.',
      confirmAction: 'Remove it',
      /* The signed-out control. Shown only where the browser can do it. */
      signInAction: 'Sign in with your passkey',
      signInBusy: 'Waiting for your phone…',
      signInFailed: 'That did not work. If you have not added a passkey yet, ask your practice for a new invitation.',
    },
  },
} as const;

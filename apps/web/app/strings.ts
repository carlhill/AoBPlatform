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
import { CONTACT_CLASH_MESSAGES } from '@aobplatform/domain';

export const strings = {
  appName: 'AoBPlatform',
  auth: {
    signIn: 'Sign in with your passkey',
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
      'This becomes where we send everything about the practice, and the passkeys enrolled against the old '
      + 'address stop working. We will send you a link to set up your own.',
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
    bannerText: 'You are acting as {practice}. Everything you do is recorded against you and them.',
    end: 'Stop acting as them',
    ending: 'Stopping…',
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
    filterKind: 'Kind',
    anyKind: 'Any kind',
    notLoaded: 'The review queue could not be read',
    emptyTitle: 'Nothing to look at',
    emptyBody: 'No changes are waiting. An empty queue is the normal state.',
    highStakes: 'A person must decide',
    lowStakes: 'May be checked automatically',
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
    resending: 'Sending…',
    resendTitle: 'Send this again',
    resendBody:
      'This copies the message and queues the copy. The original stays exactly as it is — including if it failed, because that attempt really did happen.',
    resendReason: 'Why are you sending it again?',
    resendReasonHint: 'Optional, and it is what the next person reads.',
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
    checkedByUsTitle: 'AoBPlatform checks the register, not you',
    checkedByUsBody:
      'A register check is our evidence that somebody independent looked. It is what turns a typed-in ' +
      'registration number into something with weight, so a practice checking its own practitioner would ' +
      'be awarding itself the check. Add them here and enter their AHPRA number — we do the rest, and ' +
      'nothing is needed from you unless we ask.',
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
    kioskTitle: 'Kiosk',
    kioskState: 'Not built yet',
    kioskBody:
      'A tablet at reception for patients who are already in the building. Nothing to pair yet — this is ' +
      'listed so the card is honest about what exists, rather than quietly leaving it out.',
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
} as const;

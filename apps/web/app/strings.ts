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
  review: {
    navQueue: 'Queue',
    audience: 'Reviewer',

    queueTitle: 'Applications waiting on a person',
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
  setup: {
    audience: 'Practice admin',
    title: 'Set up',
    approvedBy: 'Approved by',
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
    noPracticeBody:
      'This page shows the setup for one practice, and none is currently selected \u2014 or the one that was ' +
      'selected no longer exists. Once platform sign-in is in place the practice comes from your session and ' +
      'this will not happen.',

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
} as const;

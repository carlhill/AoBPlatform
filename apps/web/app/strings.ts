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

export const strings = {
  appName: 'AoBPlatform',
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
     * THE CODE, SHOWN ONCE. The screen says so, because a code that cannot be
     * fetched again is a surprise unless it was announced — and the way out of
     * having lost it is Rotate, which is named here rather than left to be
     * discovered.
     */
    codeHeading: 'Type this code into the tablet',
    codeShownOnce: 'This code is shown once. If it is lost, rotate the tablet for a new one.',
    codeWhere: 'On the tablet, open /kiosk and enter the code.',
    codeExpires: (minutes: number) =>
      minutes <= 0
        ? 'This code has expired. Rotate the tablet for a new one.'
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

    rotateAction: 'Rotate',
    rotateConfirm: (label: string) =>
      `Rotate ${label}? Its current credential stops working immediately and you will get a new code to type `
      + 'into it.',
    rotateConfirmAction: 'Rotate and show a new code',
    rotating: 'Rotating…',

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
    signingLabel: 'Signing',
    signingPatient: 'The patient',
    signingOther: (name: string, relationship: string) => (relationship ? `${name} · ${relationship}` : name),
    signingUnset: 'Not decided yet',
    onTabletNow: (label: string) => `On ${label} now`,
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
    whoContactHint: 'A mobile or an email, so their copy of the agreement can reach them.',
    whoMobile: 'Mobile',
    whoEmail: 'Email',
    whoSave: 'Save who is signing',
    whoSaving: 'Saving…',
    whoSaved: 'Saved.',
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
    tabletRevoked: 'Revoked — rotate it under Tablets to bring it back',
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
    } as Record<string, string>,

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
    correctSave: 'Save the correction',
    correctSaving: 'Saving…',
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
      /** "Reception tablet 1 is still showing Jamie Sampleton — recall it to send this one." */
      device_busy: (deviceLabel: string, patientName: string) =>
        `${deviceLabel} is still showing ${patientName} — recall it to send this one.`,
      /** Used only when a busy refusal cannot be matched to a live session by id or by device. */
      device_busySomeone: 'another patient',
      agreement_not_found: 'That agreement is no longer available.',
      agreement_not_pushable: 'This agreement has moved on and cannot be sent to a tablet.',
      service_description_missing:
        'This agreement still needs a description of the service, chosen from the current list — the tablet '
        + 'never asks a patient for it.',
      who_is_signing_unset:
        'Say who is signing before you send this one — use “Who is signing?” on this row.',
      patient_confidential:
        'This patient’s record is flagged confidential, so nothing about them goes on a waiting-room screen. '
        + 'Take this one on paper or after the service.',
      enduring_not_supported:
        'Enduring agreements cannot be sent to a tablet yet. Offer an episodic agreement for this visit.',
      /** A code this build has not met yet. Shown, never swallowed (Carl, 4 Sep 2026). */
      other: (code: string) => `Could not send (${code}). Please tell support this code.`,
      /** The rarer case of a refusal that carries no code at all — the server's own sentence, as it came. */
      otherNoCode: 'Could not send. Please tell support what you were doing.',
    },

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

    /**
     * ENDURING IS GP-ONLY (REQ-END-01/-01a, hard rule 6). Per practitioner ×
     * patient, never per practice, and never offered for a specialist, allied
     * health or optometry — the offer there is a Treatment Plan Assignment.
     */
    enduringGpOnly:
      'Enduring agreements are for general practitioners only. For this provider, offer an episodic '
      + 'agreement or a Treatment Plan Assignment.',
  },

  kiosk: {
    /** The wordmark in the tablet's footer. Repeated here so the ceremony reads one namespace. */
    appName: 'AoBPlatform',
    chrome: {
      stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
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
      consentText:
        'I assign my right to the Medicare benefit for the service described above to the provider named '
        + 'above, who accepts that assigned benefit as full payment for that service.',
      versions: (ruleSet: string, mapping: string) => `Rule set ${ruleSet} · mapping ${mapping}`,
      hashLine: (hash: string) => `SHA-256 ${hash}`,
      tagNoAmount: 'No amount shown',
      tagNoProviderSignature: 'No provider signature field',
      tagHashBeforeSigning: 'Hash written before signing',
      validating: 'Checking the details…',
      validatedHeading: 'Ready to sign',
      validatedBody: 'Particulars are locked. Changing one voids this render and produces a new hash.',
      /** THE ONE PRIMARY ON K-3. Reading is a step; signing is the next one. */
      continueToSign: 'Continue to sign',
      continueNotReady: 'Continue to sign — not ready yet',
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
      footer: 'Checked against the s 65C data set',
    },

    signature: {
      heading: 'Sign here',
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
      failed: 'Your signature was not recorded. Please see reception — your appointment is not affected.',
      footer: 'Vector and raster capture · tap-to-approve offered where signing on glass is difficult',
    },

    complete: {
      heading: (givenName: string) => `Signed. Thank you, ${givenName}.`,
      body: 'Reception has been told you are ready. A copy is on its way to you.',
      done: 'Done',
      returning: (seconds: number) => `Returns to the start in ${seconds}s`,
      writeBackQueued: 'Being written back to the practice system',
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

    /**
     * THE VERSION BANNER SUPPORT CAN READ (TODO.md "Zero-footprint kiosk").
     * Small, in the footer, and the only reason it is on a patient-facing
     * screen at all: when a practice rings up, the first question is which
     * build the tablet is running, and the alternative is asking somebody to
     * find it in a browser menu.
     */
    build: (build: string) => `build ${build}`,
  },
} as const;

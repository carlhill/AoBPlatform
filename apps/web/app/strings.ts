/**
 * String table (REQ-LANG-01): every user-facing string lives here, none
 * inline in components. en-AU only for now; the multilingual pipeline (M14)
 * replaces this module with the real string-table architecture — keeping the
 * discipline from the first screen means no inline-string hunt later.
 * UK/AU spelling throughout (CLAUDE.md §3).
 */
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
  org: {
    heading: 'Practice onboarding',
    intro:
      'Three gates, in order: the ABN checksum (offline), the ABR (must be ACTIVE, and the name must match), ' +
      'then a named human. The first two are necessary and not sufficient.',
    // Step 1
    registerHeading: '1. Register the practice',
    nameLabel: 'Practice name (legal OR trading name)',
    abnLabel: 'ABN',
    registerButton: 'Register',
    offlineNote:
      'ABN lookup runs offline against fixtures in this environment, so only these resolve: 53004085616 ' +
      '(company, trades under another name), 51824753556 (sole trader, no ACN), 13824753558 (CANCELLED).',
    attestHeading: 'The ABR could not be reached — record what you saw instead',
    attestNote:
      'Open abr.business.gov.au in another tab, search this ABN, and type in what the register shows. Every ' +
      'gate still runs against these values: the ABN must be ACTIVE, the practice name must match one of the ' +
      'registered names, and a company must still yield an ACN. What changes is only who looked — and the ' +
      'record says it was you, so the reviewer approving this practice can weigh it accordingly.',
    attestLegalName: 'Entity name, exactly as the ABR shows it',
    attestTradingNames: 'Registered business names (comma separated, optional)',
    attestStatus: 'ABN status',
    attestEntityType: 'Entity type',
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
    resumeHeading: 'Or resume a practice you have already approved',
    resumeNote:
      'A validated practice leaves the queue, so it cannot be picked from there again. Paste its id — there is ' +
      'deliberately no "list every practice" endpoint, because that is the same enumeration risk the ' +
      'practitioner directory refuses.',
    resumeLabel: 'Practice id',
    resumeButton: 'Resume',
    clearButton: 'Clear selection',
    // Step 3
    locationsHeading: '3. Locations',
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
    practitionersHeading: '4. Practitioners',
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
    locationSelectLabel: 'Location',
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

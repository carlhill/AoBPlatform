/**
 * The kiosk string table (REQ-LANG-01). Every user-facing word on this device
 * is here; none is inline in a component, and `check-strings.mjs` fails the
 * lint if one appears in a `<Text>`.
 *
 * TWO RULES ARE ENFORCED OVER THIS FILE, both by that same script:
 *
 *   NO "certified", "approved", "accredited" or "government-approved" about
 *   our forms (REQ-65C-05, hard rule 12). The permitted phrasings are
 *   "checked against the s 65C data set" and "self-assessment", and they are
 *   used below. A form that claims a government blessing it does not have is
 *   the one piece of copy in this product that could not be walked back.
 *
 *   NO DOLLAR AMOUNT anywhere (REQ-REG-04, hard rule 4). Not a fee, not a
 *   benefit, not a gap. The 89AA notice is the one artefact in the platform
 *   that carries one and the kiosk never shows an 89AA notice.
 *
 * UK/AU spelling throughout (CLAUDE.md §3). "Provider", not GP; "service",
 * not consult; "assignor" is never silently called the patient.
 *
 * `identifierNames` is read dynamically by type — the server sends
 * `identifierTypes` and the screen renders from that list, so a type with no
 * entry here would render its raw key rather than nothing. Only the approved
 * six have entries, deliberately: there is no key for a card number because
 * there is no field for one (REQ-VER-02).
 */

export const strings = {
  appName: 'AoBPlatform',

  chrome: {
    stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
    stepDetails: 'your details',
    stepSigning: 'who is signing',
    complete: 'Complete',
    allSynced: 'All signatures synced',
    offlineQueued: (count: number) =>
      count === 1 ? '1 signature waiting to send' : `${count} signatures waiting to send`,
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
  },

  idle: {
    heading: 'Checking in?',
    lede: 'Tap below to confirm your details and read your bulk-billing consent. Our staff can help at any point.',
    start: 'Start check-in',
    waitingCount: (count: number) =>
      count === 1 ? '1 person is ready to check in' : `${count} people are ready to check in`,
    nobodyWaiting: 'Nobody is waiting to check in just now.',
    listHeading: 'Who is checking in?',
    listHint: 'Tap your name. If it is not here, please see reception.',
    walkIn: 'No appointment time',
    backToIdle: 'Back',
    loadFailed: 'The list could not be loaded. Please see reception — your appointment is not affected.',
    retry: 'Try again',
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
    identifierHints: {
      /*
       * YYYY-MM-DD, because that is what the server compares against: it takes
       * the first ten characters of the stated value and matches them against
       * the ISO date it holds. A hint that said DD/MM/YYYY would be a field
       * that could never match, and the screen would only ever say 'some
       * details don't match' — with no way for anyone to find out why.
       */
      date_of_birth: 'YYYY-MM-DD',
      address: 'Street, suburb and postcode',
    } as Record<string, string>,
  },

  assignor: {
    heading: 'Who is signing today?',
    self: (patientName: string) => `${patientName} — I am signing for myself`,
    other: (patientName: string) => `Someone else is signing for ${patientName}`,
    panelHeading: 'If someone else signs',
    otherName: 'Their full name',
    otherRelationship: 'Relationship',
    /** Composed from MIN_AGE_ASSIGN_FOR_OTHER — the threshold is never typed here. */
    otherAgeConfirm: (minimumAge: number) => `They are ${minimumAge} or over`,
    continueAction: 'Continue',
    /**
     * NEUTRAL REFUSAL COPY. It does not explain the rule to the patient, does
     * not say "staff", and does not accuse anybody of anything — it points at
     * the desk and stops (REQ-VUL-04).
     */
    blockedHeading: 'Please ask our reception staff',
    blockedBody:
      'This consent needs to be signed by the patient or by someone from outside the practice. '
      + 'Please ask our reception staff.',
    tooYoungSelf: 'Please ask our reception staff to continue this with you.',
    tooYoungOther: 'Please ask our reception staff to continue this at the desk.',
    detailsNeeded: 'Please give their name and relationship.',
    handoverHeading: 'Please ask our reception staff',
    handoverBody:
      'Someone else signing for the patient is completed at the desk, so the practice can record who they '
      + 'are. Your appointment is not affected.',
    railAgeKicker: 'Age gates',
    railAgeBody:
      'A patient of the qualifying age or over may sign for themselves. Anyone signing for another person '
      + 'must be of full age — checked before the branch continues.',
    railAbsentKicker: 'Not on this screen',
    railAbsentBody:
      'No capacity question, and nothing that asks staff to judge whether the patient can consent.',
  },

  particulars: {
    heading: 'Assignment of benefit — please read',
    documentTitle: 'Assignment of Medicare benefit',
    patient: 'Patient',
    provider: 'Provider',
    placeOfPractice: 'Place of practice',
    serviceDate: 'Date of service',
    service: 'Service',
    agreementDate: 'Date of this agreement',
    assignor: 'Signing',
    assignorIsPatient: 'The patient is signing',
    assignorIsOther: (name: string, relationship: string) => `${name} · ${relationship}`,
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
    blockedHeading: (count: number) =>
      count === 1 ? '1 detail still needed' : `${count} details still needed`,
    askStaff: 'Ask a staff member to fix these',
    /*
     * D6a, entered by a person, because no mapping exists to draw it from
     * (plan §2.4; hard rule 14 forbids hardcoding one here).
     */
    staffDescriptionLabel: 'Basic description of the service — staff entry',
    staffDescriptionHint: 'For example: general practitioner attendance',
    staffDescriptionAction: 'Check again',
    continueToSign: 'Continue to sign',
    lockFailed:
      'This agreement is not ready to sign. Please see reception — your appointment is not affected.',
    footer: 'Checked against the s 65C data set',
  },

  signature: {
    heading: 'Sign here',
    validatedBanner: 'All particulars are complete and locked. Checked against the s 65C data set.',
    padHint: 'Sign with your finger above this line',
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
    queuedBody: 'This tablet is offline. Your signature is stored here and will be sent as soon as it can.',
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
} as const;

export type KioskStrings = typeof strings;

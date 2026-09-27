# INVENTORY.md — what AoBPlatform already exports

**Generated. Do not edit by hand — run `npm run inventory`.** The staleness guard (`node scripts/dev/inventory.test.mjs`, wired into `npm run lint`) fails when this file and the source tree disagree.

This is required reading before you write a component, a hook or a helper (wow.md §10). Search it for the noun you are about to build. The thing at the top of a section is the thing you should probably be using.

## How to read it

- **Used by** is the number of other files that import the symbol, then up to three of them. Sections are sorted most-imported first, because that is the answer to "what should I be using".
- **What it is** is the first sentence of the symbol's own comment, quoted, never composed. `(file)` marks a description taken from the file's header comment because the symbol shares the file's name and has no comment of its own. An empty cell means the export carries no comment — that is a gap in the code, not in this file.
- Tests, `.d.ts`, generated Prisma output, `node_modules` and `.next` are excluded, and so are test files as importers — a count here is production reuse.
- Paths are shortened: `web:` = `apps/web/app/`, `domain:` = `packages/domain/src/`, `contracts:` = `packages/contracts/src/`, `core:` = `apps/core/src/`, and the same for `rules:`, `vault:`, `connector:`, `vault-client:`, `auth-client:`.
- Barrels (`index.ts`) are not listed. An import of a domain helper through `@aobplatform/domain` is credited to the file that declares it.
- No line numbers, deliberately: they would change on every edit above a symbol and the staleness guard would fire on work that added nothing. Search the file for the name.

## Totals

| | Count |
|---|---|
| Exported symbols indexed | 2245 |
| Files scanned for exports | 541 |
| Files scanned for imports | 583 |
| Exports with no comment of their own | 961 |
| Exports imported nowhere else | 934 |

## Sections

- [Web components](#web-components) — 228
- [Web hooks](#web-hooks) — 15
- [Web helpers and constants](#web-helpers-and-constants) — 288
- [Web types](#web-types) — 108
- [Domain functions](#domain-functions) — 388
- [Domain constants and content](#domain-constants-and-content) — 244
- [Domain types](#domain-types) — 284
- [Contracts types](#contracts-types) — 91
- [Contracts functions and constants](#contracts-functions-and-constants) — 25
- [Core services, controllers and modules](#core-services-controllers-and-modules) — 278
- [Core helpers, constants and types](#core-helpers-constants-and-types) — 185
- [AOBPRINTER (the desktop print channel)](#aobprinter-the-desktop-print-channel-) — 111

## Web components

228 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `Notice` | web:ui/index.tsx |  | **66** · web:AccessGuard.tsx, web:HistoryDisclosure.tsx, web:NotFoundView.tsx, +63 more |
| `Shell` | web:ui/index.tsx |  | **56** · web:AccessGuard.tsx, web:NotFoundView.tsx, web:apply/ApplyForm.tsx, +53 more |
| `Button` | web:ui/index.tsx |  | **53** · web:ClearForm.tsx, web:HistoryDisclosure.tsx, web:apply/ApplyForm.tsx, +50 more |
| `SessionControl` | web:SessionControl.tsx | (file) Who is signed in, WHICH PRACTICE they are from, and the way out. | **46** · web:AccessGuard.tsx, web:apply/ApplyForm.tsx, web:help/HelpView.tsx, +43 more |
| `Chip` | web:ui/index.tsx | The text IS the status. | **34** · web:EmailStatusChip.tsx, web:apply/ApplyForm.tsx, web:apply/GateLedger.tsx, +31 more |
| `Field` | web:ui/index.tsx |  | **30** · web:apply/ApplyForm.tsx, web:platform/acting-as/history/HistoryView.tsx, web:practice/ActingAs.tsx, +27 more |
| `TextInput` | web:ui/index.tsx |  | **25** · web:apply/ApplyForm.tsx, web:platform/acting-as/history/HistoryView.tsx, web:practice/ActingAs.tsx, +22 more |
| `SelectInput` | web:ui/index.tsx |  | **22** · web:apply/ApplyForm.tsx, web:practice/ActingAs.tsx, web:practice/PracticePicker.tsx, +19 more |
| `ViewOnly` | web:platform/practices/[practiceId]/ViewOnly.tsx | (file) A practice page opened as the platform: readable, and genuinely inert. | **16** · web:platform/practices/[practiceId]/affiliations/page.tsx, web:platform/practices/[practiceId]/application/page.tsx, web:platform/practices/[practiceId]/channels/page.tsx, +13 more |
| `PracticeGate` | web:practice/PracticeGate.tsx | (file) "Which practice" resolved, with the two states that answer can be in. | **15** · web:practice/affiliations/page.tsx, web:practice/channels/page.tsx, web:practice/day/page.tsx, +12 more |
| `Screen` | web:kiosk/components/Chrome.tsx | Header, content and footer. | **12** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/CheckDetailsScreen.tsx, web:kiosk/screens/CompleteScreen.tsx, +9 more |
| `Blueprint` | web:kiosk/components/Chrome.tsx |  | **11** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/CheckDetailsScreen.tsx, web:kiosk/screens/HandoverScreen.tsx, +8 more |
| `Card` | web:patient/portal/portal-ui.tsx |  | **9** · web:patient/portal/cards/AgreementsCard.tsx, web:patient/portal/cards/DataCard.tsx, web:patient/portal/cards/DetailsCard.tsx, +6 more |
| `CardState` | web:patient/portal/portal-ui.tsx | Loading, failed, or empty — the three answers that are not data. | **9** · web:patient/portal/cards/AgreementsCard.tsx, web:patient/portal/cards/DataCard.tsx, web:patient/portal/cards/DetailsCard.tsx, +6 more |
| `Section` | web:ui/index.tsx |  | **9** · web:apply/ApplyForm.tsx, web:practice/devices/DevicesView.tsx, web:practice/entity/EntityView.tsx, +6 more |
| `Checkbox` | web:ui/index.tsx | ONE CHECKBOX, AND FROM 12 SEP 2026 IT ALSO WORKS IN A TABLE ROW. | **8** · web:apply/ApplyForm.tsx, web:patient/agree/[token]/AgreeView.tsx, web:practice/affiliations/AffiliationsView.tsx, +5 more |
| `PracticeOverride` | web:practice/usePractice.tsx |  | **7** · web:platform/practices/[practiceId]/application/page.tsx, web:platform/practices/[practiceId]/correspondence/page.tsx, web:platform/practices/[practiceId]/queue/page.tsx, +4 more |
| `GuardedButton` | web:kiosk/components/Buttons.tsx |  | **6** · web:kiosk/components/SignatureControl.tsx, web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/CheckDetailsScreen.tsx, +3 more |
| `PortalButton` | web:patient/portal/portal-ui.tsx | A BUTTON WITH A 44px TARGET, which is why this is not `Button` from `app/ui`. | **6** · web:patient/portal/PortalView.tsx, web:patient/portal/activate/[token]/ActivateView.tsx, web:patient/portal/cards/DetailsCard.tsx, +3 more |
| `PrimaryButton` | web:kiosk/components/Buttons.tsx |  | **6** · web:kiosk/screens/CompleteScreen.tsx, web:kiosk/screens/HandoverScreen.tsx, web:kiosk/screens/IdleScreen.tsx, +3 more |
| `SecondaryButton` | web:kiosk/components/Buttons.tsx |  | **6** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/CompleteScreen.tsx, web:kiosk/screens/IdleScreen.tsx, +3 more |
| `RecordId` | web:ui/index.tsx |  | **5** · web:practice/patients/NewAgreementPanel.tsx, web:practice/patients/PatientWorkView.tsx, web:practice/patients/PatientsQueueView.tsx, +2 more |
| `CeremonyHeading` | web:kiosk/components/Chrome.tsx | THE TWO LINES ON TOP OF EVERY PAGE OF THE CEREMONY (Carl, 7 Sep 2026, from testing the pushed flow: "on top of each page of this workflow it should say 'Agree to bulk billing'; on the next line it should say by who — Name of Person"). | **4** · web:kiosk/screens/CheckDetailsScreen.tsx, web:kiosk/screens/HandoverScreen.tsx, web:kiosk/screens/ParticularsScreen.tsx, +1 more |
| `ConfirmDialog` | web:patient/portal/portal-ui.tsx | ARE YOU SURE — for the three acts on this page that reach the server and change something: asking for a correction, ending an enduring agreement, and withdrawing somebody's authority. | **4** · web:patient/portal/cards/DetailsCard.tsx, web:patient/portal/cards/EnduringCard.tsx, web:patient/portal/cards/PasskeysCard.tsx, +1 more |
| `CorrectOutcomeNotice` | web:practice/tablet/pushDesk.tsx | The outcome of the last correction or resolution on this session, if any. | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `CorrectionPanel` | web:practice/tablet/pushDesk.tsx | THE CORRECTION PANEL — every detail, with the crossed ones MARKED (Carl, 4 Sep 2026: "just in case the patient says my mobile is also wrong but I ticked yes"). | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `Kicker` | web:kiosk/components/Chrome.tsx |  | **4** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/CheckDetailsScreen.tsx, web:kiosk/screens/ParticularsScreen.tsx, +1 more |
| `SessionActions` | web:practice/tablet/pushDesk.tsx | WHAT RECEPTION CAN DO TO A LIVE SESSION: take the screen back, correct the detail the patient crossed, say no change was needed, send it again. | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `SessionDisputeNotices` | web:practice/tablet/pushDesk.tsx | WHAT THE PATIENT SAID IS WRONG, AND WHETHER ANYBODY HAS ANSWERED IT. | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `SessionTag` | web:practice/tablet/pushDesk.tsx | The short id, in the one typeface it can be compared in. | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `Field` | web:kiosk/components/Field.tsx | (file) The kiosk's form controls. | **3** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/PairingScreen.tsx, web:kiosk/screens/VerifyScreen.tsx |
| `MessageLog` | web:correspondence/MessageLog.tsx | (file) One log, two audiences — the design handoff's M-1 and the Messages tab of P-1. | **3** · web:patient/messages/[token]/PatientMessagesView.tsx, web:practice/correspondence/CorrespondenceView.tsx, web:practitioner/messages/MessagesView.tsx |
| `PatientIdentity` | web:ui/index.tsx | WHO THIS ROW IS ABOUT, IN THE SAME TWO LINES ON EVERY SURFACE (Carl, 12 September 2026: *"patientid is diff on /tablet and /frontdesk"*, and then *"ok. | **3** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/tablet/pushDesk.tsx |
| `PractitionersView` | web:practice/practitioners/PractitionersView.tsx | (file) The practice's roster of practitioners. | **3** · web:platform/practices/[practiceId]/practitioners/check/page.tsx, web:platform/practices/[practiceId]/practitioners/page.tsx, web:practice/practitioners/page.tsx |
| `ReviewerGate` | web:review/ReviewerGate.tsx | (file) The reviewer's sign-in gate. | **3** · web:review/[id]/page.tsx, web:review/identity/page.tsx, web:review/page.tsx |
| `SendAgain` | web:practice/tablet/pushDesk.tsx | SEND IT AGAIN, ON THE ROW THAT SAID IT ENDED (Carl, 4 Sep 2026). | **3** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/patients/PatientWorkView.tsx, web:practice/tablet/TabletView.tsx |
| `SessionOutcomeNotice` | web:practice/tablet/pushDesk.tsx | The outcome of the last recall, re-send or send-again on this session. | **3** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/patients/PatientWorkView.tsx, web:practice/tablet/TabletView.tsx |
| `ActingAsBanner` | web:practice/ActingAs.tsx | The banner. | **2** · web:practice/PracticeList.tsx, web:practice/users/UsersView.tsx |
| `ActingAsStart` | web:practice/ActingAs.tsx | Starting one. | **2** · web:practice/PracticeList.tsx, web:practice/users/UsersView.tsx |
| `AffiliationsView` | web:practice/affiliations/AffiliationsView.tsx | (file) Affiliations — the edge between a practitioner and a place. | **2** · web:platform/practices/[practiceId]/affiliations/page.tsx, web:practice/affiliations/page.tsx |
| `AgreementBands` | web:practice/tablet/pushDesk.tsx | THE BANDS UNDER ONE AGREEMENT, AND THE PANEL THEY OPEN — the reason it cannot go with the fix in it, the outcome of the last press, and the who-is-signing form itself. | **2** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx |
| `AgreementRow` | web:practice/tablet/pushDesk.tsx | ONE AGREEMENT WAITING TO BE SIGNED, WITH EVERY CONTROL THAT ACTS ON IT. | **2** · web:practice/patients/PatientWorkView.tsx, web:practice/tablet/TabletView.tsx |
| `ApplicationView` | web:practice/application/ApplicationView.tsx | (file) The practice's own application, filled in. | **2** · web:platform/practices/[practiceId]/application/page.tsx, web:practice/application/page.tsx |
| `AuditTrail` | web:review/AuditTrail.tsx |  | **2** · web:practice/entity/EntityView.tsx, web:review/[id]/DossierView.tsx |
| `ChannelsView` | web:practice/channels/ChannelsView.tsx | (file) How consent requests reach patients, and what patients are asked. | **2** · web:platform/practices/[practiceId]/channels/page.tsx, web:practice/channels/page.tsx |
| `Checkbox` | web:kiosk/components/Field.tsx |  | **2** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/ParticularsScreen.tsx |
| `CorrespondenceView` | web:practice/correspondence/CorrespondenceView.tsx | (file) M-1 — every message sent in this practice's name (design handoff). | **2** · web:platform/practices/[practiceId]/correspondence/page.tsx, web:practice/correspondence/page.tsx |
| `DevicesView` | web:practice/devices/DevicesView.tsx | (file) THE PRACTICE'S TABLETS — where a waiting-room device is given its one credential, and where that credential is taken back. | **2** · web:platform/practices/[practiceId]/devices/page.tsx, web:practice/devices/page.tsx |
| `EmailStatusChip` | web:EmailStatusChip.tsx | (file) The status of an email address under verification — everywhere one is shown. | **2** · web:practice/application/ApplicationView.tsx, web:practitioner/PractitionerHub.tsx |
| `EntityView` | web:practice/entity/EntityView.tsx | (file) The practice's own dossier — everything the reviewer sees, in view mode. | **2** · web:platform/practices/[practiceId]/entity/page.tsx, web:practice/entity/page.tsx |
| `GateLedger` | web:apply/GateLedger.tsx | (file) The gate ledger. | **2** · web:apply/ApplyForm.tsx, web:status/[token]/StatusView.tsx |
| `HistoryDisclosure` | web:HistoryDisclosure.tsx | (file) "Show me the history of THIS row" — the pattern, once. | **2** · web:practice/affiliations/AffiliationsView.tsx, web:practice/practitioners/PractitionersView.tsx |
| `LocationsView` | web:practice/locations/LocationsView.tsx | (file) The places a practice works from. | **2** · web:platform/practices/[practiceId]/locations/page.tsx, web:practice/locations/page.tsx |
| `NewAgreementPanel` | web:practice/patients/NewAgreementPanel.tsx | (file) RECEPTION TYPES AN AGREEMENT BY HAND (Carl, 7 Sep 2026; PMS_to_AoB_Workflow.md case 4, row W2). | **2** · web:practice/patients/PatientWorkView.tsx, web:practice/patients/PatientsQueueView.tsx |
| `PatientWorkView` | web:practice/patients/PatientWorkView.tsx | (file) ONE PATIENT, EVERYTHING OPEN, ONE PAGE (TODO.md "Reception-centric: the patient work page", Carl 4 Sep 2026). | **2** · web:platform/practices/[practiceId]/patients/[patientId]/page.tsx, web:practice/patients/[patientId]/page.tsx |
| `PatientsQueueView` | web:practice/patients/PatientsQueueView.tsx | (file) PATIENTS — reception's queue, one row per person (TODO.md "Reception-centric: the patient work page", Carl 4 Sep 2026). | **2** · web:platform/practices/[practiceId]/patients/page.tsx, web:practice/patients/page.tsx |
| `PracticePicker` | web:practice/PracticePicker.tsx | (file) "Which practice?" — for screens a platform operator can reach without one. | **2** · web:practice/reviews/ReviewsView.tsx, web:practice/users/UsersView.tsx |
| `QueueView` | web:practice/queue/QueueView.tsx | (file) The outbound queue, for the people who operate it. | **2** · web:platform/practices/[practiceId]/queue/page.tsx, web:practice/queue/page.tsx |
| `ReconciliationView` | web:practice/reconciliation/ReconciliationView.tsx | (file) The reconciliation queue — every service billed without a stored agreement, ranked by days left on the twelve-month lodgement window (M7, REQ-REC-01). | **2** · web:platform/practices/[practiceId]/reconciliation/page.tsx, web:practice/reconciliation/page.tsx |
| `ReportsView` | web:practice/reports/ReportsView.tsx | (file) The packaged reports, answered by Cube. | **2** · web:platform/practices/[practiceId]/reports/page.tsx, web:practice/reports/page.tsx |
| `ReviewsView` | web:practice/reviews/ReviewsView.tsx | (file) The review queue — changes that need a second look. | **2** · web:platform/practices/[practiceId]/reviews/page.tsx, web:practice/reviews/page.tsx |
| `SelectField` | web:kiosk/components/Field.tsx |  | **2** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/VerifyScreen.tsx |
| `SendSteps` | web:practice/tablet/pushDesk.tsx | THE THREE STEPS, NUMBERED, WITH THE CONTROL EACH ONE NAMES DIRECTLY BENEATH IT (Carl, 10 Sep 2026, from a mock-up: "Who is signing over the Who is signing button, Choose a tablet over the select, Send over Send, an arrow between them"). | **2** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx |
| `SetupHub` | web:practice/setup/SetupHub.tsx | (file) The practice setup hub. | **2** · web:platform/practices/[practiceId]/page.tsx, web:practice/setup/page.tsx |
| `SummaryView` | web:practice/queue/SummaryView.tsx | (file) Queue totals — by practice, or by site and department. | **2** · web:practice/queuebyOrg/page.tsx, web:practice/queuebyOrgLocDepartment/page.tsx |
| `TabletView` | web:practice/tablet/TabletView.tsx | (file) SEND TO THE TABLET — reception's half of the push (TODO.md "Two front doors", Carl 4 Sep 2026). | **2** · web:platform/practices/[practiceId]/tablet/page.tsx, web:practice/tablet/page.tsx |
| `Tag` | web:kiosk/components/Chrome.tsx |  | **2** · web:kiosk/screens/IdleScreen.tsx, web:kiosk/screens/ParticularsScreen.tsx |
| `UsersView` | web:practice/users/UsersView.tsx | (file) The practice's own people. | **2** · web:platform/practices/[practiceId]/users/page.tsx, web:practice/users/page.tsx |
| `AccessGuard` | web:AccessGuard.tsx | (file) Enforcing the page map, and saying something useful when it refuses. | **1** · web:layout.tsx |
| `ActingAsHistory` | web:platform/acting-as/history/HistoryView.tsx |  | **1** · web:platform/acting-as/history/page.tsx |
| `ActingAsRegister` | web:platform/acting-as/ActingAsRegister.tsx | (file) Who is acting as which practice, and the way to stop it. | **1** · web:platform/acting-as/page.tsx |
| `ActivateView` | web:patient/portal/activate/[token]/ActivateView.tsx | (file) THE ACTIVATION PAGE — the door the invitation link opens (FR-1.14, REQ-PORT-08, REQ-PORT-06). | **1** · web:patient/portal/activate/[token]/page.tsx |
| `AddressDecision` | web:practice/locations/AddressDecision.tsx | The reviewer's decision: confirm with a method and evidence, or send it back with a reason. | **1** · web:practice/locations/LocationsView.tsx |
| `AddressEdit` | web:practice/locations/AddressDecision.tsx | The practice correcting its own address. | **1** · web:practice/locations/LocationsView.tsx |
| `AffiliationsView` | web:practitioner/affiliations/AffiliationsView.tsx | (file) A practitioner's affiliations, and leaving one. | **1** · web:practitioner/affiliations/page.tsx |
| `AgreeView` | web:patient/agree/[token]/AgreeView.tsx | (file) A patient approving their bulk-billing agreement, from the link we sent. | **1** · web:patient/agree/[token]/page.tsx |
| `AgreementCopyView` | web:patient/agreement-copy/[token]/AgreementCopyView.tsx | (file) WHERE A COPY LINK LANDS — W6, REQ-PORT-02, the s 65C copy-on-request obligation automated. | **1** · web:patient/agreement-copy/[token]/page.tsx |
| `AgreementsCard` | web:patient/portal/cards/AgreementsCard.tsx | (file) MY AGREEMENTS — every bulk-billing agreement this person is party to (REQ-PORT-01/-02). | **1** · web:patient/portal/PortalView.tsx |
| `ApplyForm` | web:apply/ApplyForm.tsx |  | **1** · web:apply/page.tsx |
| `AssignorScreen` | web:kiosk/screens/AssignorScreen.tsx | (file) K-5 — who is signing. | **1** · web:kiosk/Ceremony.tsx |
| `AuthGate` | web:AuthGate.tsx | (file) The console sign-in gate. | **1** · web:page.tsx |
| `BackLink` | web:BackLink.tsx | (file) Where "up" is, on every page that has an up. | **1** · web:ui/index.tsx |
| `BlockingRefusal` | web:ui/index.tsx | A modal, used ONLY for a blocking refusal. | **1** · web:apply/ApplyForm.tsx |
| `Ceremony` | web:kiosk/Ceremony.tsx | (file) The ceremony: verify → (who is signing) → locked particulars → sign → done. | **1** · web:kiosk/page.tsx |
| `CheckDetailsScreen` | web:kiosk/screens/CheckDetailsScreen.tsx | (file) K-P1 — "Please check your details", the first screen of the PUSHED ceremony (TODO.md "Two front doors", Carl 4 Sep 2026; redesigned to a tick and a cross per row on his ruling of the same day). | **1** · web:kiosk/Ceremony.tsx |
| `CheckRecorder` | web:review/CheckRecorder.tsx |  | **1** · web:review/[id]/DossierView.tsx |
| `ClearForm` | web:ClearForm.tsx | (file) "Clear the form" — the pattern, once. | **1** · web:practice/affiliations/AffiliationsView.tsx |
| `ComingLaterCard` | web:patient/portal/cards/ComingLaterCard.tsx | (file) COMING LATER — appointments and referrals, named and not built. | **1** · web:patient/portal/PortalView.tsx |
| `CompleteScreen` | web:kiosk/screens/CompleteScreen.tsx | (file) K-6 — done, and back to idle. | **1** · web:kiosk/Ceremony.tsx |
| `ConfirmBackupView` | web:practice/confirm-backup/ConfirmBackupView.tsx | (file) "Confirm this backup address" — the page the emailed link opens. | **1** · web:practice/confirm-backup/page.tsx |
| `ConfirmEmailView` | web:practice/confirm-email/ConfirmEmailView.tsx | (file) "Confirm your new administrator address" — the page the emailed link opens. | **1** · web:practice/confirm-email/page.tsx |
| `ConsoleDashboard` | web:ConsoleDashboard.tsx |  | **1** · web:page.tsx |
| `CorrectView` | web:status/[token]/correct/CorrectView.tsx |  | **1** · web:status/[token]/correct/page.tsx |
| `DataCard` | web:patient/portal/cards/DataCard.tsx | (file) WHAT HAPPENS TO MY DATA — the card Carl asked for by name (4 Sep 2026: "a patient will want to know what we do with all their data"). | **1** · web:patient/portal/PortalView.tsx |
| `DayView` | web:practice/day/DayView.tsx | (file) `/practice/day` — WHO CAME IN, ON ONE DAY (Carl, 12 September 2026, on `/practice/frontdesk`: *"Add a button here with a link to show all Patients seen at this practice today. | **1** · web:practice/day/page.tsx |
| `DetailsCard` | web:patient/portal/cards/DetailsCard.tsx | (file) MY DETAILS — what each practice holds, and how to get it corrected. | **1** · web:patient/portal/PortalView.tsx |
| `DossierView` | web:review/[id]/DossierView.tsx | (file) The reviewer's dossier — everything gate 3 needs, on one screen. | **1** · web:review/[id]/page.tsx |
| `EnduringCard` | web:patient/portal/cards/EnduringCard.tsx | (file) ONGOING BULK-BILLING AGREEMENTS, and the one control on this page the statute puts here (REQ-PORT-03/-05, REQ-END-06, FR-5.3). | **1** · web:patient/portal/PortalView.tsx |
| `FlagChip` | web:review/flags.tsx |  | **1** · web:review/QueueView.tsx |
| `FrontDeskView` | web:practice/frontdesk/FrontDeskView.tsx | (file) PRACTICE FRONTDESK — the queue rail and, from 12 September 2026, the whole of one patient's work in the panel beside it. | **1** · web:practice/frontdesk/page.tsx |
| `HandoverScreen` | web:kiosk/screens/HandoverScreen.tsx | (file) The one screen every dead end on this device ends at: "please see reception". | **1** · web:kiosk/Ceremony.tsx |
| `HelpView` | web:help/HelpView.tsx | (file) "You are signed in, and we cannot tell what you should see." | **1** · web:help/page.tsx |
| `IdentityDashboard` | web:review/identity/IdentityDashboard.tsx | (file) The two identity dashboards (IDENTITY-STRENGTH-DESIGN.md §7). | **1** · web:review/identity/page.tsx |
| `IdleScreen` | web:kiosk/screens/IdleScreen.tsx | (file) K-1 — idle. | **1** · web:kiosk/Ceremony.tsx |
| `InactivityWarning` | web:kiosk/components/InactivityWarning.tsx | (file) "Still there?" — the thirty seconds before the tablet returns to the start (Carl, 4 September 2026). | **1** · web:kiosk/Ceremony.tsx |
| `InvitationView` | web:invitation/[token]/InvitationView.tsx | (file) The practitioner answers an invitation. | **1** · web:invitation/[token]/page.tsx |
| `MainMenu` | web:MainMenu.tsx | (file) The menu, on every page. | **1** · web:ui/index.tsx |
| `MessagesCard` | web:patient/portal/cards/MessagesCard.tsx | (file) MESSAGES SENT TO ME — and the structural answer to phishing (REQ-PORT-06). | **1** · web:patient/portal/PortalView.tsx |
| `MessagesView` | web:practitioner/messages/MessagesView.tsx | (file) What has been sent to this practitioner, wherever they work. | **1** · web:practitioner/messages/page.tsx |
| `MovePanel` | web:practice/practitioner/waiting/MovePanel.tsx | (file) MOVE THE SELECTED PATIENTS TO ANOTHER PRACTITIONER — the sick-practitioner morning (Carl, 12 September 2026: *"the assigned practioner has called in sick... | **1** · web:practice/practitioner/waiting/WaitingView.tsx |
| `NotFoundView` | web:NotFoundView.tsx | (file) A page that does not exist, said plainly and then left behind. | **1** · web:not-found.tsx |
| `NoticesCard` | web:patient/portal/cards/NoticesCard.tsx | (file) MEDICARE CLAIM NOTICES — reg 89AA (REQ-PORT-04, REQ-END-05). | **1** · web:patient/portal/PortalView.tsx |
| `OrgConsole` | web:OrgConsole.tsx | (file) The organisation / location / practitioner / affiliation console (ORG-MODEL-PROPOSAL.md). | **1** · web:page.tsx |
| `OutOfUseScreen` | web:kiosk/screens/OutOfUseScreen.tsx | (file) THE SCREEN FOR "RECEPTION HAS TAKEN THIS TABLET OFF THE FLOOR" (Carl, 4–5 Sep 2026; TODO.md "Tablets: make one inactive from the send-to-tablet page"). | **1** · web:kiosk/Ceremony.tsx |
| `OutageScreen` | web:kiosk/screens/OutageScreen.tsx | (file) THE SCREEN FOR "CORE STOPPED ANSWERING" (TODO.md "Outage screen on the tablet", Carl 4 Sep 2026: "When the server is down, hide everything and say, Please contact reception."). | **1** · web:kiosk/Ceremony.tsx |
| `PairingScreen` | web:kiosk/screens/PairingScreen.tsx | (file) K-0 — PAIRING. | **1** · web:kiosk/Ceremony.tsx |
| `ParticularsScreen` | web:kiosk/screens/ParticularsScreen.tsx | (file) K-3 — the locked particulars, and the screen the REQ-REG-06 rule is really about. | **1** · web:kiosk/Ceremony.tsx |
| `PasskeysCard` | web:patient/portal/cards/PasskeysCard.tsx | (file) SIGN-IN AND SECURITY — FR-8.2's passkey half, on the patient's own page (Carl, 4 September 2026: "Implement"; D-2026-09-04-02). | **1** · web:patient/portal/PortalView.tsx |
| `PatientMessagesView` | web:patient/messages/[token]/PatientMessagesView.tsx | (file) P-1, Messages tab — the same log from the other side (design handoff). | **1** · web:patient/messages/[token]/page.tsx |
| `PeopleCard` | web:patient/portal/cards/PeopleCard.tsx | (file) PEOPLE WHO ACT FOR ME, AND PEOPLE I ACT FOR (REQ-PORT-07, FR-1.19/-1.23). | **1** · web:patient/portal/PortalView.tsx |
| `PlatformTemplatesView` | web:platform/templates/PlatformTemplatesView.tsx | (file) AGREEMENT WORDING REVIEW — the platform's side of `/practice/templates` (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1). | **1** · web:platform/templates/page.tsx |
| `PmsView` | web:practice/pms/PmsView.tsx | (file) The PMS connection — deliberately unfinished, and it says so. | **1** · web:practice/pms/page.tsx |
| `PortalView` | web:patient/portal/PortalView.tsx | (file) THE PATIENT'S OWN PAGE — C8, one route, ten cards (REQ-PORT-01..08). | **1** · web:patient/portal/page.tsx |
| `PracticeFilter` | web:patient/portal/cards/PracticeFilter.tsx | (file) SHOWING: ALL PRACTICES, OR ONE OF THEM (Carl, 5 Sep 2026). | **1** · web:patient/portal/PortalView.tsx |
| `PracticeList` | web:practice/PracticeList.tsx | (file) The practices this admin works with. | **1** · web:practice/page.tsx |
| `PracticeView` | web:practitioner/practices/[practiceId]/PracticeView.tsx | (file) A practice, as the BUSINESS publishes itself, shown to somebody who works there. | **1** · web:practitioner/practices/[practiceId]/page.tsx |
| `PractitionerHub` | web:practitioner/PractitionerHub.tsx | (file) A practitioner's own view: the four cards, and only their own scope. | **1** · web:practitioner/page.tsx |
| `PractitionerLandingView` | web:practice/practitioner/PractitionerLandingView.tsx | (file) `/practice/practitioner` — WHERE A PRACTITIONER LANDS WHEN THEY SIGN IN AT A PRACTICE (PRACTITIONER-QUEUE-PAGE.md §1; Carl, 12 September 2026). | **1** · web:practice/practitioner/page.tsx |
| `QueueView` | web:review/QueueView.tsx | (file) The human validation queue — gate 3. | **1** · web:review/page.tsx |
| `RefreshButton` | web:RefreshButton.tsx | (file) The refresh control in the top bar. | **1** · web:ui/index.tsx |
| `ReportView` | web:practice/queue/ReportView.tsx | (file) How much was sent, over time. | **1** · web:practice/queue/SummaryView.tsx |
| `ServiceDescriptionsNeeded` | web:practice/reconciliation/ServiceDescriptionsNeeded.tsx | (file) D6a, ON A STAFF SURFACE — the drafts that cannot be completed until somebody chooses the basic description of the service. | **1** · web:practice/reconciliation/ReconciliationView.tsx |
| `SignatureControl` | web:kiosk/components/SignatureControl.tsx | (file) THE REQ-REG-06 CONTROL. | **1** · web:kiosk/screens/SignatureScreen.tsx |
| `SignaturePad` | web:kiosk/components/SignaturePad.tsx | (file) Signing on glass — a `<canvas>` and pointer events, no drawing library and no new runtime dependency. | **1** · web:kiosk/screens/SignatureScreen.tsx |
| `SignatureScreen` | web:kiosk/screens/SignatureScreen.tsx | (file) K-4 — signing. | **1** · web:kiosk/Ceremony.tsx |
| `SmallDeskView` | web:practice/frontdesksmall/SmallDeskView.tsx | (file) THE FRONT DESK ON A SMALL SCREEN — one list, not five rails. | **1** · web:practice/frontdesksmall/page.tsx |
| `StatusView` | web:status/[token]/StatusView.tsx |  | **1** · web:status/[token]/page.tsx |
| `StopEmailChangeView` | web:practice/stop-email-change/StopEmailChangeView.tsx | (file) "Stop this change" — the page the warning links to. | **1** · web:practice/stop-email-change/page.tsx |
| `TemplateForm` | web:practice/templates/TemplateForm.tsx | (file) THE WORDING EDITOR — a form, not a box of JSON (Carl, 7 Sep 2026; W1). | **1** · web:practice/templates/TemplatesView.tsx |
| `TemplatePreview` | web:practice/templates/TemplatesView.tsx | The words, read-only, exactly as they are stored — placeholders and all. | **1** · web:platform/templates/PlatformTemplatesView.tsx |
| `TemplatesView` | web:practice/templates/TemplatesView.tsx | (file) WHAT THE AGREEMENT LOOKS LIKE, AND WHAT IT SAYS (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1, Q3/Q4). | **1** · web:practice/templates/page.tsx |
| `TodayView` | web:practice/today/TodayView.tsx | (file) `/practice/today` — THE DAY'S WORK, AND WHERE PRACTICE STAFF LAND (Carl, 12 September 2026; PRACTICE-NAVIGATION.md §2). | **1** · web:practice/today/page.tsx |
| `UnpairedScreen` | web:kiosk/screens/UnpairedScreen.tsx | (file) WHERE A REVOKED TABLET LANDS — mid-morning, possibly with a patient holding it. | **1** · web:kiosk/Ceremony.tsx |
| `VerifyScreen` | web:kiosk/screens/VerifyScreen.tsx | (file) K-2 — verification, and K-2b's mismatch and lockout states. | **1** · web:kiosk/Ceremony.tsx |
| `VerifyView` | web:verify/[token]/VerifyView.tsx | (file) Confirming an email address, in two phases. | **1** · web:verify/[token]/page.tsx |
| `VisitsCard` | web:patient/portal/cards/VisitsCard.tsx | (file) WHERE I HAVE BEEN — the practices and dates where a bulk-billing agreement was made. | **1** · web:patient/portal/PortalView.tsx |
| `WaitingView` | web:practice/practitioner/waiting/WaitingView.tsx | (file) `/practice/practitioner/waiting` — WHO IS WAITING, AND IS THEIR PAPERWORK DONE (PRACTITIONER-QUEUE-PAGE.md §3; Carl, 12 September 2026). | **1** · web:practice/practitioner/waiting/page.tsx |
| `ActingAsHistoryPage` | web:platform/acting-as/history/page.tsx |  | 0 |
| `ActingAsRegisterPage` | web:platform/acting-as/page.tsx | UNDER `/platform/`, unlike the three platform screens that live under `/practice/`. | 0 |
| `AffiliationsPage` | web:practice/affiliations/page.tsx |  | 0 |
| `AgreePage` | web:patient/agree/[token]/page.tsx |  | 0 |
| `AgreementCopyPage` | web:patient/agreement-copy/[token]/page.tsx |  | 0 |
| `ApplicationPage` | web:practice/application/page.tsx |  | 0 |
| `ApplyPage` | web:apply/page.tsx |  | 0 |
| `CallbackPage` | web:callback/page.tsx | (file) The OIDC redirect target. | 0 |
| `ChannelsPage` | web:practice/channels/page.tsx |  | 0 |
| `CheckPractitionersPage` | web:platform/practices/[practiceId]/practitioners/check/page.tsx | (file) The register-check WORKING page — the one door in the platform tree that is not view-only, and deliberately outside the read-only route above it. | 0 |
| `ConfirmBackupPage` | web:practice/confirm-backup/page.tsx | Suspense because the view reads useSearchParams, which Next requires to be inside a boundary during static generation. | 0 |
| `ConfirmEmailPage` | web:practice/confirm-email/page.tsx |  | 0 |
| `CorrectPage` | web:status/[token]/correct/page.tsx |  | 0 |
| `CorrespondencePage` | web:practice/correspondence/page.tsx |  | 0 |
| `D6aFix` | web:practice/tablet/pushDesk.tsx | THE FIX, IN THE BAND THAT STATES THE PROBLEM (Carl, 4 Sep 2026). | 0 |
| `DayRegisterPage` | web:practice/day/page.tsx | `/practice/day` — THE PRACTICE'S DAY REGISTER (Carl, 12 September 2026, on `/practice/frontdesk`: *"Add a button here with a link to show all Patients seen at this practice today. | 0 |
| `DevicesPage` | web:practice/devices/page.tsx | `/practice/devices` — the practice's paired tablets. | 0 |
| `EnduringOfferFix` | web:practice/tablet/pushDesk.tsx | THE OTHER FIX IN A BAND, AND THE ONE RECEPTION COULD NOT MAKE AT ALL (Carl, 5 Sep 2026; CLAUDE.md §7 "shortcuts to the answer", second instance). | 0 |
| `EntityPage` | web:practice/entity/page.tsx |  | 0 |
| `FrontDeskPage` | web:practice/frontdesk/page.tsx | `/practice/frontdesk` — Practice Frontdesk (Carl, 12 Sep 2026; FRONT-DESK-PAGE.md §11, "a separate route, linked from the setup hub"). | 0 |
| `FrontDeskSmallPage` | web:practice/frontdesksmall/page.tsx | `/practice/frontdesksmall` — the front desk on a small screen (Carl, 12 September 2026: *"If the Practice has small screens, we will need to go to a different design."*; SESSION-HANDOVER.md, "A proposal for the small-screen version"). | 0 |
| `HelpPage` | web:help/page.tsx |  | 0 |
| `Home` | web:page.tsx | (file) The root, which is a SIGNPOST rather than a destination. | 0 |
| `IdentityDashboardPage` | web:review/identity/page.tsx |  | 0 |
| `InvitationPage` | web:invitation/[token]/page.tsx |  | 0 |
| `KioskPage` | web:kiosk/page.tsx |  | 0 |
| `LegacyAgreePage` | web:agree/[token]/page.tsx | The patient's page lives under /patient, like every audience's pages live under their prefix (/practice, /practitioner, /platform). | 0 |
| `LocationsPage` | web:practice/locations/page.tsx |  | 0 |
| `NotFound` | web:not-found.tsx | Next's 404. Handed to the same component that handles a refused page, so "there is no such page" and "that page is not yours" look and behave alike — both say which it is, and both take somebody back to a page they can use. | 0 |
| `OfferEpisodic` | web:practice/tablet/pushDesk.tsx | "CREATE AGREEMENT FOR TODAY'S VISIT" — reception's one press after a patient declines an ongoing agreement (Carl, 4 Sep 2026; GA-PLAN B5). | 0 |
| `PatientMessagesPage` | web:patient/messages/[token]/page.tsx |  | 0 |
| `PatientPortalPage` | web:patient/portal/page.tsx | `/patient/portal` — the patient's own page (C8, M8). | 0 |
| `PatientWorkPage` | web:practice/patients/[patientId]/page.tsx | `/practice/patients/<id>` — one patient, everything open, one page. | 0 |
| `PatientsPage` | web:practice/patients/page.tsx | `/practice/patients` — the patients with something open today. | 0 |
| `PlatformTemplatesPage` | web:platform/templates/page.tsx | UNDER `/platform/`, for the reason `/platform/acting-as` gives: the three platform screens that live under `/practice/` are misleading paths and the access table has had to say so each time. | 0 |
| `PmsPage` | web:practice/pms/page.tsx |  | 0 |
| `PortalActivatePage` | web:patient/portal/activate/[token]/page.tsx | `/patient/portal/activate/<token>` — what the invitation actually opens (FR-1.14, REQ-PORT-08). | 0 |
| `PracticesPage` | web:practice/page.tsx |  | 0 |
| `PractitionerAffiliationsPage` | web:practitioner/affiliations/page.tsx |  | 0 |
| `PractitionerLandingPage` | web:practice/practitioner/page.tsx | `/practice/practitioner` — WHERE A PRACTITIONER LANDS WHEN THEY SIGN IN AT A PRACTICE (Carl, 12 Sep 2026; PRACTITIONER-QUEUE-PAGE.md §1). | 0 |
| `PractitionerMessagesPage` | web:practitioner/messages/page.tsx |  | 0 |
| `PractitionerPage` | web:practitioner/page.tsx |  | 0 |
| `PractitionerPracticePage` | web:practitioner/practices/[practiceId]/page.tsx |  | 0 |
| `PractitionerWaitingPage` | web:practice/practitioner/waiting/page.tsx | `/practice/practitioner/waiting` — WHO IS WAITING, AND IS THEIR PAPERWORK DONE (Carl, 12 Sep 2026; PRACTITIONER-QUEUE-PAGE.md §3). | 0 |
| `PractitionersPage` | web:practice/practitioners/page.tsx |  | 0 |
| `QueueByOrgPage` | web:practice/queuebyOrg/page.tsx |  | 0 |
| `QueueBySitePage` | web:practice/queuebyOrgLocDepartment/page.tsx |  | 0 |
| `QueuePage` | web:practice/queue/page.tsx |  | 0 |
| `ReconciliationPage` | web:practice/reconciliation/page.tsx |  | 0 |
| `RefusalOutcomeBody` | web:practice/tablet/pushDesk.tsx | ONE REFUSAL, RENDERED — the sentence, and whatever the reason carries: a link (`service_description_missing`, `agreement_not_pushable`, `device_revoked`, `device_not_paired`, `patient_confidential`) or a Recall button right in the band (`device_busy`). | 0 |
| `Registration` | web:kiosk/components/Chrome.tsx |  | 0 |
| `ReportsPage` | web:practice/reports/page.tsx |  | 0 |
| `ReviewDossierPage` | web:review/[id]/page.tsx |  | 0 |
| `ReviewQueuePage` | web:review/page.tsx |  | 0 |
| `ReviewsPage` | web:practice/reviews/page.tsx |  | 0 |
| `RootLayout` | web:layout.tsx |  | 0 |
| `SetupPage` | web:practice/setup/page.tsx |  | 0 |
| `StatusPage` | web:status/[token]/page.tsx |  | 0 |
| `StopEmailChangePage` | web:practice/stop-email-change/page.tsx |  | 0 |
| `TabletPage` | web:practice/tablet/page.tsx | `/practice/tablet` — "Send to the tablet". | 0 |
| `TemplatesPage` | web:practice/templates/page.tsx |  | 0 |
| `TodayPage` | web:practice/today/page.tsx | `/practice/today` — THE DAY'S WORK (Carl, 12 Sep 2026; PRACTICE-NAVIGATION.md §2). | 0 |
| `UsersPage` | web:practice/users/page.tsx |  | 0 |
| `VerifyPage` | web:verify/[token]/page.tsx |  | 0 |
| `ViewAffiliationsViewPage` | web:platform/practices/[practiceId]/affiliations/page.tsx | (file) AffiliationsView, seen as the platform rather than as the practice. | 0 |
| `ViewApplicationViewPage` | web:platform/practices/[practiceId]/application/page.tsx | (file) ApplicationView, seen as the platform rather than as the practice. | 0 |
| `ViewChannelsViewPage` | web:platform/practices/[practiceId]/channels/page.tsx | (file) ChannelsView, seen as the platform rather than as the practice. | 0 |
| `ViewCorrespondencePage` | web:platform/practices/[practiceId]/correspondence/page.tsx | (file) The practice's correspondence, seen as the platform: states, never bodies. | 0 |
| `ViewDevicesPage` | web:platform/practices/[practiceId]/devices/page.tsx | (file) DevicesView, seen as the platform rather than as the practice. | 0 |
| `ViewEntityViewPage` | web:platform/practices/[practiceId]/entity/page.tsx | (file) EntityView, seen as the platform rather than as the practice. | 0 |
| `ViewLocationsViewPage` | web:platform/practices/[practiceId]/locations/page.tsx | (file) LocationsView, seen as the platform rather than as the practice. | 0 |
| `ViewPatientWorkPage` | web:platform/practices/[practiceId]/patients/[patientId]/page.tsx | (file) One patient's work page, seen as the platform: readable, and genuinely inert. | 0 |
| `ViewPatientsPage` | web:platform/practices/[practiceId]/patients/page.tsx | (file) The patients work list, seen as the platform rather than as the practice. | 0 |
| `ViewPracticePage` | web:platform/practices/[practiceId]/page.tsx | (file) A practice's setup hub, READ-ONLY, as the platform. | 0 |
| `ViewPractitionersPage` | web:platform/practices/[practiceId]/practitioners/page.tsx | (file) A practice's practitioners, VIEW-ONLY, as the platform. | 0 |
| `ViewQueueViewPage` | web:platform/practices/[practiceId]/queue/page.tsx | (file) QueueView, scoped to one practice, seen as the platform. | 0 |
| `ViewReconciliationPage` | web:platform/practices/[practiceId]/reconciliation/page.tsx | (file) ReconciliationView, scoped to one practice, seen as the platform. | 0 |
| `ViewReportsViewPage` | web:platform/practices/[practiceId]/reports/page.tsx | (file) ReportsView, seen as the platform rather than as the practice. | 0 |
| `ViewReviewsViewPage` | web:platform/practices/[practiceId]/reviews/page.tsx | (file) ReviewsView, scoped to one practice, seen as the platform. | 0 |
| `ViewTabletPage` | web:platform/practices/[practiceId]/tablet/page.tsx | (file) TabletView, seen as the platform rather than as the practice. | 0 |
| `ViewUsersViewPage` | web:platform/practices/[practiceId]/users/page.tsx | (file) UsersView, seen as the platform rather than as the practice. | 0 |

## Web hooks

15 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `useRefreshable` | web:refresh.ts | Register this page's reload. | **29** · web:patient/portal/PortalView.tsx, web:patient/portal/activate/[token]/ActivateView.tsx, web:platform/acting-as/ActingAsRegister.tsx, +26 more |
| `usePractice` | web:practice/usePractice.tsx | (file) Which practice is this page about? | **9** · web:practice/PracticeGate.tsx, web:practice/application/ApplicationView.tsx, web:practice/correspondence/CorrespondenceView.tsx, +6 more |
| `useLiveRefresh` | web:useLiveRefresh.tsx | (file) Re-fetch a screen that is waiting on somebody else. | **4** · web:practice/affiliations/AffiliationsView.tsx, web:practice/queue/QueueView.tsx, web:practice/queue/SummaryView.tsx, +1 more |
| `usePushDesk` | web:practice/tablet/pushDesk.tsx | EVERYTHING RECEPTION CAN DO TO A TABLET, IN ONE PLACE — the fetches, the three-second poll, and the outcome of the last thing anybody pressed. | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `useSurfaceProfile` | web:surfaceProfile.ts | The practice's profile, and whether we know yet. | **4** · web:AccessGuard.tsx, web:MainMenu.tsx, web:practice/setup/SetupHub.tsx, +1 more |
| `useEffectivePractice` | web:effectivePractice.ts | The practice claim this browser effectively holds, and whether we know yet. | **3** · web:AccessGuard.tsx, web:BackLink.tsx, web:MainMenu.tsx |
| `usePendingRefresh` | web:EmailStatusChip.tsx | Reload automatically WHILE something is pending, and only then. | **2** · web:practice/application/ApplicationView.tsx, web:practitioner/PractitionerHub.tsx |
| `useAddressCatalogue` | web:practice/locations/AddressDecision.tsx |  | **1** · web:practice/locations/LocationsView.tsx |
| `useDayReads` | web:practice/frontdesksmall/useDayReads.ts | (file) THE TWO READS THE TABLET DESK DOES NOT MAKE — today's booking list and today's register — polled on the same three seconds `usePushDesk` uses. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `useDevBuildWatch` | web:kiosk/useDevBuildWatch.ts | (file) A DEV TAB NOTICES THAT THE SERVER IT LOADED FROM HAS GONE (Carl, 12 Sep 2026: "fix the dev kiosk build id so it reloads"). | **1** · web:kiosk/Ceremony.tsx |
| `useHasRefresh` | web:refresh.ts | Whether anything on this page can be refreshed. | **1** · web:RefreshButton.tsx |
| `useInactivityReset` | web:kiosk/useInactivityReset.ts | (file) RETURN TO THE START WHEN THE TABLET IS UNTOUCHED (Carl, 4 September 2026). | **1** · web:kiosk/Ceremony.tsx |
| `useKioskHeartbeat` | web:kiosk/useKioskHeartbeat.ts | (file) THE HEARTBEAT — one poll, on every screen, carrying the tablet's own state out and reception's instructions back (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat and Return to Begin"). | **1** · web:kiosk/Ceremony.tsx |
| `useTabletSession` | web:kiosk/useTabletSession.ts | (file) THE PUSHED SESSION POLL — the tablet's half of "send to the tablet" (TODO.md "Two front doors", Carl 4 Sep 2026). | **1** · web:kiosk/Ceremony.tsx |
| `useWaitingList` | web:kiosk/useWaitingList.ts | (file) The waiting-room poll (§9.4). | **1** · web:kiosk/Ceremony.tsx |

## Web helpers and constants

288 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `strings` | web:strings.ts | (file) String table (REQ-LANG-01): every user-facing string lives here, none inline in components. | **133** · web:AccessGuard.tsx, web:AuthGate.tsx, web:BackLink.tsx, +130 more |
| `apiHeaders` | web:auth.ts | Headers for a core API call: bearer when signed in, dev practice header otherwise. | **49** · web:ConsoleDashboard.tsx, web:HistoryDisclosure.tsx, web:OrgConsole.tsx, +46 more |
| `currentSession` | web:auth.ts |  | **35** · web:AccessGuard.tsx, web:AuthGate.tsx, web:BackLink.tsx, +32 more |
| `strings` | web:kiosk/strings.ts | (file) The kiosk's view of the one string table (REQ-LANG-01). | **23** · web:kiosk/Ceremony.tsx, web:kiosk/components/Chrome.tsx, web:kiosk/components/InactivityWarning.tsx, +20 more |
| `beginLogin` | web:auth.ts | Sends the browser to Keycloak. | **7** · web:AccessGuard.tsx, web:AuthGate.tsx, web:ConsoleDashboard.tsx, +4 more |
| `calendarDate` | web:patient/portal/format.ts | A calendar date — `YYYY-MM-DD`. | **6** · web:patient/portal/cards/AgreementsCard.tsx, web:patient/portal/cards/DetailsCard.tsx, web:patient/portal/cards/EnduringCard.tsx, +3 more |
| `explainFailure` | web:apiError.ts | Read the server's own reason out of a failed response. | **5** · web:practice/channels/ChannelsView.tsx, web:practice/correspondence/CorrespondenceView.tsx, web:practice/patients/PatientWorkView.tsx, +2 more |
| `instant` | web:patient/portal/format.ts | An instant — when something happened, in the reader's own time. | **5** · web:patient/portal/cards/AgreementsCard.tsx, web:patient/portal/cards/DataCard.tsx, web:patient/portal/cards/EnduringCard.tsx, +2 more |
| `toViewPath` | web:viewPath.ts |  | **5** · web:practice/PracticeList.tsx, web:practice/channels/ChannelsView.tsx, web:practice/setup/SetupHub.tsx, +2 more |
| `STATE_TONE` | web:practice/tablet/pushDesk.tsx |  | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `isUnpaired` | web:kiosk/api.ts | THE SERVER SAYS THIS TABLET IS NOT PAIRED — revoked, rotated, or holding a credential from a practice that no longer knows it. | **4** · web:kiosk/Ceremony.tsx, web:kiosk/useKioskHeartbeat.ts, web:kiosk/useTabletSession.ts, +1 more |
| `subjectForSession` | web:practice/tablet/pushDesk.tsx | A session, as the thing a correction is about. | **4** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx, +1 more |
| `KioskApiError` | web:kiosk/api.ts | Thrown for any non-2xx. | **3** · web:kiosk/Ceremony.tsx, web:kiosk/rules/retry.ts, web:kiosk/useKioskHeartbeat.ts |
| `arrivedAtLabel` | web:practice/practitioner/waiting/WaitingView.tsx | THE TIME THEY ARRIVED, IN THE PRACTICE'S OWN CLOCK-FACE TERMS. | **3** · web:practice/day/DayView.tsx, web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx |
| `bornOn` | web:practice/tablet/pushDesk.tsx | "3 March 1957" — the same date, read the way a receptionist reads one. | **3** · web:practice/patients/NewAgreementPanel.tsx, web:practice/patients/PatientWorkView.tsx, web:practice/patients/PatientsQueueView.tsx |
| `canSendAgain` | web:practice/tablet/pushDesk.tsx | MAY THIS ENDED SESSION BE SENT AGAIN? | **3** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/patients/PatientWorkView.tsx, web:practice/tablet/TabletView.tsx |
| `dayOptions` | web:kiosk/rules/verify-fields.ts | 1–31. The pickers do not validate the calendar — a wrong date is a mismatch, not an error screen. | **3** · web:kiosk/screens/VerifyScreen.tsx, web:patient/portal/activate/[token]/ActivateView.tsx, web:practice/patients/NewAgreementPanel.tsx |
| `disputedLabels` | web:practice/tablet/pushDesk.tsx | WHAT THE PATIENT CROSSED, IN WORDS — "address, mobile number". | **3** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientsQueueView.tsx |
| `kioskBuildId` | web:kiosk/session.ts | WHICH BUILD THIS TAB IS RUNNING — the rollback mechanism, not a vanity string (TODO.md "Zero-footprint kiosk": "a version banner support can read, and a forced-reload signal so a rollback reaches every open tab"). | **3** · web:kiosk/api.ts, web:kiosk/components/Chrome.tsx, web:kiosk/useKioskHeartbeat.ts |
| `monthOptions` | web:kiosk/rules/verify-fields.ts | Month NAMES, valued as '01'–'12'. | **3** · web:kiosk/screens/VerifyScreen.tsx, web:patient/portal/activate/[token]/ActivateView.tsx, web:practice/patients/NewAgreementPanel.tsx |
| `readPairingCredential` | web:kiosk/pairing.ts | The credential this tablet holds, or null if it holds none. | **3** · web:kiosk/Ceremony.tsx, web:kiosk/api.ts, web:kiosk/components/Chrome.tsx |
| `relationshipLabel` | web:kiosk/rules/assignor.ts | The words for a relationship key. | **3** · web:kiosk/rules/who-is-signing.ts, web:kiosk/screens/AssignorScreen.tsx, web:patient/agree/[token]/AgreeView.tsx |
| `restoreRefusalReason` | web:auth.ts | The OIDC reason the last silent restore was refused, for a browser that had signed in here. | **3** · web:AccessGuard.tsx, web:AuthGate.tsx, web:SessionControl.tsx |
| `sessionIdleMinutes` | web:auth.ts | HOW LONG A SIGN-IN SURVIVES WITHOUT ACTIVITY, in minutes, so the copy can say it instead of leaving somebody to guess. | **3** · web:AccessGuard.tsx, web:AuthGate.tsx, web:SessionControl.tsx |
| `silentRestoreInFlight` | web:auth.ts | IS A SILENT RESTORE ACTUALLY RUNNING RIGHT NOW? | **3** · web:AccessGuard.tsx, web:AuthGate.tsx, web:SessionControl.tsx |
| `subjectForPatient` | web:practice/tablet/pushDesk.tsx | A patient with nothing on a tablet -- a correction with no dispute to close. | **3** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx, web:practice/patients/PatientWorkView.tsx |
| `yearOptions` | web:kiosk/rules/verify-fields.ts |  | **3** · web:kiosk/screens/VerifyScreen.tsx, web:patient/portal/activate/[token]/ActivateView.tsx, web:practice/patients/NewAgreementPanel.tsx |
| `PortalApiError` | web:patient/portal/api.ts | Thrown for any non-2xx. | **2** · web:patient/portal/activate/[token]/ActivateView.tsx, web:patient/portal/fixtures.ts |
| `clearSession` | web:auth.ts | `reason` defaults to `'signed-out'` — the caller for whom that is wrong (the failed-refresh path below) says so explicitly. | **2** · web:AuthGate.tsx, web:ConsoleDashboard.tsx |
| `composeDateOfBirth` | web:kiosk/rules/verify-fields.ts | ISO `YYYY-MM-DD`, because that is what the server compares against: it takes the first ten characters of the stated value and matches them against the date it holds. | **2** · web:patient/portal/activate/[token]/ActivateView.tsx, web:practice/patients/NewAgreementPanel.tsx |
| `dayRails` | web:practice/frontdesk/dayRails.ts | THE DAY'S ROWS, IN GROUPS THAT ACCOUNT FOR ALL OF THEM. | **2** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/deskLines.ts |
| `deviceActivityLine` | web:practice/deviceActivity.ts | The line itself, or `null` where there is honestly nothing to say. | **2** · web:practice/devices/DevicesView.tsx, web:practice/tablet/TabletView.tsx |
| `fetchKioskMe` | web:kiosk/api.ts | Who this tablet is: the practice name and state for the header, the label somebody gave the device, and whether this tab is below the build floor. | **2** · web:kiosk/Ceremony.tsx, web:kiosk/components/Chrome.tsx |
| `forgetActingAs` | web:effectivePractice.ts | Dropped when a session starts or ends, so the next read is honest. | **2** · web:platform/acting-as/ActingAsRegister.tsx, web:practice/PracticeList.tsx |
| `identifierFieldsFor` | web:kiosk/rules/identifiers.ts | Builds the field set for the challenge. | **2** · web:kiosk/Ceremony.tsx, web:patient/portal/activate/[token]/ActivateView.tsx |
| `passkeysAvailable` | web:patient/portal/api.ts | CAN THIS BROWSER DO PASSKEYS AT ALL. | **2** · web:patient/portal/PortalView.tsx, web:patient/portal/activate/[token]/ActivateView.tsx |
| `shortSessionId` | web:practice/tablet/pushDesk.tsx | THE FIRST EIGHT CHARACTERS OF A SESSION ID (Carl, 4 Sep 2026). | **2** · web:practice/patients/PatientWorkView.tsx, web:practice/patients/PatientsQueueView.tsx |
| `signInWithPasskey` | web:patient/portal/api.ts | SIGN IN WITH A PASSKEY — no username, no identifier, nothing typed. | **2** · web:patient/portal/PortalView.tsx, web:patient/portal/activate/[token]/ActivateView.tsx |
| `signOut` | web:auth.ts | Sign out — OF KEYCLOAK, not just of this tab. | **2** · web:SessionControl.tsx, web:review/ReviewerGate.tsx |
| `silentRestoreUnresolved` | web:auth.ts | IS THE RESTORE QUESTION STILL OPEN — including "nobody has asked yet"? | **2** · web:practice/PracticeList.tsx, web:practice/usePractice.tsx |
| `situationFor` | web:practice/frontdesk/visitChecklist.ts | THE ONE SITUATION THIS PERSON IS IN, so the panel can show ONE next thing (FRONT-DESK-PAGE.md §4). | **2** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx |
| `visitChecklist` | web:practice/frontdesk/visitChecklist.ts | THE ROWS FOR ONE PATIENT'S DAY — four of paperwork, and the visit itself. | **2** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx |
| `visitStateLabel` | web:practice/practitioner/waiting/WaitingView.tsx | THE WORD FOR A VISIT STATE, AND THE CODE ITSELF WHERE THERE IS NO WORD. | **2** · web:practice/day/DayView.tsx, web:practice/frontdesk/FrontDeskView.tsx |
| `when` | web:practice/tablet/pushDesk.tsx |  | **2** · web:practice/patients/PatientWorkView.tsx, web:practice/tablet/TabletView.tsx |
| `EMPTY_CHOICE` | web:kiosk/rules/assignor.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `EMPTY_PARTS` | web:kiosk/rules/verify-fields.ts |  | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `EMPTY_WHO` | web:practice/tablet/pushDesk.tsx |  | **1** · web:practice/patients/NewAgreementPanel.tsx |
| `FIRST_DB4_PAGE` | web:kiosk/rules/db4-pages.ts | Where a patient arriving at the step starts, and where Back out of it resets to. | **1** · web:kiosk/Ceremony.tsx |
| `KIOSK_MAX_ATTEMPTS` | web:kiosk/rules/verification.ts | Attempts allowed at the tablet before it hands over to the desk. | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `POLL_MS` | web:practice/tablet/pushDesk.tsx | THREE SECONDS. | **1** · web:practice/patients/PatientsQueueView.tsx |
| `PORTAL_FIXTURES` | web:patient/portal/api.ts | TRUE WHILE THE SERVER SIDE IS BEING BUILT. | **1** · web:patient/portal/activate/[token]/ActivateView.tsx |
| `activatePortal` | web:patient/portal/api.ts | THE THREE IDENTIFIERS, AND THE SESSION IF THEY MATCH. | **1** · web:patient/portal/activate/[token]/ActivateView.tsx |
| `afterAttempt` | web:kiosk/rules/verification.ts | Advances the ladder. | **1** · web:kiosk/Ceremony.tsx |
| `allAnswered` | web:kiosk/rules/pushed-details.ts | Every row on screen has an answer. | **1** · web:kiosk/Ceremony.tsx |
| `answerSignature` | web:kiosk/rules/pushed-details.ts | ONE STRING FOR ONE SET OF ANSWERS, so the screen can tell whether what it is about to send is what it already sent. | **1** · web:kiosk/Ceremony.tsx |
| `answeredTypes` | web:kiosk/rules/pushed-details.ts | WHAT GOES ON THE WIRE — the ANSWERED TYPES, in the domain's order, split into the ticked and the crossed, and nothing else (REQ-VER-04, hard rule 9). | **1** · web:kiosk/Ceremony.tsx |
| `anyDisputed` | web:kiosk/rules/pushed-details.ts | At least one cross — which disables Continue and summons reception. | **1** · web:kiosk/Ceremony.tsx |
| `artefactUrl` | web:patient/portal/api.ts | The agreement AS SIGNED. | **1** · web:patient/portal/cards/AgreementsCard.tsx |
| `assignorRequestFrom` | web:kiosk/rules/assignor.ts | The body for `POST /agreements/:id/assignor`, composed from the choice. | **1** · web:kiosk/Ceremony.tsx |
| `attemptChallenge` | web:kiosk/api.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `attemptSilentLogin` | web:auth.ts |  | **1** · web:AccessGuard.tsx |
| `aud` | web:patient/portal/format.ts | THE ONLY MONEY FORMATTER IN THE PRODUCT, and it is used by one card. | **1** · web:patient/portal/cards/NoticesCard.tsx |
| `blockingCount` | web:kiosk/rules/signature-gate.ts | How many things are outstanding — the number the disabled label carries. | **1** · web:kiosk/components/SignatureControl.tsx |
| `bodyFromForm` | web:practice/templates/templateEditing.ts | THE FORM BACK INTO EXACTLY THE JSON THE ENDPOINT ACCEPTS TODAY. | **1** · web:practice/templates/TemplateForm.tsx |
| `candidateTemplate` | web:practice/templates/templateEditing.ts | THE CANDIDATE THE CHECKS RUN AGAINST, assembled exactly as `TemplatesService.validateBody` assembles it on the server — same fallback id, same forced `draft_pending_review` status, same note. | **1** · web:practice/templates/TemplateForm.tsx |
| `ceremonySequence` | web:kiosk/rules/ceremony-steps.ts | The steps this route will run. | **1** · web:kiosk/Ceremony.tsx |
| `challengeIsComplete` | web:kiosk/rules/identifiers.ts | True when every field the challenge asked for has been given something. | **1** · web:kiosk/Ceremony.tsx |
| `changeAssignor` | web:kiosk/api.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `checkTemplateForm` | web:practice/templates/templateEditing.ts |  | **1** · web:practice/templates/TemplateForm.tsx |
| `claimWaitingRow` | web:kiosk/api.ts | THE WALK-UP CLAIM: three details in, one row out — or the generic refusal. | **1** · web:kiosk/Ceremony.tsx |
| `clearPairingCredential` | web:kiosk/pairing.ts | Forget it — on a 401, which is what a revoked or rotated device gets. | **1** · web:kiosk/Ceremony.tsx |
| `completeCapture` | web:kiosk/api.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `completeLogin` | web:auth.ts |  | **1** · web:callback/page.tsx |
| `composeIdentifier` | web:kiosk/rules/verify-fields.ts | The composed value for one identifier type, or null when this type is not a composite. | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `composeName` | web:kiosk/rules/verify-fields.ts | GIVEN NAME FIRST, then family name — which is the order a person says it and the order the server's `nameMatches` is indifferent to. | **1** · web:patient/portal/activate/[token]/ActivateView.tsx |
| `composeSignRequest` | web:kiosk/rules/signature-payload.ts | Returns null when a drawn signature has nothing to send — no ink, or a canvas that could not rasterise itself. | **1** · web:kiosk/Ceremony.tsx |
| `confirmSessionDetails` | web:kiosk/api.ts | THE TICKS AND THE CROSSES — TYPES ONLY, NEVER VALUES (REQ-VER-04, hard rule 9). | **1** · web:kiosk/Ceremony.tsx |
| `coreBaseUrl` | web:kiosk/session.ts |  | **1** · web:kiosk/api.ts |
| `db4PagePosition` | web:kiosk/rules/db4-pages.ts | Which of the three a page is, for the screen's own "Page 1 of 3" line. | **1** · web:kiosk/screens/ParticularsScreen.tsx |
| `decideAssignor` | web:kiosk/rules/assignor.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `deskCounts` | web:practice/frontdesksmall/deskLines.ts | HOW MANY LINES ARE IN EACH STATE — the chips, and the whole reconciliation on one line. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `deskLines` | web:practice/frontdesksmall/deskLines.ts | EVERYBODY HERE TODAY, IN ONE LIST. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `detailRowsFor` | web:kiosk/rules/pushed-details.ts | The rows to draw, in the domain's order, with the empty ones dropped. | **1** · web:kiosk/Ceremony.tsx |
| `detailSentence` | web:practice/frontdesk/FrontDeskView.tsx | The row's own sentence, resolved from the key the computation returned. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `deviceLabelFor` | web:practice/frontdesk/FrontDeskView.tsx | WHICH TABLET, BY THE NAME THE DESK USES FOR IT — "the blue one" is how the room talks (§12.2). | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `evaluateAssignorGate` | web:kiosk/rules/assignor.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `evaluateSignatureGate` | web:kiosk/rules/signature-gate.ts | The only sanctioned way any surface may decide whether the signature control enables. | **1** · web:kiosk/Ceremony.tsx |
| `everyServiceResolved` | web:practice/frontdesk/visitChecklist.ts | IS EVERY SERVICE ON THIS PATIENT'S LIST RESOLVED? | **1** · web:practice/frontdesk/dayRails.ts |
| `fetchAccessLog` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchActingAs` | web:effectivePractice.ts |  | **1** · web:practice/PracticeList.tsx |
| `fetchActivationChallenge` | web:patient/portal/api.ts | WHAT THE INVITATION LINK OPENS. | **1** · web:patient/portal/activate/[token]/ActivateView.tsx |
| `fetchAgreement` | web:kiosk/api.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `fetchAgreements` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchAssignors` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchCopyOffer` | web:kiosk/api.ts |  | **1** · web:kiosk/screens/CompleteScreen.tsx |
| `fetchDetails` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchEnduring` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchMessages` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchNotices` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchPasskeys` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchPracticeStaffNames` | web:kiosk/api.ts | The practice's own staff names, for the REQ-VUL-04 block. | **1** · web:kiosk/Ceremony.tsx |
| `fetchSession` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchTabletSession` | web:kiosk/api.ts | WHAT IS ON THIS TABLET RIGHT NOW. | **1** · web:kiosk/useTabletSession.ts |
| `fetchVisits` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `fetchWaitingList` | web:kiosk/api.ts |  | **1** · web:kiosk/useWaitingList.ts |
| `firstAttempt` | web:kiosk/rules/verification.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `flagLabel` | web:review/flags.tsx | The word on the chip. | **1** · web:review/[id]/DossierView.tsx |
| `flagWhy` | web:review/flags.tsx |  | **1** · web:review/[id]/DossierView.tsx |
| `forgetSurfaceProfile` | web:surfaceProfile.ts | Dropped when the setting is saved, so the next read is honest. | **1** · web:practice/channels/ChannelsView.tsx |
| `formFromBody` | web:practice/templates/templateEditing.ts | THE SHAPE COMES FROM THE GENERIC AND THE WORDS COME FROM THE DRAFT. | **1** · web:practice/templates/TemplateForm.tsx |
| `formatAbn` | web:review/QueueView.tsx | "27734610304" reads as a number; "27 734 610 304" reads as an ABN. | **1** · web:review/[id]/DossierView.tsx |
| `getSession` | web:kiosk/session.ts |  | **1** · web:kiosk/api.ts |
| `hasSignedInBefore` | web:auth.ts |  | **1** · web:AccessGuard.tsx |
| `insertAtCaret` | web:practice/templates/templateEditing.ts | INSERT A PLACEHOLDER WHERE THE CARET IS. | **1** · web:practice/templates/TemplateForm.tsx |
| `isRetryAborted` | web:kiosk/rules/retry.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `isSignable` | web:kiosk/rules/signature-gate.ts | True only for the one state that carries permission. | **1** · web:kiosk/components/SignatureControl.tsx |
| `isSignedOut` | web:patient/portal/api.ts |  | **1** · web:patient/portal/PortalView.tsx |
| `isStructured` | web:kiosk/rules/verify-fields.ts |  | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `itemsFact` | web:practice/tablet/pushDesk.tsx | D6b, IN WORDS. | **1** · web:practice/tablet/TabletView.tsx |
| `lockParticulars` | web:kiosk/api.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `mismatchHeading` | web:kiosk/rules/verification.ts |  | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `mismatchMessage` | web:kiosk/rules/verification.ts | The ONLY failure message. | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `moveOutcomeWords` | web:practice/practitioner/waiting/MovePanel.tsx | WHAT ONE ROW'S MOVE CAME TO, IN WORDS — beside the patient it was about. | **1** · web:practice/practitioner/waiting/WaitingView.tsx |
| `nextAnswers` | web:kiosk/rules/pushed-details.ts | THE ONLY WAY AN ANSWER EVER CHANGES (extracted from `Ceremony.tsx` on 7 Sep 2026, in review of the Continue lock). | **1** · web:kiosk/Ceremony.tsx |
| `nextDb4Page` | web:kiosk/rules/db4-pages.ts | The next page, or `null` on the last one — where Continue goes to sign-off. | **1** · web:kiosk/screens/ParticularsScreen.tsx |
| `nextVersionName` | web:practice/templates/templateEditing.ts | THE NEXT VERSION NAME FOR THIS PRACTICE AND AGREEMENT TYPE: `<practice-slug>-<agreementType>-<n>`, where `<n>` is one more than the highest number already used by one of THIS practice's own templates of THIS type (Carl, 7 Sep 2026). | **1** · web:practice/templates/TemplateForm.tsx |
| `openDevPortalSession` | web:patient/portal/api.ts | DEV ONLY — mint a portal session for named patients without a passkey. | **1** · web:patient/portal/PortalView.tsx |
| `pairDevice` | web:kiosk/api.ts | THE ONE CALL MADE WITHOUT A CREDENTIAL, because it is the call that earns one. | **1** · web:kiosk/Ceremony.tsx |
| `previousDb4Page` | web:kiosk/rules/db4-pages.ts | The previous page, or `null` on the first one — where Back stops being the screen's own navigation and becomes the ceremony's, whatever `onBack` does. | **1** · web:kiosk/screens/ParticularsScreen.tsx |
| `readyToSubmit` | web:kiosk/rules/verify-fields.ts | True when every challenged identifier has everything it needs to be sent. | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `refreshAll` | web:refresh.ts | Run every registered loader. | **1** · web:RefreshButton.tsx |
| `refreshFailureReason` | web:auth.ts | The reason the most recent refresh attempt failed, if the last thing that happened to this session was a failure. | **1** · web:SessionControl.tsx |
| `registerPasskey` | web:patient/portal/api.ts | ADD A PASSKEY — options, the browser ceremony, then verify. | **1** · web:patient/portal/PortalView.tsx |
| `requestCopy` | web:kiosk/api.ts | The answer is a channel TYPE and an outcome. | **1** · web:kiosk/screens/CompleteScreen.tsx |
| `requestDetailCorrection` | web:patient/portal/api.ts | ASKING A PRACTICE TO CORRECT A DETAIL — a request, never an edit. | **1** · web:patient/portal/PortalView.tsx |
| `retryAfterMismatch` | web:kiosk/rules/verification.ts | After a mismatch the patient may try again — this is the next asking state. | **1** · web:kiosk/Ceremony.tsx |
| `returnPath` | web:auth.ts | Where to send the browser after a successful exchange. | **1** · web:callback/page.tsx |
| `revokeAssignor` | web:patient/portal/api.ts | Withdrawing somebody's authority to act. | **1** · web:patient/portal/PortalView.tsx |
| `revokePasskey` | web:patient/portal/api.ts | REMOVE ONE. | **1** · web:patient/portal/PortalView.tsx |
| `sampleValuesFor` | web:practice/templates/templateEditing.ts | OBVIOUSLY FAKE VALUES FOR THE PREVIEW, one for every declared placeholder. | **1** · web:practice/templates/TemplateForm.tsx |
| `sendKioskHeartbeat` | web:kiosk/api.ts |  | **1** · web:kiosk/useKioskHeartbeat.ts |
| `setTabletSessionState` | web:kiosk/api.ts | WHAT THE TABLET IS SHOWING — `reading`, or that the person walked away. | **1** · web:kiosk/Ceremony.tsx |
| `shortHash` | web:kiosk/components/SignatureControl.tsx | Grouped for reading aloud at a desk, exactly as the handoff draws it. | **1** · web:kiosk/screens/ParticularsScreen.tsx |
| `signAgreement` | web:kiosk/api.ts | THE DRAWN MARK TRAVELS WITH THE SIGN CALL (REQ-SIG-01/-02). | **1** · web:kiosk/Ceremony.tsx |
| `signOut` | web:patient/portal/api.ts | SIGN OUT — a server-side revoke, not only a cleared cookie (Carl, 4 Sep 2026: "no sign-out button"). | **1** · web:patient/portal/PortalView.tsx |
| `signingByLine` | web:kiosk/rules/who-is-signing.ts | The header's second line, on every page: "by Alex Fictional", or "by Kim Fictional for Alex Fictional". | **1** · web:kiosk/components/Chrome.tsx |
| `signingStatement` | web:kiosk/rules/who-is-signing.ts | K-4's fuller statement, above the pad: "Alex Fictional is signing." or "Kim Fictional is signing for Alex Fictional as their Mother." | **1** · web:kiosk/screens/SignatureScreen.tsx |
| `silentLoginFailed` | web:auth.ts | Called by the callback when Keycloak answers `login_required`. | **1** · web:callback/page.tsx |
| `slugify` | web:practice/templates/templateEditing.ts | A PRACTICE NAME, MADE INTO THE SHAPE A VERSION NAME CAN START WITH (Carl, 7 Sep 2026). | **1** · web:practice/templates/TemplateForm.tsx |
| `stableByFirstSeen` | web:practice/frontdesk/FrontDeskView.tsx | HOLD THE ORDER SOMEBODY IS LOOKING AT (§12.3). | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `startChallenge` | web:kiosk/api.ts |  | **1** · web:kiosk/Ceremony.tsx |
| `stateWord` | web:practice/frontdesk/FrontDeskView.tsx | DONE, STILL TO DO, DROPPED, OR NOTHING TO SIGN — the words, from the table. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `statementPage` | web:kiosk/rules/db4-pages.ts | The page a statement is read on. | **1** · web:kiosk/screens/ParticularsScreen.tsx |
| `stepNumber` | web:kiosk/rules/ceremony-steps.ts | Where a step sits in a sequence, or `null` if it is not one of its steps. | **1** · web:kiosk/Ceremony.tsx |
| `terminateEnduring` | web:patient/portal/api.ts | ENDING AN ENDURING AGREEMENT — the patient's own right under 65CA(7)(b), held even where somebody else entered the agreement for them (REQ-END-06). | **1** · web:patient/portal/PortalView.tsx |
| `timeLabel` | web:practice/frontdesk/FrontDeskView.tsx | The time on a row, or the honest statement that the booking carried none. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `transitionAgreement` | web:kiosk/api.ts | Moves a verified draft to the signing step. | **1** · web:kiosk/Ceremony.tsx |
| `trimStatedValues` | web:kiosk/rules/verify-fields.ts | TRIMS WHAT LEAVES THE DEVICE, NEVER WHAT IS TYPED (Carl, 3 Sep 2026). | **1** · web:kiosk/Ceremony.tsx |
| `whoIsBlocked` | web:practice/tablet/pushDesk.tsx | The same gate, as the single sentence its two other callers ask for. | **1** · web:practice/patients/NewAgreementPanel.tsx |
| `withTransientRetry` | web:kiosk/rules/retry.ts | Run `attempt`, and on a transient failure run it again after each delay. | **1** · web:kiosk/Ceremony.tsx |
| `wrapSelection` | web:practice/templates/templateEditing.ts | WRAP THE SELECTION IN A CONDITION — "only when…". | **1** · web:practice/templates/TemplateForm.tsx |
| `writePairingCredential` | web:kiosk/pairing.ts | Remember the credential this tablet was just given. | **1** · web:kiosk/Ceremony.tsx |
| `ARRIVED_STATES` | web:practice/frontdesksmall/deskLines.ts | The four states that partition the register — the sum the chips must make. | 0 |
| `DB4_PAGES` | web:kiosk/rules/db4-pages.ts | The three pages of the DB4, in the order they are read. | 0 |
| `FIELDS_FOR_DISPUTED_TYPE` | web:practice/tablet/pushDesk.tsx | WHICH COLUMNS ANSWER A CROSSED ROW. | 0 |
| `FIXTURE_ACTIVATION_ANSWERS` | web:patient/portal/fixtures.ts | WHAT THE ACTIVATION PAGE ANSWERS FROM WHEN CORE IS NOT RUNNING. | 0 |
| `GATE_REASONS` | web:kiosk/rules/signature-gate.ts | Reasons are engineering-legible, not patient-legible: they are shown to whoever is standing at the tablet so a staff member can act on them, and they never name a patient detail value. | 0 |
| `GET` | web:api/kiosk-build/route.ts |  | 0 |
| `LAST_DB4_PAGE` | web:kiosk/rules/db4-pages.ts | The page the sign-off is on, and the home of any statement not placed below. | 0 |
| `LIVE_REFRESH_MS` | web:useLiveRefresh.tsx | Long enough to be unnoticeable, short enough that nobody reaches for F5. | 0 |
| `OFFER_RETURN_SECONDS` | web:kiosk/screens/CompleteScreen.tsx | LONGER WHILE A QUESTION IS ON SCREEN (W6). | 0 |
| `PAIRING_CREDENTIAL_KEY` | web:kiosk/pairing.ts | The only key the kiosk may ever persist. | 0 |
| `PERSISTABLE_KEYS` | web:kiosk/pairing.ts | THE ALLOW-LIST. | 0 |
| `RESOLVED_SERVICE_STATES` | web:practice/frontdesk/visitChecklist.ts | WHICH STATES MEAN AN ITEM NEEDS NOTHING MORE. | 0 |
| `RETURN_SECONDS` | web:kiosk/screens/CompleteScreen.tsx | The Expo build's timeout, unchanged. | 0 |
| `RETURN_TO_BEGIN_HOLD_MS` | web:kiosk/Ceremony.tsx | HOW LONG "Please see reception" STAYS UP before the tablet returns to Begin on its own (Carl, 4–5 Sep 2026). | 0 |
| `RetryAborted` | web:kiosk/rules/retry.ts | THE ERROR AN ABORT PRODUCES. | 0 |
| `SEND_AGAIN_ENDINGS` | web:practice/tablet/pushDesk.tsx | WHICH ENDINGS STILL HAVE SOMETHING TO SEND (Carl, 4 Sep 2026). | 0 |
| `SEND_CARD_CLEARS` | web:practice/frontdesk/visitChecklist.ts | WHICH REFUSALS THE NUMBERED SEND CARD CAN ITSELF CLEAR. | 0 |
| `STRUCTURED_IDENTIFIER_TYPES` | web:kiosk/rules/verify-fields.ts | The identifier types this module composes. | 0 |
| `TEMPLATE_VERSION_PATTERN` | web:practice/templates/templateEditing.ts | The version name the endpoint accepts: lower-kebab-case ending in a number. | 0 |
| `TRANSIENT_RETRY_DELAYS_MS` | web:kiosk/rules/retry.ts | Four waits, so five attempts in total, ~15s end to end. | 0 |
| `YEAR_SPAN` | web:kiosk/rules/verify-fields.ts | The current year back 120. Newest first, because the youngest patient scrolls least — and a 120-year window covers every living person without offering a year that cannot be a date of birth. | 0 |
| `addFixturePasskey` | web:patient/portal/fixtures.ts |  | 0 |
| `ageIsOnRecord` | web:practice/tablet/pushDesk.tsx | IS THE AGE DECLARATION ALREADY ON THE RECORD FOR THE PERSON NOW NAMED? | 0 |
| `agreementHeading` | web:practice/patients/PatientWorkView.tsx | HOW ONE AGREEMENT IS NAMED ON THIS PAGE. | 0 |
| `agreementStatusLabel` | web:practice/day/DayView.tsx | THE WORD FOR AN AGREEMENT'S STATE, AND THE CODE ITSELF WHERE THERE IS NO WORD. | 0 |
| `askedAt` | web:practice/patients/PatientWorkView.tsx | "4 Sep 2026 at 8:31 pm" — when the patient asked. | 0 |
| `blockedMessage` | web:practice/tablet/pushDesk.tsx | The sentence alone, for the places that show only text (a dead button's tooltip). | 0 |
| `closeFixtureSession` | web:patient/portal/fixtures.ts |  | 0 |
| `describeRefusal` | web:practice/tablet/pushDesk.tsx | WHY THE PUSH WAS REFUSED, in our words, with somewhere to go. | 0 |
| `detailInSentence` | web:practice/patients/PatientWorkView.tsx | The detail's own label, as it reads inside a sentence rather than above a field. | 0 |
| `devAgreementType` | web:practice/frontdesk/FrontDeskView.tsx | THE DOMAIN'S OWN NAME FOR THE KIND OF AGREEMENT, IN BRACKETS, AND ONLY OUTSIDE PRODUCTION (Carl, 12 September 2026: *"Should say (enduring / episodic) at least while we are testing."*). | 0 |
| `deviceSeenAgo` | web:practice/deviceActivity.ts | "4 s", "3 min", "2 hours", "over a day" — deliberately coarse. | 0 |
| `dynamic` | web:api/kiosk-build/route.ts | Never cached: a cached answer is the same tab staring at its own stale copy. | 0 |
| `fetchSurfaceProfile` | web:surfaceProfile.ts |  | 0 |
| `fieldsToCorrect` | web:practice/tablet/pushDesk.tsx |  | 0 |
| `fixtureAccessLog` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureActivate` | web:patient/portal/fixtures.ts | The three-identifier check, fixture side — same refusals, same statuses, and the same refusal to say WHICH answer was wrong (REQ-SEC-07). | 0 |
| `fixtureActivationChallenge` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureAgreements` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureAssignors` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureDetails` | web:patient/portal/fixtures.ts | Two practices, and they DISAGREE ABOUT THE ADDRESS — which is the point of the card, and now of the reconciliation notice above it (Carl, 5 Sep 2026). | 0 |
| `fixtureEnduring` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureMessages` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureNotices` | web:patient/portal/fixtures.ts |  | 0 |
| `fixturePasskeys` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureSession` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureTermination` | web:patient/portal/fixtures.ts |  | 0 |
| `fixtureVisits` | web:patient/portal/fixtures.ts |  | 0 |
| `formatDateOfBirth` | web:kiosk/rules/pushed-details.ts | d MMMM yyyy — "4 September 1962". | 0 |
| `historyLine` | web:practice/patients/PatientWorkView.tsx | One history line: the words for the type, then whatever short codes it carries. | 0 |
| `isExpiredSessionFailure` | web:apiError.ts | The same recognition `explainFailure` applies, exposed separately so a caller that already has a message string (rather than the `Response`) can decide whether to offer a retry after sign-in without re-deriving it. | 0 |
| `isExpiredSessionMessage` | web:apiError.ts | True for the message `explainFailure` produces for an expired session. | 0 |
| `isTransientFailure` | web:kiosk/rules/retry.ts | Is this worth trying again? | 0 |
| `liveOnly` | web:practice/tablet/pushDesk.tsx | THE SESSIONS THAT STILL OWN A TABLET. | 0 |
| `livePractices` | web:practice/practitioner/PractitionerLandingView.tsx | One row per practice they currently work at, de-duplicated by id. | 0 |
| `logoutHint` | web:auth.ts | The assertion to name at logout, whether or not the session is still live. | 0 |
| `matchesTerm` | web:practice/patients/PatientsQueueView.tsx | Name or date of birth, matched the way somebody types at a counter. | 0 |
| `mayActOnDescriptions` | web:practice/reconciliation/ServiceDescriptionsNeeded.tsx | May this account actually set a description, as against read the list? | 0 |
| `mayPush` | web:practice/tablet/pushDesk.tsx | MAY THIS ACCOUNT ACTUALLY SEND, as against read the page? | 0 |
| `metadata` | web:apply/page.tsx |  | 0 |
| `metadata` | web:help/page.tsx |  | 0 |
| `metadata` | web:invitation/[token]/page.tsx |  | 0 |
| `metadata` | web:kiosk/page.tsx | `/kiosk` — the waiting-room tablet, as a page of the web app. | 0 |
| `metadata` | web:layout.tsx | UK/AU spelling in all user-facing text (CLAUDE.md §3). | 0 |
| `metadata` | web:patient/agree/[token]/page.tsx |  | 0 |
| `metadata` | web:patient/agreement-copy/[token]/page.tsx |  | 0 |
| `metadata` | web:patient/messages/[token]/page.tsx |  | 0 |
| `metadata` | web:patient/portal/activate/[token]/page.tsx |  | 0 |
| `metadata` | web:patient/portal/page.tsx |  | 0 |
| `metadata` | web:platform/acting-as/history/page.tsx |  | 0 |
| `metadata` | web:platform/acting-as/page.tsx |  | 0 |
| `metadata` | web:platform/templates/page.tsx |  | 0 |
| `metadata` | web:practice/application/page.tsx |  | 0 |
| `metadata` | web:practice/confirm-backup/page.tsx |  | 0 |
| `metadata` | web:practice/confirm-email/page.tsx |  | 0 |
| `metadata` | web:practice/correspondence/page.tsx |  | 0 |
| `metadata` | web:practice/page.tsx |  | 0 |
| `metadata` | web:practice/queue/page.tsx |  | 0 |
| `metadata` | web:practice/queuebyOrg/page.tsx |  | 0 |
| `metadata` | web:practice/queuebyOrgLocDepartment/page.tsx |  | 0 |
| `metadata` | web:practice/reconciliation/page.tsx |  | 0 |
| `metadata` | web:practice/reports/page.tsx |  | 0 |
| `metadata` | web:practice/reviews/page.tsx |  | 0 |
| `metadata` | web:practice/stop-email-change/page.tsx |  | 0 |
| `metadata` | web:practice/users/page.tsx |  | 0 |
| `metadata` | web:practitioner/affiliations/page.tsx |  | 0 |
| `metadata` | web:practitioner/messages/page.tsx |  | 0 |
| `metadata` | web:practitioner/page.tsx |  | 0 |
| `metadata` | web:practitioner/practices/[practiceId]/page.tsx |  | 0 |
| `metadata` | web:review/[id]/page.tsx |  | 0 |
| `metadata` | web:review/identity/page.tsx |  | 0 |
| `metadata` | web:review/page.tsx |  | 0 |
| `metadata` | web:status/[token]/correct/page.tsx |  | 0 |
| `metadata` | web:status/[token]/page.tsx |  | 0 |
| `metadata` | web:verify/[token]/page.tsx |  | 0 |
| `newAgreementBlocked` | web:practice/patients/NewAgreementPanel.tsx | EVERY REASON THIS CANNOT BE SUBMITTED, ALL AT ONCE — live, before anybody presses (CLAUDE.md §6: blocked states are unreachable, not merely inert). | 0 |
| `openFixtureSession` | web:patient/portal/fixtures.ts |  | 0 |
| `outcomeMessage` | web:practice/reconciliation/ServiceDescriptionsNeeded.tsx | What to say after a successful set. | 0 |
| `paperworkLabel` | web:practice/practitioner/waiting/WaitingView.tsx | THE WORD FOR A STATE, AND THE CODE ITSELF WHEN THERE IS NO WORD. | 0 |
| `partsComplete` | web:kiosk/rules/verify-fields.ts | WHICH PARTS ARE MANDATORY, and no more than that. | 0 |
| `purposeLabel` | web:correspondence/MessageLog.tsx | WHAT THE ROW ACTUALLY IS — `Episodic-Agreement-Pre-Consultation`, and `Episodic-Agreement-Post-Consultation-Reminder-2` for the second chase. | 0 |
| `queueSummary` | web:practice/patients/PatientsQueueView.tsx | THE FRESHEST TRUE THING ABOUT THIS PATIENT, IN ONE LINE. | 0 |
| `queueTone` | web:practice/patients/PatientsQueueView.tsx | Stop-tone for a cross nobody has answered; warn while a tablet is live. | 0 |
| `readLockFailure` | web:kiosk/Ceremony.tsx |  | 0 |
| `redirectUri` | web:auth.ts |  | 0 |
| `relationshipDescription` | web:kiosk/rules/assignor.ts | What is actually sent as the relationship: the free text when the option asks for it, otherwise the option's own label. | 0 |
| `relationshipFromSaved` | web:practice/tablet/pushDesk.tsx | THE SAVED RELATIONSHIP, BACK ONTO THE LIST IT CAME FROM. | 0 |
| `rememberSignedIn` | web:auth.ts |  | 0 |
| `removeFixturePasskey` | web:patient/portal/fixtures.ts |  | 0 |
| `requiredElementsFor` | web:practice/templates/templateEditing.ts | Every s 65C element this agreement type must print — the domain's list, not ours. | 0 |
| `revalidate` | web:api/kiosk-build/route.ts |  | 0 |
| `sendSteps` | web:practice/tablet/pushDesk.tsx |  | 0 |
| `serviceFact` | web:practice/tablet/pushDesk.tsx | "Service: General practitioner attendance" — label and value as ONE string, always. | 0 |
| `setSession` | web:kiosk/session.ts | Replaces the session wholesale. | 0 |
| `shortDeviceSessionId` | web:practice/deviceActivity.ts | The same eight characters the tablet's own footer shows. | 0 |
| `signatureFailureMessage` | web:practice/tablet/pushDesk.tsx | A SERVER CODE TO A SENTENCE RECEPTION CAN ACT ON, or the code itself. | 0 |
| `signedLabel` | web:practice/day/DayView.tsx | WHETHER IT IS SIGNED, IN THREE ANSWERS RATHER THAN TWO. | 0 |
| `signingFact` | web:practice/tablet/pushDesk.tsx | "Signing: the patient" / "Signing: Alex Fictional for Kim Specimen — mother" — the same one-string treatment as `serviceFact`. | 0 |
| `soleLivePracticeName` | web:practitioner/PractitionerHub.tsx | THE ONE PRACTICE A PRACTITIONER IS WORKING AT, for the session badge — or null when there is none or more than one, because naming one of two in the corner of every page would be a guess presented as a fact. | 0 |
| `todayLocal` | web:practice/patients/NewAgreementPanel.tsx | TODAY, BY THE PRACTICE'S CLOCK — never `toISOString().slice(0, 10)`. | 0 |
| `waitedFor` | web:review/QueueView.tsx | How long it has waited, in the terms a person would say it. | 0 |
| `whenLabel` | web:practice/reconciliation/ServiceDescriptionsNeeded.tsx | "Thu 3 Sep, 09:00" — or nothing, for a walk-in with no booked time. | 0 |
| `whenLabel` | web:practice/tablet/pushDesk.tsx | "9:00", or the honest absence for a walk-in nobody booked. | 0 |
| `whoDraftFromRow` | web:practice/tablet/pushDesk.tsx | WHAT THE PANEL OPENS SHOWING, WHEN NOBODY HAS TYPED IN IT YET (Carl, 10 Sep 2026). | 0 |
| `whoFault` | web:practice/tablet/pushDesk.tsx | THE GATE ON THE "SOMEONE ELSE" BRANCH — the single source of truth behind what Save refuses to send and the reason shown UNDER THE CONTROL IT IS ABOUT. | 0 |
| `whoSnapshot` | web:practice/tablet/pushDesk.tsx | THE PANEL'S ANSWER, IN THE SHAPE THE DOMAIN COMPARES (Carl, 11 Sep 2026 — D-2026-09-11-01). | 0 |

## Web types

108 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `Loadable` | web:patient/portal/portal-ui.tsx | What a card has been handed. | **10** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/AgreementsCard.tsx, web:patient/portal/cards/DataCard.tsx, +7 more |
| `Tone` | web:ui/index.tsx |  | **9** · web:apply/GateLedger.tsx, web:correspondence/MessageLog.tsx, web:practice/affiliations/AffiliationsView.tsx, +6 more |
| `PushableRow` | web:practice/tablet/pushDesk.tsx |  | **6** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesk/dayRails.ts, web:practice/frontdesk/visitChecklist.ts, +3 more |
| `StepNumber` | web:kiosk/rules/ceremony-steps.ts | A position in a sequence, for `strings.chrome.stepOf`. | **5** · web:kiosk/screens/AssignorScreen.tsx, web:kiosk/screens/CheckDetailsScreen.tsx, web:kiosk/screens/ParticularsScreen.tsx, +2 more |
| `Session` | web:auth.ts |  | **4** · web:AuthGate.tsx, web:ConsoleDashboard.tsx, web:SessionControl.tsx, +1 more |
| `SignatureValidation` | web:kiosk/rules/signature-gate.ts |  | **4** · web:kiosk/Ceremony.tsx, web:kiosk/components/SignatureControl.tsx, web:kiosk/screens/ParticularsScreen.tsx, +1 more |
| `SigningParties` | web:kiosk/rules/who-is-signing.ts | The four facts a screen needs to say who is signing. | **4** · web:kiosk/Ceremony.tsx, web:kiosk/components/Chrome.tsx, web:kiosk/screens/CheckDetailsScreen.tsx, +1 more |
| `IdentifierField` | web:kiosk/rules/identifiers.ts |  | **3** · web:kiosk/Ceremony.tsx, web:kiosk/screens/VerifyScreen.tsx, web:patient/portal/activate/[token]/ActivateView.tsx |
| `PortalAccessEntry` | web:patient/portal/api.ts | `GET /portal/access-log` — every look, from the vault's own events (FR-8.2). | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/DataCard.tsx, web:patient/portal/fixtures.ts |
| `PortalAgreement` | web:patient/portal/api.ts | `GET /portal/agreements`. | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/AgreementsCard.tsx, web:patient/portal/fixtures.ts |
| `PortalAssignors` | web:patient/portal/api.ts |  | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/PeopleCard.tsx, web:patient/portal/fixtures.ts |
| `PortalDetails` | web:patient/portal/api.ts | `GET /portal/details` — one row PER PRACTICE, because the PMS is the master and two practices can hold different addresses for the same person. | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/DetailsCard.tsx, web:patient/portal/fixtures.ts |
| `PortalEnduring` | web:patient/portal/api.ts | `GET /portal/enduring` — per practitioner × patient, never per practice (hard rule 6). | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/EnduringCard.tsx, web:patient/portal/fixtures.ts |
| `PortalMessage` | web:patient/portal/api.ts | `GET /portal/messages` — that a message was sent, never what it said. | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/MessagesCard.tsx, web:patient/portal/fixtures.ts |
| `PortalNotice` | web:patient/portal/api.ts | `GET /portal/notices` — reg 89AA claim notifications. | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/NoticesCard.tsx, web:patient/portal/fixtures.ts |
| `PortalPasskey` | web:patient/portal/api.ts | ONE CREDENTIAL, AS THE "SIGN-IN AND SECURITY" CARD LISTS IT. | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/PasskeysCard.tsx, web:patient/portal/fixtures.ts |
| `PortalVisit` | web:patient/portal/api.ts | `GET /portal/visits` — where an agreement was made. | **3** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/VisitsCard.tsx, web:patient/portal/fixtures.ts |
| `AssignorChoice` | web:kiosk/rules/assignor.ts |  | **2** · web:kiosk/Ceremony.tsx, web:kiosk/screens/AssignorScreen.tsx |
| `AssignorGate` | web:kiosk/rules/assignor.ts | THE LIVE GATE FOR THE "SOMEONE ELSE" BRANCH — the single source of truth behind both the `GuardedButton` on K-5 (which must be disabled, with a reason, before anybody presses Continue — CLAUDE.md §6: blocked states are unreachable, not merely inert) and `decideAssignor`'s final allow/refuse call below, so the two can never drift apart on what counts as blocked. | **2** · web:kiosk/Ceremony.tsx, web:kiosk/screens/AssignorScreen.tsx |
| `DateOfBirthParts` | web:kiosk/rules/verify-fields.ts |  | **2** · web:patient/portal/activate/[token]/ActivateView.tsx, web:practice/patients/NewAgreementPanel.tsx |
| `Db4Page` | web:kiosk/rules/db4-pages.ts |  | **2** · web:kiosk/Ceremony.tsx, web:kiosk/screens/ParticularsScreen.tsx |
| `DetailAnswer` | web:kiosk/rules/pushed-details.ts | A TICK OR A CROSS, AND THERE IS NO THIRD ANSWER (Carl, 4 Sep 2026). | **2** · web:kiosk/Ceremony.tsx, web:kiosk/screens/CheckDetailsScreen.tsx |
| `DetailAnswers` | web:kiosk/rules/pushed-details.ts |  | **2** · web:kiosk/Ceremony.tsx, web:kiosk/screens/CheckDetailsScreen.tsx |
| `PatientDetails` | web:practice/tablet/pushDesk.tsx | The six correctable details, as the server hands them back. | **2** · web:practice/patients/NewAgreementPanel.tsx, web:practice/patients/PatientWorkView.tsx |
| `PortalActivationChallenge` | web:patient/portal/api.ts | `GET /portal/activate/:token/challenge` — which boxes the activation page should draw (FR-1.14). | **2** · web:patient/portal/activate/[token]/ActivateView.tsx, web:patient/portal/fixtures.ts |
| `PortalLink` | web:patient/portal/api.ts | One practice this account is linked to. | **2** · web:patient/portal/PortalView.tsx, web:patient/portal/cards/PracticeFilter.tsx |
| `PortalTermination` | web:patient/portal/api.ts | `POST /portal/enduring/:id/terminate` — the written notice, and when it bites. | **2** · web:patient/portal/cards/EnduringCard.tsx, web:patient/portal/fixtures.ts |
| `PushDesk` | web:practice/tablet/pushDesk.tsx | (file) THE PUSH DESK — the one implementation of reception's tablet controls, rendered by two pages (Carl, 4 Sep 2026). | **2** · web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/SmallDeskView.tsx |
| `SignaturePadHandle` | web:kiosk/components/SignaturePad.tsx |  | **2** · web:kiosk/Ceremony.tsx, web:kiosk/screens/SignatureScreen.tsx |
| `TemplateBody` | web:practice/templates/templateEditing.ts | Exactly the four fields `POST /agreement-templates` reads out of `body`. | **2** · web:practice/templates/TemplateForm.tsx, web:practice/templates/TemplatesView.tsx |
| `VerificationState` | web:kiosk/rules/verification.ts |  | **2** · web:kiosk/Ceremony.tsx, web:kiosk/screens/VerifyScreen.tsx |
| `AgreementResponse` | web:kiosk/api.ts | `GET /agreements/:id` — only the fields the ceremony reads. | **1** · web:kiosk/Ceremony.tsx |
| `ChecklistRow` | web:practice/frontdesk/visitChecklist.ts |  | **1** · web:practice/frontdesk/FrontDeskView.tsx |
| `ChecklistState` | web:practice/frontdesk/visitChecklist.ts | WHERE ONE SERVICE ON THIS PATIENT'S LIST HAS GOT TO (`VISIT-CHECKLIST.md` §3a; Carl, 12 September 2026: *"What you call 'Paper work' per patient, I call the patient service list. | **1** · web:practice/frontdesk/dayRails.ts |
| `CopyOfferResponse` | web:kiosk/api.ts |  | **1** · web:kiosk/screens/CompleteScreen.tsx |
| `CoveredServiceRow` | web:practice/tablet/pushDesk.tsx | A VISIT THAT NEEDED NO SECOND SIGNATURE — a history line on the desk, never a Send (Carl, 11 Sep 2026, step 4). | **1** · web:practice/frontdesk/visitChecklist.ts |
| `DayRailRow` | web:practice/frontdesk/dayRails.ts | ONE LINE ON THE RAIL. | **1** · web:practice/frontdesksmall/deskLines.ts |
| `DeskLine` | web:practice/frontdesksmall/deskLines.ts | ONE LINE OF THE LIST. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `DeskState` | web:practice/frontdesksmall/deskLines.ts | THE SIX MARKERS A LINE CAN CARRY, and the first five are the chips. | **1** · web:practice/frontdesksmall/SmallDeskView.tsx |
| `DetailRow` | web:kiosk/rules/pushed-details.ts |  | **1** · web:kiosk/screens/CheckDetailsScreen.tsx |
| `GateLedgerState` | web:apply/GateLedger.tsx |  | **1** · web:apply/ApplyForm.tsx |
| `GateState` | web:apply/GateLedger.tsx | ATTESTED is deliberately its own state, not a flavour of `passed`. | **1** · web:status/[token]/StatusView.tsx |
| `IdentifierParts` | web:kiosk/rules/verify-fields.ts |  | **1** · web:kiosk/screens/VerifyScreen.tsx |
| `MoveSummary` | web:practice/practitioner/waiting/MovePanel.tsx |  | **1** · web:practice/practitioner/waiting/WaitingView.tsx |
| `PairedOutcome` | web:kiosk/screens/PairingScreen.tsx |  | **1** · web:kiosk/Ceremony.tsx |
| `PairingFailure` | web:kiosk/screens/PairingScreen.tsx | What happened to the last attempt. | **1** · web:kiosk/Ceremony.tsx |
| `ParticularsView` | web:kiosk/screens/ParticularsScreen.tsx |  | **1** · web:kiosk/Ceremony.tsx |
| `PortalSession` | web:patient/portal/api.ts | `GET /portal/session`. | **1** · web:patient/portal/fixtures.ts |
| `QueueRow` | web:review/QueueView.tsx | One row of the pending queue, as the API returns it. | **1** · web:review/[id]/DossierView.tsx |
| `RecordCheckInput` | web:review/CheckRecorder.tsx |  | **1** · web:review/[id]/DossierView.tsx |
| `SignRequestBody` | web:kiosk/rules/signature-payload.ts |  | **1** · web:kiosk/api.ts |
| `TemplateFormProblem` | web:practice/templates/templateEditing.ts | WHY THIS WORDING CANNOT BE SAVED YET — one entry per outstanding reason. | **1** · web:practice/templates/TemplateForm.tsx |
| `TemplateFormState` | web:practice/templates/templateEditing.ts | THE FORM'S OWN SHAPE, and the two places it differs from the body are both deliberate. | **1** · web:practice/templates/TemplateForm.tsx |
| `WaitingListResponse` | web:kiosk/api.ts | `GET /kiosk/waiting-list`. | **1** · web:kiosk/useWaitingList.ts |
| `WhoDraft` | web:practice/tablet/pushDesk.tsx | What the who-is-signing panel is holding, before it is saved. | **1** · web:practice/patients/NewAgreementPanel.tsx |
| `ActingAs` | web:effectivePractice.ts |  | 0 |
| `AgreementGateFacts` | web:kiosk/rules/signature-gate.ts | What the kiosk knows about an agreement, as `GET /agreements/:id` returns it. | 0 |
| `AssignorDecision` | web:kiosk/rules/assignor.ts |  | 0 |
| `AttemptOutcome` | web:kiosk/rules/verification.ts |  | 0 |
| `AttemptResponse` | web:kiosk/api.ts |  | 0 |
| `CeremonyRoute` | web:kiosk/rules/ceremony-steps.ts |  | 0 |
| `CeremonySequence` | web:kiosk/rules/ceremony-steps.ts | The steps one route will run, in the order it will run them. | 0 |
| `ChallengeResponse` | web:kiosk/api.ts |  | 0 |
| `ChangeAssignorRequest` | web:kiosk/api.ts | SOMEBODY OTHER THAN THE PATIENT IS SIGNING — or the patient is after all. | 0 |
| `ChecklistDetail` | web:practice/frontdesk/visitChecklist.ts | WHICH SENTENCE THE ROW SAYS. | 0 |
| `ChecklistKey` | web:practice/frontdesk/visitChecklist.ts | THE ROWS OF `VISIT-CHECKLIST.md` §2 THAT ARE OURS — four of paperwork, and since D-2026-09-12-20 the visit itself between them. | 0 |
| `CopyOfferChannelResponse` | web:kiosk/api.ts | A channel the signer may be offered, with the address MASKED by the server. | 0 |
| `CorrectionSubject` | web:practice/tablet/pushDesk.tsx | WHAT ONE CORRECTION IS ABOUT. | 0 |
| `DayRails` | web:practice/frontdesk/dayRails.ts | The groups a day's rows can be printed under. | 0 |
| `DayReads` | web:practice/frontdesksmall/useDayReads.ts |  | 0 |
| `EmailStatus` | web:EmailStatusChip.tsx |  | 0 |
| `GuardedState` | web:kiosk/components/Buttons.tsx |  | 0 |
| `HeartbeatState` | web:kiosk/useKioskHeartbeat.ts |  | 0 |
| `InactivityState` | web:kiosk/useInactivityReset.ts |  | 0 |
| `KioskClaimResponse` | web:kiosk/api.ts | `POST /kiosk/claim` — the walk-up front door. | 0 |
| `KioskHeartbeatRequest` | web:kiosk/api.ts | `POST /kiosk/heartbeat` — WHERE THIS TABLET IS, AND WHAT RECEPTION WANTS IT TO DO (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat and Return to Begin"). | 0 |
| `KioskHeartbeatResponse` | web:kiosk/api.ts |  | 0 |
| `KioskMeResponse` | web:kiosk/api.ts | `GET /kiosk/me` — who this tablet is, answered by the server. | 0 |
| `KioskSignatureMethod` | web:kiosk/rules/signature-payload.ts |  | 0 |
| `KioskStrings` | web:kiosk/strings.ts |  | 0 |
| `LockFailure` | web:kiosk/Ceremony.tsx | WHOSE FAULT WAS IT — the distinction the Expo build did not draw, and Carl found it on a live tablet. | 0 |
| `LoginOptions` | web:auth.ts | ASK KEYCLOAK TO AUTHENTICATE THE PERSON AGAIN, EVEN IF IT ALREADY HAS (AUTH-TIERS.md §5.2, D-2026-09-12-11). | 0 |
| `MessageBody` | web:correspondence/MessageLog.tsx | What a row said, fetched or held by whoever owns the query. | 0 |
| `NameParts` | web:kiosk/rules/verify-fields.ts |  | 0 |
| `NumberedStep` | web:kiosk/rules/ceremony-steps.ts | The steps that carry a number. | 0 |
| `Option` | web:kiosk/components/Field.tsx |  | 0 |
| `Option` | web:kiosk/rules/verify-fields.ts |  | 0 |
| `PairingResponse` | web:kiosk/api.ts | `POST /devices/pair` — the one call made with no credential, because it earns one. | 0 |
| `PendingRow` | web:practice/reconciliation/ServiceDescriptionsNeeded.tsx |  | 0 |
| `Point` | web:kiosk/components/SignaturePad.tsx | The wire shapes, imported rather than restated — one definition (REQ-SIG-01). | 0 |
| `PortalActsForMe` | web:patient/portal/api.ts | Somebody nominated to act for this patient (REQ-PORT-07, REQ-VUL-01). | 0 |
| `PortalIActFor` | web:patient/portal/api.ts | A patient this account acts for — scoped, and never their clinical anything. | 0 |
| `PracticeSelection` | web:practice/usePractice.tsx |  | 0 |
| `PracticeUsersResponse` | web:kiosk/api.ts |  | 0 |
| `PractitionersMode` | web:practice/practitioners/PractitionersView.tsx | WHOSE WORK IS BEING DONE ON THIS PAGE — and there are two answers, which is the thing acting-as alone could not express. | 0 |
| `RefusalContext` | web:practice/tablet/pushDesk.tsx | What only the caller knows at the moment of a refusal. | 0 |
| `RefusalDescription` | web:practice/tablet/pushDesk.tsx | WHAT ONE REFUSAL SHOWS: the sentence, and — where there is somewhere to go — a link or a Recall action right there in the band (Carl, 4 Sep 2026: a pushable row that the server then refused told reception nothing true and pointed at a screen that does not exist). | 0 |
| `SendStepState` | web:practice/tablet/pushDesk.tsx | WHICH STEP THE ROW IS ON — one function, so the strip and the controls cannot come to disagree about the order they are both describing. | 0 |
| `SessionChangeReason` | web:auth.ts | THE ONE SIGNAL EVERY UI THAT SHOWS "SIGNED IN" LISTENS FOR (Carl, 7 Sep 2026). | 0 |
| `Situation` | web:practice/frontdesk/visitChecklist.ts | Everything the panel can be looking at, as one word. | 0 |
| `StaffSession` | web:kiosk/session.ts |  | 0 |
| `Stroke` | web:kiosk/components/SignaturePad.tsx |  | 0 |
| `TabletSessionResponse` | web:kiosk/api.ts | `GET /kiosk/session` — the one pushed session, or none. | 0 |
| `TabletSessionState` | web:kiosk/useTabletSession.ts |  | 0 |
| `WaitingListResult` | web:kiosk/api.ts |  | 0 |
| `WaitingListState` | web:kiosk/useWaitingList.ts |  | 0 |
| `WhoFault` | web:practice/tablet/pushDesk.tsx |  | 0 |
| `WhoFaultField` | web:practice/tablet/pushDesk.tsx | Which control a refusal belongs under — the one the reader must fix. | 0 |

## Domain functions

388 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `audiencesOf` | domain:page-access.ts | What somebody is allowed to be, given what the token and the staff row say. | **10** · web:AccessGuard.tsx, web:BackLink.tsx, web:MainMenu.tsx, +7 more |
| `mayReach` | domain:page-access.ts | May this audience open this page? | **10** · web:AccessGuard.tsx, web:BackLink.tsx, web:MainMenu.tsx, +7 more |
| `HardRuleViolation` | domain:guards.ts |  | **6** · core:agreements/agreements.service.ts, core:arrivals/arrivals.service.ts, core:enduring/enduring.service.ts, +3 more |
| `chaseBandFor` | domain:chase.ts |  | **5** · core:arrivals/post-service-chase.sweep.ts, core:auto-capture/auto-capture.service.ts, core:chase-attempts/chase-attempts.service.ts, +2 more |
| `isPlatformOperator` | domain:landing.ts |  | **5** · web:practice/locations/LocationsView.tsx, web:practice/practitioners/PractitionersView.tsx, web:practice/queue/QueueView.tsx, +2 more |
| `landingPath` | domain:landing.ts |  | **5** · web:AccessGuard.tsx, web:MainMenu.tsx, web:NotFoundView.tsx, +2 more |
| `assertValidIdentifierSet` | domain:identifiers.ts | Validates a practice's configured identifier challenge set. | **4** · core:portal/portal.service.ts, core:practices/practices.service.ts, core:verification/verification.service.ts, +1 more |
| `attemptAllowed` | domain:chase.ts |  | **4** · core:chase-attempts/chase-attempts.service.ts, core:reconciliation/reconciliation.service.ts, domain:chase-attempt.ts, +1 more |
| `daysRemainingInLodgementWindow` | domain:chase.ts |  | **4** · core:arrivals/post-service-chase.sweep.ts, core:auto-capture/auto-capture.service.ts, core:chase-attempts/chase-attempts.service.ts, +1 more |
| `detailTypeForPatientField` | domain:tablet-session.ts |  | **4** · core:arrivals/arrivals.service.ts, core:patients/patients.service.ts, core:tablet-sessions/tablet-sessions.service.ts, +1 more |
| `isValidAhpraNumberFormat` | domain:enrolment-ceremony.ts |  | **4** · core:affiliations/affiliations.service.ts, core:organisations/organisations.service.ts, web:practice/practitioners/PractitionersView.tsx, +1 more |
| `kioskIdleTimeoutOrDefault` | domain:kiosk.ts | WHAT THE TABLET USES when the server said nothing it can believe. | **4** · core:kiosk/kiosk.service.ts, web:kiosk/Ceremony.tsx, web:kiosk/useInactivityReset.ts, +1 more |
| `normalisePhone` | domain:contacts.ts | Reduce an Australian telephone number to a comparable form. | **4** · core:agreements/agreements.service.ts, domain:agreement-copy.ts, domain:assignor.ts, +1 more |
| `profileAllows` | domain:practice-surfaces.ts | May a practice on this profile open this console page? | **4** · web:AccessGuard.tsx, web:MainMenu.tsx, web:practice/setup/SetupHub.tsx, +1 more |
| `relationshipNeedsFreeText` | domain:assignor-relationships.ts | True for the one option that reveals a required "Please describe" box. | **4** · web:kiosk/rules/assignor.ts, web:kiosk/screens/AssignorScreen.tsx, web:practice/patients/NewAgreementPanel.tsx, +1 more |
| `AgreementTemplateError` | domain:agreement-templates.ts |  | **3** · core:agreements/agreements.service.ts, core:templates/templates.service.ts, web:practice/templates/TemplateForm.tsx |
| `IdentifierSetError` | domain:identifiers.ts |  | **3** · core:portal/portal.service.ts, core:practices/practices.service.ts, core:verification/verification.service.ts |
| `authorityBasisFor` | domain:assignor-relationships.ts | The basis for a chosen relationship, and the note that goes with it. | **3** · web:kiosk/rules/assignor.ts, web:practice/patients/NewAgreementPanel.tsx, web:practice/tablet/pushDesk.tsx |
| `basicServiceDescriptionOf` | domain:service-descriptions.ts | D6a, READ THE SAME WAY EVERYWHERE IT MATTERS — ONE COPY (Carl flagged the gap live, 4 Sep 2026, over `supersedeForCorrection` losing it; unified 7 Sep 2026 after a review found the helper byte-identical in two services). | **3** · core:agreements/agreements.service.ts, core:kiosk/kiosk.service.ts, core:tablet-sessions/tablet-sessions.service.ts |
| `buildMessageLog` | domain:correspondence-log.ts | The log, from the dispatches that happened and the sends that were suppressed before they could. | **3** · web:patient/messages/[token]/PatientMessagesView.tsx, web:practice/correspondence/CorrespondenceView.tsx, web:practitioner/messages/MessagesView.tsx |
| `contactClash` | domain:contacts.ts | Which channel, if any, the two contacts share. | **3** · web:apply/ApplyForm.tsx, web:status/[token]/correct/CorrectView.tsx, domain:review.ts |
| `isBillingRole` | domain:billing-roles.ts |  | **3** · core:affiliations/affiliations.service.ts, core:arrivals/arrivals.service.ts, core:practices/practices.service.ts |
| `isCorrectablePatientField` | domain:tablet-session.ts |  | **3** · core:patients/patients.service.ts, core:tablet-sessions/tablet-sessions.service.ts, web:practice/tablet/pushDesk.tsx |
| `isServiceDescription` | domain:service-descriptions.ts | Is this exactly one of the descriptions the current list offers? | **3** · core:kiosk/kiosk.service.ts, core:service-descriptions/service-descriptions.service.ts, core:tablet-sessions/tablet-sessions.service.ts |
| `isTheServiceRenderedSignal` | domain:visit-states.ts | Setting this is the service-rendered signal (§3a rule 3). | **3** · core:practitioner-queue/practitioner-queue.service.ts, web:practice/frontdesk/dayRails.ts, web:practice/frontdesk/visitChecklist.ts |
| `latestVisitState` | domain:visit-states.ts | WHERE A VISIT HAS GOT TO — the newest record, or the starting state. | **3** · core:arrivals/arrivals.service.ts, core:practitioner-queue/practitioner-queue.service.ts, core:tablet-sessions/tablet-sessions.service.ts |
| `matrix` | domain:reporting.ts | Months down the side, positions within the month across the top. | **3** · core:outbound/outbound.service.ts, web:practice/reports/ReportsView.tsx, web:practitioner/messages/MessagesView.tsx |
| `mayBeProviderOnAgreement` | domain:billing-roles.ts | MAY THIS PERSON BE THE PROVIDER ON AN AGREEMENT AT THIS LOCATION? | **3** · core:arrivals/arrivals.service.ts, core:tablet-sessions/tablet-sessions.service.ts, domain:guards.ts |
| `normaliseEmail` | domain:contacts.ts | One mailbox, case-insensitively. | **3** · core:agreements/agreements.service.ts, domain:agreement-copy.ts, domain:assignor.ts |
| `practiceDisplayLabel` | domain:account-naming.ts | The practice's half of that label. | **3** · core:identity/identity.service.ts, core:identity/practice-admin.service.ts, core:practices/practice-users.service.ts |
| `profileSurfaces` | domain:practice-surfaces.ts | The surfaces a named profile switches on. | **3** · core:practices/practices.service.ts, core:practices/surface.guard.ts, web:practice/channels/ChannelsView.tsx |
| `webAuthnDisplayName` | domain:account-naming.ts | WHAT A PERSON READS AT THE PASSKEY PICKER (section 3c) -- and it leads with the practice, because that is the part that distinguishes it. | **3** · core:identity/identity.service.ts, core:identity/practice-admin.service.ts, core:practices/practice-users.service.ts |
| `AbnError` | domain:abn.ts |  | **2** · core:common/domain-exception.filter.ts, core:organisations/organisations.service.ts |
| `AffiliationError` | domain:affiliation.ts |  | **2** · core:affiliations/affiliations.service.ts, core:common/domain-exception.filter.ts |
| `CeremonyError` | domain:enrolment-ceremony.ts |  | **2** · core:common/domain-exception.filter.ts, core:identity/identity.service.ts |
| `ContactError` | domain:contacts.ts |  | **2** · core:organisations/applicant.service.ts, core:organisations/organisations.service.ts |
| `PendingEmailChangeError` | domain:pending-email-change.ts |  | **2** · core:identity/practitioner-email.service.ts, core:organisations/pending-email.service.ts |
| `abnLookupUrl` | domain:external-links.ts | One ABN's page on ABN Lookup. | **2** · web:OrgConsole.tsx, web:apply/ApplyForm.tsx |
| `afterFailure` | domain:outbound-queue.ts | What happens after a failed attempt. | **2** · core:inbound/inbound-print-jobs.service.ts, core:outbound/outbound.service.ts |
| `afterPermanentFailure` | domain:outbound-queue.ts | A permanent failure — a malformed address, a destination that does not exist. | **2** · core:inbound/inbound-print-jobs.service.ts, core:outbound/outbound.service.ts |
| `assertConfirmable` | domain:pending-email-change.ts |  | **2** · core:identity/practitioner-email.service.ts, core:organisations/pending-email.service.ts |
| `assertContactsIndependent` | domain:contacts.ts | Server-side enforcement. | **2** · core:organisations/applicant.service.ts, core:organisations/organisations.service.ts |
| `assertEnduringAllowed` | domain:guards.ts |  | **2** · core:agreements/agreements.service.ts, core:enduring/enduring.service.ts |
| `assertNoForbiddenAgreementFields` | domain:guards.ts | Recursively asserts a payload carries none of the forbidden fields. | **2** · core:agreements/agreements.service.ts, vault:events/events.service.ts |
| `assertStoppable` | domain:pending-email-change.ts | Stopping is allowed for longer than confirming, and after expiry. | **2** · core:identity/practitioner-email.service.ts, core:organisations/pending-email.service.ts |
| `assessAdmission` | domain:checks.ts | What HARD enforcement would decide, computed while enforcement is SOFT. | **2** · core:identity-dashboard/identity-dashboard.service.ts, core:organisations/checks.service.ts |
| `authMethodFromAmr` | domain:auth-method.ts | Read the token's `amr` claim as a product answer. | **2** · core:auth/actor.decorator.ts, core:auth/auth.guard.ts |
| `buildAssignorForAnother` | domain:assignor.ts | Every refusal on this path, in the order a person would meet them, each throwing a `HardRuleViolation` that names the RULE and never the name that was typed (no PII in errors — definition of done). | **2** · core:agreements/agreements.service.ts, core:arrivals/arrivals.service.ts |
| `calendarFor` | domain:enduring.ts | Builds the calendar for a state, covering the year of the notice and the next (a late-December notice crosses into January, where the substituted New Year holidays live). | **2** · core:affiliations/affiliations.service.ts, core:enduring/enduring.service.ts |
| `canActAsAssignor` | domain:guards.ts |  | **2** · web:kiosk/rules/assignor.ts, domain:assignor.ts |
| `canTransition` | domain:lifecycle.ts |  | **2** · core:agreements/agreements.service.ts, core:retention/retention-sweep.service.ts |
| `chaseNextStep` | domain:chase.ts |  | **2** · core:chase-attempts/chase-attempts.service.ts, core:reconciliation/reconciliation.service.ts |
| `checksAffectedBy` | domain:amendment.ts | Which already-recorded checks an amendment bears on. | **2** · core:organisations/applicant.service.ts, core:organisations/organisations.service.ts |
| `classifyAssignorChange` | domain:assignor.ts |  | **2** · core:agreements/agreements.service.ts, web:practice/tablet/pushDesk.tsx |
| `computeSignability` | domain:kiosk.ts | THE CHEAP, STRUCTURAL PRECHECK BEHIND `signable` — deliberately not a call to the rules engine. | **2** · core:kiosk/kiosk.service.ts, core:tablet-sessions/tablet-sessions.service.ts |
| `deviceState` | domain:devices.ts | The one place the four states are decided, so the console and the server cannot disagree about what a row IS. | **2** · core:devices/devices.service.ts, core:organisations/setup.service.ts |
| `diffApplication` | domain:amendment.ts | The difference between what was submitted and what is being proposed. | **2** · core:organisations/applicant.service.ts, core:organisations/organisations.service.ts |
| `establishingEntitlementCheck` | domain:checks.ts | Which recorded check establishes that this applicant speaks for this entity. | **2** · core:organisations/organisations.service.ts, web:review/[id]/DossierView.tsx |
| `expiresAt` | domain:pending-email-change.ts |  | **2** · core:identity/practitioner-email.service.ts, core:organisations/pending-email.service.ts |
| `isAffiliationVelocityAnomalous` | domain:affiliation.ts | REQ-ANOM-01 — surface, never block. | **2** · core:affiliations/affiliations.service.ts, core:identity-dashboard/identity-dashboard.service.ts |
| `isPairingCodeShape` | domain:devices.ts | Shape only — whether it is a LIVE code is the server's question, not this one. | **2** · core:devices/devices.service.ts, web:kiosk/screens/PairingScreen.tsx |
| `isValidAbnChecksum` | domain:abn.ts | The ATO's published ABN check: subtract 1 from the leading digit, apply the weights, and the weighted sum must be divisible by 89. | **2** · core:organisations/organisations.service.ts, web:apply/ApplyForm.tsx |
| `kioskPollMs` | domain:kiosk.ts |  | **2** · core:devices/devices.service.ts, core:kiosk/kiosk.service.ts |
| `matchesPracticeStaff` | domain:assignor.ts | REQ-VUL-04 / hard rule 10 — the practice-staff comparison. | **2** · web:kiosk/rules/assignor.ts, web:practice/tablet/pushDesk.tsx |
| `mayChoosePractice` | domain:landing.ts | May this person choose which practice they are looking at? | **2** · web:practice/PracticeList.tsx, web:practice/usePractice.tsx |
| `normaliseAbn` | domain:abn.ts | Strip the spaces the ABR itself prints ("51 824 753 556"). | **2** · core:organisations/organisations.service.ts, web:apply/ApplyForm.tsx |
| `remoteChannelFor` | domain:auto-capture.ts | Which remote channel reaches this patient. | **2** · core:arrivals/post-service-chase.sweep.ts, core:auto-capture/auto-capture.service.ts |
| `renderAgreementTemplate` | domain:agreement-templates.ts | Substitute the values in, resolving the branches first. | **2** · core:agreements/agreements.service.ts, web:practice/templates/TemplateForm.tsx |
| `renderPatientMessage` | domain:patient-message-templates.ts | Substitute the values in. | **2** · core:agreement-copy/agreement-copy.service.ts, core:portal/portal-invitation.dispatcher.ts |
| `reviewFlags` | domain:review.ts | The flags for one application, worst first. | **2** · web:review/QueueView.tsx, web:review/[id]/DossierView.tsx |
| `safeReturnPath` | domain:redirect.ts | A same-origin path, or `/`. | **2** · web:auth.ts, domain:landing.ts |
| `servicesNeedABillingProvider` | domain:billing-roles.ts | DOES A VISIT TO SOMEBODY IN THIS ROLE NEED A BILLING PROVIDER AT ALL? | **2** · core:arrivals/arrivals.service.ts, core:practitioner-queue/practitioner-queue.service.ts |
| `summariseChecks` | domain:checks.ts | Summarise the LATEST outcome per check key. | **2** · core:identity-dashboard/identity-dashboard.service.ts, core:organisations/checks.service.ts |
| `whoTheyCameToSee` | domain:practitioner-queue.ts | WHICH PRACTITIONER THE PATIENT CAME TO SEE, from the arrival's two fields. | **2** · core:arrivals/arrivals.service.ts, core:practitioner-queue/practitioner-queue.service.ts |
| `withinCoolingOff` | domain:pending-email-change.ts |  | **2** · core:identity/practitioner-email.service.ts, core:organisations/pending-email.service.ts |
| `ActingAsError` | domain:acting-as.ts |  | **1** · core:acting-as/acting-as.service.ts |
| `AddressCheckError` | domain:address-check.ts |  | **1** · core:organisations/organisations.service.ts |
| `AddressError` | domain:address.ts |  | **1** · core:organisations/organisations.service.ts |
| `AhpraError` | domain:ahpra.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `AmendmentError` | domain:amendment.ts |  | **1** · core:organisations/applicant.service.ts |
| `ArtefactError` | domain:artefact.ts |  | **1** · core:artefacts/artefacts.service.ts |
| `ChaseAttemptError` | domain:chase-attempt.ts |  | **1** · core:chase-attempts/chase-attempts.service.ts |
| `CheckError` | domain:checks.ts |  | **1** · core:organisations/checks.service.ts |
| `DepartureNoticeError` | domain:departure-notice.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `DirectoryError` | domain:directory.ts |  | **1** · core:common/domain-exception.filter.ts |
| `LogoError` | domain:practice-logo.ts |  | **1** · core:practices/letterhead.service.ts |
| `MethodFidelityError` | domain:notice.ts |  | **1** · core:notices/notices.service.ts |
| `NotACalendarDay` | domain:practice-day.ts | Thrown for a date that is not a real calendar day. | **1** · core:arrivals/arrivals.service.ts |
| `NoticeContentError` | domain:notice.ts |  | **1** · core:notices/notices.service.ts |
| `OutboundQueueError` | domain:outbound-queue.ts |  | **1** · core:outbound/outbound.service.ts |
| `PracticeUserError` | domain:practice-users.ts |  | **1** · core:practices/practice-users.service.ts |
| `PractitionerDepartureError` | domain:practitioner-departure.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `ReconciliationDecisionError` | domain:reconciliation-decision.ts |  | **1** · core:reconciliation/reconciliation.service.ts |
| `ReportingError` | domain:reporting.ts |  | **1** · core:outbound/outbound.service.ts |
| `SignatureCaptureError` | domain:signature.ts |  | **1** · core:agreements/agreements.service.ts |
| `actingAsReason` | domain:acting-as.ts |  | **1** · core:acting-as/acting-as.service.ts |
| `addressWarnings` | domain:address.ts | Non-blocking observations, for the same reason G-NAF gaps are non-blocking. | **1** · core:organisations/organisations.service.ts |
| `adminUsername` | domain:account-naming.ts | THE PRACTICE'S OWN ACCOUNT. | **1** · core:identity/account-names.ts |
| `afterStop` | domain:pending-email-change.ts | What a stop means for the account, which is more than discarding a row. | **1** · core:organisations/pending-email.service.ts |
| `agreementTemplateProblems` | domain:agreement-templates.ts | Every problem with one template body, in the order the loader would hit them. | **1** · web:practice/templates/templateEditing.ts |
| `anniversaryWarningBand` | domain:enduring.ts | The warning band to surface, or null when none is due (REQ-END-03: 90/60/30). | **1** · core:enduring/enduring.service.ts |
| `assertAddressUsable` | domain:address.ts | The bar for a PLACE OF PRACTICE, whose address is rendered into the s 65C(5)(a) particulars. | **1** · core:organisations/organisations.service.ts |
| `assertAffiliationTransition` | domain:affiliation.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `assertAgreementTemplateBody` | domain:agreement-templates.ts | Validate one template body — the shape a PRACTICE VARIANT is checked against too, which is why it is exported separately from the whole-file parse. | **1** · core:templates/templates.service.ts |
| `assertAmendmentAllowed` | domain:amendment.ts | Server-side gate. | **1** · core:organisations/applicant.service.ts |
| `assertBackupUsable` | domain:pending-email-change.ts | A backup address, and why it is what makes the rest workable. | **1** · core:identity/practitioner-email.service.ts |
| `assertCanBeProviderOnAgreement` | domain:guards.ts | THE PROVIDER ON AN AGREEMENT IS THE SERVICING PROVIDER (Carl, 5–7 Sep 2026; TODO.md "Billing role on the affiliation"). | **1** · core:agreements/agreements.service.ts |
| `assertCeremonySufficient` | domain:enrolment-ceremony.ts | The gate. | **1** · core:identity/identity.service.ts |
| `assertChaseAttemptAllowed` | domain:chase-attempt.ts | May this attempt be recorded? | **1** · core:chase-attempts/chase-attempts.service.ts |
| `assertChaseSubjectChaseable` | domain:chase-attempt.ts | RULE 7, ENFORCED RATHER THAN DOCUMENTED. | **1** · core:chase-attempts/chase-attempts.service.ts |
| `assertCheckRecordable` | domain:checks.ts | The gate on recording a check. | **1** · core:organisations/checks.service.ts |
| `assertDecisionAllowed` | domain:reconciliation-decision.ts | May this decision be recorded now? | **1** · core:reconciliation/reconciliation.service.ts |
| `assertDirectoryQueryAllowed` | domain:directory.ts | Directory lookup takes an AHPRA number and nothing else. | **1** · core:affiliations/affiliations.service.ts |
| `assertLogoAcceptable` | domain:practice-logo.ts | Accept or refuse the bytes, and say which they are. | **1** · core:practices/letterhead.service.ts |
| `assertMayAddUser` | domain:practice-users.ts | May this practice add another console user here? | **1** · core:practices/practice-users.service.ts |
| `assertMayApproveAfterActingAs` | domain:acting-as.ts | May this person approve this practice? | **1** · core:acting-as/acting-as.service.ts |
| `assertMayRequest` | domain:pending-email-change.ts | Whether this request may be made at all. | **1** · core:organisations/pending-email.service.ts |
| `assertMayRequestGroupEmail` | domain:pending-email-change.ts | Whether a groupEmail request may be made at all — the mirror of {@link assertMayRequest}, minus the checks that only make sense for a credential. | **1** · core:organisations/pending-email.service.ts |
| `assertMethodFidelity` | domain:notice.ts | REQ-DEL-02 — METHOD FIDELITY. | **1** · core:notices/notices.service.ts |
| `assertNoProviderNumber` | domain:directory.ts | A guard for the boundary: refuses to serialise anything carrying a provider number. | **1** · core:affiliations/affiliations.service.ts |
| `assertNotChurning` | domain:pending-email-change.ts |  | **1** · core:identity/practitioner-email.service.ts |
| `assertNoticeContentComplete` | domain:notice.ts |  | **1** · core:notices/notices.service.ts |
| `assertOrganisationApplicationValid` | domain:abn.ts | Throws unless the ABN is well-formed and ACTIVE, the typed name matches a registered name, and any supplied ACN agrees with the one derived from the ABN. | **1** · core:organisations/organisations.service.ts |
| `assertPracticeCode` | domain:account-naming.ts | A code is checked at every use, not only at allocation. | **1** · core:practices/practice-code.ts |
| `assertQueueable` | domain:outbound-queue.ts |  | **1** · core:outbound/outbound.service.ts |
| `assertRecordableCheck` | domain:address-check.ts | Is this confirmation recordable? | **1** · core:organisations/organisations.service.ts |
| `assertRegistrationPermitsPractice` | domain:ahpra.ts | A blocking check, and a deliberately narrow one: only the registration STATUS refuses. | **1** · core:affiliations/affiliations.service.ts |
| `assertRepointAllowed` | domain:assignor.ts |  | **1** · core:agreements/agreements.service.ts |
| `assertResendNote` | domain:outbound-queue.ts | The note, checked against the rule. | **1** · core:outbound/outbound.service.ts |
| `assertSendableRejection` | domain:address-check.ts | Is this rejection sendable? | **1** · core:organisations/organisations.service.ts |
| `assertSightingAttributable` | domain:ahpra.ts | A manual sighting is a person's word about a public register, so it must name them — exactly as the ABR attestation does. | **1** · core:affiliations/affiliations.service.ts |
| `assertSignatureAllowed` | domain:guards.ts |  | **1** · core:agreements/agreements.service.ts |
| `assertSignatureCaptureAcceptable` | domain:signature.ts | Is this signature payload acceptable, and does it belong with this method? | **1** · core:agreements/agreements.service.ts |
| `assertUploadAcceptable` | domain:artefact.ts |  | **1** · core:artefacts/artefacts.service.ts |
| `assessDeparture` | domain:departure-notice.ts | Assess a departure, with or without an external attestation. | **1** · core:affiliations/affiliations.service.ts |
| `assessPractitionerDeparture` | domain:practitioner-departure.ts | Whether this affiliation can be departed at all, and when it ends. | **1** · core:affiliations/affiliations.service.ts |
| `assignorRepointDisposition` | domain:assignor.ts |  | **1** · core:agreements/agreements.service.ts |
| `autoAssignorDecision` | domain:auto-capture.ts | May the patient be made their own assignor with nobody asking? | **1** · core:auto-capture/auto-capture.service.ts |
| `backoffFor` | domain:outbound-queue.ts |  | **1** · aobprinter:outbox.ts |
| `blockingFlags` | domain:review.ts | Whether any flag refuses the approval outright. | **1** · web:review/[id]/DossierView.tsx |
| `bucketKey` | domain:reporting.ts | `2026-Q3`, `2026-08`, `2026-W34`, `2026-08-22`, or `all`. | **1** · core:outbound/outbound.service.ts |
| `canAnswerInvitation` | domain:invitation.ts |  | **1** · core:affiliations/invitation.service.ts |
| `canCaptureUnder` | domain:affiliation.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `canChangeTabletSessionState` | domain:tablet-session.ts | MAY THIS SESSION MOVE TO THAT STATE? | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `canEnableSignature` | domain:guards.ts | The ONLY way any surface may decide whether the signature control enables. | **1** · web:kiosk/rules/signature-gate.ts |
| `captureBlockReason` | domain:affiliation.ts | The same question, with the reason — for surfacing in a console. | **1** · core:affiliations/affiliations.service.ts |
| `captureReadiness` | domain:setup.ts | Whether consent capture can actually happen, and if not, why not. | **1** · core:organisations/setup.service.ts |
| `chaseAttemptOrdinal` | domain:chase-attempt.ts | Which rung this attempt is, for display and for the vault payload. | **1** · core:chase-attempts/chase-attempts.service.ts |
| `closesItem` | domain:reconciliation-decision.ts | What the queue does with the item after the decision. | **1** · core:reconciliation/reconciliation.service.ts |
| `compareForReview` | domain:review.ts | Sort comparator: worst first, and oldest first within equal severity. | **1** · web:review/QueueView.tsx |
| `compareLocality` | domain:address.ts | Compare a practice address against the principal place of practice AHPRA publishes for a practitioner (suburb + postcode only — the register carries no street address). | **1** · core:affiliations/affiliations.service.ts |
| `compareProfession` | domain:ahpra.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `copyDestinationFor` | domain:agreement-copy.ts | The address a chosen option actually reaches — SERVER SIDE ONLY. | **1** · core:agreement-copy/agreement-copy.service.ts |
| `copyOfferFor` | domain:agreement-copy.ts | Which channels this signer may be offered, and the masked address each one would reach. | **1** · core:agreement-copy/agreement-copy.service.ts |
| `correctionTouchesParticulars` | domain:tablet-session.ts | Does correcting any of these types mean the locked agreement must be superseded? | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `countsToward` | domain:practice-users.ts | Does this user count against the cap for the given scope instance? | **1** · core:practices/practice-users.service.ts |
| `daysUntilAnniversary` | domain:enduring.ts |  | **1** · core:enduring/enduring.service.ts |
| `decidePostServiceAgreement` | domain:visit-policy.ts | WHAT THIS RENDERED SERVICE NEEDS. | **1** · core:arrivals/arrivals.service.ts |
| `decideVisitAgreement` | domain:visit-policy.ts | WHAT THIS VISIT NEEDS. | **1** · core:arrivals/arrivals.service.ts |
| `departureNoticeToPractice` | domain:practitioner-departure.ts | What the practice is told. | **1** · core:affiliations/affiliations.service.ts |
| `describePurpose` | domain:correspondence-log.ts | The three facts, or null when there is no agreement behind the message. | **1** · web:correspondence/MessageLog.tsx |
| `describeVaultEventType` | domain:acting-as.ts | A vault event TYPE, in the practice's own words — never the payload. | **1** · core:acting-as/acting-as.service.ts |
| `detectContentType` | domain:artefact.ts | Detect the type from the leading bytes. | **1** · domain:signature.ts |
| `deviceHeartbeatIsStale` | domain:devices.ts | Has this tablet missed two heartbeats? | **1** · core:devices/devices.service.ts |
| `dispatchedWithinWindow` | domain:notice.ts | Whether the obligation was discharged on time: DISPATCHED within the window. | **1** · core:notices/notices.service.ts |
| `downloadHeaders` | domain:artefact.ts | How an artefact is served. | **1** · core:artefacts/artefacts.service.ts |
| `duplicateWarning` | domain:evidence.ts | The same bytes, cited for something else. | **1** · core:artefacts/artefacts.service.ts |
| `escalationLevel` | domain:notice.ts | Highest escalation threshold passed, or null. | **1** · core:notices/notices.service.ts |
| `extendPracticeCode` | domain:account-naming.ts | ON COLLISION, EXTEND DETERMINISTICALLY (section 3b rule 5, section 5 rule 3): `xlevelup`, then `xlevelup2`, `xlevelup3`. | **1** · core:practices/practice-code.ts |
| `forcesReapproval` | domain:acting-as.ts | Does starting a session put the practice back through approval? | **1** · core:acting-as/acting-as.service.ts |
| `formatAddress` | domain:address.ts | The single line that goes into a s 65C particulars block. | **1** · core:organisations/organisations.service.ts |
| `formatPairingCode` | domain:devices.ts | How the code is SHOWN — grouped in fours, because eight unbroken characters is where people lose their place. | **1** · web:practice/devices/DevicesView.tsx |
| `generatePracticeCode` | domain:account-naming.ts | The fallback of section 3b rule 4. `randomHex` is injected so a test can pin it; production passes node's crypto. | **1** · core:practices/practice-code.ts |
| `genericAgreementTemplate` | domain:agreement-templates.ts |  | **1** · core:templates/templates.service.ts |
| `hasAnniversaryFuse` | domain:enduring.ts |  | **1** · core:enduring/enduring.service.ts |
| `hasInvitationCapacity` | domain:affiliation.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `holidaySetFor` | domain:public-holidays.ts | The set a BusinessDayCalendar needs, spanning the years a calculation may cross. | **1** · domain:enduring.ts |
| `idempotencyKey` | domain:outbound-queue.ts | A stable key for one logical send, so a retry cannot become a duplicate. | **1** · core:outbound/outbound.service.ts |
| `identifierWarning` | domain:evidence.ts |  | **1** · core:artefacts/artefacts.service.ts |
| `inactivityAction` | domain:practice-users.ts | What the lifecycle should do about this account today. | **1** · core:practices/practice-users.service.ts |
| `invitationCapMessage` | domain:affiliation.ts | The message shown when the wall is hit. | **1** · core:affiliations/affiliations.service.ts |
| `invitationLimitFor` | domain:affiliation.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `invitationMessage` | domain:invitation.ts | What to tell whoever opened the link. | **1** · core:affiliations/invitation.service.ts |
| `invitationSummary` | domain:invitation.ts | What the practitioner is being asked to agree to, in one sentence. | **1** · core:affiliations/invitation.service.ts |
| `isAustralianState` | domain:public-holidays.ts |  | **1** · core:enduring/enduring.service.ts |
| `isBusinessDay` | domain:enduring.ts |  | **1** · domain:departure-notice.ts |
| `isConfirmableDetailType` | domain:tablet-session.ts |  | **1** · core:portal/portal-reads.service.ts |
| `isContentImmutable` | domain:lifecycle.ts |  | **1** · domain:assignor.ts |
| `isGeneratedPracticeCode` | domain:account-naming.ts | True for a code this platform generated rather than read off a name. | **1** · core:practices/practice-code.ts |
| `isInvitationCodeShaped` | domain:invitation.ts |  | **1** · core:affiliations/invitation.service.ts |
| `isPullChannel` | domain:outbound-queue.ts |  | **1** · core:outbound/outbound.service.ts |
| `isReconciliationDecision` | domain:reconciliation-decision.ts |  | **1** · core:reconciliation/reconciliation.service.ts |
| `isReportGrain` | domain:reporting.ts |  | **1** · core:outbound/outbound.service.ts |
| `isSessionLive` | domain:acting-as.ts | Is this session still live? | **1** · core:acting-as/acting-as.service.ts |
| `isTaskClaimable` | domain:review-tasks.ts | Is this task available to be picked up? | **1** · core:review-tasks/review-tasks.service.ts |
| `isWithinNoticeWindow` | domain:notice.ts |  | **1** · core:notices/notices.service.ts |
| `kindForAmendment` | domain:review-tasks.ts |  | **1** · core:organisations/organisations.service.ts |
| `kioskBuildIsStale` | domain:devices.ts | THE FORCED RELOAD — the other half of the zero-footprint bargain. | **1** · core:devices/devices.service.ts |
| `kioskCommandIsLive` | domain:kiosk.ts |  | **1** · core:devices/devices.service.ts |
| `laneFor` | domain:inbound-lanes.ts |  | **1** · core:inbound/inbound-print-jobs.service.ts |
| `leaseSecondsFor` | domain:outbound-queue.ts | How long a lease should run for this channel. | **1** · core:outbound/outbound.service.ts |
| `locationEditability` | domain:address-check.ts | What the practice is allowed to do with a location right now. | **1** · core:organisations/organisations.service.ts |
| `markSuperseded` | domain:audit.ts | Mark entries that a later entry supersedes. | **1** · core:organisations/audit.service.ts |
| `matchesFilter` | domain:search.ts |  | **1** · web:practice/PracticeList.tsx |
| `matchesPractice` | domain:search.ts | Whether a practice matches what somebody typed. | **1** · web:practice/PracticeList.tsx |
| `matchesSegment` | domain:correspondence-log.ts |  | **1** · web:practice/correspondence/CorrespondenceView.tsx |
| `mayAutoResolve` | domain:review-tasks.ts |  | **1** · core:review-tasks/review-tasks.service.ts |
| `mayBeSetByHand` | domain:visit-states.ts | MAY THIS STATE BE CHOSEN BY A PERSON? | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `mayGroupByOrganisation` | domain:reporting.ts | Whether a scope may be asked for totals broken down by organisation. | **1** · core:outbound/outbound.service.ts |
| `mayPerformHighStakesAct` | domain:auth-method.ts | May this session perform a high-stakes act? | **1** · core:auth/auth.guard.ts |
| `maySetVisitState` | domain:visit-states.ts | MAY THIS PERSON SET A STATE ON THIS VISIT (§3a rule 2)? | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `needsFourteenthBirthdayAction` | domain:enduring.ts | True when a patient covered under SOMEONE ELSE'S agreement is within the lead window of turning 14. Deterministic from date of birth — there is no excuse for missing it (Addendum v2 §3.3). | **1** · core:enduring/enduring.service.ts |
| `nextAllocatedTicket` | domain:queue-ticket.ts | THE NEXT NUMBER TO ALLOCATE, given what this practice has already issued TODAY. | **1** · core:arrivals/arrivals.service.ts |
| `normalisePairingCode` | domain:devices.ts | What the tablet typed, reduced to what the server stored. | **1** · core:devices/devices.service.ts |
| `normalisePersonName` | domain:assignor.ts | How a typed name is reduced before it is compared to the practice's staff list. | **1** · core:agreements/agreements.service.ts |
| `normaliseQueueTicket` | domain:queue-ticket.ts | A TICKET AS IT IS STORED — trimmed, upper-cased, and cut to length. | **1** · core:arrivals/arrivals.service.ts |
| `noticeDeadline` | domain:notice.ts | The clock starts at CLAIM LODGEMENT, not at the service (reg 89AA). | **1** · core:notices/notices.service.ts |
| `noticeToPractice` | domain:acting-as.ts | What the practice is told afterwards. | **1** · core:acting-as/acting-as.service.ts |
| `noticeToPracticeOnEnd` | domain:acting-as.ts | What the practice is told once the session ENDS — the second half of the pair with {@link noticeToPractice}. | **1** · core:acting-as/acting-as.service.ts |
| `orderAuditTrail` | domain:audit.ts |  | **1** · core:organisations/audit.service.ts |
| `orderCards` | domain:setup.ts | Cards in the order the hub should present them. | **1** · core:organisations/setup.service.ts |
| `packedQuery` | domain:packed-reports.ts | The query to actually send: a report, plus a breakdown if one was chosen. | **1** · web:practice/reports/ReportsView.tsx |
| `packedReport` | domain:packed-reports.ts |  | **1** · web:practice/reports/ReportsView.tsx |
| `pageKeyFor` | domain:page-access.ts | WHICH ENTRY IN THIS TABLE ANSWERS FOR A PATH — the key, not the rule. | **1** · domain:practice-surfaces.ts |
| `paperworkFor` | domain:practitioner-queue.ts | ONE VISIT, FLATTENED TO ONE WORD. | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `parseRetentionYears` | domain:retention.ts | Turn a configured value into a number of years, refusing nonsense. | **1** · core:correspondence/correspondence.service.ts |
| `parseSingleLine` | domain:address.ts | Best-effort split of a single line, for migrating existing records and for pre-filling the six fields from something already typed. | **1** · core:organisations/organisations.service.ts |
| `partsInReportTimezone` | domain:reporting.ts | The calendar parts of an instant, IN THE REPORTING TIMEZONE. | **1** · domain:practice-day.ts |
| `passkeysRemaining` | domain:practice-users.ts | How many passkeys the admin account may still enrol. | **1** · core:practices/practice-users.service.ts |
| `personUsername` | domain:account-naming.ts | A PERSON, AT ONE PRACTICE -- `audrey@hillsempire.com.xlevelup`. | **1** · core:identity/account-names.ts |
| `placeOptionsQuery` | domain:packed-reports.ts |  | **1** · web:practice/reports/ReportsView.tsx |
| `portalRecordIdLine` | domain:patient-message-templates.ts | The one sentence, ready to append (Carl, 4 Sep 2026). | **1** · core:messaging/portal-record-id.service.ts |
| `practiceDayWindow` | domain:practice-day.ts | THE WINDOW FOR ONE DAY, OR FOR TODAY WHEN NOBODY NAMED ONE. | **1** · core:arrivals/arrivals.service.ts |
| `practitionerStrength` | domain:practitioner-strength.ts |  | **1** · core:identity-dashboard/identity-dashboard.service.ts |
| `projectKioskWaitingRow` | domain:kiosk.ts | Build a row by taking ONLY the permitted fields. | **1** · core:kiosk/kiosk.service.ts |
| `projectTabletSessionPatient` | domain:tablet-session.ts | Build the patient block by taking ONLY the permitted fields. | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `proposePracticeCode` | domain:account-naming.ts | THE SLUG (section 3b rules 1-3). | **1** · core:practices/practice-code.ts |
| `providerIsGpFor` | domain:billing-roles.ts | IS THIS THE GP THE CLAIM GOES UNDER — the one input `decideVisitAgreement` takes, and the only place the two facts are allowed to meet. | **1** · core:arrivals/arrivals.service.ts |
| `raisesAFrontDeskTask` | domain:visit-states.ts | Setting this asks reception to look, and moves nobody (§3a rule 4). | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `recipientsFor` | domain:pending-email-change.ts | Who gets told, given what the practice looked like BEFORE the save. | **1** · core:organisations/pending-email.service.ts |
| `recipientsForGroupEmail` | domain:pending-email-change.ts | Who gets told about a groupEmail change — the same shape as {@link recipientsFor}, with the pairing inverted. | **1** · core:organisations/pending-email.service.ts |
| `registrationWarnings` | domain:ahpra.ts | Everything worth showing a human, none of it blocking. | **1** · core:affiliations/affiliations.service.ts |
| `reinvitationAttribution` | domain:review-tasks.ts | CLOSED BY AN ACT RATHER THAN BY A DECISION — its own sentence for the same reason `resolutionAttribution` distinguishes a person from a checker. | **1** · core:review-tasks/review-tasks.service.ts |
| `reportBuilderUrl` | domain:packed-reports.ts | A link that opens this query in Cube's own report builder. | **1** · web:practice/reports/ReportsView.tsx |
| `reportWindow` | domain:reporting.ts | How far back a report may look. | **1** · core:outbound/outbound.service.ts |
| `requiresPostClaimNotice` | domain:enduring.ts | Reg 89AA notices are MyMedicare-only (REQ-END-05, C7.4). | **1** · core:notices/notices.service.ts |
| `resolutionAttribution` | domain:review-tasks.ts | What the record must say about how a task was closed. | **1** · core:review-tasks/review-tasks.service.ts |
| `retentionExpiryFor` | domain:retention.ts | The date on which something anchored at `anchor` may have its content removed. | **1** · core:correspondence/correspondence.service.ts |
| `reviewTaskKind` | domain:review-tasks.ts |  | **1** · core:review-tasks/review-tasks.service.ts |
| `ruleFor` | domain:page-access.ts | The rule for a path, matching `/status/abc123` to `/status`. | **1** · web:AccessGuard.tsx |
| `scopeFor` | domain:reporting.ts |  | **1** · core:outbound/outbound.service.ts |
| `scopeOf` | domain:practice-users.ts | Which scope a record sits in. | **1** · core:practices/practice-users.service.ts |
| `sessionExpiresAt` | domain:acting-as.ts | When it will lapse, so a screen can say so rather than surprising somebody. | **1** · core:acting-as/acting-as.service.ts |
| `shownDetailTypesFor` | domain:tablet-session.ts | WHICH ROWS THE TABLET DREW, DECIDED BY THE SERVER RATHER THAN TAKEN FROM THE DEVICE. | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `showsBodies` | domain:correspondence-log.ts | Bodies belong to the practice that sent and the person who received. | **1** · web:correspondence/MessageLog.tsx |
| `summarise` | domain:reporting.ts | Totals per bucket, oldest first. | **1** · core:outbound/outbound.service.ts |
| `summariseAudit` | domain:audit.ts | A short account of what the trail shows, for the top of the view. | **1** · core:organisations/audit.service.ts |
| `surfaceOf` | domain:practice-surfaces.ts | Which surface owns a console page, or `always`, or null. | **1** · web:AccessGuard.tsx |
| `surfaceOfEndpoint` | domain:practice-surfaces.ts | Which surface owns a core route, or `always`, or null. | **1** · core:practices/surface.guard.ts |
| `templateTypeFor` | domain:agreement-templates.ts | WHICH TEMPLATE TYPE AN AGREEMENT TYPE USES. | **1** · core:templates/templates.service.ts |
| `terminationEffectiveDate` | domain:enduring.ts | The moment an enduring agreement ends: 2 business days after written notice. | **1** · core:enduring/enduring.service.ts |
| `toDirectoryEntry` | domain:directory.ts | Project a practitioner down to the directory shape. | **1** · core:affiliations/affiliations.service.ts |
| `toRosterEntry` | domain:directory.ts | Project a practitioner down to the roster shape. | **1** · core:affiliations/affiliations.service.ts |
| `triggerAppliesTo` | domain:enduring.ts | Which pathways each automatic trigger can apply to. | **1** · core:enduring/enduring.service.ts |
| `userStatus` | domain:practice-users.ts | Plain-language state for one row, so every surface says the same thing. | **1** · core:practices/practice-users.service.ts |
| `validAnchorKindFor` | domain:guards.ts |  | **1** · core:agreements/agreements.service.ts |
| `warnedAddresses` | domain:pending-email-change.ts | Who is warned, given a backup may or may not exist. | **1** · core:identity/practitioner-email.service.ts |
| `worstRowsFirst` | domain:setup.ts | Promote the rows that need work. | **1** · core:organisations/setup.service.ts |
| `AccountNameError` | domain:account-naming.ts |  | 0 |
| `InvitationError` | domain:invitation.ts |  | 0 |
| `PageAccessError` | domain:page-access.ts |  | 0 |
| `ReviewTaskError` | domain:review-tasks.ts |  | 0 |
| `addressCheckMethod` | domain:address-check.ts |  | 0 |
| `addressRejectionReason` | domain:address-check.ts |  | 0 |
| `ageYearsAt` | domain:auto-capture.ts | Whole years between a date of birth and a moment, calendar-accurate. | 0 |
| `anniversaryDate` | domain:enduring.ts |  | 0 |
| `applyChange` | domain:lifecycle.ts | The only sanctioned way to apply a field change to an agreement. | 0 |
| `assertCanAnswer` | domain:invitation.ts |  | 0 |
| `assertMayReach` | domain:page-access.ts |  | 0 |
| `assertNoticeValid` | domain:affiliation.ts | Notice must PRECEDE the end date. | 0 |
| `assertPermittedWhileActingAs` | domain:acting-as.ts | May this act be performed inside an acting-as session? | 0 |
| `assignorContactChannels` | domain:assignor.ts | The well-formed channels present, mobile first. | 0 |
| `assignorRelationshipOption` | domain:assignor-relationships.ts |  | 0 |
| `billingRoleOption` | domain:billing-roles.ts |  | 0 |
| `businessDaysBetween` | domain:departure-notice.ts | Business days from notice to departure. | 0 |
| `canAffiliationTransition` | domain:affiliation.ts |  | 0 |
| `canOfferEnduring` | domain:guards.ts |  | 0 |
| `canRepointAssignor` | domain:assignor.ts | Hard rule 2 / REQ-REG-06 — WHO SIGNS IS A PARTICULAR, so it may only change while the particulars can still change. | 0 |
| `carriesSecondFactor` | domain:auth-method.ts | Whether the session presented something beyond a password. | 0 |
| `ceremonyFailures` | domain:enrolment-ceremony.ts | Non-throwing form, for surfacing the gate in a UI before anyone tries. | 0 |
| `checksInCategory` | domain:checks.ts |  | 0 |
| `containsIdentifier` | domain:evidence.ts | Whether an identifier appears anywhere in the extracted text. | 0 |
| `coolingOffEndsAt` | domain:pending-email-change.ts |  | 0 |
| `copyDeliveryOption` | domain:agreement-copy.ts |  | 0 |
| `countWords` | domain:outbound-queue.ts |  | 0 |
| `daysInMonth` | domain:reporting.ts |  | 0 |
| `daysSince` | domain:practitioner-strength.ts |  | 0 |
| `departureReason` | domain:practitioner-departure.ts |  | 0 |
| `deregistrationTakesEffect` | domain:affiliation.ts | REQ-XFER-08 — deregistration is an immediate hard stop. | 0 |
| `deriveAcnFromAbn` | domain:abn.ts | For a company, the ABN is the ACN with two check digits prefixed — so the ACN is simply the last nine digits. | 0 |
| `describeRejectedType` | domain:artefact.ts | Names the format in a refusal, so the message is actionable. | 0 |
| `easterSunday` | domain:public-holidays.ts | Anonymous Gregorian computus — Easter Sunday for any year. | 0 |
| `endOfAffiliationEffects` | domain:affiliation.ts |  | 0 |
| `externalNoticeMeans` | domain:departure-notice.ts |  | 0 |
| `findCheck` | domain:checks.ts |  | 0 |
| `fourteenthBirthday` | domain:enduring.ts |  | 0 |
| `hasRestriction` | domain:ahpra.ts |  | 0 |
| `holidaysFor` | domain:public-holidays.ts | Every holiday observed in `state` during `year`, substitutions applied. | 0 |
| `hoursElapsedSinceClaim` | domain:notice.ts |  | 0 |
| `isActiveTabletSessionState` | domain:tablet-session.ts |  | 0 |
| `isAgreementType` | domain:correspondence-log.ts | Is this a type this domain knows? | 0 |
| `isAmendable` | domain:amendment.ts |  | 0 |
| `isApprovedIdentifierType` | domain:identifiers.ts |  | 0 |
| `isAuthorityBasisForAnother` | domain:assignor.ts |  | 0 |
| `isChaseAttemptChannel` | domain:chase-attempt.ts |  | 0 |
| `isChaseAttemptOutcome` | domain:chase-attempt.ts |  | 0 |
| `isChaseAttemptSubjectType` | domain:chase-attempt.ts |  | 0 |
| `isClaimable` | domain:outbound-queue.ts | Is this item available to be taken right now? | 0 |
| `isComplianceBearing` | domain:notice.ts |  | 0 |
| `isContactedPartyType` | domain:chase-attempt.ts |  | 0 |
| `isDeviceSettableTabletSessionState` | domain:tablet-session.ts |  | 0 |
| `isDisputeResolutionOutcome` | domain:tablet-session.ts |  | 0 |
| `isDueForRemoval` | domain:retention.ts | Past expiry, and not held. | 0 |
| `isImmediate` | domain:practitioner-departure.ts | A reason that says the listing was WRONG rather than that it is ending. | 0 |
| `isKioskCapturableStatus` | domain:kiosk.ts |  | 0 |
| `isKioskIdleTimeoutInRange` | domain:kiosk.ts |  | 0 |
| `isKioskScreen` | domain:kiosk.ts |  | 0 |
| `isKnownState` | domain:address.ts |  | 0 |
| `isLive` | domain:pending-email-change.ts | Live means "still awaiting an answer" — not merely "a row exists". | 0 |
| `isParticularDetailType` | domain:tablet-session.ts |  | 0 |
| `isPostServiceOutcome` | domain:visit-policy.ts |  | 0 |
| `isPracticeUser` | domain:landing.ts | A practice user is defined by HOLDING A PRACTICE CLAIM, not by holding a particular role. | 0 |
| `isPractitioner` | domain:landing.ts | A practitioner is defined by their own claim, for the same reason a practice user is defined by theirs: the `provider` ROLE says what kind of person they are, and the claim says which person. | 0 |
| `isPrintDocumentType` | domain:inbound-lanes.ts |  | 0 |
| `isSignatureRefusalReason` | domain:tablet-session.ts |  | 0 |
| `isSurfaceProfile` | domain:practice-surfaces.ts | True for a value this platform recognises as a profile. | 0 |
| `isTabletSessionState` | domain:tablet-session.ts |  | 0 |
| `isValidAcnChecksum` | domain:abn.ts | ASIC's ACN check digit: complement of the weighted sum modulo 10. | 0 |
| `isValidPostcodeFormat` | domain:address.ts | Four digits. | 0 |
| `isVerbalCaptureAllowed` | domain:guards.ts |  | 0 |
| `isVisitAgreementType` | domain:visit-policy.ts |  | 0 |
| `isWellFormedEmail` | domain:assignor.ts | Conservative, and deliberately not RFC 5322. The purpose is to catch the typo that would send a patient's agreement copy nowhere — not to litigate the address grammar, which would refuse valid mailboxes to no benefit. | 0 |
| `isWellFormedMobile` | domain:assignor.ts | Australian mobile, checked for SHAPE only. | 0 |
| `kioskScreenIsCeremony` | domain:kiosk.ts | THE SCREENS THAT MEAN SOMEBODY IS STANDING THERE. | 0 |
| `maskEmail` | domain:agreement-copy.ts | `carl@example.com` → `c•••@e•••.com`. | 0 |
| `maskMobile` | domain:agreement-copy.ts | `0408 169 971` → `•••••• 971`. | 0 |
| `matchOrganisationName` | domain:abn.ts |  | 0 |
| `mayAttemptConfirmation` | domain:pending-email-change.ts |  | 0 |
| `mayChase` | domain:correspondence-log.ts | May this be chased? | 0 |
| `monthLabel` | domain:reporting.ts |  | 0 |
| `needsExternalAttestation` | domain:departure-notice.ts | Does this departure need the practice to attest to notice given elsewhere? | 0 |
| `noticeDays` | domain:affiliation.ts |  | 0 |
| `pagesFor` | domain:page-access.ts | Every page an audience can open. | 0 |
| `parseAgreementTemplates` | domain:agreement-templates.ts |  | 0 |
| `parseAssignorRelationshipContent` | domain:assignor-relationships.ts | Exhaustive, and it throws rather than repairing. | 0 |
| `parseBillingRoleContent` | domain:billing-roles.ts | Exhaustive, and it throws rather than repairing. | 0 |
| `parseCopyDeliveryContent` | domain:agreement-copy.ts | Exhaustive, and it throws rather than repairing — the same charter every other content loader in this package follows (CONVENTIONS.md §1: no runtime dependencies, so no schema library). | 0 |
| `parseEnduringTerminationNotice` | domain:enduring-termination-notice.ts |  | 0 |
| `parsePatientMessageTemplates` | domain:patient-message-templates.ts |  | 0 |
| `parsePostServiceRules` | domain:visit-policy.ts | The post-service half of the same content file, validated the same way and with the same posture: it throws rather than repairing, because the file is editable precisely because somebody will edit it. | 0 |
| `parsePracticeSurfaceContent` | domain:practice-surfaces.ts | Exhaustive, and it throws rather than repairing — the same posture as every other content loader here. | 0 |
| `parseServiceDescriptionContent` | domain:service-descriptions.ts |  | 0 |
| `parseSignedDb4Content` | domain:signed-db4-content.ts | Exhaustive, and it throws rather than repairing — the same contract as `parseAssignorRelationshipContent`, and for the same reason: the whole point of an editable file is that somebody will edit it. | 0 |
| `parseVisitPolicyContent` | domain:visit-policy.ts | Exhaustive, and it throws rather than repairing — the same posture `parseAssignorRelationshipContent` takes and for the same reason: the file is editable precisely because somebody will edit it, and a default quietly applied to a bad edit is a decision nobody made. | 0 |
| `parseVisitStateContent` | domain:visit-states.ts | Exhaustive, and it throws rather than repairing. | 0 |
| `patientMessageTemplate` | domain:patient-message-templates.ts |  | 0 |
| `placeFilters` | domain:packed-reports.ts |  | 0 |
| `postcodeMatchesState` | domain:address.ts |  | 0 |
| `practiceNameForCode` | domain:account-naming.ts | The trading name if there is one, else the practice name. | 0 |
| `practiceToday` | domain:practice-day.ts | Today's calendar day in the practice's zone — never `toISOString().slice(0, 10)`. | 0 |
| `preferredAssignorChannel` | domain:assignor.ts | The assignor's preferred channel (C7.2 — per ASSIGNOR, not per patient, because the signer is not always the patient). | 0 |
| `profileAllowsEndpoint` | domain:practice-surfaces.ts | May a practice on this profile call this endpoint? | 0 |
| `profileAllowsEndpointIn` | domain:practice-surfaces.ts | May a practice on this profile call this endpoint? | 0 |
| `profileAllowsPageIn` | domain:practice-surfaces.ts | May a practice on this profile open this console page? | 0 |
| `profileSurfacesIn` | domain:practice-surfaces.ts | The surfaces a named profile switches on. | 0 |
| `purposeOf` | domain:correspondence-log.ts | What a message was for, from what it was about. | 0 |
| `raisesConcern` | domain:practitioner-departure.ts |  | 0 |
| `sanitiseFilename` | domain:artefact.ts | Strip a filename down to something safe to store and echo back. | 0 |
| `showsCost` | domain:correspondence-log.ts | Per-message cost is the practice's own business. | 0 |
| `sightingFreshness` | domain:practitioner-strength.ts | How much a sighting is worth given its age. | 0 |
| `startOfWeek` | domain:reporting.ts | The Monday of the week containing `at`, at 00:00 in the reporting timezone. | 0 |
| `surfaceOfEndpointIn` | domain:practice-surfaces.ts | Which surface owns a core route, or `always`, or null when nobody has said. | 0 |
| `surfaceOfPageIn` | domain:practice-surfaces.ts | Which surface owns a console page, or `always`, or null when nobody has said. | 0 |
| `tabletSessionIsStale` | domain:tablet-session.ts |  | 0 |
| `transition` | domain:lifecycle.ts |  | 0 |
| `visitStateOption` | domain:visit-states.ts |  | 0 |
| `weekOfMonth` | domain:reporting.ts | Which week of its own month a date falls in, 1..5. | 0 |
| `worstSeverity` | domain:review.ts | The worst flag present, or null. | 0 |

## Domain constants and content

244 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `CONFIRMABLE_DETAIL_TYPES` | domain:tablet-session.ts | WHAT THE PATIENT TICKS, AND WHY IT IS NOT THE IDENTIFIER LIST. | **5** · core:portal/portal-reads.service.ts, core:tablet-sessions/dispute-resolution.dto.ts, core:tablet-sessions/tablet-sessions.dto.ts, +2 more |
| `MIN_AGE_ASSIGN_FOR_OTHER` | domain:guards.ts |  | **5** · web:kiosk/rules/assignor.ts, web:kiosk/screens/AssignorScreen.tsx, web:practice/patients/NewAgreementPanel.tsx, +2 more |
| `ASSIGNOR_RELATIONSHIP_OPTIONS` | domain:assignor-relationships.ts | The list, in file order, which is screen order. | **4** · web:kiosk/rules/assignor.ts, web:kiosk/screens/AssignorScreen.tsx, web:practice/patients/NewAgreementPanel.tsx, +1 more |
| `CHECK_CATALOGUE` | domain:checks.ts | The catalogue. | **4** · core:artefacts/artefacts.service.ts, core:organisations/audit.service.ts, core:organisations/checks.service.ts, +1 more |
| `ASSIGNOR_RELATIONSHIPS_VERSION` | domain:assignor-relationships.ts | Recorded alongside the assignor, so a stored agreement says which list it was made from. | **3** · web:kiosk/rules/assignor.ts, web:practice/patients/NewAgreementPanel.tsx, web:practice/tablet/pushDesk.tsx |
| `AUTHORITY_BASES_FOR_ANOTHER` | domain:assignor.ts | The fixed list from REQ-VUL-01, for somebody signing FOR ANOTHER PERSON. | **3** · core:agreements/agreements.dto.ts, core:arrivals/arrivals.dto.ts, domain:assignor-relationships.ts |
| `BILLING_ROLES_VERSION` | domain:billing-roles.ts | Recorded alongside every role change, so a question asked in 2028 has an answer. | **3** · core:affiliations/affiliations.service.ts, core:arrivals/arrivals.service.ts, core:practices/practices.service.ts |
| `DEFAULT_SURFACE_PROFILE` | domain:practice-surfaces.ts | The profile every practice has until somebody decides otherwise. | **3** · core:practices/practice-surfaces.service.ts, web:practice/channels/ChannelsView.tsx, web:surfaceProfile.ts |
| `EXTERNAL_LINKS` | domain:external-links.ts |  | **3** · web:OrgConsole.tsx, web:practice/practitioners/PractitionersView.tsx, domain:checks.ts |
| `MIN_AGE_SELF_ASSIGN` | domain:guards.ts |  | **3** · web:kiosk/rules/assignor.ts, web:practice/patients/NewAgreementPanel.tsx, domain:auto-capture.ts |
| `SERVICE_DESCRIPTIONS_VERSION` | domain:service-descriptions.ts | Recorded with every description set, so the record says which list it came from. | **3** · core:arrivals/arrivals.service.ts, core:auto-capture/auto-capture.service.ts, core:service-descriptions/service-descriptions.service.ts |
| `ACTING_AS_REASON_KEYS` | domain:acting-as.ts |  | **2** · core:acting-as/acting-as.controller.ts, core:acting-as/acting-as.service.ts |
| `ADDRESS_CHECK_VERSION` | domain:address-check.ts | The catalogue version. | **2** · core:organisations/organisations.controller.ts, core:organisations/organisations.service.ts |
| `AFFILIATION_VELOCITY_WINDOW_DAYS` | domain:affiliation.ts |  | **2** · core:affiliations/affiliations.service.ts, core:identity-dashboard/identity-dashboard.service.ts |
| `AU_STATES` | domain:address.ts |  | **2** · web:apply/ApplyForm.tsx, web:status/[token]/correct/CorrectView.tsx |
| `BILLING_ROLE_KEYS` | domain:billing-roles.ts | Just the keys, in order — the shape a `<select>` and a CHECK constraint want. | **2** · core:affiliations/affiliations.controller.ts, core:affiliations/affiliations.service.ts |
| `CORRECTABLE_PATIENT_FIELDS` | domain:tablet-session.ts | WHAT RECEPTION MAY CORRECT ON THE PLATFORM'S MIRROR, and the list is the whole of it (TODO.md "Check-your-details", Carl 4 Sep 2026). | **2** · core:patients/patients.service.ts, web:practice/tablet/pushDesk.tsx |
| `DEFAULT_BILLING_ROLE` | domain:billing-roles.ts | The role every affiliation starts on, and the database column's default. | **2** · core:affiliations/agreement-anchor.ts, core:practices/practices.service.ts |
| `DEVICE_LABEL_MAX_LENGTH` | domain:devices.ts | A label a human chose, for a list a human reads. | **2** · core:devices/devices.controller.ts, core:devices/devices.service.ts |
| `KIOSK_IDLE_TIMEOUT_DEFAULT_SECONDS` | domain:kiosk.ts | RETURN TO THE START WHEN NOBODY IS THERE (Carl, 4 September 2026). | **2** · web:kiosk/Ceremony.tsx, web:practice/channels/ChannelsView.tsx |
| `LOCKED_FIELDS` | domain:amendment.ts | Fields that are explicitly refused, with the reason the applicant sees. | **2** · core:organisations/organisations.controller.ts, core:organisations/organisations.service.ts |
| `MANUAL_REVIEW_RESOLUTIONS` | domain:review-tasks.ts | The ones a person may choose. | **2** · core:review-tasks/review-tasks.controller.ts, core:review-tasks/review-tasks.service.ts |
| `MAX_ARTEFACT_BYTES` | domain:artefact.ts | 20 MB. | **2** · core:main.ts, web:review/CheckRecorder.tsx |
| `MAX_LOGO_BYTES` | domain:practice-logo.ts | 512 KB. | **2** · core:practices/letterhead.controller.ts, web:practice/templates/TemplatesView.tsx |
| `MAX_PASSKEYS_PER_ADMIN` | domain:practice-users.ts | SIX PASSKEYS ON THE ADMIN ACCOUNT. | **2** · core:practices/practice-users.controller.ts, core:practices/practice-users.service.ts |
| `MAX_USERS_PER_SCOPE` | domain:practice-users.ts | FIVE PER SCOPE INSTANCE — five for the organisation, five at EACH location, five in EACH department. | **2** · core:practices/practice-users.controller.ts, core:practices/practice-users.service.ts |
| `REPORT_TIMEZONE` | domain:reporting.ts |  | **2** · core:outbound/outbound.service.ts, domain:practice-day.ts |
| `SERVICE_DESCRIPTIONS` | domain:service-descriptions.ts | The list, in file order, which is screen order. | **2** · core:arrivals/arrivals.dto.ts, core:service-descriptions/service-descriptions.service.ts |
| `SURFACE_PROFILE_KEYS` | domain:practice-surfaces.ts | The profile keys a practice's column may hold. | **2** · core:practices/practices.dto.ts, web:practice/channels/ChannelsView.tsx |
| `VISIT_STATE_KEYS` | domain:visit-states.ts |  | **2** · core:practitioner-queue/practitioner-queue.controller.ts, core:practitioner-queue/practitioner-queue.service.ts |
| `ACCEPTANCE_MEANS` | domain:invitation.ts | What each method actually establishes, in words fit to show a reviewer. | **1** · core:affiliations/affiliations.service.ts |
| `ACTING_AS_MAX_MINUTES` | domain:acting-as.ts | How long a session may run before it expires on its own. | **1** · core:acting-as/acting-as.service.ts |
| `ACTING_AS_REASONS` | domain:acting-as.ts | Why somebody is acting for a practice. | **1** · core:acting-as/acting-as.controller.ts |
| `ADDRESS_CHECK_KEYS` | domain:address-check.ts |  | **1** · core:organisations/organisations.controller.ts |
| `ADDRESS_CHECK_METHODS` | domain:address-check.ts |  | **1** · core:organisations/organisations.controller.ts |
| `ADDRESS_REJECTION_KEYS` | domain:address-check.ts |  | **1** · core:organisations/organisations.controller.ts |
| `ADDRESS_REJECTION_REASONS` | domain:address-check.ts |  | **1** · core:organisations/organisations.controller.ts |
| `AFFILIATION_VELOCITY_THRESHOLD` | domain:affiliation.ts | ⚠ DRAFT PARAMETER — the threshold wants a look at real data before GA. | **1** · core:affiliations/affiliations.service.ts |
| `AGREEMENT_COPY_TEMPLATE_KEY` | domain:agreement-copy.ts | The template the copy message is written from. | **1** · core:agreement-copy/agreement-copy.service.ts |
| `AGREEMENT_TEMPLATES` | domain:agreement-templates.ts |  | **1** · core:templates/templates.service.ts |
| `AGREEMENT_TEMPLATES_VERSION` | domain:agreement-templates.ts | Recorded beside the template id and version on every agreement. | **1** · core:templates/templates.service.ts |
| `AHPRA_REGISTRATION_STATUSES` | domain:ahpra.ts | Registration status, as the register words it. | **1** · web:practice/practitioners/PractitionersView.tsx |
| `ALWAYS` | domain:practice-surfaces.ts | The answer for a page or endpoint that belongs to no optional surface: signing in, setting the practice up, the day hub, the platform's own pages, and the shared machinery every practice has. | **1** · core:practices/surface.guard.ts |
| `AMENDABLE_FIELDS` | domain:amendment.ts | What an applicant may correct. | **1** · web:practice/application/ApplicationView.tsx |
| `APPROVED_IDENTIFIER_TYPES` | domain:identifiers.ts |  | **1** · web:practice/channels/ChannelsView.tsx |
| `ARTEFACT_PURPOSES` | domain:artefact.ts | What an artefact is evidence OF. | **1** · core:artefacts/artefacts.controller.ts |
| `AUTOMATIC_CESSATION_TRIGGERS` | domain:enduring.ts | The six automatic cessation triggers (65CA(8), Addendum v2 §3.3). | **1** · core:enduring/enduring.controller.ts |
| `BILLING_ROLES` | domain:billing-roles.ts | The list, in file order, which is screen order. | **1** · core:affiliations/affiliations.service.ts |
| `CEREMONY_FRESHNESS_DAYS` | domain:enrolment-ceremony.ts | ⚠ DRAFT PARAMETER pending Carl's decision (like the C2 tolerance). | **1** · core:identity/identity.service.ts |
| `CHASE_ATTEMPT_CHANNELS` | domain:chase-attempt.ts | How a person reached out. | **1** · core:chase-attempts/chase-attempts.controller.ts |
| `CHASE_ATTEMPT_OUTCOMES` | domain:chase-attempt.ts | What came of it. | **1** · core:chase-attempts/chase-attempts.controller.ts |
| `CHASE_ATTEMPT_SUBJECT_TYPES` | domain:chase-attempt.ts | WHAT a chase attempt can be recorded against. | **1** · core:chase-attempts/chase-attempts.controller.ts |
| `CHASE_NOTE_MAX_LENGTH` | domain:chase-attempt.ts | A note is for what was said, not for who was called. | **1** · core:chase-attempts/chase-attempts.controller.ts |
| `CHECKLIST_VERSION` | domain:checks.ts | Bump when the catalogue changes. | **1** · core:organisations/checks.service.ts |
| `CHECK_WEIGHTS` | domain:checks.ts | Weight, for the strength score that follows. | **1** · domain:practitioner-strength.ts |
| `CONSOLE_ROLES` | domain:practice-users.ts | Console roles. | **1** · core:practices/practice-users.controller.ts |
| `CONTACTED_PARTY_TYPES` | domain:chase-attempt.ts | WHO was contacted, by ROLE and never by name (REQ-VER-04): the patient themselves, the assignor acting for them, or somebody else who answered -- a parent, a carer, the desk at a residential facility. | **1** · core:chase-attempts/chase-attempts.controller.ts |
| `CONTACT_CLASH_MESSAGES` | domain:contacts.ts |  | **1** · web:strings.ts |
| `COPY_DELIVERY_VERSION` | domain:agreement-copy.ts | Recorded on every copy request. | **1** · core:agreement-copy/agreement-copy.service.ts |
| `COPY_LINK_EXPIRY_HOURS` | domain:agreement-copy.ts | How long a copy link stays open. | **1** · core:agreement-copy/agreement-copy.service.ts |
| `DATASET` | domain:public-holidays.ts |  | **1** · domain:enduring.ts |
| `DEFAULT_VISIT_STATE` | domain:visit-states.ts | Where a visit sits before anybody has said anything about it. | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `DEPARTURE_REASONS` | domain:practitioner-departure.ts | Why they are leaving, chosen from a list rather than typed. | **1** · core:affiliations/practitioner-self.controller.ts |
| `DEPARTURE_REASON_KEYS` | domain:practitioner-departure.ts |  | **1** · core:affiliations/practitioner-self.controller.ts |
| `DEVICE_SETTABLE_TABLET_SESSION_STATES` | domain:tablet-session.ts | `signature_failed` IS DEVICE-SETTABLE AND `signed` IS NOT, which reads like a contradiction and is not (Carl, 7 Sep 2026). | **1** · core:tablet-sessions/tablet-sessions.dto.ts |
| `DISPUTE_RESOLUTION_OUTCOMES` | domain:tablet-session.ts | HOW A DISPUTE ENDED, and there are exactly two honest answers (Carl, 4 Sep 2026). | **1** · core:tablet-sessions/dispute-resolution.dto.ts |
| `ENDED_TABLET_SESSION_STATES` | domain:tablet-session.ts | THE FIVE WAYS A SESSION ENDS, and only ONE of them touches the agreement. | **1** · web:practice/tablet/pushDesk.tsx |
| `ENDURING_TERMINATION_NOTICE_TEMPLATE_KEY` | domain:enduring-termination-notice.ts | `enduring_termination_notice_v1` — recorded on every notice row. | **1** · core:portal/portal-reads.service.ts |
| `ENDURING_TERMINATION_NOTICE_VERSION` | domain:enduring-termination-notice.ts |  | **1** · core:portal/portal-reads.service.ts |
| `EXTERNAL_NOTICE_KEYS` | domain:departure-notice.ts |  | **1** · core:affiliations/affiliations.controller.ts |
| `EXTERNAL_NOTICE_MEANS` | domain:departure-notice.ts | How notice was given, when it was not given through us. | **1** · core:affiliations/affiliations.controller.ts |
| `FAILURE_REASONS` | domain:checks.ts | Why a check FAILED — the applicant was checked and did not hold up. | **1** · core:organisations/checks.service.ts |
| `IDENTIFIER_COUNT_FLOOR` | domain:identifiers.ts | Floor on how many identifiers must be challenged (REQ-VER-06: configurable per practice, floor 3, default 3). | **1** · web:practice/channels/ChannelsView.tsx |
| `INCOMPLETE_REASONS` | domain:checks.ts | Why a check COULD NOT BE COMPLETED — we tried and could not finish. | **1** · core:organisations/checks.service.ts |
| `INVITATION_ATTEMPT_CAP` | domain:invitation.ts | Five wrong codes and it stops. | **1** · core:affiliations/invitation.service.ts |
| `INVITATION_CONSEQUENCES` | domain:invitation.ts | What accepting DOES, and what it does not. | **1** · core:affiliations/invitation.service.ts |
| `INVITATION_DAYS` | domain:invitation.ts | How long an invitation stays answerable. | **1** · core:affiliations/invitation.service.ts |
| `INVITATION_NOT_CONSENT` | domain:invitation.ts | The caveat, held apart from the list ON PURPOSE. | **1** · core:affiliations/invitation.service.ts |
| `KIOSK_CAPTURABLE_STATUSES` | domain:kiosk.ts | The statuses a pre-agreement can be in while it is still waiting for the ceremony. | **1** · core:kiosk/kiosk.service.ts |
| `KIOSK_IDLE_TIMEOUT_MAX_SECONDS` | domain:kiosk.ts |  | **1** · core:practices/practices.dto.ts |
| `KIOSK_IDLE_TIMEOUT_MIN_SECONDS` | domain:kiosk.ts |  | **1** · core:practices/practices.dto.ts |
| `KIOSK_IDLE_WARNING_SECONDS` | domain:kiosk.ts | THE QUIET WARNING BEFORE IT HAPPENS. | **1** · web:kiosk/useInactivityReset.ts |
| `KIOSK_SCREENS` | domain:kiosk.ts | WHERE THE TABLET IS — the ten words a heartbeat may carry, and no eleventh (Carl, 4–5 Sep 2026: "the tablet must know what it is on"). | **1** · core:kiosk/kiosk.controller.ts |
| `LANE_POLICIES` | domain:inbound-lanes.ts | What each lane promises, and how often its worker looks. | **1** · core:inbound/inbound-lane.worker.ts |
| `LEASE_SECONDS` | domain:outbound-queue.ts | How long a worker holds an item before others may reclaim it. | **1** · core:inbound/inbound-print-jobs.service.ts |
| `LODGEMENT_WINDOW_DAYS` | domain:chase.ts |  | **1** · core:chase-attempts/chase-attempts.service.ts |
| `LOGO_BOX_POINTS` | domain:practice-logo.ts | HOW BIG THE LOGO IS DRAWN ON THE PAGE, in PDF points, and it is FIXED. | **1** · core:render/agreement-pdf-renderer.ts |
| `LOG_SEGMENTS` | domain:correspondence-log.ts | The filter segment the design draws above the table. | **1** · web:practice/correspondence/CorrespondenceView.tsx |
| `MAX_CONFIRMATION_ATTEMPTS` | domain:pending-email-change.ts | A LINK ALONE IS NOT ENOUGH, which is why there is also a code. | **1** · core:identity/practitioner-email.service.ts |
| `MAX_PAYLOAD_BYTES` | domain:outbound-queue.ts | Sanity limits on what may be queued. | **1** · core:outbound/outbound.service.ts |
| `MAX_SIGNATURE_RASTER_BYTES` | domain:signature.ts | 512 KB for the image and 200 KB for the strokes. | **1** · core:agreements/agreements.dto.ts |
| `MIN_RESEND_REASON_WORDS` | domain:outbound-queue.ts | AT LEAST THREE WORDS, and it is not arbitrary. | **1** · core:outbound/outbound.service.ts |
| `OUTBOUND_STATES` | domain:outbound-queue.ts | The states, and there are deliberately few. | **1** · core:outbound/outbound.controller.ts |
| `PACKED_BREAKDOWNS` | domain:packed-reports.ts | The same reports, split by where the messages went. | **1** · web:practice/reports/ReportsView.tsx |
| `PACKED_REPORTS` | domain:packed-reports.ts |  | **1** · web:practice/reports/ReportsView.tsx |
| `PAIRING_CODE_ALPHABET` | domain:devices.ts | THE PAIRING-CODE ALPHABET, and every omission is deliberate. | **1** · core:devices/device-credential.ts |
| `PAIRING_CODE_LENGTH` | domain:devices.ts |  | **1** · core:devices/device-credential.ts |
| `PAIRING_CODE_TTL_MS` | domain:devices.ts | TEN MINUTES, which is the number Carl gave and is the right shape of number: long enough to walk a code from the console to the tablet across a practice, short enough that a code left on a screen at lunchtime is dead by the afternoon. | **1** · core:devices/devices.service.ts |
| `PERSON_VERIFICATION_METHODS` | domain:enrolment-ceremony.ts | Only these prove a PRACTITIONER. | **1** · core:identity/ceremony.dto.ts |
| `PORTAL_INVITATION_TEMPLATE_KEY` | domain:patient-message-templates.ts | The offer of portal activation (FR-1.14). | **1** · core:portal/portal-invitation.dispatcher.ts |
| `PRACTICE_SURFACES_VERSION` | domain:practice-surfaces.ts | Recorded on the event that changes a practice's profile. | **1** · core:practices/practices.service.ts |
| `PRACTICE_SURFACE_KEYS` | domain:practice-surfaces.ts | Just the keys, in file order — what the string table is keyed by. | **1** · web:practice/channels/ChannelsView.tsx |
| `PRINT_DOCUMENT_TYPES` | domain:inbound-lanes.ts | The documents a practice's desktop can print to us (Part 8), each on its lane. | **1** · core:inbound/inbound-print-jobs.controller.ts |
| `REASSIGNMENT_TASK_KIND` | domain:review-tasks.ts | THE KIND "REASSIGN" RAISES (PRACTITIONER-QUEUE-PAGE.md §3a rule 4). | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `REGISTRATION_RECHECK_DAYS` | domain:ahpra.ts | ⚠ DRAFT PARAMETER — how old a sighting may be before it wants redoing. | **1** · domain:practitioner-strength.ts |
| `REPORT_GRAINS` | domain:reporting.ts |  | **1** · core:outbound/outbound.service.ts |
| `REPORT_MATRICES` | domain:reporting.ts |  | **1** · core:outbound/outbound.service.ts |
| `REPORT_MAX_YEARS` | domain:reporting.ts | TWO YEARS, and it is a retention rule rather than a default. | **1** · core:outbound/outbound.service.ts |
| `REQUIRED_TEMPLATE_PLACEHOLDERS` | domain:agreement-templates.ts | THE D-ELEMENTS EVERY TEMPLATE OF A TYPE MUST ACTUALLY PRINT (REQ-REG-01 for episodic; REQ-END-02 / reg 65CB for enduring). | **1** · web:practice/templates/templateEditing.ts |
| `REVIEW_CLAIM_MINUTES` | domain:review-tasks.ts | How long a claim holds before anybody else may take it. | **1** · core:review-tasks/review-tasks.service.ts |
| `REVIEW_TASK_KEYS` | domain:review-tasks.ts |  | **1** · core:review-tasks/review-tasks.service.ts |
| `REVIEW_TASK_KINDS` | domain:review-tasks.ts |  | **1** · core:review-tasks/review-tasks.controller.ts |
| `SIGNATURE_RASTER_PURPOSE` | domain:signature.ts | The two artefact purposes a drawn signature produces. | **1** · core:agreements/agreements.service.ts |
| `SIGNATURE_VECTOR_PURPOSE` | domain:signature.ts |  | **1** · core:agreements/agreements.service.ts |
| `SIGNED_DB4_CONTENT` | domain:signed-db4-content.ts | The words and geometry in force now. | **1** · core:agreements/signed-db4.service.ts |
| `SURFACE_REFUSED_CODE` | domain:practice-surfaces.ts | THE REASON CODE FOR "this practice does not use that part of AoB", named once and read by both sides. | **1** · core:practices/surface.guard.ts |
| `TABLET_SESSION_IDLE_MS` | domain:tablet-session.ts | THIRTY MINUTES OF NOTHING AND THE SESSION IS OVER. | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `TERMINATION_BUSINESS_DAYS` | domain:enduring.ts |  | **1** · domain:departure-notice.ts |
| `TERMINATION_NOTICE_DRAFT_STATUS` | domain:enduring-termination-notice.ts | The only status a portal-generated termination notice may hold today. | **1** · core:portal/portal-reads.service.ts |
| `VERBAL_FALLBACK_END_DATE` | domain:guards.ts | Statutory dates. | **1** · core:reconciliation/reconciliation.service.ts |
| `VISIT_STATES_VERSION` | domain:visit-states.ts |  | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `VISIT_STATE_OPTIONS` | domain:visit-states.ts | ORDER IS THE ORDER ON SCREEN. | **1** · web:practice/practitioner/waiting/WaitingView.tsx |
| `ACCEPTANCE_METHODS` | domain:invitation.ts | How an affiliation came to be accepted. | 0 |
| `ACCEPTANCE_STRENGTH` | domain:invitation.ts | Ranked weakest to strongest, for anything that must compare two records. | 0 |
| `ACTIVE_TABLET_SESSION_STATES` | domain:tablet-session.ts | `details_disputed` IS LIVE, NOT AN ENDING (Carl, 4 Sep 2026). | 0 |
| `ADMIN_VERIFICATION_METHODS` | domain:enrolment-ceremony.ts | For a practice ADMIN, a callback on a number obtained INDEPENDENTLY of the application is a genuine person check — the applicant did not choose the number, so answering it is evidence. | 0 |
| `AFFILIATION_STATUSES` | domain:affiliation.ts | `invited` — the practice has added them; the practitioner has not answered. | 0 |
| `AGREEMENT_TEMPLATE_STATUSES` | domain:agreement-templates.ts | `draft_pending_review` is where every template in this repository starts and, as at 5 September 2026, where all of them still are. | 0 |
| `AGREEMENT_TEMPLATE_TYPES` | domain:agreement-templates.ts | The two instruments. | 0 |
| `AHPRA_NUMBER_PATTERN` | domain:enrolment-ceremony.ts | AHPRA registration numbers are three profession letters followed by ten digits (e.g. MED0001234567). | 0 |
| `ALLOWED_ARTEFACT_TYPES` | domain:artefact.ts | The allowlist. | 0 |
| `ALLOWED_LOGO_TYPES` | domain:practice-logo.ts | The two raster formats. | 0 |
| `ANNIVERSARY_FUSE_CUTOFF_DATE` | domain:enduring.ts | Agreements entered on or before 30 June 2027 CEASE unless registered with Services Australia before their first anniversary. | 0 |
| `ANNIVERSARY_WARNING_DAYS` | domain:enduring.ts |  | 0 |
| `ASSIGNOR_RELATIONSHIP_KEYS` | domain:assignor-relationships.ts | Just the keys, in order — the shape a `<select>` wants. | 0 |
| `AUDIENCES` | domain:page-access.ts | WHO somebody is, in the only terms this map cares about. | 0 |
| `AUSTRALIAN_STATES` | domain:public-holidays.ts |  | 0 |
| `AUTO_CAPTURE_SUPPRESSION_REASONS` | domain:auto-capture.ts | Why the cascade decided not to ask. | 0 |
| `AUTO_RESOLVE_CONFIDENCE` | domain:review-tasks.ts | May an automated check close this task by itself? | 0 |
| `BACKOFF_SECONDS` | domain:outbound-queue.ts | Backoff, in seconds, indexed by attempts already made. | 0 |
| `CEREMONY_SUBJECT_KINDS` | domain:enrolment-ceremony.ts | A ceremony verifies one of two quite different kinds of person, and the checks that mean anything differ completely between them. | 0 |
| `CHASE_BAND_POLICIES` | domain:chase.ts | REQ-CHASE-05, verbatim from the table. | 0 |
| `CHASE_OUTCOMES_BY_CHANNEL` | domain:chase-attempt.ts | Which outcomes a channel can honestly produce. | 0 |
| `CHECK_CATEGORIES` | domain:checks.ts |  | 0 |
| `CHECK_OUTCOMES` | domain:checks.ts |  | 0 |
| `CLOSING_DECISIONS` | domain:reconciliation-decision.ts | The two that close the item. | 0 |
| `COMPANY_ENTITY_TYPES` | domain:abn.ts | ABR entity types that are companies, and therefore must carry an ACN. | 0 |
| `COMPLIANCE_BEARING_STATES` | domain:notice.ts | REQ-DEL-07 — read state is EVIDENTIAL COLOUR, NEVER A COMPLIANCE MEASURE. | 0 |
| `COOLING_OFF_DAYS` | domain:pending-email-change.ts | SEVEN DAYS AFTER IT TAKES EFFECT, somebody can still stop it. | 0 |
| `COPY_DELIVERY_CONTENT` | domain:agreement-copy.ts |  | 0 |
| `COPY_DELIVERY_TRANSPORTS` | domain:agreement-copy.ts | The transports a copy may actually take. | 0 |
| `CORRESPONDENCE_PURPOSES` | domain:correspondence-log.ts |  | 0 |
| `DEFAULT_ATTEMPT_CAP` | domain:chase.ts | REQ-CHASE-09/-10 — the economics guard. | 0 |
| `DEFAULT_INVITATION_CEILING` | domain:affiliation.ts |  | 0 |
| `DEVICE_LEASE_SECONDS` | domain:outbound-queue.ts | A device's lease is longer, because a tablet on a counter may be picked up, carried to a patient, and put down again before it confirms. | 0 |
| `DEVICE_STALE_AFTER_POLLS` | domain:devices.ts | TWO MISSED HEARTBEATS AND THE ROW SAYS SO. | 0 |
| `DEVICE_STATES` | domain:devices.ts | `inactive` IS RECEPTION'S SWITCH; `revoked` IS THE ADMINISTRATOR'S (Carl, 4–5 Sep 2026, TODO.md "Tablets: make one inactive"). | 0 |
| `ENDURING_TERMINATION_NOTICE` | domain:enduring-termination-notice.ts |  | 0 |
| `ENDURING_TERMINATION_NOTICE_IS_DRAFT` | domain:enduring-termination-notice.ts | True while the wording is unwritten. | 0 |
| `FORBIDDEN_WHILE_ACTING_AS` | domain:acting-as.ts | WHAT AN OPERATOR MAY NOT DO WHILE WEARING A PRACTICE'S FACE. | 0 |
| `FOURTEENTH_BIRTHDAY_LEAD_DAYS` | domain:enduring.ts | Prompt the practice this far ahead so it is re-papered before an invalid claim, not after. | 0 |
| `GENERATED_PRACTICE_CODE_PATTERN` | domain:account-naming.ts | A generated code is `p` then twelve hex characters, and it starts with a letter so it can never be mistaken for a truncated ABN or a row number. | 0 |
| `HOLIDAY_RULES` | domain:public-holidays.ts | The standing rules. | 0 |
| `IDENTIFIER_MATCH_MEANS` | domain:evidence.ts | Whether a match should be read as reassurance. | 0 |
| `INACTIVITY_GRACE_MONTHS` | domain:practice-users.ts | Warned this long ago and still absent, and access is withdrawn. | 0 |
| `INACTIVITY_WARN_MONTHS` | domain:practice-users.ts | Inactive this long, and we ask them to sign in. | 0 |
| `INBOUND_LANES` | domain:inbound-lanes.ts |  | 0 |
| `INBOUND_STATES` | domain:inbound-lanes.ts | The same states as the outbound queue, for the same reasons (outbound-queue.ts). | 0 |
| `INVITATION_CODE_PATTERN` | domain:invitation.ts | Exactly six digits. | 0 |
| `INVITATION_HEADROOM` | domain:affiliation.ts | A practice states its headcount at onboarding; the cap is that plus room to grow, bounded by a default ceiling. | 0 |
| `INVITATION_STATES` | domain:invitation.ts | `not_found` covers a token that never existed AND one already used, because both clear the token. | 0 |
| `KIOSK_COMMAND_KINDS` | domain:kiosk.ts | The commands a heartbeat may answer with. | 0 |
| `KIOSK_COMMAND_TTL_MS` | domain:kiosk.ts | HOW LONG A COMMAND IS WORTH DELIVERING — two minutes (Carl, 4 Sep 2026). | 0 |
| `KIOSK_POLL_MS` | domain:kiosk.ts | HOW FAST THE TABLET ASKS AGAIN — §9.4, and the reasoning there is the reasoning here. | 0 |
| `KIOSK_WAITING_ROW_FIELDS` | domain:kiosk.ts | Every field a waiting-list row may carry. | 0 |
| `LOG_AUDIENCES` | domain:correspondence-log.ts | Who is reading. | 0 |
| `MAX_ADMIN_ACCOUNTS` | domain:practice-users.ts | EXACTLY ONE ADMIN ACCOUNT PER PRACTICE, and it is not a person. | 0 |
| `MAX_ATTEMPTS` | domain:outbound-queue.ts | After this many failed attempts an item stops trying and waits for a human. | 0 |
| `MAX_CHANGES_PER_MONTH` | domain:pending-email-change.ts | How many changes are too many, and over what. | 0 |
| `MAX_LOGO_PIXELS` | domain:practice-logo.ts | Above this it is a photograph somebody dragged in by mistake. | 0 |
| `MAX_SIGNATURE_VECTOR_BYTES` | domain:signature.ts |  | 0 |
| `MINIMUM_SCORE` | domain:checks.ts | ⚠ DRAFT PARAMETERS — captured now, enforced later (design §2). | 0 |
| `MINIMUM_STRONG_CHECKS` | domain:checks.ts |  | 0 |
| `MIN_LOGO_PIXELS` | domain:practice-logo.ts | Below this in either direction the mark is an artefact of a bad export. | 0 |
| `NOTICE_DELIVERY_STATES` | domain:notice.ts | Each state is independently evidenced with its own timestamp. | 0 |
| `NOTICE_ESCALATION_HOURS` | domain:notice.ts | Escalate before the window closes, not after (REQ-DEL-03). | 0 |
| `NOTICE_WINDOW_HOURS` | domain:notice.ts |  | 0 |
| `OUTBOUND_CHANNELS` | domain:outbound-queue.ts | Where a thing is going. | 0 |
| `PACKED_REPORT_RANGE` | domain:packed-reports.ts | TWO YEARS, and it is retention rather than a default. | 0 |
| `PAGES` | domain:page-access.ts | Every page, and who may open it. | 0 |
| `PAPERWORK_STATES` | domain:practitioner-queue.ts | THE THREE WORDS, AND ONE MORE THAT §3 DID NOT ANTICIPATE. | 0 |
| `PARTICULAR_DETAIL_TYPES` | domain:tablet-session.ts | THE THREE THAT ARE PARTICULARS, AND THE TWO THAT ARE NOT (Carl, 4 Sep 2026). | 0 |
| `PATIENT_MESSAGE_TEMPLATES` | domain:patient-message-templates.ts |  | 0 |
| `PATIENT_MESSAGE_TEMPLATES_VERSION` | domain:patient-message-templates.ts | Recorded beside every message sent from this file. | 0 |
| `PATIENT_TIMELINE_TYPES` | domain:patient-work.ts | WHAT HAPPENED TO THIS PATIENT, IN ORDER — types, times and short labels only. | 0 |
| `PENDING_EMAIL_EXPIRY_DAYS` | domain:pending-email-change.ts | Five days, matching the correction window on an emailed amendment link. | 0 |
| `PENDING_EMAIL_OUTCOMES` | domain:pending-email-change.ts | How the request ended. | 0 |
| `PLATFORM_ADMIN_ROLE` | domain:landing.ts |  | 0 |
| `PORTAL_RECORD_ID_LINE_TEMPLATE_KEY` | domain:patient-message-templates.ts | The one sentence every portal-related message ends with. | 0 |
| `POSTCODE_DATASET` | domain:address.ts |  | 0 |
| `POST_SERVICE_OUTCOMES` | domain:visit-policy.ts | WHAT THIS *RENDERED* SERVICE NEEDS SIGNED (Carl, 11 Sep 2026; TODO.md "Two front doors" decision (b), "Still to build: Post-service push"). | 0 |
| `POST_SERVICE_POLICY_INPUTS` | domain:visit-policy.ts | The two input names, which is also the set a post-service `when` may mention. | 0 |
| `POST_SERVICE_POLICY_RULES` | domain:visit-policy.ts | The post-service table, in file order, which is evaluation order. | 0 |
| `PRACTICE_CODE_MAX_LENGTH` | domain:account-naming.ts | 24 characters (section 3b rule 3). | 0 |
| `PRACTICE_CODE_MIN_LENGTH` | domain:account-naming.ts | Under three characters is not a code anybody would recognise -- a practice named in a non-Latin script strips to nothing -- so section 3b rule 4 falls back to a GENERATED code rather than a mangled one, and marks it generated. | 0 |
| `PRACTICE_CODE_PATTERN` | domain:account-naming.ts | What a code may contain once allocated. | 0 |
| `PRACTICE_SURFACES` | domain:practice-surfaces.ts | Every surface, in file order. | 0 |
| `PRACTICE_SURFACE_CONTENT` | domain:practice-surfaces.ts | The whole parsed file, for the tests and for anything that wants to enumerate. | 0 |
| `PRACTICE_TIMEZONE` | domain:practice-day.ts | THE ZONE A PRACTICE'S DAY IS MEASURED IN — the reporting zone, deliberately the same object rather than a copy. | 0 |
| `PRINT_DOCUMENT_LANES` | domain:inbound-lanes.ts |  | 0 |
| `PROVIDER_TYPE_PROFESSIONS` | domain:ahpra.ts | Does the AHPRA profession support the provider type a practice is asserting? | 0 |
| `PURPOSE_FAMILIES` | domain:correspondence-log.ts | WHAT THE THING ACTUALLY IS, in three facts. | 0 |
| `PUSH_BLOCKED_REASONS` | domain:tablet-session.ts | WHY A PUSH WAS REFUSED — a CODE, never the rule's own sentence with data folded into it, and never anything about the patient. | 0 |
| `QUEUE_TICKET_MAX_LENGTH` | domain:queue-ticket.ts | The longest a ticket may be. | 0 |
| `QUEUE_TICKET_SOURCES` | domain:queue-ticket.ts | WHERE A NUMBER CAME FROM, IN PRECEDENCE ORDER (Carl, 12 September 2026; D-2026-09-12-18). | 0 |
| `RECONCILIATION_DECISIONS` | domain:reconciliation-decision.ts |  | 0 |
| `REGISTRATION_SOURCES` | domain:ahpra.ts | How the registration details were obtained. | 0 |
| `REPORT_SCOPES` | domain:reporting.ts | WHOSE NUMBERS SOMEBODY MAY SEE. | 0 |
| `RETENTION_YEARS_DEFAULT` | domain:retention.ts |  | 0 |
| `RETENTION_YEARS_MAX` | domain:retention.ts |  | 0 |
| `RETENTION_YEARS_MIN` | domain:retention.ts |  | 0 |
| `REVIEW_RESOLUTIONS` | domain:review-tasks.ts | How a task ended. | 0 |
| `REVIEW_TASK_STATES` | domain:review-tasks.ts |  | 0 |
| `SECOND_FACTOR_MAX_AGE_SECONDS` | domain:auth-method.ts | HOW FRESH A SECOND FACTOR HAS TO BE FOR A HIGH-STAKES ACT (AUTH-TIERS.md §5.2), in seconds. | 0 |
| `SELF_ASSIGN_AGE` | domain:enduring.ts |  | 0 |
| `SENSITIVE_CONTACT_FIELDS` | domain:review-tasks.ts | Which fields, if changed, raise the HIGH-stakes contact task rather than the ordinary one. | 0 |
| `SIGHTING_FULL_WEIGHT_DAYS` | domain:practitioner-strength.ts | How long a sighting keeps FULL weight, and how long before it is worth zero. | 0 |
| `SIGHTING_WORTHLESS_DAYS` | domain:practitioner-strength.ts |  | 0 |
| `SIGNATURE_REFUSAL_REASONS` | domain:tablet-session.ts | WHY A SIGNATURE WAS REFUSED — a CODE, never the server's own sentence, and never anything about the patient (Carl, 7 Sep 2026). | 0 |
| `SIGNED_DB4_CONTENT_VERSION` | domain:signed-db4-content.ts | Recorded on the agreement, so "which wording produced this page" is a query. | 0 |
| `SIGNED_DB4_LABEL_KEYS` | domain:signed-db4-content.ts | THE FIXED LABELS, and the list is closed. | 0 |
| `STATE_POSTCODE_RANGES` | domain:address.ts | ⚠ UNVERIFIED DATASET, on the same footing as the public-holiday calendar: real, widely published, and not yet checked against an authoritative source. | 0 |
| `STATUS_TRANSITIONS` | domain:lifecycle.ts | Allowed forward transitions. | 0 |
| `SUPPRESSIONS_SHOWN_ON_LOG` | domain:correspondence-log.ts | A send that never happened, and why. | 0 |
| `TABLET_SESSION_PATIENT_FIELDS` | domain:tablet-session.ts | WHAT THE TABLET IS SHOWN ABOUT THE PATIENT, and the list is the contract. | 0 |
| `TABLET_SESSION_STATES` | domain:tablet-session.ts |  | 0 |
| `USER_SCOPES` | domain:practice-users.ts | Where a user's access sits. | 0 |
| `VISIT_AGREEMENT_TYPES` | domain:visit-policy.ts | The three answers. | 0 |
| `VISIT_POLICY_ENDURING_PATHWAYS` | domain:visit-policy.ts | THE PATHWAY AN ENDURING AGREEMENT IS ENTERED UNDER, and it is CONTENT rather than code for the same reason the type is (hard rule 14). | 0 |
| `VISIT_POLICY_INPUTS` | domain:visit-policy.ts | The six input names, which is also the set a rule's `when` may mention. | 0 |
| `VISIT_POLICY_RULES` | domain:visit-policy.ts | The rule table, in file order, which is evaluation order. | 0 |
| `VISIT_POLICY_VERSION` | domain:visit-policy.ts | Recorded on every arrival, so the decision says which table produced it. | 0 |
| `VISIT_STATE_CONTENT` | domain:visit-states.ts |  | 0 |
| `WAITING_SCOPES` | domain:practitioner-queue.ts | WHOSE LIST IS BEING ASKED FOR — decided by the SERVER from the token, never sent up by the browser. | 0 |

## Domain types

284 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `AgreementType` | domain:agreement.ts |  | **11** · core:patients/patients.service.ts, core:tablet-sessions/tablet-sessions.service.ts, web:kiosk/Ceremony.tsx, +8 more |
| `IsoTimestamp` | domain:ids.ts | ISO-8601 UTC timestamp string (server-authoritative time — REQ-VAULT-03). | **10** · core:inbound/inbound-print-jobs.service.ts, vault:chain/chain-store.ts, vault:chain/immudb-chain-store.ts, +7 more |
| `Audience` | domain:page-access.ts |  | **9** · web:BackLink.tsx, web:MainMenu.tsx, web:practice/channels/ChannelsView.tsx, +6 more |
| `ConfirmableDetailType` | domain:tablet-session.ts |  | **7** · core:arrivals/arrivals.service.ts, core:patients/patients.service.ts, core:tablet-sessions/tablet-sessions.service.ts, +4 more |
| `DeviceRow` | domain:devices.ts | A device as the console lists it. | **7** · core:devices/devices.service.ts, web:practice/channels/ChannelsView.tsx, web:practice/deviceActivity.ts, +4 more |
| `IsoDate` | domain:ids.ts | Calendar date, `YYYY-MM-DD`, in the practice's timezone. | **7** · connector:mock-adapter.ts, core:auto-capture/auto-capture.controller.ts, core:auto-capture/auto-capture.service.ts, +4 more |
| `KioskScreen` | domain:kiosk.ts |  | **7** · core:devices/devices.service.ts, core:kiosk/kiosk.controller.ts, core:kiosk/kiosk.service.ts, +4 more |
| `AgreementStatus` | domain:agreement.ts | REQ-REC-02 + design decisions §7, incl. | **5** · core:agreements/agreements.service.ts, core:retention/retention-sweep.service.ts, domain:assignor.ts, +2 more |
| `EnduringPathway` | domain:agreement.ts |  | **5** · core:agreements/agreements.service.ts, core:enduring/enduring.service.ts, core:notices/notices.service.ts, +2 more |
| `KioskCommand` | domain:kiosk.ts |  | **5** · core:devices/devices.service.ts, core:kiosk/kiosk.service.ts, web:kiosk/Ceremony.tsx, +2 more |
| `KioskWaitingRow` | domain:kiosk.ts |  | **5** · core:kiosk/kiosk.service.ts, web:kiosk/Ceremony.tsx, web:kiosk/api.ts, +2 more |
| `ApprovedIdentifierType` | domain:identifiers.ts |  | **4** · core:kiosk/kiosk.service.ts, core:verification/identifier-matching.ts, core:verification/verification.service.ts, +1 more |
| `DisputeResolutionOutcome` | domain:tablet-session.ts |  | **4** · core:patients/patients.service.ts, core:tablet-sessions/dispute-resolution.dto.ts, core:tablet-sessions/tablet-sessions.service.ts, +1 more |
| `DrawnSignatureCapture` | domain:signature.ts | What the tablet sends with a `drawn` signature. | **4** · core:agreements/agreements.service.ts, web:kiosk/components/SignaturePad.tsx, web:kiosk/rules/signature-payload.ts, +1 more |
| `ProviderType` | domain:parties.ts | Drives Basic Service Description categories and the enduring GP-only rule (REQ-END-01a). | **4** · core:agreements/agreements.service.ts, core:enduring/enduring.service.ts, domain:billing-roles.ts, +1 more |
| `PushBlockedReason` | domain:tablet-session.ts |  | **4** · core:tablet-sessions/push-refusal.ts, core:tablet-sessions/tablet-sessions.service.ts, web:practice/tablet/pushDesk.tsx, +1 more |
| `TabletSessionPayload` | domain:tablet-session.ts | THE ONE PAYLOAD `GET /kiosk/session` RETURNS. | **4** · core:tablet-sessions/tablet-sessions.service.ts, web:kiosk/Ceremony.tsx, web:kiosk/api.ts, +1 more |
| `TabletSessionRow` | domain:tablet-session.ts | A session as the CONSOLE lists it — a staff surface, so the patient's name is allowed here exactly as it is on every other practice list. | **4** · core:tablet-sessions/tablet-sessions.service.ts, web:practice/frontdesk/visitChecklist.ts, web:practice/patients/PatientWorkView.tsx, +1 more |
| `TabletSessionState` | domain:tablet-session.ts |  | **4** · core:patients/patients.service.ts, core:tablet-sessions/tablet-sessions.service.ts, web:kiosk/api.ts, +1 more |
| `AgreementTemplateType` | domain:agreement-templates.ts |  | **3** · core:templates/templates.service.ts, web:practice/templates/TemplateForm.tsx, web:practice/templates/templateEditing.ts |
| `CorrectablePatientField` | domain:tablet-session.ts |  | **3** · core:arrivals/arrivals.service.ts, core:patients/patients.service.ts, web:practice/tablet/pushDesk.tsx |
| `PatientId` | domain:ids.ts |  | **3** · contracts:pms-adapter.ts, domain:agreement.ts, domain:parties.ts |
| `PatientQueueItem` | domain:patient-work.ts |  | **3** · core:patients/patients.service.ts, web:practice/patients/PatientWorkView.tsx, web:practice/patients/PatientsQueueView.tsx |
| `PatientQueueRow` | domain:patient-work.ts | ONE PATIENT WITH SOMETHING OPEN TODAY. | **3** · core:patients/patients.service.ts, web:practice/patients/PatientWorkView.tsx, web:practice/patients/PatientsQueueView.tsx |
| `RenderedAgreementTemplate` | domain:agreement-templates.ts |  | **3** · core:agreements/agreements.service.ts, core:render/agreement-document.ts, web:practice/templates/TemplateForm.tsx |
| `ReviewFlag` | domain:review.ts |  | **3** · web:review/QueueView.tsx, web:review/[id]/DossierView.tsx, web:review/flags.tsx |
| `VaultEventId` | domain:ids.ts |  | **3** · vault:chain/immudb-chain-store.ts, vault:chain/in-memory-chain-store.ts, contracts:vault.ts |
| `AgreementTemplate` | domain:agreement-templates.ts |  | **2** · core:templates/templates.service.ts, web:practice/templates/templateEditing.ts |
| `AssignorId` | domain:ids.ts |  | **2** · domain:agreement.ts, domain:parties.ts |
| `AssignorPartySnapshot` | domain:assignor.ts | The party as it stands, or as a request would have it. | **2** · core:agreements/agreements.service.ts, web:practice/tablet/pushDesk.tsx |
| `AuditEntry` | domain:audit.ts |  | **2** · core:organisations/audit.service.ts, web:review/AuditTrail.tsx |
| `AustralianState` | domain:public-holidays.ts |  | **2** · core:enduring/enduring.service.ts, domain:enduring.ts |
| `AutoCaptureSuppressionReason` | domain:auto-capture.ts |  | **2** · core:auto-capture/auto-capture.service.ts, core:inbound/inbound-print-jobs.processor.ts |
| `CardState` | domain:setup.ts |  | **2** · core:organisations/setup.service.ts, web:practice/setup/SetupHub.tsx |
| `CheckRecord` | domain:checks.ts |  | **2** · core:identity-dashboard/identity-dashboard.service.ts, core:organisations/checks.service.ts |
| `DispatchRow` | domain:correspondence-log.ts | One correspondence row, as much of it as the log needs. | **2** · web:patient/messages/[token]/PatientMessagesView.tsx, web:practice/correspondence/CorrespondenceView.tsx |
| `InboundLane` | domain:inbound-lanes.ts |  | **2** · core:inbound/inbound-lane.worker.ts, core:inbound/inbound-print-jobs.service.ts |
| `LogAudience` | domain:correspondence-log.ts |  | **2** · web:correspondence/MessageLog.tsx, web:practice/correspondence/CorrespondenceView.tsx |
| `NoticeContent` | domain:notice.ts | The four mandatory elements (reg 89AA, Addendum v2 §4 quoting p.37). | **2** · core:notices/notice-template.ts, core:notices/notices.service.ts |
| `OrganisationId` | domain:ids.ts |  | **2** · domain:agreement.ts, domain:parties.ts |
| `PatientTimelineEntry` | domain:patient-work.ts |  | **2** · core:patients/patients.service.ts, web:practice/patients/PatientWorkView.tsx |
| `PerformedCheck` | domain:checks.ts | A recorded check, as the console holds it — richer than `CheckRecord`, because this is the one place the FIELDS and the AUTHOR matter. | **2** · core:organisations/organisations.service.ts, web:review/[id]/DossierView.tsx |
| `PracticeId` | domain:ids.ts |  | **2** · domain:agreement.ts, domain:parties.ts |
| `PrintDocumentType` | domain:inbound-lanes.ts |  | **2** · aobprinter:db4-record.ts, contracts:print-capture.ts |
| `ProviderId` | domain:ids.ts |  | **2** · domain:agreement.ts, domain:parties.ts |
| `WaitingList` | domain:practitioner-queue.ts |  | **2** · core:practitioner-queue/practitioner-queue.service.ts, web:practice/practitioner/waiting/WaitingView.tsx |
| `AbrLookup` | domain:abn.ts | What the ABR gives back, reduced to the fields the gate actually uses. | **1** · core:organisations/abr.ts |
| `AcceptanceMethod` | domain:invitation.ts |  | **1** · core:affiliations/affiliations.service.ts |
| `AcceptedSignatureCapture` | domain:signature.ts |  | **1** · core:agreements/agreements.service.ts |
| `Agreement` | domain:agreement.ts | (file) The Agreement — the centre of the data model (design decisions §7). | **1** · domain:lifecycle.ts |
| `AgreementId` | domain:ids.ts |  | **1** · domain:agreement.ts |
| `AgreementNeeded` | domain:practitioner-queue.ts | WHETHER THIS VISIT NEEDS AN AGREEMENT AT ALL — a fact, never a reason code. | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `AgreementTemplateProblem` | domain:agreement-templates.ts |  | **1** · web:practice/templates/templateEditing.ts |
| `AgreementTemplateValues` | domain:agreement-templates.ts | What a substitution is given: strings for values, booleans for branches. | **1** · web:practice/templates/templateEditing.ts |
| `AssignorAuthorityBasis` | domain:parties.ts | Authority basis for an assignor acting for another person (REQ-VUL-01, self-declared per reg 65CB(5)). | **1** · domain:assignor.ts |
| `AssignorChangeKind` | domain:assignor.ts |  | **1** · core:agreements/agreements.service.ts |
| `AuditKind` | domain:audit.ts |  | **1** · web:review/AuditTrail.tsx |
| `AuthorityBasisForAnother` | domain:assignor.ts |  | **1** · domain:assignor-relationships.ts |
| `AutomaticCessationTrigger` | domain:enduring.ts |  | **1** · core:enduring/enduring.service.ts |
| `BusinessDayCalendar` | domain:enduring.ts | Public holidays are STATE-SPECIFIC: a Friday notice before a long weekend lands differently in each state (REQ-OFF-03). | **1** · domain:departure-notice.ts |
| `CeremonyRecord` | domain:enrolment-ceremony.ts |  | **1** · core:identity/identity.service.ts |
| `CessationReason` | domain:enduring.ts |  | **1** · core:enduring/enduring.service.ts |
| `ChaseAttemptSubjectType` | domain:chase-attempt.ts |  | **1** · core:chase-attempts/chase-attempts.service.ts |
| `ChaseBand` | domain:chase.ts |  | **1** · core:reconciliation/reconciliation.service.ts |
| `CheckWeight` | domain:checks.ts |  | **1** · domain:practitioner-strength.ts |
| `CopyOffer` | domain:agreement-copy.ts |  | **1** · core:agreement-copy/agreement-copy.service.ts |
| `CopyOfferInput` | domain:agreement-copy.ts |  | **1** · core:agreement-copy/agreement-copy.service.ts |
| `DeviceSettableTabletSessionState` | domain:tablet-session.ts |  | **1** · web:kiosk/api.ts |
| `EvidenceWarning` | domain:evidence.ts |  | **1** · core:artefacts/artefacts.service.ts |
| `FlagSeverity` | domain:review.ts | Severity orders the queue. | **1** · web:review/flags.tsx |
| `HolidayDataset` | domain:public-holidays.ts |  | **1** · domain:enduring.ts |
| `InvitationState` | domain:invitation.ts |  | **1** · core:affiliations/invitation.service.ts |
| `KioskCommandKind` | domain:kiosk.ts |  | **1** · core:devices/devices.service.ts |
| `LogEntry` | domain:correspondence-log.ts |  | **1** · web:correspondence/MessageLog.tsx |
| `LogSegment` | domain:correspondence-log.ts |  | **1** · web:practice/correspondence/CorrespondenceView.tsx |
| `NoticeDeliveryState` | domain:notice.ts |  | **1** · core:notices/notices.service.ts |
| `PackedBreakdown` | domain:packed-reports.ts |  | **1** · web:practice/reports/ReportsView.tsx |
| `PlaceFilter` | domain:packed-reports.ts | Narrowing to one place, which is not the same as breaking down BY place. | **1** · web:practice/reports/ReportsView.tsx |
| `PracticeDayWindow` | domain:practice-day.ts | ONE DAY IN THE PRACTICE'S ZONE, AS A HALF-OPEN INTERVAL OF INSTANTS. | **1** · core:arrivals/arrivals.service.ts |
| `PracticeFilter` | domain:search.ts | The status a row is filtered by. | **1** · web:practice/PracticeList.tsx |
| `QueueTicketSource` | domain:queue-ticket.ts |  | **1** · core:arrivals/arrivals.service.ts |
| `ReconciliationDecision` | domain:reconciliation-decision.ts |  | **1** · core:reconciliation/reconciliation.service.ts |
| `ReportScope` | domain:reporting.ts |  | **1** · core:outbound/outbound.service.ts |
| `SessionAuthMethod` | domain:auth-method.ts | What a session was authenticated with, in the product's own words. | **1** · core:auth/actor.decorator.ts |
| `SetupGap` | domain:setup.ts |  | **1** · web:practice/PracticeList.tsx |
| `SetupRow` | domain:setup.ts |  | **1** · core:organisations/setup.service.ts |
| `SignatureEventId` | domain:ids.ts |  | **1** · domain:agreement.ts |
| `SignaturePoint` | domain:signature.ts | A captured point, in the pad's own logical coordinate space. | **1** · web:kiosk/components/SignaturePad.tsx |
| `SignatureStroke` | domain:signature.ts | One continuous contact with the glass. | **1** · web:kiosk/components/SignaturePad.tsx |
| `SignedDb4Content` | domain:signed-db4-content.ts |  | **1** · core:render/signed-db4-document.ts |
| `StructuredAddress` | domain:address.ts |  | **1** · core:organisations/organisations.service.ts |
| `SuppressedSend` | domain:correspondence-log.ts |  | **1** · web:practice/correspondence/CorrespondenceView.tsx |
| `TabletSessionPatient` | domain:tablet-session.ts |  | **1** · web:kiosk/rules/pushed-details.ts |
| `TreatmentPlanId` | domain:ids.ts |  | **1** · domain:agreement.ts |
| `VerificationEventId` | domain:ids.ts |  | **1** · domain:agreement.ts |
| `VisitAgreementDecision` | domain:visit-policy.ts |  | **1** · core:arrivals/arrivals.service.ts |
| `WaitingGroup` | domain:practitioner-queue.ts | EVERYBODY WAITING FOR ONE PRACTITIONER. | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `WaitingRow` | domain:practitioner-queue.ts | ONE PERSON WAITING. | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `WaitingScope` | domain:practitioner-queue.ts |  | **1** · core:practitioner-queue/practitioner-queue.service.ts |
| `AcceptedLogo` | domain:practice-logo.ts |  | 0 |
| `AcceptedUpload` | domain:artefact.ts |  | 0 |
| `ActingAsSessionLike` | domain:acting-as.ts |  | 0 |
| `ActiveTabletSessionState` | domain:tablet-session.ts |  | 0 |
| `AddressCheckMethod` | domain:address-check.ts |  | 0 |
| `AddressRejectionReason` | domain:address-check.ts | Why a reviewer sent an address back. | 0 |
| `AddressWarning` | domain:address.ts |  | 0 |
| `AdminVerificationMethod` | domain:enrolment-ceremony.ts |  | 0 |
| `AdmissionAssessment` | domain:checks.ts |  | 0 |
| `Affiliation` | domain:affiliation.ts | (file) The practitioner-to-location affiliation. | 0 |
| `AffiliationForDeparture` | domain:practitioner-departure.ts |  | 0 |
| `AffiliationStatus` | domain:affiliation.ts |  | 0 |
| `AffiliationVelocity` | domain:affiliation.ts | There is NO CAP on how many practices a practitioner may be affiliated with. | 0 |
| `AgreementAnchor` | domain:agreement.ts | Polymorphic anchor (Addendum v3 §1.1): provider for episodic and for MyMedicare / aged-care enduring; organisation ONLY for the ACCHO/AMS enduring pathway. | 0 |
| `AgreementParticulars` | domain:agreement.ts | The s 65C(4) data set D1–D7, snapshotted onto the agreement at signature time (REQ-DATA-11). | 0 |
| `AgreementTemplateContent` | domain:agreement-templates.ts |  | 0 |
| `AgreementTemplateProblemKind` | domain:agreement-templates.ts | WHAT KIND OF PROBLEM, AND WHICH ELEMENT IT IS ABOUT (Carl, 7 Sep 2026; W1). | 0 |
| `AgreementTemplateSection` | domain:agreement-templates.ts |  | 0 |
| `AgreementTemplateStatement` | domain:agreement-templates.ts | One thing the assignor ticks. | 0 |
| `AgreementTemplateStatus` | domain:agreement-templates.ts |  | 0 |
| `AhpraRecord` | domain:ahpra.ts |  | 0 |
| `AhpraRegistrationStatus` | domain:ahpra.ts |  | 0 |
| `AhpraRegistrationType` | domain:ahpra.ts | One registration type held by a practitioner. | 0 |
| `AmendableField` | domain:amendment.ts |  | 0 |
| `AmendmentChange` | domain:amendment.ts |  | 0 |
| `AmendmentRequest` | domain:amendment.ts |  | 0 |
| `ApplicationContacts` | domain:contacts.ts |  | 0 |
| `ArtefactContentType` | domain:artefact.ts |  | 0 |
| `ArtefactPurpose` | domain:artefact.ts |  | 0 |
| `Assignor` | domain:parties.ts | An assignor is a person, not a field on the patient (Addendum v3 §7.3). | 0 |
| `AssignorContactChannel` | domain:assignor.ts |  | 0 |
| `AssignorContactInput` | domain:assignor.ts |  | 0 |
| `AssignorForAnother` | domain:assignor.ts |  | 0 |
| `AssignorForAnotherInput` | domain:assignor.ts |  | 0 |
| `AssignorRelationshipContent` | domain:assignor-relationships.ts |  | 0 |
| `AssignorRelationshipOption` | domain:assignor-relationships.ts |  | 0 |
| `AssignorRepointDisposition` | domain:assignor.ts |  | 0 |
| `AssignorRepointReason` | domain:assignor.ts | WHAT A REQUEST TO CHANGE WHO SIGNS SHOULD DO — the whole decision, in one place (Carl, 7 Sep 2026: "go — fix who is signing on locked rows"). | 0 |
| `AttachedElsewhere` | domain:evidence.ts |  | 0 |
| `AuState` | domain:address.ts |  | 0 |
| `AutoAssignorDecision` | domain:auto-capture.ts |  | 0 |
| `BillingRoleContent` | domain:billing-roles.ts |  | 0 |
| `BillingRoleOption` | domain:billing-roles.ts |  | 0 |
| `Branded` | domain:ids.ts |  | 0 |
| `CaptureInputs` | domain:setup.ts |  | 0 |
| `CaptureReadiness` | domain:setup.ts |  | 0 |
| `CaptureRequestId` | domain:ids.ts |  | 0 |
| `CeremonyContext` | domain:enrolment-ceremony.ts |  | 0 |
| `CeremonySubjectKind` | domain:enrolment-ceremony.ts |  | 0 |
| `ChaseAttemptChannel` | domain:chase-attempt.ts |  | 0 |
| `ChaseAttemptInput` | domain:chase-attempt.ts |  | 0 |
| `ChaseAttemptOutcome` | domain:chase-attempt.ts |  | 0 |
| `ChaseBandPolicy` | domain:chase.ts |  | 0 |
| `ChaseNextStep` | domain:chase.ts | What the ladder says comes next, given what has already been tried. | 0 |
| `CheckCategory` | domain:checks.ts |  | 0 |
| `CheckDefinition` | domain:checks.ts |  | 0 |
| `CheckOutcome` | domain:checks.ts |  | 0 |
| `CheckSummary` | domain:checks.ts |  | 0 |
| `ConsoleRole` | domain:practice-users.ts |  | 0 |
| `ContactClash` | domain:contacts.ts |  | 0 |
| `ContactedPartyType` | domain:chase-attempt.ts |  | 0 |
| `CopyDeliveryContent` | domain:agreement-copy.ts |  | 0 |
| `CopyDeliveryOption` | domain:agreement-copy.ts |  | 0 |
| `CopyDeliveryTransport` | domain:agreement-copy.ts |  | 0 |
| `CopyOfferChannel` | domain:agreement-copy.ts |  | 0 |
| `CopyOfferUnavailable` | domain:agreement-copy.ts | Why no channel could be offered. | 0 |
| `CorrespondencePurpose` | domain:correspondence-log.ts |  | 0 |
| `Counted` | domain:reporting.ts |  | 0 |
| `CubeGranularity` | domain:packed-reports.ts |  | 0 |
| `CubeQuery` | domain:packed-reports.ts |  | 0 |
| `DepartureReason` | domain:practitioner-departure.ts |  | 0 |
| `DepartureRequest` | domain:practitioner-departure.ts |  | 0 |
| `DerivedAuthority` | domain:assignor-relationships.ts |  | 0 |
| `DeviceState` | domain:devices.ts |  | 0 |
| `DirectoryEntry` | domain:directory.ts | The ONLY shape in which a practitioner crosses a practice boundary. | 0 |
| `EndOfAffiliationEffects` | domain:affiliation.ts | What actually happens when the end date arrives. | 0 |
| `EndedTabletSessionState` | domain:tablet-session.ts |  | 0 |
| `EnduringTerminationNoticeSection` | domain:enduring-termination-notice.ts |  | 0 |
| `EnduringTerminationNoticeTemplate` | domain:enduring-termination-notice.ts |  | 0 |
| `EstablishedEntitlement` | domain:checks.ts |  | 0 |
| `EvidenceWarningKind` | domain:evidence.ts |  | 0 |
| `ExternalLink` | domain:external-links.ts |  | 0 |
| `ExternalLinkKey` | domain:external-links.ts |  | 0 |
| `ExternalNoticeAttestation` | domain:departure-notice.ts |  | 0 |
| `FailureOutcome` | domain:outbound-queue.ts |  | 0 |
| `FilterableRow` | domain:search.ts |  | 0 |
| `HolidayRule` | domain:public-holidays.ts |  | 0 |
| `InboundState` | domain:inbound-lanes.ts |  | 0 |
| `InvitationCap` | domain:affiliation.ts |  | 0 |
| `KioskBlockedReason` | domain:kiosk.ts | A CODE, NEVER FREE TEXT — and never a rule message with data folded into it (hard rule 9's reasoning applied to a new surface: this screen is read by whoever is in the waiting room, so it must say "signable or not" without ever repeating a rules-engine sentence that might, some day, carry a detail it should not). | 0 |
| `KioskCapturableStatus` | domain:kiosk.ts |  | 0 |
| `KioskWaitingRowField` | domain:kiosk.ts |  | 0 |
| `LandingInput` | domain:landing.ts |  | 0 |
| `LifecycleAction` | domain:practice-users.ts | What the lifecycle can do to an account. | 0 |
| `LocalityComparison` | domain:address.ts |  | 0 |
| `LocalityMatch` | domain:address.ts |  | 0 |
| `LogState` | domain:correspondence-log.ts | A projection of the transport's states, plus the one that never had a transport. | 0 |
| `LogoContentType` | domain:practice-logo.ts |  | 0 |
| `Matrix` | domain:reporting.ts |  | 0 |
| `NameMatch` | domain:abn.ts |  | 0 |
| `NameMatchTier` | domain:abn.ts | Practices trade under a name that is not their legal entity name, routinely: legal entity "Smith Medical Pty Ltd" trading as "Sampletown Family Practice". | 0 |
| `NominationId` | domain:ids.ts |  | 0 |
| `NoticeAssessment` | domain:departure-notice.ts |  | 0 |
| `NoticeBasis` | domain:departure-notice.ts | Where the notice came from. | 0 |
| `NoticeId` | domain:ids.ts |  | 0 |
| `NoticeOfDeparture` | domain:affiliation.ts |  | 0 |
| `Organisation` | domain:parties.ts | ACCHO/AMS organisation — the enduring anchor on that pathway (Addendum v3 §1.1). | 0 |
| `OrganisationApplication` | domain:abn.ts |  | 0 |
| `OrganisationGateResult` | domain:abn.ts |  | 0 |
| `OutboundChannel` | domain:outbound-queue.ts |  | 0 |
| `OutboundItemLike` | domain:outbound-queue.ts |  | 0 |
| `OutboundState` | domain:outbound-queue.ts |  | 0 |
| `PackedReport` | domain:packed-reports.ts |  | 0 |
| `PackedReportShape` | domain:packed-reports.ts | How a report is drawn, which is not the same as what it asks for. | 0 |
| `PageRule` | domain:page-access.ts |  | 0 |
| `PaperworkState` | domain:practitioner-queue.ts |  | 0 |
| `ParticularDetailType` | domain:tablet-session.ts |  | 0 |
| `Patient` | domain:parties.ts | Minimum patient record (design decisions §6.3). | 0 |
| `PatientMessageTemplate` | domain:patient-message-templates.ts |  | 0 |
| `PatientMessageTemplates` | domain:patient-message-templates.ts |  | 0 |
| `PatientQueueItemKind` | domain:patient-work.ts | ONE OPEN THING ABOUT ONE PATIENT. | 0 |
| `PatientTimelineType` | domain:patient-work.ts |  | 0 |
| `PendingEmailOutcome` | domain:pending-email-change.ts |  | 0 |
| `PendingEmailRecipient` | domain:pending-email-change.ts |  | 0 |
| `PersonVerificationMethod` | domain:enrolment-ceremony.ts |  | 0 |
| `PostServiceDecision` | domain:visit-policy.ts |  | 0 |
| `PostServiceOutcome` | domain:visit-policy.ts |  | 0 |
| `PostServicePolicyInput` | domain:visit-policy.ts | EVERYTHING THIS DECISION IS ALLOWED TO KNOW. | 0 |
| `PostServiceRule` | domain:visit-policy.ts |  | 0 |
| `Practice` | domain:parties.ts |  | 0 |
| `PracticeLocation` | domain:parties.ts |  | 0 |
| `PracticeNaming` | domain:account-naming.ts | THE NAME A CODE IS PROPOSED FROM: the trading name where there is one, else the practice name, NEVER the legal name (section 3b rule 1). | 0 |
| `PracticeSurface` | domain:practice-surfaces.ts |  | 0 |
| `PracticeSurfaceContent` | domain:practice-surfaces.ts |  | 0 |
| `PractitionerRecord` | domain:directory.ts | Everything the platform holds about a practitioner. | 0 |
| `PractitionerStrength` | domain:practitioner-strength.ts |  | 0 |
| `PractitionerStrengthInput` | domain:practitioner-strength.ts |  | 0 |
| `ProfessionComparison` | domain:ahpra.ts |  | 0 |
| `ProfessionMatch` | domain:ahpra.ts |  | 0 |
| `Provider` | domain:parties.ts |  | 0 |
| `PurposeArtefact` | domain:correspondence-log.ts | The agreement itself, or a reg 89AA notice about one. | 0 |
| `PurposeDescriptor` | domain:correspondence-log.ts |  | 0 |
| `PurposeFamily` | domain:correspondence-log.ts |  | 0 |
| `PurposeTiming` | domain:correspondence-log.ts | Before the service, or after it. | 0 |
| `RegisteredNames` | domain:abn.ts |  | 0 |
| `RegistrationSource` | domain:ahpra.ts |  | 0 |
| `RegistrationWarning` | domain:ahpra.ts |  | 0 |
| `RenderedPatientMessage` | domain:patient-message-templates.ts |  | 0 |
| `ReportGrain` | domain:reporting.ts |  | 0 |
| `ReportMatrix` | domain:reporting.ts |  | 0 |
| `ResolvedHoliday` | domain:public-holidays.ts |  | 0 |
| `ReviewResolution` | domain:review-tasks.ts |  | 0 |
| `ReviewTaskKind` | domain:review-tasks.ts |  | 0 |
| `ReviewTaskState` | domain:review-tasks.ts |  | 0 |
| `ReviewableApplication` | domain:review.ts |  | 0 |
| `RosterEntry` | domain:directory.ts | What a practice may see about a practitioner IT HAS A RELATIONSHIP WITH. | 0 |
| `SearchablePractice` | domain:search.ts |  | 0 |
| `ServiceDescriptionContent` | domain:service-descriptions.ts |  | 0 |
| `SignatureGateState` | domain:guards.ts |  | 0 |
| `SignatureRefusalReason` | domain:tablet-session.ts |  | 0 |
| `SignedDb4Footer` | domain:signed-db4-content.ts |  | 0 |
| `SignedDb4LabelKey` | domain:signed-db4-content.ts |  | 0 |
| `SignedDb4Labels` | domain:signed-db4-content.ts |  | 0 |
| `SignedDb4Layout` | domain:signed-db4-content.ts |  | 0 |
| `SignerContact` | domain:agreement-copy.ts | A contact pair, from whichever record the signer's contact lives on. | 0 |
| `Stakes` | domain:review-tasks.ts | How much rides on getting this one wrong. | 0 |
| `StepUpDecision` | domain:auth-method.ts | The answer to "may this session do the irreversible thing", and why not. | 0 |
| `StepUpRefusal` | domain:auth-method.ts | Why a high-stakes act was refused — the code, not the sentence. | 0 |
| `StrengthLine` | domain:practitioner-strength.ts | One line of the §6 table, as it applies to one practitioner. | 0 |
| `SurfaceOrAlways` | domain:practice-surfaces.ts | A surface key, or `always`. | 0 |
| `SurfaceProfile` | domain:practice-surfaces.ts |  | 0 |
| `TabletSessionAssignor` | domain:tablet-session.ts | WHO IS SIGNING, as the tablet is told it. | 0 |
| `TabletSessionPatientField` | domain:tablet-session.ts |  | 0 |
| `UploadCandidate` | domain:artefact.ts |  | 0 |
| `UserScope` | domain:practice-users.ts |  | 0 |
| `VerificationEvidence` | domain:identifiers.ts | A verification event record — types and outcomes only, never values (REQ-VER-04, HARD-04). | 0 |
| `VisitAgreementType` | domain:visit-policy.ts |  | 0 |
| `VisitPaperwork` | domain:practitioner-queue.ts | What the caller knows about one visit's paperwork. | 0 |
| `VisitPolicyContent` | domain:visit-policy.ts |  | 0 |
| `VisitPolicyEnduringPathway` | domain:visit-policy.ts |  | 0 |
| `VisitPolicyInput` | domain:visit-policy.ts | EVERYTHING THE DECISION IS ALLOWED TO KNOW. | 0 |
| `VisitPolicyRule` | domain:visit-policy.ts |  | 0 |
| `VisitStateContent` | domain:visit-states.ts |  | 0 |
| `VisitStateOption` | domain:visit-states.ts |  | 0 |
| `VisitStateRecord` | domain:visit-states.ts | ONE RECORD OF SOMEBODY SAYING WHERE A VISIT HAD GOT TO. | 0 |

## Contracts types

91 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `PrintJobEnvelope` | contracts:print-capture.ts |  | **8** · core:agreements/db4-form-view.ts, core:agreements/signed-db4.service.ts, core:inbound/db4-assignment.handler.ts, +5 more |
| `VaultEventInput` | contracts:vault.ts |  | **8** · core:artefacts/artefacts.service.ts, vault:chain/chain-store.contract.ts, vault:chain/chain-store.ts, +5 more |
| `VaultEventRecord` | contracts:vault.ts |  | **7** · vault:chain/chain-store.ts, vault:chain/immudb-chain-store.ts, vault:chain/in-memory-chain-store.ts, +4 more |
| `ArrivalProviderChoice` | contracts:arrivals.ts | A SERVICING PRACTITIONER, AT A LOCATION, reception may choose instead. | **5** · core:arrivals/arrivals.service.ts, web:practice/patients/NewAgreementPanel.tsx, web:practice/patients/PatientsQueueView.tsx, +2 more |
| `DayRegisterRow` | contracts:arrivals.ts | WHO CAME IN, WHEN, TO SEE WHOM, AND WHAT HAPPENED ABOUT THEIR AGREEMENT (Carl, 12 September 2026, on `/practice/frontdesk`: *"Add a button here with a link to show all Patients seen at this practice today. | **5** · core:arrivals/arrivals.service.ts, web:practice/day/DayView.tsx, web:practice/frontdesk/FrontDeskView.tsx, +2 more |
| `PmsAdapter` | contracts:pms-adapter.ts | The adapter contract. | **5** · connector:mock-adapter.ts, core:auto-capture/auto-capture.service.ts, core:pms/pms-sync.service.ts, +2 more |
| `RuleResult` | contracts:rules-engine.ts |  | **5** · core:service-descriptions/service-descriptions.service.ts, rules:rules/rule-set-2026-08.draft.ts, rules:rules/rule-set.contract.ts, +2 more |
| `DayRegister` | contracts:arrivals.ts | ONE PRACTICE'S DAY. | **4** · core:arrivals/arrivals.service.ts, web:practice/day/DayView.tsx, web:practice/frontdesk/FrontDeskView.tsx, +1 more |
| `Db4FormView` | contracts:db4-form-view.ts | The block the lock response carries for a session that came from a DB4 Print Record. | **4** · core:agreements/agreements.service.ts, core:agreements/db4-form-view.ts, web:kiosk/api.ts, +1 more |
| `ExpectedAppointment` | contracts:arrivals.ts | SOMEBODY BOOKED FOR TODAY WHO HAS NOT WALKED IN YET (Carl, 12 Sep 2026; FRONT-DESK-PAGE.md §12.4). | **4** · core:arrivals/arrivals.service.ts, web:practice/frontdesk/FrontDeskView.tsx, web:practice/frontdesksmall/deskLines.ts, +1 more |
| `PmsPatientRecord` | contracts:pms-adapter.ts |  | **4** · connector:mock-adapter.ts, core:auto-capture/auto-capture.service.ts, core:pms/pms-sync.service.ts, +1 more |
| `PmsProvider` | contracts:pms-adapter.ts |  | **4** · connector:mock-adapter.ts, core:auto-capture/auto-capture.service.ts, core:pms/pms-sync.service.ts, +1 more |
| `Db4PrintRecordCheck` | contracts:db4-print-record-check.ts | One failed check. | **3** · core:agreements/agreements.service.ts, core:agreements/db4-form-view.ts, core:tablet-sessions/push-refusal.ts |
| `PmsInvoice` | contracts:pms-adapter.ts |  | **3** · connector:mock-adapter.ts, core:pms/pms-sync.service.ts, contracts:print-capture.ts |
| `RulesEngineClient` | contracts:rules-engine.ts |  | **3** · core:agreements/agreements.service.ts, core:rules-client/rules-client.module.ts, core:service-descriptions/service-descriptions.service.ts |
| `ValidationResponse` | contracts:rules-engine.ts |  | **3** · core:rules-client/rules-client.module.ts, rules:rules/rules.controller.ts, rules:rules/rules.service.ts |
| `ValidationStage` | contracts:rules-engine.ts | REQ-65C-01 runs the validator twice: BEFORE the signature control enables (blocking) and again AT STORAGE (assert). | **3** · rules:rules/rule-set-2026-08.draft.ts, rules:rules/rule-set.ts, rules:rules/rules.service.ts |
| `VaultClient` | contracts:vault.ts | Append and read. | **3** · core:vault/vault-relay.service.ts, vault-client:client.ts, vault-client:relay.ts |
| `ArrivalMoveResult` | contracts:arrivals.ts | ONE PRESS OF "MOVE THESE PATIENTS", ANSWERED IN FULL. | **2** · core:arrivals/arrivals.service.ts, web:practice/practitioner/waiting/WaitingView.tsx |
| `ArrivalPreview` | contracts:arrivals.ts | WHAT THE VISIT WOULD NEED, ASKED BEFORE ANYTHING IS WRITTEN (W2, Carl 7 Sep 2026). | **2** · core:arrivals/arrivals.service.ts, web:practice/patients/NewAgreementPanel.tsx |
| `Db4JobOutcome` | contracts:print-capture.ts | WHAT A `db4_assignment` JOB DID, written onto the job row. | **2** · core:inbound/db4-assignment.handler.ts, core:inbound/inbound-print-jobs.processor.ts |
| `Db4PlacementReason` | contracts:print-capture.ts |  | **2** · core:inbound/db4-assignment.handler.ts, contracts:db4-print-record-check.ts |
| `PatientSearchResult` | contracts:arrivals.ts | ONE PATIENT THIS PRACTICE ALREADY HOLDS, FOUND BY TYPING A NAME (W2). | **2** · core:patients/patients.service.ts, web:practice/patients/NewAgreementPanel.tsx |
| `PmsAppointment` | contracts:pms-adapter.ts |  | **2** · connector:mock-adapter.ts, contracts:print-capture.ts |
| `PortalLink` | contracts:portal.ts | One practice the patient linked for themselves. | **2** · core:portal/portal-reads.service.ts, core:portal/portal.service.ts |
| `RefusedArrival` | contracts:arrivals.ts | ONE ARRIVAL WAITING FOR RECEPTION TO NAME A PROVIDER. | **2** · core:arrivals/arrivals.service.ts, web:practice/patients/PatientsQueueView.tsx |
| `VaultEventType` | contracts:vault.ts |  | **2** · vault:events/create-event.dto.ts, vault-client:relay.ts |
| `ArrivalMoveOutcome` | contracts:arrivals.ts | WHAT HAPPENED TO ONE PATIENT. | **1** · core:arrivals/arrivals.service.ts |
| `ArrivalMoveRefusal` | contracts:arrivals.ts |  | **1** · core:arrivals/arrivals.service.ts |
| `ArrivalReceipt` | contracts:arrivals.ts | What the platform did about it. | **1** · core:arrivals/arrivals.service.ts |
| `Db4Assignment` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-document.ts |
| `Db4Form` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-document.ts |
| `Db4FormViewProvider` | contracts:db4-form-view.ts |  | **1** · core:agreements/db4-form-view.ts |
| `Db4FormViewService` | contracts:db4-form-view.ts | One service row, reproduced from the form. | **1** · core:agreements/db4-form-view.ts |
| `Db4FormViewStatement` | contracts:db4-form-view.ts |  | **1** · core:agreements/db4-form-view.ts |
| `Db4Heading` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-document.ts |
| `Db4Patient` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-document.ts |
| `Db4Referral` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-document.ts |
| `Db4Service` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-document.ts |
| `Db4ServicingLocation` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-document.ts |
| `Db4Statement` | contracts:print-capture.ts |  | **1** · core:render/signed-db4-renderer.ts |
| `PmsAdapterCapabilities` | contracts:pms-adapter.ts | Declared per adapter; the core adjusts behaviour to what is absent. | **1** · connector:mock-adapter.ts |
| `PortalAccessLogEntry` | contracts:portal.ts | FR-8.2 — "who has looked", as the patient sees it. | **1** · core:portal/portal-reads.service.ts |
| `PortalActivationChallenge` | contracts:portal.ts | WHY THE ACTIVATION PAGE ASKS THE SERVER ANYTHING AT ALL (FR-1.14, REQ-PORT-08). | **1** · core:portal/portal.service.ts |
| `PortalActivationRefusalReason` | contracts:portal.ts | WHY A REFUSAL CARRIES A CODE AND NOT A SENTENCE. | **1** · core:portal/portal.service.ts |
| `PortalActivationResult` | contracts:portal.ts |  | **1** · core:portal/portal.service.ts |
| `PortalAgreement` | contracts:portal.ts | One agreement, from the patient's side (REQ-PORT-01). | **1** · core:portal/portal-reads.service.ts |
| `PortalAssignorOfMine` | contracts:portal.ts | Somebody who has signed on this patient's behalf (REQ-PORT-07, FR-1.19). | **1** · core:portal/portal-reads.service.ts |
| `PortalAssignors` | contracts:portal.ts | REQ-PORT-07, both directions. | **1** · core:portal/portal-reads.service.ts |
| `PortalCorrectionRequestResult` | contracts:portal.ts |  | **1** · core:portal/portal-reads.service.ts |
| `PortalDetails` | contracts:portal.ts | The five details, as ONE practice holds them. | **1** · core:portal/portal-reads.service.ts |
| `PortalEnduring` | contracts:portal.ts | REQ-PORT-03 — the enduring agreements in force for this patient. | **1** · core:portal/portal-reads.service.ts |
| `PortalInvitationResult` | contracts:portal.ts | What `POST /agreements/:id/portal-invitation` gives back to the practice. | **1** · core:portal/portal.service.ts |
| `PortalMessage` | contracts:portal.ts | "Messages to me" (REQ-PORT-06) — the anti-phishing surface. | **1** · core:portal/portal-reads.service.ts |
| `PortalNotice` | contracts:portal.ts | REQ-PORT-04 — a reg 89AA claim notification the patient was sent. | **1** · core:portal/portal-reads.service.ts |
| `PortalPasskey` | contracts:portal.ts | One enrolled credential, as the patient's own "Sign-in and security" card lists it. | **1** · core:portal/portal-passkey.service.ts |
| `PortalPasskeyChallenge` | contracts:portal.ts | What an options call returns. | **1** · core:portal/portal-passkey.service.ts |
| `PortalPasskeyRegistrationResult` | contracts:portal.ts |  | **1** · core:portal/portal-passkey.service.ts |
| `PortalPasskeyRevocationResult` | contracts:portal.ts |  | **1** · core:portal/portal-passkey.service.ts |
| `PortalPasskeySignInResult` | contracts:portal.ts | A sign-in that worked. | **1** · core:portal/portal-passkey.service.ts |
| `PortalSession` | contracts:portal.ts |  | **1** · core:portal/portal.service.ts |
| `PortalTerminationResult` | contracts:portal.ts | The result of REQ-PORT-05 / 65CA(7)(b) — the patient ends it, whether or not they were the assignor. | **1** · core:portal/portal-reads.service.ts |
| `PortalVisit` | contracts:portal.ts | "Where I have been" — derived from agreement service dates ONLY. | **1** · core:portal/portal-reads.service.ts |
| `PrintJobAccepted` | contracts:print-capture.ts | What the platform says back — at once, before any of it is processed. | **1** · core:inbound/inbound-print-jobs.service.ts |
| `PrintJobProvider` | contracts:print-capture.ts | A provider named on a printed document. | **1** · core:render/signed-db4-document.ts |
| `ServiceRenderedReceipt` | contracts:arrivals.ts | THE SERVICE HAS BEEN RENDERED — what the platform did about it (Carl, 11 Sep 2026; TODO.md "Two front doors" decision (b), "Still to build: Post-service push"). | **1** · core:arrivals/arrivals.service.ts |
| `SilentRestoreClient` | contracts:auth.ts |  | **1** · web:AccessGuard.tsx |
| `ValidationRequest` | contracts:rules-engine.ts |  | **1** · core:rules-client/rules-client.module.ts |
| `WriteArtefactRequest` | contracts:pms-adapter.ts |  | **1** · connector:mock-adapter.ts |
| `WriteResult` | contracts:pms-adapter.ts |  | **1** · connector:mock-adapter.ts |
| `ArrivalEvent` | contracts:arrivals.ts |  | 0 |
| `ArrivalRefusalReason` | contracts:arrivals.ts |  | 0 |
| `ArrivalSource` | contracts:arrivals.ts |  | 0 |
| `Db4FormViewPatient` | contracts:db4-form-view.ts | The patient block, as the form prints it — with the one redaction. | 0 |
| `EnduringRuleId` | contracts:rules-engine.ts |  | 0 |
| `PmsClaimEvent` | contracts:pms-adapter.ts |  | 0 |
| `PortalActivationRequest` | contracts:portal.ts | What `POST /portal/activate` is given. | 0 |
| `PortalCorrectionRequest` | contracts:portal.ts | "Ask the practice to correct this" — an APP 13-style correction routed to the record owner, never a direct edit. | 0 |
| `PortalDate` | contracts:portal.ts | ISO-8601 date, `YYYY-MM-DD`. | 0 |
| `PortalPasskeyAuthenticationVerification` | contracts:portal.ts |  | 0 |
| `PortalPasskeyOptions` | contracts:portal.ts | `PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON` as an opaque object. | 0 |
| `PortalPasskeyRegistrationVerification` | contracts:portal.ts | What the browser posts back. | 0 |
| `PortalPatientIActFor` | contracts:portal.ts | A patient this account's person acts for. | 0 |
| `PortalTimestamp` | contracts:portal.ts | ISO-8601 instant, server-authoritative. | 0 |
| `RetentionClockSource` | contracts:pms-adapter.ts | Marker for records whose retention clock had to be defaulted conservatively (REQ-INT-04). | 0 |
| `RuleId` | contracts:rules-engine.ts | Rule identifiers C1–C14 per REQ-65C-01, plus room for versioned additions. | 0 |
| `RuleOutcome` | contracts:rules-engine.ts |  | 0 |
| `SignAgreementRequest` | contracts:signature.ts |  | 0 |
| `SignatureChannel` | contracts:signature.ts |  | 0 |
| `SignatureMethod` | contracts:signature.ts |  | 0 |
| `VaultOutboxRow` | contracts:vault.ts | Outbox row shape (FR-11.2). | 0 |

## Contracts functions and constants

25 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `portalRecordId` | contracts:portal.ts |  | **4** · core:messaging/portal-record-id.service.ts, core:portal/portal-invitation.dispatcher.ts, core:portal/portal-webauthn.ts, +1 more |
| `ARRIVAL_SOURCE_TYPED_BY_A_PERSON` | contracts:arrivals.ts | THE ONLY SOURCE THAT MAY CARRY THE THREE RECEPTION-ONLY FIELDS BELOW. | **2** · core:arrivals/arrivals.service.ts, core:practitioner-queue/practitioner-queue.service.ts |
| `PORTAL_SESSION_MINUTES` | contracts:portal.ts | FR-8.2 — sessions are short-lived. | **2** · core:portal/portal-cookie.ts, core:portal/portal.service.ts |
| `ARRIVAL_SOURCES` | contracts:arrivals.ts | WHERE AN ARRIVAL CAME FROM. | **1** · core:arrivals/arrivals.dto.ts |
| `DB4_PRINT_RECORD_REFUSED_CODE` | contracts:db4-print-record-check.ts | THE REFUSAL ITSELF, NAMED ONCE AND READ BY BOTH SIDES. | **1** · core:tablet-sessions/push-refusal.ts |
| `PORTAL_ACTIVATION_MAX_ATTEMPTS` | contracts:portal.ts | REQ-PORT-08's teeth on the activation path: three wrong answers and the token is finished. | **1** · core:portal/portal.service.ts |
| `PORTAL_PASSKEY_ATTEMPT_LIMIT` | contracts:portal.ts | The sign-in attempts one address gets per window, before it is asked to wait. | **1** · core:portal/portal-passkey-rate-limit.ts |
| `PORTAL_PASSKEY_ATTEMPT_WINDOW_MINUTES` | contracts:portal.ts |  | **1** · core:portal/portal-passkey-rate-limit.ts |
| `PORTAL_PASSKEY_CHALLENGE_MINUTES` | contracts:portal.ts | FIVE MINUTES, SINGLE USE. | **1** · core:portal/portal-passkey.service.ts |
| `PORTAL_SESSION_COOKIE` | contracts:portal.ts | The name of the session cookie. | **1** · core:portal/portal-cookie.ts |
| `SILENT_RESTORE_PARAM` | contracts:auth.ts | THE MARKER THAT SAYS "THIS BROWSER HAS JUST BEEN GIVEN A SESSION ELSEWHERE". | **1** · web:AccessGuard.tsx |
| `VAULT_EVENT_TYPES` | contracts:vault.ts | Event type registry. | **1** · vault:events/create-event.dto.ts |
| `answersEnduringRules` | contracts:rules-engine.ts | DID THE RULE SET ANSWER THE ENDURING QUESTIONS AT ALL? | **1** · core:agreements/agreements.service.ts |
| `isSilentRestoreClient` | contracts:auth.ts |  | **1** · web:AccessGuard.tsx |
| `withSilentRestore` | contracts:auth.ts | Add the marker to a URL an invitation will return to. | **1** · auth-client:keycloak-admin.ts |
| `ARRIVAL_MOVE_REFUSALS` | contracts:arrivals.ts | WHY A ROW COULD NOT BE MOVED — a CODE the console maps to words and a destination, never prose (CLAUDE.md §7, "shortcuts to the answer"). | 0 |
| `ARRIVAL_REFUSAL_REASONS` | contracts:arrivals.ts | WHY AN ARRIVAL WAS REFUSED — a reason CODE, never prose (Carl, 4 Sep 2026: "shortcuts to the answer, not directions to a screen"; 5–7 Sep 2026: the billing role). | 0 |
| `DB4_PLACEMENT_REASONS` | contracts:print-capture.ts | WHY A DB4 PRODUCED NO AGREEMENT — a code, mapped to copy and a destination by whoever shows it (CLAUDE.md §7, "shortcuts to the answer, not directions to a screen"). | 0 |
| `DB4_PRINT_RECORD_CHECKS` | contracts:db4-print-record-check.ts | EVERY CHECK, IN THE ORDER THEY ARE REPORTED. | 0 |
| `DB4_PRINT_RECORD_CHECK_GATED_AT_INGEST` | contracts:db4-print-record-check.ts | WHICH INGEST REFUSAL ALREADY COVERS WHICH CHECK — the backstop declaration, written down rather than remembered. | 0 |
| `ENDURING_RULE_IDS` | contracts:rules-engine.ts | THE ENDURING BRANCH'S RULE FAMILY — the boundary between what an agent may build and what a human must author (Carl, 4 Sep 2026; GA-PLAN B5). | 0 |
| `PORTAL_RECORD_ID_PREFIX` | contracts:portal.ts | THE RECORD ID A PATIENT CAN RECOGNISE (Carl, 4 Sep 2026). | 0 |
| `SIGNATURE_CHANNELS` | contracts:signature.ts |  | 0 |
| `SIGNATURE_METHODS` | contracts:signature.ts | REQ-SIG-01 — the five recognised marks. | 0 |
| `SILENT_RESTORE_CLIENTS` | contracts:auth.ts | The Keycloak clients an invitation may name. | 0 |

## Core services, controllers and modules

278 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `PrismaService` | core:prisma/prisma.service.ts | Every practice-scoped read or write goes through withPractice() — RLS policies (FORCE, fail closed) filter on the transaction-local app.practice_id setting, so a query outside withPractice() sees no practice-scoped rows at all. | **63** · core:acting-as/acting-as.service.ts, core:affiliations/affiliations.service.ts, core:affiliations/invitation.service.ts, +60 more |
| `ReviewTasksService` | core:review-tasks/review-tasks.service.ts | Work arriving into the platform that needs a second look. | **12** · core:affiliations/affiliations.service.ts, core:affiliations/practitioner-self.controller.ts, core:identity/practice-admin.service.ts, +9 more |
| `OutboundService` | core:outbound/outbound.service.ts | The outbound queue. | **9** · core:acting-as/acting-as.service.ts, core:affiliations/affiliations.service.ts, core:agreement-copy/agreement-copy.service.ts, +6 more |
| `CaptureService` | core:capture/capture.service.ts |  | **8** · core:agreements/agreements.service.ts, core:arrivals/arrivals.service.ts, core:arrivals/post-service-chase.sweep.ts, +5 more |
| `EmailComposer` | core:messaging/composer.service.ts | One place that knows what an outbound message from us looks like. | **8** · core:acting-as/acting-as.service.ts, core:affiliations/affiliations.service.ts, core:affiliations/invitation.service.ts, +5 more |
| `AgreementsService` | core:agreements/agreements.service.ts |  | **7** · core:agree/agree.service.ts, core:agreements/agreements.controller.ts, core:agreements/agreements.module.ts, +4 more |
| `ArtefactsService` | core:artefacts/artefacts.service.ts | Evidence artefacts. | **7** · core:agreements/agreements.service.ts, core:agreements/signed-db4.service.ts, core:artefacts/artefacts.controller.ts, +4 more |
| `CorrespondenceService` | core:correspondence/correspondence.service.ts | The evidence twin of every send — CONSULTATION-CAPTURE-PLAN.md Part 4. | **7** · core:agree/agree.service.ts, core:correspondence/correspondence.controller.ts, core:correspondence/correspondence.module.ts, +4 more |
| `PortalService` | core:portal/portal.service.ts | WHO THE PATIENT IS, AND WHAT THEY MAY SEE — the identity half of C8. | **7** · core:portal/portal-dev.controller.ts, core:portal/portal-invitation.controller.ts, core:portal/portal-passkey.controller.ts, +4 more |
| `RendererRegistry` | core:render/renderer-registry.ts | Resolves renderers by version. | **7** · core:agreement-copy/agreement-copy.service.ts, core:agreements/agreements.service.ts, core:agreements/signed-db4.service.ts, +4 more |
| `CaptureModule` | core:capture/capture.module.ts |  | **6** · core:agreements/agreements.module.ts, core:app.module.ts, core:arrivals/arrivals.module.ts, +3 more |
| `DevicesService` | core:devices/devices.service.ts | DEVICE PAIRING — the one credential the zero-footprint rule allows on a tablet (CLAUDE.md §7; TODO.md "Zero-footprint kiosk", "Push-to-device capture"). | **6** · core:dev-seed/dev-seed.controller.ts, core:devices/device.guard.ts, core:devices/devices.controller.ts, +3 more |
| `VerificationService` | core:verification/verification.service.ts |  | **6** · core:capture/capture.service.ts, core:kiosk/kiosk.service.ts, core:portal/portal.service.ts, +3 more |
| `AffiliationsService` | core:affiliations/affiliations.service.ts | Practitioners and their affiliations (ORG-MODEL-PROPOSAL.md §5, §6). | **5** · core:affiliations/affiliation-sweep.service.ts, core:affiliations/affiliations.controller.ts, core:affiliations/affiliations.module.ts, +2 more |
| `AgreementsModule` | core:agreements/agreements.module.ts |  | **5** · core:agree/agree.module.ts, core:app.module.ts, core:arrivals/arrivals.module.ts, +2 more |
| `ArtefactsModule` | core:artefacts/artefacts.module.ts |  | **5** · core:agreements/agreements.module.ts, core:app.module.ts, core:practices/practices.module.ts, +2 more |
| `DevicesModule` | core:devices/devices.module.ts |  | **5** · core:agreement-copy/agreement-copy.module.ts, core:app.module.ts, core:dev-seed/dev-seed.module.ts, +2 more |
| `EnduringService` | core:enduring/enduring.service.ts |  | **5** · core:arrivals/arrivals.service.ts, core:auto-capture/auto-capture.service.ts, core:enduring/enduring.controller.ts, +2 more |
| `PmsModule` | core:pms/pms.module.ts |  | **5** · core:agreements/agreements.module.ts, core:app.module.ts, core:auto-capture/auto-capture.module.ts, +2 more |
| `PortalScope` | core:portal/portal-scope.ts | THE SECOND KEY, for rows that belong to a PERSON rather than to a practice. | **5** · core:portal/portal-dev.controller.ts, core:portal/portal-passkey.service.ts, core:portal/portal-reads.service.ts, +2 more |
| `TabletSessionsService` | core:tablet-sessions/tablet-sessions.service.ts | PUSH-TO-DEVICE CAPTURE — reception hands the patient a locked screen (TODO.md "Push-to-device capture" and "Two front doors", Carl 4 Sep 2026). | **5** · core:patients/patients.service.ts, core:tablet-sessions/kiosk-session.controller.ts, core:tablet-sessions/tablet-sessions.controller.ts, +2 more |
| `VerificationModule` | core:verification/verification.module.ts |  | **5** · core:app.module.ts, core:capture/capture.module.ts, core:kiosk/kiosk.module.ts, +2 more |
| `ActingAsService` | core:acting-as/acting-as.service.ts | Acting as a practice. | **4** · core:acting-as/acting-as.controller.ts, core:acting-as/acting-as.interceptor.ts, core:acting-as/acting-as.module.ts, +1 more |
| `AppModule` | core:app.module.ts |  | **4** · core:main.ts, rules:main.ts, vault:main.ts, +1 more |
| `ArrivalsService` | core:arrivals/arrivals.service.ts | "THIS PATIENT HAS JUST ARRIVED AT RECEPTION TO SEE THIS PROVIDER" (Carl, 4 Sep 2026; TODO.md "Reception-centric: the patient work page" §2). | **4** · core:arrivals/arrivals.controller.ts, core:arrivals/arrivals.module.ts, core:inbound/db4-assignment.handler.ts, +1 more |
| `EnduringModule` | core:enduring/enduring.module.ts |  | **4** · core:app.module.ts, core:arrivals/arrivals.module.ts, core:auto-capture/auto-capture.module.ts, +1 more |
| `IdentityModule` | core:identity/identity.module.ts |  | **4** · core:affiliations/affiliations.module.ts, core:app.module.ts, core:organisations/organisations.module.ts, +1 more |
| `RenderModule` | core:render/render.module.ts |  | **4** · core:agreement-copy/agreement-copy.module.ts, core:agreements/agreements.module.ts, core:pms/pms.module.ts, +1 more |
| `AgreementCopyService` | core:agreement-copy/agreement-copy.service.ts | W6 — "SEND ME A COPY". | **3** · core:agreement-copy/agreement-copy-kiosk.controller.ts, core:agreement-copy/agreement-copy.controller.ts, core:agreement-copy/agreement-copy.module.ts |
| `ArrivalsModule` | core:arrivals/arrivals.module.ts |  | **3** · core:app.module.ts, core:inbound/inbound.module.ts, core:practitioner-queue/practitioner-queue.module.ts |
| `AutoCaptureModule` | core:auto-capture/auto-capture.module.ts |  | **3** · core:app.module.ts, core:arrivals/arrivals.module.ts, core:inbound/inbound.module.ts |
| `AutoCaptureService` | core:auto-capture/auto-capture.service.ts | The capture cascade, run by the platform with nobody at the practice deciding first — CONSULTATION-CAPTURE-PLAN.md Parts 2 and 3. | **3** · core:auto-capture/auto-capture.controller.ts, core:auto-capture/auto-capture.module.ts, core:inbound/inbound-print-jobs.processor.ts |
| `CaptureLinkDispatcher` | core:auto-capture/capture-link.dispatcher.ts | Sends the patient the link that lets them approve an agreement. | **3** · core:arrivals/post-service-chase.sweep.ts, core:auto-capture/auto-capture.module.ts, core:auto-capture/auto-capture.service.ts |
| `ChangeAssignorDto` | core:agreements/agreements.dto.ts | `POST /agreements/:id/assignor` — somebody other than the patient is signing, or the patient is after all. | **3** · core:agreements/agreements.controller.ts, core:agreements/agreements.service.ts, core:arrivals/arrivals.service.ts |
| `ChecksService` | core:organisations/checks.service.ts | The validation checklist (IDENTITY-STRENGTH-DESIGN.md §3). | **3** · core:organisations/organisations.controller.ts, core:organisations/organisations.module.ts, core:organisations/organisations.service.ts |
| `HealthController` | core:health/health.controller.ts | Liveness/readiness endpoint. | **3** · core:health/health.module.ts, rules:health/health.module.ts, vault:health/health.module.ts |
| `HealthModule` | core:health/health.module.ts |  | **3** · core:app.module.ts, rules:app.module.ts, vault:app.module.ts |
| `InboundPrintJobsService` | core:inbound/inbound-print-jobs.service.ts | The inbound queue — print jobs from a practice's desktop, waiting to be turned into drafts and messages (CONSULTATION-CAPTURE-PLAN.md 8.4, 9.3). | **3** · core:inbound/inbound-lane.worker.ts, core:inbound/inbound-print-jobs.controller.ts, core:inbound/inbound.module.ts |
| `LetterheadService` | core:practices/letterhead.service.ts | THE PRACTICE'S LETTERHEAD — what appears at the top of every agreement it makes (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1, Q3/Q4). | **3** · core:agreements/agreements.service.ts, core:practices/letterhead.controller.ts, core:practices/practices.module.ts |
| `LockParticularsDto` | core:agreements/agreements.dto.ts |  | **3** · core:agreements/agreements.controller.ts, core:agreements/agreements.service.ts, core:tablet-sessions/tablet-sessions.service.ts |
| `MessagingModule` | core:messaging/messaging.module.ts |  | **3** · core:agreement-copy/agreement-copy.module.ts, core:app.module.ts, core:auto-capture/auto-capture.module.ts |
| `OrganisationsService` | core:organisations/organisations.service.ts | Organisation onboarding (ORG-MODEL-PROPOSAL.md §4). | **3** · core:affiliations/affiliations.service.ts, core:organisations/organisations.controller.ts, core:organisations/organisations.module.ts |
| `OutboundModule` | core:outbound/outbound.module.ts |  | **3** · core:agreement-copy/agreement-copy.module.ts, core:app.module.ts, core:auto-capture/auto-capture.module.ts |
| `PendingEmailService` | core:organisations/pending-email.service.ts | Holding a change to the administrator's email address until it is confirmed. | **3** · core:organisations/organisations.module.ts, core:organisations/organisations.service.ts, core:organisations/pending-email.controller.ts |
| `PmsSyncService` | core:pms/pms-sync.service.ts |  | **3** · core:auto-capture/auto-capture.service.ts, core:inbound/inbound-print-jobs.processor.ts, core:pms/pms.module.ts |
| `PracticeAdminService` | core:identity/practice-admin.service.ts |  | **3** · core:identity/identity.module.ts, core:organisations/organisations.service.ts, core:organisations/pending-email.service.ts |
| `PracticeSurfacesService` | core:practices/practice-surfaces.service.ts | WHICH PROFILE IS THIS PRACTICE ON — one question, asked by one guard. | **3** · core:practices/practices.module.ts, core:practices/practices.service.ts, core:practices/surface.guard.ts |
| `PractitionerEmailService` | core:identity/practitioner-email.service.ts | Changing a practitioner's own email address, held until it is proved. | **3** · core:affiliations/practitioner-self.controller.ts, core:identity/identity.module.ts, core:organisations/pending-email.controller.ts |
| `PrintRecordsService` | core:inbound/print-records.service.ts | READ ONE PRINT RECORD BACK — the inbound module's own door onto its own table, opened for the one caller outside it that legitimately needs the contents of a form after the fact. | **3** · core:agreements/agreements.service.ts, core:agreements/signed-db4.service.ts, core:inbound/print-records.module.ts |
| `ServiceDescriptionsService` | core:service-descriptions/service-descriptions.service.ts | D6a — THE ONE PARTICULAR THE PLATFORM CANNOT DERIVE, SET ON A STAFF SURFACE. | **3** · core:service-descriptions/service-descriptions.controller.ts, core:service-descriptions/service-descriptions.module.ts, core:tablet-sessions/tablet-sessions.service.ts |
| `ServiceRenderedDto` | core:arrivals/arrivals.dto.ts | THE SERVICE HAS BEEN RENDERED — the second front door, on the same desk (Carl, 11 Sep 2026; TODO.md "Two front doors" decision (b)). | **3** · core:arrivals/arrivals.controller.ts, core:arrivals/arrivals.service.ts, core:inbound/db4-assignment.handler.ts |
| `TemplatesService` | core:templates/templates.service.ts | WHICH WORDS THIS PRACTICE'S AGREEMENTS ARE MADE FROM (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1). | **3** · core:agreements/agreements.service.ts, core:templates/templates.controller.ts, core:templates/templates.module.ts |
| `AffiliationsModule` | core:affiliations/affiliations.module.ts |  | **2** · core:app.module.ts, core:practitioner-queue/practitioner-queue.module.ts |
| `AgreeService` | core:agree/agree.service.ts | The patient approves — from a link, never an account (CONSULTATION-CAPTURE-PLAN.md §3.3). | **2** · core:agree/agree.controller.ts, core:agree/agree.module.ts |
| `ApplicantService` | core:organisations/applicant.service.ts | The applicant's own view of their application, and their ability to correct it. | **2** · core:organisations/applicant.controller.ts, core:organisations/organisations.module.ts |
| `ArrivalDto` | core:arrivals/arrivals.dto.ts |  | **2** · core:arrivals/arrivals.controller.ts, core:arrivals/arrivals.service.ts |
| `ArrivalPreviewDto` | core:arrivals/arrivals.dto.ts | "WHAT WOULD THIS VISIT NEED?" — asked before anything is written (W2). | **2** · core:arrivals/arrivals.controller.ts, core:arrivals/arrivals.service.ts |
| `AuditService` | core:organisations/audit.service.ts | Everything that has happened to one application, merged into one trail. | **2** · core:organisations/organisations.controller.ts, core:organisations/organisations.module.ts |
| `ChaseAttemptsService` | core:chase-attempts/chase-attempts.service.ts | M7 — the human half of the chase (Carl, 3 Sep 2026). | **2** · core:chase-attempts/chase-attempts.controller.ts, core:chase-attempts/chase-attempts.module.ts |
| `CreateAgreementDto` | core:agreements/agreements.dto.ts |  | **2** · core:agreements/agreements.controller.ts, core:agreements/agreements.service.ts |
| `CreateAssignorDto` | core:practices/practices.dto.ts |  | **2** · core:practices/practices.controller.ts, core:practices/practices.service.ts |
| `CreatePracticeDto` | core:practices/practices.dto.ts |  | **2** · core:practices/practices.controller.ts, core:practices/practices.service.ts |
| `CreateProviderDto` | core:practices/practices.dto.ts | FR-1.8 — A PRACTITIONER AT A LOCATION, which is what "add a provider" now makes (Carl, 7 Sep 2026; TODO.md "retire providers as the anchor"). | **2** · core:practices/practices.controller.ts, core:practices/practices.service.ts |
| `CreateStaffDto` | core:practices/practices.dto.ts |  | **2** · core:practices/practices.controller.ts, core:practices/practices.service.ts |
| `Db4AssignmentHandler` | core:inbound/db4-assignment.handler.ts | A DB4 PRINTED TO AOBPRINTER BECOMES A POST-SERVICE AGREEMENT (DB4-AND-AOBL.md §13a piece 1; D-2026-09-14-02/-03/-04). | **2** · core:inbound/inbound-print-jobs.processor.ts, core:inbound/inbound.module.ts |
| `IdentityDashboardService` | core:identity-dashboard/identity-dashboard.service.ts | The two identity dashboards (IDENTITY-STRENGTH-DESIGN.md §7). | **2** · core:identity-dashboard/identity-dashboard.controller.ts, core:identity-dashboard/identity-dashboard.module.ts |
| `IdentityService` | core:identity/identity.service.ts | Practitioner and staff onboarding (FR-1.9, FR-1.5). | **2** · core:identity/identity.controller.ts, core:identity/identity.module.ts |
| `InboundPrintJobsProcessor` | core:inbound/inbound-print-jobs.processor.ts | Turns one accepted print job into consequences — the cascade (AutoCaptureService) applied to what the document named. | **2** · core:inbound/inbound-lane.worker.ts, core:inbound/inbound.module.ts |
| `InvitationService` | core:affiliations/invitation.service.ts | Sending an affiliation invitation, and answering one. | **2** · core:affiliations/affiliations.controller.ts, core:affiliations/affiliations.module.ts |
| `KioskService` | core:kiosk/kiosk.service.ts | WHO IS HERE, FOR THIS PRACTICE, RIGHT NOW — the one question a tablet in a waiting room asks, and the only gap left between the capture cascade and the kiosk ceremony (CONSULTATION-CAPTURE-PLAN.md §2.2 step 1). | **2** · core:kiosk/kiosk.controller.ts, core:kiosk/kiosk.module.ts |
| `MoveArrivalsDto` | core:arrivals/arrivals.dto.ts | MOVE THESE PATIENTS TO THAT PRACTITIONER (Carl, 12 September 2026: *"the assigned practioner has called in sick... | **2** · core:arrivals/arrivals.controller.ts, core:arrivals/arrivals.service.ts |
| `NoticesService` | core:notices/notices.service.ts |  | **2** · core:notices/notices.controller.ts, core:notices/notices.module.ts |
| `OrganisationsModule` | core:organisations/organisations.module.ts |  | **2** · core:affiliations/affiliations.module.ts, core:app.module.ts |
| `PatientsService` | core:patients/patients.service.ts | THE PLATFORM'S PATIENT MIRROR, AND THE ONE THING STAFF MAY CHANGE ON IT (TODO.md "Check-your-details: tick or cross per row", Carl 4 Sep 2026). | **2** · core:patients/patients.controller.ts, core:patients/patients.module.ts |
| `PortalInvitationDispatcher` | core:portal/portal-invitation.dispatcher.ts | THE INVITATION ACTUALLY REACHES THE PATIENT (Carl, 4 Sep 2026). | **2** · core:portal/portal.module.ts, core:portal/portal.service.ts |
| `PortalPasskeyAttemptLimit` | core:portal/portal-passkey-rate-limit.ts |  | **2** · core:portal/portal-activation-rate-limit.ts, core:portal/portal-passkey.service.ts |
| `PortalPasskeyService` | core:portal/portal-passkey.service.ts | FR-8.2's PASSKEY HALF — "Implement" (Carl, 4 September 2026). | **2** · core:portal/portal-passkey.controller.ts, core:portal/portal.module.ts |
| `PortalReadsService` | core:portal/portal-reads.service.ts | WHAT THE PATIENT CAN SEE — the reads half of C8. | **2** · core:portal/portal.controller.ts, core:portal/portal.module.ts |
| `PortalRecordIdLine` | core:messaging/portal-record-id.service.ts | ONE SENTENCE, IN EVERY MESSAGE, FOR A PATIENT WHO HAS A PORTAL RECORD (Carl, 4 Sep 2026). | **2** · core:auto-capture/capture-link.dispatcher.ts, core:messaging/messaging.module.ts |
| `PracticeUsersService` | core:practices/practice-users.service.ts | The practice's own user list. | **2** · core:practices/practice-users.controller.ts, core:practices/practices.module.ts |
| `PracticesModule` | core:practices/practices.module.ts |  | **2** · core:agreements/agreements.module.ts, core:app.module.ts |
| `PracticesService` | core:practices/practices.service.ts |  | **2** · core:practices/practices.controller.ts, core:practices/practices.module.ts |
| `PractitionerAccessService` | core:identity/practitioner-access.service.ts | Giving a practitioner a way to sign in. | **2** · core:affiliations/affiliations.service.ts, core:identity/identity.module.ts |
| `PractitionerQueueService` | core:practitioner-queue/practitioner-queue.service.ts | WHO IS WAITING, AND IS THEIR PAPERWORK DONE (PRACTITIONER-QUEUE-PAGE.md §3, §5; Carl 12 September 2026). | **2** · core:practitioner-queue/practitioner-queue.controller.ts, core:practitioner-queue/practitioner-queue.module.ts |
| `ReconciliationService` | core:reconciliation/reconciliation.service.ts | M7 — the core operational screen (REQ-REC-01): every service without a stored agreement, ranked by days remaining on the twelve-month lodgement window, banded per REQ-CHASE-05. | **2** · core:reconciliation/reconciliation.controller.ts, core:reconciliation/reconciliation.module.ts |
| `RenderRefusal` | core:render/agreement-document.ts | THE RENDER-TIME GUARD. | **2** · core:agreements/agreements.service.ts, core:render/agreement-pdf-renderer.ts |
| `RulesClientError` | core:rules-client/rules-client.module.ts |  | **2** · core:agreements/agreements.service.ts, core:service-descriptions/service-descriptions.service.ts |
| `RulesClientModule` | core:rules-client/rules-client.module.ts |  | **2** · core:agreements/agreements.module.ts, core:service-descriptions/service-descriptions.module.ts |
| `SandboxGateway` | core:messaging/gateway.ts | Records what would have been sent. | **2** · core:messaging/messaging.module.ts, core:notices/notices.module.ts |
| `ServiceDescriptionsModule` | core:service-descriptions/service-descriptions.module.ts |  | **2** · core:app.module.ts, core:tablet-sessions/tablet-sessions.module.ts |
| `SetupService` | core:organisations/setup.service.ts | The practice setup hub. | **2** · core:organisations/organisations.controller.ts, core:organisations/organisations.module.ts |
| `SignedDb4Renderer` | core:render/signed-db4-renderer.ts | `signed-db4-1` — THE PRACTICE'S OWN FORM, BACK IN THE CHART FOLDER, WITH THE COST ON IT AND THE PATIENT'S SIGNATURE AT THE BOTTOM (D-2026-09-14-02/-03). | **2** · core:agreements/signed-db4.service.ts, core:render/renderer-registry.ts |
| `SignedDb4Service` | core:agreements/signed-db4.service.ts | PRODUCE THE SIGNED-DB4 — the practice's own form, reproduced by us, with the cost printed, the Medicare card number in full and the patient's signature at the bottom (D-2026-09-14-02/-03; DB4-AND-AOBL.md §12). | **2** · core:agreements/agreements.module.ts, core:agreements/agreements.service.ts |
| `TabletSessionsModule` | core:tablet-sessions/tablet-sessions.module.ts |  | **2** · core:app.module.ts, core:patients/patients.module.ts |
| `TemplatesModule` | core:templates/templates.module.ts |  | **2** · core:agreements/agreements.module.ts, core:app.module.ts |
| `UpdateConfigDto` | core:practices/practices.dto.ts |  | **2** · core:practices/practices.controller.ts, core:practices/practices.service.ts |
| `WriteBackService` | core:pms/write-back.service.ts | Write-back is the product (REQ-INT-02): the signed artefact lands in the PMS patient record. | **2** · core:agreements/agreements.service.ts, core:pms/pms.module.ts |
| `AbnLookupRateLimit` | core:organisations/abn-lookup-rate-limit.ts |  | **1** · core:organisations/organisations.controller.ts |
| `AbrWebServicesClient` | core:organisations/abr.ts | The live ABN Lookup web service — document-style JSON, method `AbnDetails`. | **1** · core:organisations/organisations.module.ts |
| `ActingAsController` | core:acting-as/acting-as.controller.ts | Starting and stopping an acting-as session. | **1** · core:acting-as/acting-as.module.ts |
| `ActingAsInterceptor` | core:acting-as/acting-as.interceptor.ts | Makes an acting-as session actually take effect. | **1** · core:acting-as/acting-as.module.ts |
| `ActingAsModule` | core:acting-as/acting-as.module.ts |  | **1** · core:app.module.ts |
| `ActivatePortalDto` | core:portal/portal.dto.ts | WHAT THE PORTAL WILL ACCEPT — and, more importantly, what it will not. | **1** · core:portal/portal.controller.ts |
| `AffiliationSweepService` | core:affiliations/affiliation-sweep.service.ts | Ends affiliations whose agreed end date has arrived. | **1** · core:affiliations/affiliations.module.ts |
| `AffiliationsController` | core:affiliations/affiliations.controller.ts | Practitioners and affiliations. | **1** · core:affiliations/affiliations.module.ts |
| `AgreeController` | core:agree/agree.controller.ts | The patient's side of a remote capture — public, because the person holding the link has no account and must never need one (REQ-PORT-08). | **1** · core:agree/agree.module.ts |
| `AgreeModule` | core:agree/agree.module.ts |  | **1** · core:app.module.ts |
| `AgreementCopyController` | core:agreement-copy/agreement-copy.controller.ts | THE PUBLIC END OF A COPY LINK — W6, REQ-PORT-02. | **1** · core:agreement-copy/agreement-copy.module.ts |
| `AgreementCopyKioskController` | core:agreement-copy/agreement-copy-kiosk.controller.ts | THE TABLET'S SIDE OF "SEND ME A COPY" — two routes under `/kiosk`, answering only a paired device (W6, REQ-PORT-02). | **1** · core:agreement-copy/agreement-copy.module.ts |
| `AgreementCopyModule` | core:agreement-copy/agreement-copy.module.ts |  | **1** · core:app.module.ts |
| `AgreementPdfRenderer` | core:render/agreement-pdf-renderer.ts | `pdf-2` — THE AGREEMENT AS A PERSON WOULD RECOGNISE IT: the practice's letterhead, the words of the instrument, the whole s 65C data set, and the statements the assignor ticked (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1). | **1** · core:render/renderer-registry.ts |
| `AgreementsController` | core:agreements/agreements.controller.ts |  | **1** · core:agreements/agreements.module.ts |
| `ApplicantController` | core:organisations/applicant.controller.ts | The applicant's own surfaces: check the status, correct a mistake. | **1** · core:organisations/organisations.module.ts |
| `ArrivalRefusal` | core:arrivals/arrivals.service.ts | THE ARRIVAL NAMED SOMEBODY WHO CANNOT BE THE PROVIDER ON AN AGREEMENT (Carl's ruling, 5–7 Sep 2026). | **1** · core:inbound/db4-assignment.handler.ts |
| `ArrivalsController` | core:arrivals/arrivals.controller.ts | WHERE A PRACTICE'S SOFTWARE SAYS SOMEBODY WALKED IN (Carl, 4 Sep 2026; TODO.md "Reception-centric" §2). | **1** · core:arrivals/arrivals.module.ts |
| `ArtefactLogoLoader` | core:render/logo-loader.ts |  | **1** · core:render/render.module.ts |
| `ArtefactsController` | core:artefacts/artefacts.controller.ts |  | **1** · core:artefacts/artefacts.module.ts |
| `AttributionInterceptor` | core:auth/attribution.interceptor.ts |  | **1** · core:auth/auth.module.ts |
| `AuthGuard` | core:auth/auth.guard.ts | Verifies Keycloak bearer tokens and, where present, uses the token's `practice_id` claim as the practice scope — replacing the dev `x-practice-id` header. | **1** · core:auth/auth.module.ts |
| `AuthModule` | core:auth/auth.module.ts |  | **1** · core:app.module.ts |
| `AutoCaptureController` | core:auto-capture/auto-capture.controller.ts | The two PMS-driven triggers, as the practice presses them. | **1** · core:auto-capture/auto-capture.module.ts |
| `CanonicalJsonRenderer` | core:render/renderer.ts | DEV reference renderer — deterministic canonical JSON. | **1** · core:render/renderer-registry.ts |
| `CaptureController` | core:capture/capture.controller.ts |  | **1** · core:capture/capture.module.ts |
| `ChaseAttemptsController` | core:chase-attempts/chase-attempts.controller.ts | The audit trail of what a PERSON at the practice did about an unanswered agreement (Carl, 3 Sep 2026). | **1** · core:chase-attempts/chase-attempts.module.ts |
| `ChaseAttemptsModule` | core:chase-attempts/chase-attempts.module.ts |  | **1** · core:app.module.ts |
| `ClaimAttemptLimit` | core:kiosk/claim-rate-limit.ts |  | **1** · core:kiosk/kiosk.service.ts |
| `ConfirmDetailsDto` | core:tablet-sessions/tablet-sessions.dto.ts | `POST /kiosk/session/:id/confirm-details` — the patient's answer to every detail on the screen: a tick, or a cross (Carl, 4 Sep 2026). | **1** · core:tablet-sessions/kiosk-session.controller.ts |
| `CorrectPatientDetailsDto` | core:patients/patients.dto.ts | `PATCH /patients/:id/details` — reception correcting a detail the patient crossed on the tablet (TODO.md "Check-your-details", Carl 4 Sep 2026). | **1** · core:patients/patients.controller.ts |
| `CorrectionRequestDto` | core:portal/portal.dto.ts |  | **1** · core:portal/portal.controller.ts |
| `CorrespondenceController` | core:correspondence/correspondence.controller.ts | "What have we sent" — the practice's view (plan §4.2). | **1** · core:correspondence/correspondence.module.ts |
| `CorrespondenceModule` | core:correspondence/correspondence.module.ts |  | **1** · core:app.module.ts |
| `DatabaseExceptionFilter` | core:common/database-exception.filter.ts |  | **1** · core:app.module.ts |
| `DeterministicPdfRenderer` | core:render/pdf-renderer.ts | Deterministic server-side PDF renderer (rule 13). | **1** · core:render/renderer-registry.ts |
| `DevPortalSessionDto` | core:portal/portal.dto.ts | Dev only. | **1** · core:portal/portal-dev.controller.ts |
| `DevSeedController` | core:dev-seed/dev-seed.controller.ts |  | **1** · core:dev-seed/dev-seed.module.ts |
| `DevSeedModule` | core:dev-seed/dev-seed.module.ts | Dev-only fixtures. | **1** · core:app.module.ts |
| `DeviceCredentialGuard` | core:devices/device.guard.ts | THE KIOSK'S WHOLE AUTHENTICATION, and the reason `/kiosk` can be deployed at all (CLAUDE.md §7; TODO.md "URGENT before any real device"). | **1** · core:devices/devices.module.ts |
| `DeviceOutOfUseDto` | core:tablet-sessions/tablet-sessions.dto.ts | `POST /devices/:deviceId/out-of-use` — reception taking a tablet off the floor, and putting it back (Carl, 4–5 Sep 2026). | **1** · core:tablet-sessions/tablet-sessions.controller.ts |
| `DevicesController` | core:devices/devices.controller.ts | A PRACTICE'S TABLETS — registered, paired, revoked and rotated from the CONSOLE, never from the device (TODO.md "Zero-footprint kiosk"). | **1** · core:devices/devices.module.ts |
| `DomainExceptionFilter` | core:common/domain-exception.filter.ts | Maps domain rule violations to 400, globally. | **1** · core:app.module.ts |
| `EnduringController` | core:enduring/enduring.controller.ts |  | **1** · core:enduring/enduring.module.ts |
| `EnduringRulesNotAuthoredError` | core:agreements/agreements.service.ts | THE RULE SET WAS ASKED ABOUT AN ENDURING AGREEMENT AND DID NOT ANSWER (Carl, 4 Sep 2026; GA-PLAN B5). | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `FilesystemArtefactStore` | core:artefacts/artefact-store.ts | Filesystem-backed store for local development. | **1** · core:artefacts/artefacts.module.ts |
| `IdentityController` | core:identity/identity.controller.ts | Identity onboarding (FR-1.9, FR-1.5). | **1** · core:identity/identity.module.ts |
| `IdentityDashboardController` | core:identity-dashboard/identity-dashboard.controller.ts | The two identity dashboards — PLATFORM OPERATOR ONLY. | **1** · core:identity-dashboard/identity-dashboard.module.ts |
| `IdentityDashboardModule` | core:identity-dashboard/identity-dashboard.module.ts |  | **1** · core:app.module.ts |
| `InboundLaneWorkerService` | core:inbound/inbound-lane.worker.ts | One worker per lane — CONSULTATION-CAPTURE-PLAN.md 9.3. | **1** · core:inbound/inbound.module.ts |
| `InboundModule` | core:inbound/inbound.module.ts |  | **1** · core:app.module.ts |
| `InboundPrintJobsController` | core:inbound/inbound-print-jobs.controller.ts | Where a practice's desktop delivers what the PMS printed. | **1** · core:inbound/inbound.module.ts |
| `KioskController` | core:kiosk/kiosk.controller.ts | THE TABLET'S OWN ENDPOINTS, and the practice scope now comes from the DEVICE. | **1** · core:kiosk/kiosk.module.ts |
| `KioskModule` | core:kiosk/kiosk.module.ts |  | **1** · core:app.module.ts |
| `KioskSessionController` | core:tablet-sessions/kiosk-session.controller.ts | THE TABLET'S SIDE OF THE PUSH — three routes under `/kiosk`, answering only a paired device (TODO.md "Push-to-device capture", Carl 4 Sep 2026). | **1** · core:tablet-sessions/tablet-sessions.module.ts |
| `LastSeenInterceptor` | core:auth/last-seen.interceptor.ts |  | **1** · core:auth/auth.module.ts |
| `LetterheadController` | core:practices/letterhead.controller.ts | The practice letterhead — read the fields the agreement will print, and set or clear the logo (W1). | **1** · core:practices/practices.module.ts |
| `MailhogGateway` | core:messaging/mailhog.gateway.ts | A LOCAL-SINK email gateway — speaks minimal SMTP to Mailhog and nothing else. | **1** · core:messaging/messaging.module.ts |
| `NoticesController` | core:notices/notices.controller.ts | Reg 89AA notices. | **1** · core:notices/notices.module.ts |
| `NoticesModule` | core:notices/notices.module.ts |  | **1** · core:app.module.ts |
| `OfflineAbrClient` | core:organisations/abr.ts | Offline client. | **1** · core:organisations/organisations.module.ts |
| `OrganisationsController` | core:organisations/organisations.controller.ts | Organisation onboarding and the sites it operates from. | **1** · core:organisations/organisations.module.ts |
| `OutboundController` | core:outbound/outbound.controller.ts |  | **1** · core:outbound/outbound.module.ts |
| `OutboundWorkerService` | core:outbound/outbound-worker.service.ts | Drains the outbound queue. | **1** · core:outbound/outbound.module.ts |
| `PairingRateLimit` | core:devices/pairing-rate-limit.ts |  | **1** · core:devices/devices.service.ts |
| `PatientsController` | core:patients/patients.controller.ts | CORRECTING A DETAIL THE PATIENT SAID WAS WRONG (TODO.md "Check-your-details: tick or cross per row", Carl 4 Sep 2026). | **1** · core:patients/patients.module.ts |
| `PatientsModule` | core:patients/patients.module.ts |  | **1** · core:app.module.ts |
| `PendingEmailController` | core:organisations/pending-email.controller.ts | Answering a held administrator-email change, from the link in the message. | **1** · core:organisations/organisations.module.ts |
| `PlatformTemplatesController` | core:templates/templates.controller.ts | The platform reviewer's twin. | **1** · core:templates/templates.module.ts |
| `PortalActivationAttemptLimit` | core:portal/portal-activation-rate-limit.ts | THE ACTIVATION LINK'S OWN WINDOW — the same mechanism as passkey sign-in, deliberately, and a separate budget. | **1** · core:portal/portal.service.ts |
| `PortalController` | core:portal/portal.controller.ts | THE PATIENT'S OWN PAGE — C8, and a GA MUST (REQ-PORT-01..08, FR-8.1/8.2). | **1** · core:portal/portal.module.ts |
| `PortalDevController` | core:portal/portal-dev.controller.ts | A PORTAL SESSION WITHOUT A SIGNATURE — dev only. | **1** · core:portal/portal.module.ts |
| `PortalInvitationController` | core:portal/portal-invitation.controller.ts | FR-1.14 — "offer, never require" portal activation after a signature. | **1** · core:portal/portal.module.ts |
| `PortalModule` | core:portal/portal.module.ts |  | **1** · core:app.module.ts |
| `PortalPasskeyAuthenticationVerifyDto` | core:portal/portal-passkey.dto.ts |  | **1** · core:portal/portal-passkey.controller.ts |
| `PortalPasskeyController` | core:portal/portal-passkey.controller.ts | FR-8.2 — PASSKEYS. | **1** · core:portal/portal.module.ts |
| `PortalPasskeyRegistrationVerifyDto` | core:portal/portal-passkey.dto.ts | WHAT THE PASSKEY ENDPOINTS WILL ACCEPT. | **1** · core:portal/portal-passkey.controller.ts |
| `PostServiceChaseSweep` | core:arrivals/post-service-chase.sweep.ts | THIRTY MINUTES AND NOBODY SIGNED (Carl, 11 Sep 2026, step 6; TODO.md "Reminders are the fallback, not the flow"). | **1** · core:arrivals/arrivals.module.ts |
| `PracticeUsersController` | core:practices/practice-users.controller.ts | A practice managing its own people. | **1** · core:practices/practices.module.ts |
| `PracticesController` | core:practices/practices.controller.ts |  | **1** · core:practices/practices.module.ts |
| `PractitionerQueueController` | core:practitioner-queue/practitioner-queue.controller.ts | WHO IS WAITING FOR ME TODAY (PRACTITIONER-QUEUE-PAGE.md §3; Carl, 12 September 2026). | **1** · core:practitioner-queue/practitioner-queue.module.ts |
| `PractitionerQueueModule` | core:practitioner-queue/practitioner-queue.module.ts |  | **1** · core:app.module.ts |
| `PractitionerSelfController` | core:affiliations/practitioner-self.controller.ts | What a practitioner sees and does about themselves. | **1** · core:affiliations/affiliations.module.ts |
| `PrintRecordsModule` | core:inbound/print-records.module.ts |  | **1** · core:agreements/agreements.module.ts |
| `PrismaModule` | core:prisma/prisma.module.ts |  | **1** · core:app.module.ts |
| `PushToDeviceDto` | core:tablet-sessions/tablet-sessions.dto.ts | `POST /devices/:deviceId/push` — send one locked agreement to one tablet. | **1** · core:tablet-sessions/tablet-sessions.controller.ts |
| `ReconciliationController` | core:reconciliation/reconciliation.controller.ts |  | **1** · core:reconciliation/reconciliation.module.ts |
| `ReconciliationModule` | core:reconciliation/reconciliation.module.ts |  | **1** · core:app.module.ts |
| `RecordCeremonyDto` | core:identity/ceremony.dto.ts | REQ-PKI-01 — recording the three checks a human performed before a passkey may be bound. | **1** · core:identity/identity.controller.ts |
| `ResolveDisputeDto` | core:tablet-sessions/dispute-resolution.dto.ts | `POST /tablet-sessions/:id/dispute-resolution` — reception closes a dispute. | **1** · core:tablet-sessions/tablet-sessions.controller.ts |
| `RetentionModule` | core:retention/retention.module.ts |  | **1** · core:app.module.ts |
| `RetentionSweepService` | core:retention/retention-sweep.service.ts | Retention, soft (CONSULTATION-CAPTURE-PLAN.md Part 5; REQ-REG-09, REQ-INT-04). | **1** · core:retention/retention.module.ts |
| `ReviewTasksController` | core:review-tasks/review-tasks.controller.ts | The review queue. | **1** · core:review-tasks/review-tasks.module.ts |
| `ReviewTasksModule` | core:review-tasks/review-tasks.module.ts |  | **1** · core:app.module.ts |
| `ServiceDescriptionsController` | core:service-descriptions/service-descriptions.controller.ts | D6a on a staff surface (CONSULTATION-CAPTURE-PLAN §2.4). | **1** · core:service-descriptions/service-descriptions.module.ts |
| `SetSessionStateDto` | core:tablet-sessions/tablet-sessions.dto.ts | `POST /kiosk/session/:id/state` — the tablet says what it is showing. | **1** · core:tablet-sessions/kiosk-session.controller.ts |
| `SignDto` | core:agreements/agreements.dto.ts |  | **1** · core:agreements/agreements.controller.ts |
| `SignedDb4RenderRefusal` | core:render/signed-db4-document.ts |  | **1** · core:render/signed-db4-renderer.ts |
| `SimpleWebAuthnAdapter` | core:portal/portal-webauthn.ts | The real one. | **1** · core:portal/portal.module.ts |
| `SurfaceGuard` | core:practices/surface.guard.ts | DOES THIS PRACTICE USE THIS PART OF AoB? | **1** · core:practices/practices.module.ts |
| `TabletSessionsController` | core:tablet-sessions/tablet-sessions.controller.ts | RECEPTION'S SIDE OF THE PUSH — `/practice/tablet` talks to this (TODO.md "Two front doors", Carl 4 Sep 2026). | **1** · core:tablet-sessions/tablet-sessions.module.ts |
| `TemplatesController` | core:templates/templates.controller.ts | PER-PRACTICE AGREEMENT WORDING — the practice's side and the platform's, deliberately on two prefixes (Carl, 5 Sep 2026; W1). | **1** · core:templates/templates.module.ts |
| `ThreeIdentifierBootstrapAuthenticator` | core:portal/portal-authenticator.ts | The only implementation today: the bootstrap IS the authentication. | **1** · core:portal/portal.module.ts |
| `TransitionDto` | core:agreements/agreements.dto.ts |  | **1** · core:agreements/agreements.controller.ts |
| `VaultModule` | core:vault/vault.module.ts |  | **1** · core:app.module.ts |
| `VaultRelayService` | core:vault/vault-relay.service.ts | Thin NestJS wrapper around the framework-agnostic relay (vault-client): scheduling + the skip-if-already-running guard live here; the retry policy (exponential backoff, no permanent give-up) lives in the package. | **1** · core:vault/vault.module.ts |
| `VerificationController` | core:verification/verification.controller.ts |  | **1** · core:verification/verification.module.ts |
| `AbrAttestationDto` | core:organisations/organisations.controller.ts | What a named human read off abr.business.gov.au, when the platform has no ABR GUID to call the API with. | 0 |
| `ActivateLocationDto` | core:organisations/organisations.controller.ts |  | 0 |
| `AddCredentialDto` | core:organisations/organisations.controller.ts |  | 0 |
| `AddDepartmentDto` | core:organisations/organisations.controller.ts |  | 0 |
| `AddLocationDto` | core:organisations/organisations.controller.ts |  | 0 |
| `AmendApplicationDto` | core:organisations/applicant.controller.ts | What an applicant may change. | 0 |
| `AmendPracticeDto` | core:organisations/organisations.controller.ts | An amendment to an APPROVED practice, from the console. | 0 |
| `AnswerInvitationDto` | core:affiliations/affiliations.controller.ts |  | 0 |
| `ArrivalAssignorDto` | core:arrivals/arrivals.dto.ts | SOMEBODY OTHER THAN THE PATIENT IS SIGNING, SAID AT THE DESK (D7, hard rule 10; W2, Carl 7 Sep 2026). | 0 |
| `AttemptDto` | core:verification/verification.controller.ts |  | 0 |
| `BillingRoleDto` | core:affiliations/affiliations.controller.ts | WHOSE PROVIDER NUMBER THE CLAIM GOES UNDER, at this location. | 0 |
| `CeaseDto` | core:enduring/enduring.controller.ts |  | 0 |
| `ChangeRoleDto` | core:practices/practice-users.controller.ts |  | 0 |
| `ChooseProviderDto` | core:arrivals/arrivals.controller.ts | Reception naming the practitioner-at-a-location the claim will go under. | 0 |
| `ClaimEventDto` | core:notices/notices.controller.ts |  | 0 |
| `CorrectionDto` | core:notices/notices.controller.ts |  | 0 |
| `CreateEnduringDto` | core:enduring/enduring.controller.ts |  | 0 |
| `DeactivateDto` | core:practices/practice-users.controller.ts |  | 0 |
| `DecideDto` | core:reconciliation/reconciliation.controller.ts |  | 0 |
| `DeregisterDto` | core:affiliations/affiliations.controller.ts |  | 0 |
| `DeviceSettingsDto` | core:devices/devices.controller.ts |  | 0 |
| `DeviceWalkUpsDto` | core:devices/devices.controller.ts | The body of `PATCH /devices/:id/walk-ups` — one boolean, required. | 0 |
| `DrawnSignatureDto` | core:agreements/agreements.dto.ts | The drawn mark itself (REQ-SIG-01: vector + raster). | 0 |
| `ExternalNoticeDto` | core:affiliations/affiliations.controller.ts | Notice given outside AoBPlatform, for a departure that has already happened. | 0 |
| `GiveNoticeDto` | core:affiliations/affiliations.controller.ts |  | 0 |
| `GnafAddressValidator` | core:organisations/address-validator.ts | Validation against a locally-ingested G-NAF extract. | 0 |
| `GrantAccessDto` | core:practices/practice-users.controller.ts |  | 0 |
| `HttpRulesEngineClient` | core:rules-client/rules-client.module.ts |  | 0 |
| `InviteAffiliationDto` | core:affiliations/affiliations.controller.ts |  | 0 |
| `InviteDto` | core:identity/identity.controller.ts |  | 0 |
| `KioskClaimDto` | core:kiosk/kiosk.controller.ts |  | 0 |
| `KioskHeartbeatDto` | core:kiosk/kiosk.controller.ts | THE HEARTBEAT'S WHOLE BODY, and the DTO is the guard rail (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat and Return to Begin"). | 0 |
| `LinkVerifyDto` | core:capture/capture.controller.ts |  | 0 |
| `LocationDto` | core:practices/practices.dto.ts |  | 0 |
| `ManualAddressValidator` | core:organisations/address-validator.ts | The interim mode: a named human confirms the address, in the same validation queue that already approves the organisation. | 0 |
| `MinimumKioskBuildDto` | core:devices/devices.controller.ts |  | 0 |
| `OpenCaptureDto` | core:capture/capture.controller.ts |  | 0 |
| `PairDeviceDto` | core:devices/devices.controller.ts |  | 0 |
| `PreRegisterDto` | core:affiliations/affiliations.controller.ts |  | 0 |
| `PrintJobEnvelopeDto` | core:inbound/inbound-print-jobs.controller.ts |  | 0 |
| `ProposeTemplateDto` | core:templates/templates.controller.ts |  | 0 |
| `PushRefusal` | core:tablet-sessions/push-refusal.ts | WHY A PUSH WAS REFUSED — one named refusal per reason, carrying a CODE the console maps to its own words. | 0 |
| `RecordChaseAttemptDto` | core:chase-attempts/chase-attempts.controller.ts | NOTE WHAT IS NOT IN THIS DTO: a name, a phone number, an email address, or an amount. | 0 |
| `RecordCheckDto` | core:organisations/organisations.controller.ts |  | 0 |
| `RecordRegistrationDto` | core:affiliations/affiliations.controller.ts | What a named human read off the AHPRA public register. | 0 |
| `RegisterDeviceDto` | core:devices/devices.controller.ts |  | 0 |
| `RegisterOrganisationDto` | core:organisations/organisations.controller.ts |  | 0 |
| `RegistrationTypeDto` | core:affiliations/affiliations.controller.ts |  | 0 |
| `RejectAddressDto` | core:organisations/organisations.controller.ts |  | 0 |
| `RemoveCredentialDto` | core:organisations/organisations.controller.ts |  | 0 |
| `RequestCopyDto` | core:agreement-copy/agreement-copy-kiosk.controller.ts |  | 0 |
| `RequestCorrectionDto` | core:organisations/organisations.controller.ts | Asking an applicant to correct something. | 0 |
| `ResendDto` | core:outbound/outbound.controller.ts | Reading the queue. | 0 |
| `ResendDto` | core:reconciliation/reconciliation.controller.ts |  | 0 |
| `ResendInvitationDto` | core:organisations/organisations.controller.ts |  | 0 |
| `ResolveTaskDto` | core:review-tasks/review-tasks.controller.ts |  | 0 |
| `RespondDto` | core:affiliations/affiliations.controller.ts |  | 0 |
| `ReviewTemplateDto` | core:templates/templates.controller.ts |  | 0 |
| `RevokeDeviceDto` | core:devices/devices.controller.ts |  | 0 |
| `SetDefaultServiceDescriptionDto` | core:service-descriptions/service-descriptions.controller.ts |  | 0 |
| `SetLogoDto` | core:practices/letterhead.controller.ts | Base64 in JSON rather than multipart, for the reason `UploadArtefactDto` gives: a multipart parser is more attack surface than a 512 KB image justifies, and base64 keeps the request one validated DTO. | 0 |
| `SetServiceDescriptionDto` | core:service-descriptions/service-descriptions.controller.ts | The chosen words. | 0 |
| `SetVisitStateDto` | core:practitioner-queue/practitioner-queue.controller.ts | THE WHOLE BODY OF THE ONE WRITE THIS PAGE HAS — a state key, and nothing else (PRACTITIONER-QUEUE-PAGE.md §3a rule 1). | 0 |
| `SignaturePointDto` | core:agreements/agreements.dto.ts | One captured point of a drawn signature. | 0 |
| `SignatureStrokeDto` | core:agreements/agreements.dto.ts |  | 0 |
| `StartActingAsDto` | core:acting-as/acting-as.controller.ts |  | 0 |
| `StartChallengeDto` | core:verification/verification.controller.ts |  | 0 |
| `TerminateDto` | core:enduring/enduring.controller.ts |  | 0 |
| `TombstoneDto` | core:artefacts/artefacts.controller.ts |  | 0 |
| `UpdateLocationDto` | core:organisations/organisations.controller.ts | The practice correcting its own address, before anybody has confirmed it. | 0 |
| `UploadArtefactDto` | core:artefacts/artefacts.controller.ts | Upload as base64 in JSON rather than multipart. | 0 |
| `ValidationDecisionDto` | core:organisations/organisations.controller.ts |  | 0 |
| `VerifyCredentialDto` | core:organisations/organisations.controller.ts |  | 0 |
| `VerifyEmailDto` | core:organisations/applicant.controller.ts | The six-digit code from the confirmation email. | 0 |

## Core helpers, constants and types

185 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `Actor` | core:auth/actor.decorator.ts | WHO IS DOING THIS — taken from the verified token, never from the request body. | **41** · core:acting-as/acting-as.controller.ts, core:acting-as/acting-as.service.ts, core:affiliations/affiliations.controller.ts, +38 more |
| `SessionActor` | core:auth/actor.decorator.ts | Resolves the actor, or `undefined` when no verified token is present. | **22** · core:acting-as/acting-as.controller.ts, core:affiliations/affiliations.controller.ts, core:affiliations/practitioner-self.controller.ts, +19 more |
| `PracticeScoped` | core:auth/practice-scope.decorator.ts | THE PRACTICE'S OWN ACT. | **9** · core:affiliations/affiliations.controller.ts, core:arrivals/arrivals.controller.ts, core:devices/devices.controller.ts, +6 more |
| `Public` | core:auth/public.decorator.ts | Marks an endpoint reachable without an account. | **9** · core:agree/agree.controller.ts, core:agreement-copy/agreement-copy.controller.ts, core:capture/capture.controller.ts, +6 more |
| `EmailBlock` | core:messaging/template.ts |  | **8** · core:acting-as/acting-as.service.ts, core:affiliations/invitation.service.ts, core:agreement-copy/agreement-copy.service.ts, +5 more |
| `MESSAGING_GATEWAY` | core:messaging/gateway.ts |  | **8** · core:identity/practice-admin.service.ts, core:identity/practitioner-email.service.ts, core:messaging/composer.service.ts, +5 more |
| `ResolvedDevice` | core:devices/devices.service.ts | What the guard needs to know about the caller, and nothing more. | **8** · core:agreement-copy/agreement-copy-kiosk.controller.ts, core:devices/device.decorator.ts, core:devices/device.guard.ts, +5 more |
| `MessagingGateway` | core:messaging/gateway.ts |  | **7** · core:identity/practice-admin.service.ts, core:identity/practitioner-email.service.ts, core:messaging/composer.service.ts, +4 more |
| `PLATFORM_ADMIN` | core:auth/roles.decorator.ts | AoBPlatform staff who read applications and approve practices. | **7** · core:acting-as/acting-as.controller.ts, core:affiliations/affiliations.controller.ts, core:identity-dashboard/identity-dashboard.controller.ts, +4 more |
| `RequireRoles` | core:auth/roles.decorator.ts | Requires one of these realm roles on the bearer token. | **6** · core:acting-as/acting-as.controller.ts, core:affiliations/affiliations.controller.ts, core:identity-dashboard/identity-dashboard.controller.ts, +3 more |
| `anchorForAgreement` | core:affiliations/agreement-anchor.ts | WHO THIS AGREEMENT NAMES. | **6** · core:agreements/agreements.service.ts, core:arrivals/post-service-chase.sweep.ts, core:enduring/enduring.service.ts, +3 more |
| `KEYCLOAK_ADMIN` | core:identity/identity.tokens.ts |  | **5** · core:identity/identity.module.ts, core:identity/identity.service.ts, core:identity/practice-admin.service.ts, +2 more |
| `PMS_ADAPTER` | core:pms/pms.tokens.ts |  | **5** · core:auto-capture/auto-capture.service.ts, core:pms/pms-sync.service.ts, core:pms/pms.module.ts, +2 more |
| `anchorsForAgreements` | core:affiliations/agreement-anchor.ts | The same answer for a list, which is what every queue screen wants: two queries for the anchored rows and one legacy lookup each for the rest, rather than a join per line. | **5** · core:arrivals/arrivals.service.ts, core:kiosk/kiosk.service.ts, core:portal/portal-reads.service.ts, +2 more |
| `canonicalJson` | core:render/canonical-json.ts | THE ONE CANONICAL SERIALISATION IN THE RENDER PATH — the function that decides what an agreement's hash is computed over. | **5** · core:render/agreement-document.ts, core:render/agreement-pdf-renderer.ts, core:render/pdf-renderer.ts, +2 more |
| `AgreementRenderer` | core:render/renderer.ts |  | **4** · core:render/agreement-pdf-renderer.ts, core:render/pdf-renderer.ts, core:render/renderer-registry.ts, +1 more |
| `CallingDevice` | core:devices/device.decorator.ts | The resolved device, or undefined where none was offered. | **3** · core:agreement-copy/agreement-copy-kiosk.controller.ts, core:kiosk/kiosk.controller.ts, core:tablet-sessions/kiosk-session.controller.ts |
| `LogoLoader` | core:render/logo-loader.ts | THE ONE WAY THE RENDERER GETS THE PRACTICE'S LOGO BYTES. | **3** · core:render/agreement-pdf-renderer.ts, core:render/renderer-registry.ts, core:render/signed-db4-renderer.ts |
| `RenderedArtefact` | core:render/renderer.ts | Rule 13 — ONE deterministic render path. | **3** · core:render/agreement-pdf-renderer.ts, core:render/pdf-renderer.ts, core:render/signed-db4-renderer.ts |
| `RequiresDevice` | core:devices/device.decorator.ts | This endpoint answers only a PAIRED TABLET. | **3** · core:agreement-copy/agreement-copy-kiosk.controller.ts, core:kiosk/kiosk.controller.ts, core:tablet-sessions/kiosk-session.controller.ts |
| `anchorForLegacyProvider` | core:affiliations/agreement-anchor.ts | THE ANCHOR FOR A LEGACY `providers` ROW. | **3** · core:arrivals/arrivals.service.ts, core:auto-capture/auto-capture.service.ts, core:pms/pms-sync.service.ts |
| `renderInputOf` | core:render/renderer-registry.ts | WHAT TO HAND A RENDERER WHEN RE-VERIFYING A STORED AGREEMENT. | **3** · core:agreements/agreements.service.ts, core:pms/write-back.service.ts, core:render/verified-artefact.ts |
| `setPortalCookie` | core:portal/portal-cookie.ts |  | **3** · core:portal/portal-dev.controller.ts, core:portal/portal-passkey.controller.ts, core:portal/portal.controller.ts |
| `ABR_CLIENT` | core:organisations/organisations.tokens.ts | Injection tokens for the two swappable external-data adapters. | **2** · core:organisations/organisations.module.ts, core:organisations/organisations.service.ts |
| `ADDRESS_VALIDATOR` | core:organisations/organisations.tokens.ts |  | **2** · core:organisations/organisations.module.ts, core:organisations/organisations.service.ts |
| `ARTEFACT_STORE` | core:artefacts/artefact-store.ts |  | **2** · core:artefacts/artefacts.module.ts, core:artefacts/artefacts.service.ts |
| `AgreementDocument` | core:render/agreement-document.ts |  | **2** · core:agreements/agreements.service.ts, core:render/agreement-pdf-renderer.ts |
| `EmailFooter` | core:messaging/template.ts |  | **2** · core:identity/practice-admin.service.ts, core:messaging/composer.service.ts |
| `LOGO_LOADER` | core:render/logo-loader.ts |  | **2** · core:render/render.module.ts, core:render/renderer-registry.ts |
| `PORTAL_AUTHENTICATOR` | core:portal/portal-authenticator.ts | WHERE THE PASSKEY GOES — a named seam, and deliberately nothing more. | **2** · core:portal/portal.module.ts, core:portal/portal.service.ts |
| `PORTAL_WEBAUTHN` | core:portal/portal-webauthn.ts |  | **2** · core:portal/portal-passkey.service.ts, core:portal/portal.module.ts |
| `PatientIdentityRecord` | core:verification/identifier-matching.ts |  | **2** · core:kiosk/kiosk.service.ts, core:verification/verification.service.ts |
| `RULES_CLIENT` | core:rules-client/rules-client.module.ts |  | **2** · core:agreements/agreements.service.ts, core:service-descriptions/service-descriptions.service.ts |
| `SignedDb4Document` | core:render/signed-db4-document.ts |  | **2** · core:agreements/signed-db4.service.ts, core:render/signed-db4-renderer.ts |
| `VAULT_CLIENT` | core:vault/vault.tokens.ts |  | **2** · core:vault/vault-relay.service.ts, core:vault/vault.module.ts |
| `allocatePracticeCodeIfPossible` | core:practices/practice-code.ts | ALLOCATE, BUT NEVER FAIL THE THING THAT ASKED. | **2** · core:organisations/organisations.service.ts, core:practices/practices.service.ts |
| `clientKey` | core:portal/portal-client-key.ts | WHAT A RATE LIMITER ON A PUBLIC PORTAL ROUTE COUNTS AGAINST. | **2** · core:portal/portal-passkey.controller.ts, core:portal/portal.controller.ts |
| `evaluateChallenge` | core:verification/identifier-matching.ts | Evaluates ALL challenged identifiers (never short-circuits on first mismatch — uniform timing) and reports only the aggregate. | **2** · core:kiosk/kiosk.service.ts, core:verification/verification.service.ts |
| `idsOf` | core:arrivals/arrival-day.ts | Distinct, non-empty ids from a list that may hold nulls. | **2** · core:arrivals/arrivals.service.ts, core:practitioner-queue/practitioner-queue.service.ts |
| `newestAgreementInChain` | core:arrivals/arrival-day.ts | THE LAST AGREEMENT IN EACH CHAIN, WALKED FORWARD FROM THE ARRIVAL'S OWN. | **2** · core:arrivals/arrivals.service.ts, core:practitioner-queue/practitioner-queue.service.ts |
| `parseCaptureToken` | core:capture/capture-token.ts |  | **2** · core:agree/agree.service.ts, core:capture/capture.service.ts |
| `readPortalCookie` | core:portal/portal-cookie.ts | The session id the caller presented, or null. | **2** · core:portal/portal-passkey.controller.ts, core:portal/portal.controller.ts |
| `receivedArrivalsIn` | core:arrivals/arrival-day.ts | WHAT THE PRACTICE ACCEPTED IN A WINDOW, IN THE ORDER PEOPLE WALKED IN. | **2** · core:arrivals/arrivals.service.ts, core:practitioner-queue/practitioner-queue.service.ts |
| `renderHtml` | core:messaging/template.ts |  | **2** · core:identity/practice-admin.service.ts, core:messaging/composer.service.ts |
| `renderText` | core:messaging/template.ts | The plain-text alternative, derived from the same blocks so they cannot drift. | **2** · core:identity/practice-admin.service.ts, core:messaging/composer.service.ts |
| `usernameForPersonAtPractice` | core:identity/account-names.ts | A PERSON, AT ONE PRACTICE -- `audrey@hillsempire.com.xlevelup`. | **2** · core:identity/identity.service.ts, core:practices/practice-users.service.ts |
| `verifiedArtefactOf` | core:render/verified-artefact.ts |  | **2** · core:agreement-copy/agreement-copy.service.ts, core:portal/portal-reads.service.ts |
| `AbrClient` | core:organisations/abr.ts |  | **1** · core:organisations/organisations.service.ts |
| `AddressValidator` | core:organisations/address-validator.ts |  | **1** · core:organisations/organisations.service.ts |
| `AgreementAnchor` | core:affiliations/agreement-anchor.ts | WHO AN AGREEMENT NAMES — read from the practitioner's affiliation at a location, which is the anchor from 7 September 2026 (Carl: "retire providers as the anchor"). | **1** · core:arrivals/arrivals.service.ts |
| `AgreementLetterhead` | core:render/agreement-document.ts | WHAT IS ACTUALLY RENDERED — the whole document, assembled once at lock time and stored, so that "re-render it and compare the hash" has something complete to re-render (hard rule 13; Carl, 5 Sep 2026, W1). | **1** · core:practices/letterhead.service.ts |
| `ArtefactStore` | core:artefacts/artefact-store.ts | Where artefact bytes live. | **1** · core:artefacts/artefacts.service.ts |
| `CLAIM_ATTEMPT_LIMIT` | core:kiosk/claim-rate-limit.ts | Three, then the desk — the same ladder the tablet shows in its footer. | **1** · core:kiosk/kiosk.service.ts |
| `DEFAULT_IDENTIFIER_TYPES` | core:verification/verification.service.ts | The statutory floor of three, until a practice configures its own (REQ-VER-06). | **1** · core:kiosk/kiosk.service.ts |
| `DEFAULT_LINK_EXPIRY_HOURS` | core:capture/capture-token.ts | Default link expiry until decision D-05 closes (options were 24h/48h/7d). | **1** · core:capture/capture.service.ts |
| `DEVICE_REQUIRED` | core:devices/device.decorator.ts |  | **1** · core:devices/device.guard.ts |
| `DispatchRequest` | core:messaging/gateway.ts | Outbound messaging. | **1** · core:messaging/mailhog.gateway.ts |
| `DispatchResult` | core:messaging/gateway.ts |  | **1** · core:messaging/mailhog.gateway.ts |
| `FRESH_SECOND_FACTOR` | core:auth/fresh-second-factor.decorator.ts | Metadata key the guard reads to find out whether this route is gated. | **1** · core:auth/auth.guard.ts |
| `FreshSecondFactorRequirement` | core:auth/fresh-second-factor.decorator.ts | What the decorator stored: null means the domain's default window. | **1** · core:auth/auth.guard.ts |
| `GENERIC_MISMATCH_MESSAGE` | core:verification/verification.service.ts | The one message a failed attempt ever returns — never which identifier failed (REQ-SEC-07). | **1** · core:kiosk/kiosk.service.ts |
| `KioskBuild` | core:devices/device.decorator.ts | What the tablet says it is running, for the forced-reload answer. | **1** · core:kiosk/kiosk.controller.ts |
| `LegacyProviderRow` | core:affiliations/agreement-anchor.ts | What a `providers` row can be matched on. | **1** · core:pms/pms-sync.service.ts |
| `PORTAL_ACTIVATION_EXPIRY_HOURS` | core:portal/portal-token.ts | How long an invitation stays open. | **1** · core:portal/portal.service.ts |
| `PRACTICE_SCOPED` | core:auth/practice-scope.decorator.ts |  | **1** · core:auth/auth.guard.ts |
| `PUBLIC_ENDPOINT` | core:auth/public.decorator.ts |  | **1** · core:auth/auth.guard.ts |
| `PortalAuthenticator` | core:portal/portal-authenticator.ts |  | **1** · core:portal/portal.service.ts |
| `PortalRelyingParty` | core:portal/portal-passkey-config.ts |  | **1** · core:portal/portal-webauthn.ts |
| `PortalWebAuthn` | core:portal/portal-webauthn.ts |  | **1** · core:portal/portal-passkey.service.ts |
| `PreparedLock` | core:agreements/agreements.service.ts |  | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `REQUIRED_ROLES` | core:auth/roles.decorator.ts |  | **1** · core:auth/auth.guard.ts |
| `RequireFreshSecondFactor` | core:auth/fresh-second-factor.decorator.ts | A FRESH SECOND FACTOR BEFORE THIS ACT, not only at sign-in (AUTH-TIERS.md §5.2, D-2026-09-12-11). | **1** · core:devices/devices.controller.ts |
| `ResolvedChange` | core:identity/practitioner-email.service.ts | The subject of a change, as resolved from a token before any scope exists. | **1** · core:organisations/pending-email.service.ts |
| `anchorForAffiliation` | core:affiliations/agreement-anchor.ts | THE AFFILIATION, AS A PERSON AND A PLACE. | **1** · core:arrivals/arrivals.service.ts |
| `anchorsForAffiliations` | core:affiliations/agreement-anchor.ts | The batch form. | **1** · core:arrivals/arrivals.service.ts |
| `assertRenderable` | core:render/agreement-document.ts |  | **1** · core:render/agreement-pdf-renderer.ts |
| `assertSignedDb4Renderable` | core:render/signed-db4-document.ts | THE RENDER-TIME GUARD FOR THIS ARTEFACT KIND. | **1** · core:render/signed-db4-renderer.ts |
| `buildDb4FormView` | core:agreements/db4-form-view.ts | THE BLOCK THE LOCK RESPONSE CARRIES for a session that came from a DB4 Print Record — and nothing at all for every other session, which is where D-2026-09-27-02 lives: a practice with no PMS has no print record, so the caller builds no block and the tablet draws exactly what it drew before this feature existed. | **1** · core:agreements/agreements.service.ts |
| `checkDb4PrintRecord` | core:agreements/db4-form-view.ts | THE CHECKS THIS PRINT RECORD FAILS, ALL OF THEM, IN THE DECLARED ORDER. | **1** · core:agreements/agreements.service.ts |
| `clearPortalCookie` | core:portal/portal-cookie.ts |  | **1** · core:portal/portal.controller.ts |
| `correctionBody` | core:notices/notice-template.ts | Correction notices supersede rather than replace (REQ-DEL-06). | **1** · core:notices/notices.service.ts |
| `createAddressValidator` | core:organisations/address-validator.ts |  | **1** · core:organisations/organisations.module.ts |
| `extractText` | core:artefacts/extract-text.ts |  | **1** · core:artefacts/artefacts.service.ts |
| `formatAbn` | core:render/agreement-document.ts | Group an ABN the way the register prints it. | **1** · core:practices/letterhead.service.ts |
| `hashSecret` | core:devices/device-credential.ts |  | **1** · core:devices/devices.service.ts |
| `isAgreementDocument` | core:render/agreement-document.ts | True for a stored payload that is a whole document rather than bare particulars. | **1** · core:render/agreement-pdf-renderer.ts |
| `isSignedDb4Document` | core:render/signed-db4-document.ts | True for a stored payload that is a Signed-DB4 rather than an agreement document. | **1** · core:render/signed-db4-renderer.ts |
| `letterheadHashOf` | core:render/agreement-document.ts | A stable identity for the letterhead, so an agreement can say which one it was made under without storing a second copy of it. | **1** · core:practices/letterhead.service.ts |
| `mintAgreementCopyToken` | core:agreement-copy/copy-token.ts |  | **1** · core:agreement-copy/agreement-copy.service.ts |
| `mintCaptureToken` | core:capture/capture-token.ts |  | **1** · core:capture/capture.service.ts |
| `mintDeviceCredential` | core:devices/device-credential.ts |  | **1** · core:devices/devices.service.ts |
| `mintPairingCode` | core:devices/device-credential.ts | A pairing code, from the alphabet the domain fixes. | **1** · core:devices/devices.service.ts |
| `mintPortalActivationToken` | core:portal/portal-token.ts |  | **1** · core:portal/portal.service.ts |
| `noticeBody` | core:notices/notice-template.ts |  | **1** · core:notices/notices.service.ts |
| `noticeSubject` | core:notices/notice-template.ts |  | **1** · core:notices/notices.service.ts |
| `parseAgreementCopyToken` | core:agreement-copy/copy-token.ts |  | **1** · core:agreement-copy/agreement-copy.service.ts |
| `parseDeviceCredential` | core:devices/device-credential.ts | Splits a credential into the practice it routes to and the hash to look the device up by. | **1** · core:devices/devices.service.ts |
| `parsePortalActivationToken` | core:portal/portal-token.ts |  | **1** · core:portal/portal.service.ts |
| `portalRelyingParty` | core:portal/portal-passkey-config.ts |  | **1** · core:portal/portal-passkey.service.ts |
| `practiceCode` | core:practices/practice-code.ts | The code, allocating one if this practice predates the scheme or was created by a path that has not been taught to allocate yet. | **1** · core:identity/account-names.ts |
| `pushRefusals` | core:tablet-sessions/push-refusal.ts |  | **1** · core:tablet-sessions/tablet-sessions.service.ts |
| `sha256Hex` | core:artefacts/artefact-store.ts |  | **1** · core:artefacts/artefacts.service.ts |
| `usernameForPracticeAdmin` | core:identity/account-names.ts | THE PRACTICE'S OWN ACCOUNT -- `admin.xlevelup`. | **1** · core:identity/practice-admin.service.ts |
| `ABN_LOOKUP_LIMIT` | core:organisations/abn-lookup-rate-limit.ts | Twenty previews in ten minutes from one address. | 0 |
| `ABN_LOOKUP_WINDOW_MS` | core:organisations/abn-lookup-rate-limit.ts |  | 0 |
| `AGREEMENT_RENDERER` | core:render/renderer.ts |  | 0 |
| `AbrProbe` | core:organisations/abr.ts | WHY THERE ARE TWO ANSWERS AND NOT ONE. | 0 |
| `AbrReason` | core:organisations/abr.ts |  | 0 |
| `AddressValidationResult` | core:organisations/address-validator.ts |  | 0 |
| `AllocatedPracticeCode` | core:practices/practice-code.ts |  | 0 |
| `AnchoredRow` | core:affiliations/agreement-anchor.ts | The shape every caller has: an agreement row, or anything carrying the two ids. | 0 |
| `CLAIM_ATTEMPT_WINDOW_MS` | core:kiosk/claim-rate-limit.ts |  | 0 |
| `CLAIM_LOCKED_MESSAGE` | core:kiosk/kiosk.service.ts | The one sentence a locked-out tablet shows, and it points at a person. | 0 |
| `ClaimEventInput` | core:notices/notices.service.ts |  | 0 |
| `CorrectionOutcome` | core:patients/patients.service.ts |  | 0 |
| `CoveredServiceRow` | core:tablet-sessions/tablet-sessions.service.ts | A SERVICE THAT NEEDED NO SECOND SIGNATURE — a history line on the desk, never a Send (Carl, 11 Sep 2026; TODO.md "One signature per episodic visit, not two"). | 0 |
| `CreateEnduringInput` | core:enduring/enduring.service.ts |  | 0 |
| `DEVICE_CREDENTIAL_HEADER` | core:devices/device.guard.ts |  | 0 |
| `HealthResponse` | core:health/health.controller.ts |  | 0 |
| `InvitationResult` | core:identity/identity.service.ts |  | 0 |
| `KIOSK_BUILD_HEADER` | core:devices/device.guard.ts |  | 0 |
| `KioskClaimResult` | core:kiosk/kiosk.service.ts | What `POST /kiosk/claim` answers. | 0 |
| `LOCKOUT_AFTER_ATTEMPTS` | core:verification/verification.service.ts | D-06 default until a practice-config surface exists: lockout after 5 failed attempts. | 0 |
| `MAX_CHAIN_HOPS` | core:arrivals/arrival-day.ts | HOW FAR A SUPERSESSION CHAIN IS WALKED. | 0 |
| `MintedCopyToken` | core:agreement-copy/copy-token.ts | COPY LINKS — the same construction as capture links and portal activation invitations, and for the same reasons (REQ-VER-05: short-lived, non-enumerable, only the hash stored). | 0 |
| `MintedCredential` | core:devices/device-credential.ts |  | 0 |
| `MintedPortalToken` | core:portal/portal-token.ts | ACTIVATION INVITATIONS — the same construction as capture links, and for the same reasons (REQ-VER-05: short-lived, single-use, non-enumerable). | 0 |
| `MintedToken` | core:capture/capture-token.ts | Remote-link tokens (REQ-VER-05: practice-branded, short-lived, single-use, non-enumerable). | 0 |
| `OutboundLike` | core:correspondence/correspondence.service.ts | The transport row, as much of it as evidence needs. | 0 |
| `OutstandingItem` | core:reconciliation/reconciliation.service.ts |  | 0 |
| `PAIRING_ATTEMPT_LIMIT` | core:devices/pairing-rate-limit.ts | Ten wrong codes in ten minutes from one address. | 0 |
| `PAIRING_ATTEMPT_WINDOW_MS` | core:devices/pairing-rate-limit.ts |  | 0 |
| `PORTAL_PASSKEY_ATTEMPT_WINDOW_MS` | core:portal/portal-passkey-rate-limit.ts |  | 0 |
| `PendingServiceDescriptionRow` | core:service-descriptions/service-descriptions.service.ts |  | 0 |
| `PortalAuthenticationContext` | core:portal/portal-authenticator.ts |  | 0 |
| `PortalAuthenticationOutcome` | core:portal/portal-authenticator.ts |  | 0 |
| `PortalAuthenticationVerification` | core:portal/portal-webauthn.ts |  | 0 |
| `PortalRegistrationVerification` | core:portal/portal-webauthn.ts |  | 0 |
| `PortalStoredCredential` | core:portal/portal-webauthn.ts | A credential as the verifier needs it. | 0 |
| `PrintJobOutcome` | core:inbound/inbound-print-jobs.processor.ts | What a print job did, written onto the row so it is answerable later. | 0 |
| `PushableRow` | core:tablet-sessions/tablet-sessions.service.ts | A row on the console's left-hand list — a draft that could go to a tablet, or the reason it could not. | 0 |
| `RELAY_INTERVAL_MS` | core:vault/vault-relay.service.ts |  | 0 |
| `RecordChaseAttemptInput` | core:chase-attempts/chase-attempts.service.ts |  | 0 |
| `ResolvedUsername` | core:identity/account-names.ts | What the caller needs to know, and why it is what it is. | 0 |
| `RetentionSweepResult` | core:retention/retention-sweep.service.ts |  | 0 |
| `SERVICE_RENDERED_OUTCOMES` | core:practitioner-queue/practitioner-queue.service.ts | WHAT THE SERVICE-RENDERED SIGNAL CAME TO — a reason code, never prose, and never a gate (hard rule 8). | 0 |
| `SIGNED_DB4_NOT_PRODUCED_REASONS` | core:agreements/signed-db4.service.ts | WHY A SIGNED-DB4 WAS NOT PRODUCED — a code, never a shrug. | 0 |
| `ScopedTx` | core:arrivals/arrival-day.ts | The practice-scoped client `withPractice` hands its callback. | 0 |
| `ServiceRenderedOutcome` | core:practitioner-queue/practitioner-queue.service.ts |  | 0 |
| `SetServiceDescriptionResult` | core:service-descriptions/service-descriptions.service.ts |  | 0 |
| `SignedDb4NotProducedReason` | core:agreements/signed-db4.service.ts |  | 0 |
| `SignedDb4Outcome` | core:agreements/signed-db4.service.ts |  | 0 |
| `SignedDb4PrintRecord` | core:render/signed-db4-document.ts | The DB4 Print Record as it is reproduced — the driver's capture, narrowed to what is drawn. | 0 |
| `SignedDb4Signature` | core:render/signed-db4-document.ts | THE MARK, AS A REFERENCE. | 0 |
| `StagedArtefact` | core:artefacts/artefacts.service.ts | Bytes already written and hashed; the metadata row has not been made yet. | 0 |
| `UNPAIRED_MESSAGE` | core:devices/device.guard.ts | ONE SENTENCE FOR "this tablet is not paired", and the kiosk shows its own copy regardless. | 0 |
| `UploadInput` | core:artefacts/artefacts.service.ts |  | 0 |
| `VerifiableAgreement` | core:render/verified-artefact.ts | THE ONE WAY A STORED AGREEMENT BECOMES BYTES SOMEBODY IS GIVEN — hard rule 13. | 0 |
| `VerifiedArtefact` | core:render/verified-artefact.ts |  | 0 |
| `VisitStateReceipt` | core:practitioner-queue/practitioner-queue.service.ts | What one press of the control comes back with. | 0 |
| `WRITE_BACK_ALERT_AFTER_MS` | core:pms/write-back.service.ts | FR-9.3: alert on any stored artefact not in the PMS after this long. | 0 |
| `WRITE_BACK_SWEEP_INTERVAL_MS` | core:pms/write-back.service.ts |  | 0 |
| `addressMatches` | core:verification/identifier-matching.ts | The address rule (Carl, 3 Sep 2026), and it mirrors `nameMatches` on purpose. | 0 |
| `allocatePracticeCode` | core:practices/practice-code.ts |  | 0 |
| `constantTimeMatch` | core:verification/identifier-matching.ts | Constant-time equality over the normalised values — no early exit an attacker can time. | 0 |
| `esc` | core:messaging/template.ts | Escape before interpolation. | 0 |
| `existingUsername` | core:identity/account-names.ts | The username of an account we already recorded the id of. | 0 |
| `extractState` | core:organisations/address-validator.ts |  | 0 |
| `formatBenefit` | core:notices/notice-template.ts | Reg 89AA notice copy. | 0 |
| `hashCopySecret` | core:agreement-copy/copy-token.ts |  | 0 |
| `hashPortalSecret` | core:portal/portal-token.ts |  | 0 |
| `hashSecret` | core:capture/capture-token.ts |  | 0 |
| `hashesMatch` | core:devices/device-credential.ts | Constant-time comparison of two hex hashes. | 0 |
| `mapAbnDetails` | core:organisations/abr.ts | The register's answer, reduced to what we store. | 0 |
| `mapEntityType` | core:organisations/abr.ts | Map the ABR's entity-type descriptions onto our vocabulary. | 0 |
| `maskMedicareCardNumber` | core:agreements/db4-form-view.ts | eslint-disable-next-line no-restricted-syntax -- the name is the point: see D-2026-09-27-01 part 3 and the note above. | 0 |
| `matchAffiliationsForProvider` | core:affiliations/agreement-anchor.ts | WHICH AFFILIATIONS COULD A LEGACY `providers` ROW BE, and it never guesses. | 0 |
| `nameMatches` | core:verification/identifier-matching.ts | The name rule (Carl, 3 Sep 2026): the stated name must contain the held FAMILY name and the FIRST given name. | 0 |
| `normaliseStatedValue` | core:verification/identifier-matching.ts |  | 0 |
| `normalisedHeldValue` | core:verification/identifier-matching.ts | Normalises a held or stated value for one identifier type. | 0 |
| `ourStringsOf` | core:render/signed-db4-document.ts | THE STRINGS THIS CODEBASE AUTHORED — the ones hard rule 12 is about. | 0 |
| `renderedStringsOf` | core:render/agreement-document.ts | Every string that will be drawn on the page, in one list — including the particulars' own values, because a service description or a provider name is as much a line on the contract as a template paragraph is. | 0 |
| `reproducedStringsOf` | core:render/signed-db4-document.ts | THE STRINGS REPRODUCED FROM THE FORM. | 0 |
| `templateValuesFor` | core:agreements/agreements.service.ts | THE PARTICULARS, TURNED INTO THE VALUES THE WORDS NEED. | 0 |
| `unwrapJsonp` | core:organisations/abr.ts | Strip the `callback( … )` padding the JSON endpoints answer with. | 0 |

## AOBPRINTER (the desktop print channel)

111 exports.

| Symbol | File | What it is | Used by |
|---|---|---|---|
| `Logger` | aobprinter:log.ts |  | **8** · aobprinter:instance-lock.ts, aobprinter:keystore.ts, aobprinter:main.ts, +5 more |
| `redactError` | aobprinter:log.ts | An error, with its message redacted and its stack dropped. | **6** · aobprinter:instance-lock.ts, aobprinter:main.ts, aobprinter:outbox.ts, +3 more |
| `Db4PrintRecord` | aobprinter:db4-record.ts | The envelope's five fields are always present; everything below them is what the parser found on the page. | **5** · aobprinter:outbox.ts, aobprinter:parser.ts, aobprinter:poster.ts, +2 more |
| `readPackageVersion` | aobprinter:version.ts |  | **3** · aobprinter:main.ts, aobprinter:outbox.ts, aobprinter:poster.ts |
| `AobPrinterConfig` | aobprinter:config.ts |  | **2** · aobprinter:main.ts, aobprinter:poster.ts |
| `EncryptedPayload` | aobprinter:keystore.ts |  | **2** · aobprinter:outbox.ts, aobprinter:retention.ts |
| `KeyWrapper` | aobprinter:keystore.ts | Wraps and unwraps the retention key. | **2** · aobprinter:main.ts, aobprinter:retention.ts |
| `Outbox` | aobprinter:outbox.ts | (file) The outbox: a folder that must never lose a form and never send one twice. | **2** · aobprinter:main.ts, aobprinter:watcher.ts |
| `ParserTemplate` | aobprinter:template.ts |  | **2** · aobprinter:parser.ts, aobprinter:watcher.ts |
| `looksLikeAnIdentifier` | aobprinter:log.ts | Does this string look like a patient identifier? | **2** · aobprinter:config.ts, aobprinter:install-cli.ts |
| `DB4_DOCUMENT_TYPE` | aobprinter:db4-record.ts | `db4_assignment` — declared in the domain's lane table, not here. | **1** · aobprinter:parser.ts |
| `DEFAULT_RECONCILE_INTERVAL_MS` | aobprinter:print-service-log.ts | Every quarter hour. | **1** · aobprinter:main.ts |
| `DEFAULT_RETENTION_CONFIG` | aobprinter:config.ts |  | **1** · aobprinter:outbox.ts |
| `DEFAULT_TEMPLATE_VERSION` | aobprinter:template.ts | The template a fresh install parses with, until configuration says otherwise. | **1** · aobprinter:config.ts |
| `EventCountReader` | aobprinter:print-service-log.ts | Counts per printer name over a window, or null when the question could not be asked at all. | **1** · aobprinter:main.ts |
| `Extractor` | aobprinter:template.ts |  | **1** · aobprinter:parser.ts |
| `INSTALL_MODES` | aobprinter:install-marker.ts |  | **1** · aobprinter:install-cli.ts |
| `InstallMode` | aobprinter:install-marker.ts | `Single` — one queue on this desktop. | **1** · aobprinter:install-cli.ts |
| `InstallQueue` | aobprinter:install-marker.ts | One queue as the installer created it. | **1** · aobprinter:install-cli.ts |
| `InstanceLock` | aobprinter:instance-lock.ts |  | **1** · aobprinter:main.ts |
| `PostResult` | aobprinter:outbox.ts |  | **1** · aobprinter:poster.ts |
| `Poster` | aobprinter:outbox.ts | What actually talks to AoB. | **1** · aobprinter:poster.ts |
| `QueueConfig` | aobprinter:config.ts | One print queue: one Windows printer, one file-path port, one spool file. | **1** · aobprinter:watcher.ts |
| `QueueWatcher` | aobprinter:watcher.ts | Every configured queue, watched independently, on one loop. | **1** · aobprinter:main.ts |
| `ReceiptsWriter` | aobprinter:receipts.ts | Where the outbox sends a finished job's receipt. | **1** · aobprinter:retention.ts |
| `Reconciler` | aobprinter:print-service-log.ts |  | **1** · aobprinter:main.ts |
| `RetentionConfig` | aobprinter:config.ts | How long a form's OWN copy is kept on this desktop after it is no longer needed to prove delivery. | **1** · aobprinter:retention.ts |
| `RetentionDeps` | aobprinter:retention.ts |  | **1** · aobprinter:outbox.ts |
| `RowExtractor` | aobprinter:template.ts |  | **1** · aobprinter:parser.ts |
| `TransformName` | aobprinter:template.ts |  | **1** · aobprinter:parser.ts |
| `acquireInstanceLock` | aobprinter:instance-lock.ts | Take the lock, or throw. | **1** · aobprinter:main.ts |
| `buildReceipt` | aobprinter:receipts.ts | Build a receipt from a record and its outcome. | **1** · aobprinter:outbox.ts |
| `buildRetentionDeps` | aobprinter:retention.ts | Build what `Outbox` needs. | **1** · aobprinter:main.ts |
| `claimedJobs` | aobprinter:watcher.ts | Everything already claimed and not yet parsed — what a restart finds. | **1** · aobprinter:main.ts |
| `consoleLogger` | aobprinter:log.ts |  | **1** · aobprinter:main.ts |
| `decideInstallAction` | aobprinter:install-marker.ts | Should this install proceed, and as what? | **1** · aobprinter:install-cli.ts |
| `decryptPayload` | aobprinter:keystore.ts |  | **1** · aobprinter:retention.ts |
| `dpapiKeyWrapper` | aobprinter:keystore.ts | The real wrapper: Windows DPAPI at `LocalMachine` scope, via PowerShell. | **1** · aobprinter:retention.ts |
| `encryptPayload` | aobprinter:keystore.ts | AES-256-GCM over a raw key already in memory. | **1** · aobprinter:retention.ts |
| `loadConfig` | aobprinter:config.ts |  | **1** · aobprinter:main.ts |
| `loadOrCreateKey` | aobprinter:keystore.ts | Load the wrapped key from disk, or generate and wrap a fresh one. | **1** · aobprinter:retention.ts |
| `makeFileReceiptsWriter` | aobprinter:receipts.ts |  | **1** · aobprinter:retention.ts |
| `makeHttpPoster` | aobprinter:poster.ts |  | **1** · aobprinter:main.ts |
| `parseDb4` | aobprinter:parser.ts | The record, or null when the page is not the document this template reads. | **1** · aobprinter:watcher.ts |
| `powershellEventCountReader` | aobprinter:print-service-log.ts | ASYNCHRONOUS, AND THAT IS NOT A STYLE CHOICE. | **1** · aobprinter:main.ts |
| `processClaimedJob` | aobprinter:watcher.ts | One claimed file → one record in the outbox. | **1** · aobprinter:main.ts |
| `readInstallMarker` | aobprinter:install-marker.ts | The marker, or null when there is nothing trustworthy to read. | **1** · aobprinter:install-cli.ts |
| `readPdfText` | aobprinter:pdf-text.ts | The spool bytes in, the printed lines out. | **1** · aobprinter:watcher.ts |
| `sha256Hex` | aobprinter:outbox.ts |  | **1** · aobprinter:watcher.ts |
| `templateFor` | aobprinter:template.ts |  | **1** · aobprinter:main.ts |
| `writeInstallMarker` | aobprinter:install-marker.ts |  | **1** · aobprinter:install-cli.ts |
| `Cipher` | aobprinter:retention.ts | What the outbox needs to encrypt and decrypt a payload, without knowing how the key is held. | 0 |
| `DEFAULT_CONFIG_PATH` | aobprinter:config.ts |  | 0 |
| `DEFAULT_DATA_DIR` | aobprinter:config.ts |  | 0 |
| `DEFAULT_SPOOL_FILE` | aobprinter:config.ts |  | 0 |
| `Db4Assignment` | aobprinter:db4-record.ts |  | 0 |
| `Db4Form` | aobprinter:db4-record.ts |  | 0 |
| `Db4Heading` | aobprinter:db4-record.ts |  | 0 |
| `Db4Patient` | aobprinter:db4-record.ts |  | 0 |
| `Db4Provider` | aobprinter:db4-record.ts |  | 0 |
| `Db4Referral` | aobprinter:db4-record.ts |  | 0 |
| `Db4Service` | aobprinter:db4-record.ts |  | 0 |
| `Db4ServicingLocation` | aobprinter:db4-record.ts |  | 0 |
| `Db4Statement` | aobprinter:db4-record.ts |  | 0 |
| `DeriveExtractor` | aobprinter:template.ts |  | 0 |
| `EXTRACTOR_KINDS` | aobprinter:template.ts |  | 0 |
| `ExtractorKind` | aobprinter:template.ts |  | 0 |
| `FlagExtractor` | aobprinter:template.ts |  | 0 |
| `InstallAction` | aobprinter:install-marker.ts | `fresh` — nothing installed here before. | 0 |
| `InstallMarker` | aobprinter:install-marker.ts |  | 0 |
| `InstanceLockDeps` | aobprinter:instance-lock.ts |  | 0 |
| `LineExtractor` | aobprinter:template.ts |  | 0 |
| `LinesExtractor` | aobprinter:template.ts |  | 0 |
| `LogFields` | aobprinter:log.ts |  | 0 |
| `LogSink` | aobprinter:log.ts | A sink so tests can read what was written. | 0 |
| `OUTBOX_FORMAT_VERSION` | aobprinter:outbox.ts | The on-disk shape of everything under `outbox/`. | 0 |
| `OutboxPaths` | aobprinter:outbox.ts |  | 0 |
| `PRINTED_EVENT_ID` | aobprinter:print-service-log.ts | "Document printed" — one per completed job. | 0 |
| `PRINT_SERVICE_LOG` | aobprinter:print-service-log.ts |  | 0 |
| `ParagraphsExtractor` | aobprinter:template.ts |  | 0 |
| `ParseInput` | aobprinter:parser.ts |  | 0 |
| `PdfText` | aobprinter:pdf-text.ts |  | 0 |
| `ProcessOutcome` | aobprinter:watcher.ts |  | 0 |
| `RETENTION_HARD_CAP_MS` | aobprinter:config.ts | Once `retention.enabled` is true, nothing this feature can actually delete may take longer than this to go. | 0 |
| `Receipt` | aobprinter:receipts.ts |  | 0 |
| `ReceiptOutcome` | aobprinter:receipts.ts |  | 0 |
| `ReceiptState` | aobprinter:receipts.ts |  | 0 |
| `ReconcileSummary` | aobprinter:print-service-log.ts |  | 0 |
| `RunHandles` | aobprinter:main.ts |  | 0 |
| `SpoolClaimer` | aobprinter:watcher.ts | Watches ONE spool path and claims what lands there. | 0 |
| `StartDeps` | aobprinter:main.ts |  | 0 |
| `TRANSFORMS` | aobprinter:template.ts | The named transforms. | 0 |
| `WatchedQueue` | aobprinter:watcher.ts | One queue, its own folders, its own claimer. | 0 |
| `WatcherDirs` | aobprinter:watcher.ts |  | 0 |
| `appendReceipt` | aobprinter:receipts.ts |  | 0 |
| `claimedJobName` | aobprinter:watcher.ts | A claimed job's filename. | 0 |
| `compareVersions` | aobprinter:install-marker.ts | Compare two dotted numeric versions. | 0 |
| `installMarkerPath` | aobprinter:install-marker.ts |  | 0 |
| `instanceLockPath` | aobprinter:instance-lock.ts |  | 0 |
| `isCompletePdf` | aobprinter:watcher.ts | Is this a complete PDF? | 0 |
| `keystorePaths` | aobprinter:keystore.ts |  | 0 |
| `makeLogger` | aobprinter:log.ts |  | 0 |
| `outboxPaths` | aobprinter:outbox.ts |  | 0 |
| `parseConfig` | aobprinter:config.ts |  | 0 |
| `parseQueuesArgument` | aobprinter:install-cli.ts |  | 0 |
| `parseTemplate` | aobprinter:template.ts |  | 0 |
| `readQueuesArgument` | aobprinter:install-cli.ts | `@<path>` READS THE JSON FROM A FILE, and the caller is why. | 0 |
| `receiptsPath` | aobprinter:receipts.ts |  | 0 |
| `redact` | aobprinter:log.ts | Replace every long digit run with a marker. | 0 |
| `start` | aobprinter:main.ts | Start the program. | 0 |
| `watcherDirs` | aobprinter:watcher.ts | Where one queue's claimed and parked files live. | 0 |

---

Generated by `scripts/dev/inventory.mjs`. Nothing in this file varies between runs on the same tree — no timestamp, no duration, no machine name — because the staleness guard compares it byte for byte.

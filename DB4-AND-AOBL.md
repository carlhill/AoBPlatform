# DB4-AND-AOBL.md — the DB4 form, the PMS interfaces, and whether AoB should just be a signing tool
### v1.0 · 14 September 2026 · Owner: Carl. Nothing in here is built. Companion to `PMS_to_AoB_Workflow.md` (input cases), `INTEGRATION-MODES.md` (who supplies what), `GA-PLAN.md` B12/B13 (AoBPrinterApp).

Carl, 14 September 2026, with a scanned DB4 from the test practice:

> *"Read the attached photo for a db4 form and create a json file format of its
> contents... Give me a plan for each [signing option]. What is the best option
> from an audit perspective?... we need to create a print driver called
> AOBPRINTER... we need api designs and plan and approach... An alternative to
> the solution we have been building this far is to create AOBLight or AOBL...
> I learned today that when the government does the audit they come to the
> practice and audit the practice clinical system. The government will not look
> at what AOB has. Hence, not sure why we need to track patient, practitioner,
> locations and so on... Your thoughts claude?"*

**The names used in this document** (Carl, 14 September 2026: *"use proper
names... do not use generic terms"*). Each is in `.claude/docs/glossary.md` §7.

| Name | What it is |
|---|---|
| **PracSoft DB4** | The form PracSoft prints — the scanned page. The practice's document, not ours |
| **DB4 Print Record** | The JSON AOBPRINTER emits from that page (`DB4-print.example.json`) |
| **Assignment Agreement** | Our rendered agreement, built from validated particulars, shown to the patient on the tablet. Unsigned until they sign it |
| **Signed Assignment Agreement** | The general term: any of our agreements once signed — hashed, held in the Evidence Vault, written back byte for byte |
| **Signed-DB4** | Carl's name (14 Sep) for the post-service case: **our deterministic reproduction of the PracSoft DB4's layout**, rendered from the DB4 Print Record, with the patient's signature at the bottom. What the practice wants to see in the folder — one form, not two. See §12 for what that costs |
| **Write-back Manifest** | The small JSON beside the Signed Assignment Agreement in the patient's folder — reference, chart number, hash, when signed |
| **Evidence Vault** | The append-only store every event and every Signed Assignment Agreement goes into |

**The short answer is at the end (§9), and it is: the thing you learned today is
already the premise the product was built on, not a reason to abandon it.**
Everything before §9 is the working.

---

## 1. What the scanned form actually is, and four things on it that matter

The scan is a **DB4, "Printed From PracSoft3"**, citing *"the approved form as
prescribed under section 20A of the Health Insurance Act 1973"*. The test
practice runs **Medical Director for clinical and PracSoft for billing** — two
systems, not one, and your annotation *"single view of clinical + billing"* is
the integration problem in five words.

What it carries:

| Block | Fields |
|---|---|
| Header | Location ID `HSS06100`; Reference `HSS0610012092026120300`; Servicing Location name and address |
| Patient | **Medicare card number and IRN**; name; **`[Chart: 00680]`**; DOB; phone; address |
| Claim state | "This Bulk Bill claim has been: STORED FOR LATER TRANSMISSION" |
| Providers | **Servicing** Provider name + number (Dr Seng Phy, `5745385T`); **Payee** Provider name + number (Dr O. Alofivae-Doorbinnia, `0636678W`); ACRF; LSPN; Requesting/Referring provider, date, period |
| Services | Two rows: date/time, item number, description, **"Benefit Assigned" in dollars** |
| Assignment | Privacy notice; **two tick boxes joined by "or"**; patient signature; date |

**Four things on it collide with what we have built, and each needs a ruling
before any of §3 to §7 is buildable.**

### 1a. It carries the Medicare card number — and the printed form always will

Hard rule 1 says the Medicare number is not an **identity** identifier — never
used to verify who the patient is. Until 14 September the derived rule was that
we hold none at all. **Carl has since ruled that it is printed in full on the
Signed-DB4** (D-2026-09-14-03, §12b): the patient recognises it, and the
auditor uses it to link the form to a valid Medicare number. So it travels in
the DB4 Print Record and appears on the reproduction. What does NOT change: it
is never used to verify, find or match a patient, never in a log or an event,
and never sent to the rules service.

### 1b. It carries dollar amounts — and the prescribed form is allowed to

Hard rule 4 / REQ-REG-04: *"No benefit or dollar amount. The data set contains
no fee or benefit figure. Do not add."* The rule is about what **we** put on an
Assignment Agreement. The PracSoft DB4 is the government's form and it has a Benefit Assigned
column. So: **our render never carries it; a PMS document we keep as evidence
may.** Same consequence as 1a for option 3.

### 1c. Two tick boxes, "or" between them — and both are ticked

The first box assigns the benefit to the health professional who rendered the
service. The second **offers** to assign to an **Approved Pathology
Practitioner**. On the scan both are ticked.

**Pathology is out of scope for this product** — s 65C(4) items 1 to 4,
CLAUDE.md §8. Whatever we build for the DB4, **AoB does not capture, validate
or evidence the pathology assignment.** If a practice's workflow ticks both, the
second box is theirs and stays theirs. Your brief said "the patient must tick
both the boxes" — on the form as printed that is not what "or" means, and it is
worth asking the practice what they actually intend before we encode it.

### 1d. Is this the right VERSION of the form? Nobody can tell by eye

REQ-TEST-03 and the Departmental FAQ (B2): **DB4E and DB020 were updated and
are valid from 1 July 2026 — for post-assignment only — and "prior versions of
approved forms will no longer meet the requirements."**

The scan is titled "DB4", not "DB4E". It has no practitioner signature block
(good — abolished 1 July). Whether PracSoft3 is printing the updated form or the
old one **I cannot determine from the scan, and I must not guess** (CLAUDE.md:
never invent regulatory facts). The FAQ reconciliation says exactly why this
matters: *"the check a practice can't do by eye, and therefore exactly the check
worth offering."*

**This is the first question to put to the practice**, and it is also the first
argument against AOBL (§9): a signing tool signs whichever version it is given.

### 1e. Two providers, and we model one

Servicing provider (who rendered) and **payee provider (who is paid)** are
different people on this form. Our billing roles are `servicing_provider`,
`works_under_provider` and `not_billable` — nothing says "paid". Your entity
note is right and §8 takes it up.

---

## 2. The JSON — what AOBPRINTER emits

**Extend what exists rather than invent.** `POST /inbound/print-jobs` already
accepts a `PrintJobEnvelopeDto` with `documentType`, `sourceSha256`,
`parserTemplateVersion`, `pms`, `capturedAt` and arrays of patients, providers,
appointments and invoices. A DB4 is a fifth document type on that envelope, not
a second envelope.

**What the driver emits is what AoB may hold — nothing else.** The driver reads
the whole page and **discards at the practice** what we may never store. Fewer
places for it to exist beats redacting it later.

**Nothing printed on the form is discarded any more** (D-2026-09-14-03). The
Signed-DB4 reproduces the whole form, so the whole form travels — the Medicare
card number and IRN included. What is discarded is a different thing: the
number is never used for verification, lookup, matching, logging or events,
and never reaches the rules service.

**Carl, 14 September 2026, revised what travels:** *"add to the json the
'Benefit Claim' amount — according to the practice the patient needs to be
informed about the cost. Capture the privacy notice and the two tick boxes, in
case we need to make these dynamic in the future. Also capture the 4 Heading
lines. We need to print this on the page."*

So the amounts, the privacy notice, **both** tick boxes and the four heading
lines are now **carried as data from the PMS**. That is a different question
from whether any of them may be **rendered on the Signed Assignment Agreement**, and §2a
takes that up, because three of the four collide with a hard rule.

The example is in **`DB4-print.example.json`** beside this file. Shape:

```
documentType        "db4_assignment"
sourceSha256        hash of the print spool the driver saw — proof of what arrived
parserTemplateVersion "pracsoft3-db4-2026-09-1"   ← versioned content, hard rule 14
pms                 "pracsoft3"
capturedAt          ISO instant
heading.lines[]     the four heading lines as printed, in order
form
  formCode          "DB4"            ← as printed; version is DECIDED server-side (§1d), never asserted by the driver
  formReference     "HSS0610012092026120300"
  locationId        "HSS06100"
  claimStatus       "STORED FOR LATER TRANSMISSION"
  signedOnPaper     false            ← true if the driver can see a signature already on it
  serviceDate       "2026-09-12"
  currency          "AUD"
servicingLocation   name, addressLines, suburb, state, postcode
patient             pmsLinkageKey ("chart:00680"), patientRecordNumber "00680", medicareCardNumber, irn, names, DOB, address, mobile
providers[]         role "servicing" | "payee" | "requesting"; name; providerNumber; pmsProviderKey
services[]          serviceDate, time, mbsItemNumber, description, benefitAssigned  ← amount carried, see §2a
assignment
  privacyNotice[]   the five paragraphs as printed
  statementsJoinedBy "or"
  statements[]      key, text, ticked, inScope   ← both boxes; the pathology one is inScope:false
referral            requestingProviderNumber, dateOfRequest, periodOfReferral, acrf, lspn — all optional
```

Two design points that are not cosmetic:

- **`formReference` is the correlation key across every message about this
  form**, and — your annotation — the **filename** when the Signed Assignment Agreement goes
  back. `patientRecordNumber` (the Chart number) is the **folder**. §6.
- **The driver never asserts the form's validity or version.** It says "DB4, as
  printed". The server decides whether that is the post-1-July form, because
  that is regulated content that changes (§1d) and a driver installed on 200
  desktops cannot be re-shipped every time it does.

---

### 2a. Carried is not rendered — three collisions that need a ruling

Everything Carl asked for is now in the JSON. **Whether it may appear on the
page the patient signs is a different question**, and for three of the four it
runs into a hard rule. These are not mine to decide, and CLAUDE.md is explicit
that the brief wins over my judgement on a regulatory point *and* that I stop
and ask rather than silently fix. So:

| What Carl wants on the page | The rule it meets | What I can see either way |
|---|---|---|
| **The benefit amounts** — *"the patient needs to be informed about the cost"* | **Hard rule 4 / REQ-REG-04:** *"No benefit or dollar amount. The data set contains no fee or benefit figure. **Do not add.**"* The requirement names 89AA notices as the one place a benefit amount appears | The practice's concern is real and legitimate. Two ways to meet it without a dollar figure on the Signed Assignment Agreement: (a) show the amount **on the tablet screen before the ceremony**, as information, and keep it off the Signed Assignment Agreement; (b) the PMS's own DB4, which carries it, stays in the record as supporting evidence beside ours. **If Carl wants it ON the Signed Assignment Agreement, that is a change to a hard rule and needs a recorded decision with the requirement re-read** — not a JSON field |
| **Heading line 3** — *"This form is the approved form as prescribed under section 20A..."* | **Hard rule 12:** never generate "approved" or "government-approved" about **our** forms. Permitted: *"checked against the s 65C data set"*, *"self-assessment"* | The government may say its form is approved. **We may not say it of ours**, and our render is ours. Lines 1, 2 and 4 are fine to print. Line 3 on our page is the exact forbidden claim, and there is a lint rule planned to catch it (GA-PLAN C11). Suggest: print lines 1, 2 and 4; replace line 3 with the permitted wording |
| **Heading line 2 / the word "DB4"** | Same rule, softer | Our render is not the approved DB4E; it is our rendering of the same data set. Titling it "Bulk Bill Assignment of Benefit Form" is fine — that is what it is. Labelling it "DB4" implies it is the prescribed form. Worth a ruling |
| **Both tick boxes** | Pathology is out of scope (s 65C(4) items 1–4, CLAUDE.md §8) | Carry it: yes, done. **Render it on our page for the patient to tick: no**, because we would be capturing a pathology assignment we do not validate, store correctly, or write back as one. If the practice needs the pathology box signed, that stays on their paper DB4 |

**What is not in question:** the privacy notice, lines 1, 2 and 4, and the
first statement may all be rendered, and all four blocks should become
**versioned content** the day they are rendered (hard rule 14) — which is what
Carl's "in case we need to make these dynamic" already anticipates.

## 3. Three ways to get the patient's signature — and the audit verdict

| | 1. Our page, matching the PDF | 2. A PDF the patient ticks and signs on | 3. The PMS's own PDF, signed as-is |
|---|---|---|---|
| What is signed | **Our render**, from validated particulars | A PDF we generate | **PracSoft's document** |
| Hard rule 13 (one deterministic render, hashed, re-verified) | ✅ Already how it works | ⚠️ A second render path | ❌ We did not render it and cannot re-render it byte-identically |
| Hard rule 2 (locked and validated before signature) | ✅ The validator runs on the extracted set | ✅ If we generate from validated data | ❌ We sign whatever was printed. If PracSoft printed the old form, we have evidenced a defective agreement |
| Medicare number / amounts in the signed evidence | ✅ Never | ✅ Never, if we omit them | ❌ Both, permanently, in the vault |
| Form version risk (§1d) | ✅ We render the current content | ✅ Same | ❌ Whatever the PMS has |
| Familiarity for the practice | Looks like the DB4 they know | Looks like DocuSign | **Exactly** what they have today |
| Build | **Small**: a DB4-shaped template in the existing versioned template set, plus the tick controls | Medium: a PDF form-field flow the kiosk does not have | Small to build, **large to defend** |

**Verdict from an audit perspective: option 1, and it is not close.**

The auditor looks at the practice's record (§9). What they find there must be a
valid agreement: complete data set, correct form version, locked before it was
signed, no practitioner signature, no old wording. Options 1 and 2 guarantee
that because the signed thing was built from validated data. Option 3
guarantees only that a signature exists. **Option 3 is a fax machine with a
hash.**

Option 2 versus 1: 2 buys "looks like DocuSign", costs a second render path and
a PDF-form toolchain the kiosk does not have, and the patient experience on a
tablet is worse (pinch-zooming a PDF to find a tick box). Not worth it.

**What "matching the PDF" means in option 1.** A template in
`packages/domain/content/agreement-templates.json` whose sections mirror the
DB4's — parties, servicing location, services, the assignment statement, the
tick — so a receptionist and a patient who know the paper form recognise it.
The tick boxes become **statements the assignor affirms** (the mechanism the
kiosk already has: every statement ticked or the signature is refused). Only
the first box exists on our page; §1c.

**One more thing option 1 gives you that the others cannot: a decision.** The
extracted DB4 goes through the rules engine. If PracSoft printed the old form,
or a field is missing, or the servicing provider cannot be found at that
location, the desk sees it *before* the patient signs — and hard rule 8 means
the patient is still seen and billed. That is the whole product, in one screen.

---

## 4. A local LLM to read the form in real time

**Not first, and not alone.**

A DB4 printed from PracSoft3 has a **fixed layout**. Every field is at a known
place and labelled. That is a **template parser** problem — positional and
regex extraction against a versioned template (`parserTemplateVersion`, already
in the envelope) — and a template parser is:

- deterministic (the same page always yields the same JSON, which an audit needs),
- testable with fixtures,
- fast enough to run inside the print spool,
- and it cannot hallucinate a field.

A local LLM is the right tool for the case the template does NOT cover: a scan
from a PMS we have no template for, or a photographed paper form. Use it
**second**, with three guards that are already the platform's rules:

1. **Every extracted field is confirmed by a person before anything is locked**
   (W3, `extracted_elements_are_never_locked_without_staff_confirmation`). An
   LLM proposes; reception confirms.
2. **Confidence below a threshold shows as blank, never as a guess.**
3. **The field list is closed**: the six approved identifiers plus the
   agreement particulars. The model is never asked for, and never given a slot
   for, a Medicare number or an amount (`extractor_never_captures_a_medicare_number`).

*"If we do not have all the data, we do not proceed with the approval"* — that
is hard rule 2 and it is already how the lock works. Nothing new is needed for
it; the rules engine refuses an incomplete set and the tablet cannot be sent.

Running a model **inside the practice** (on the reception PC) is a real cost:
memory, a runtime to install and update, and a support surface on 200 desktops.
Running it **in our cloud** means the page image leaves the practice, which is
fine for our render but means the Medicare number on a PMS page transits our
infrastructure before redaction. The template parser at the practice avoids
both. Decide the LLM when a second PMS forces it, not before.

---

## 5. AOBPRINTER, and how the JSON reaches AoB

**AOBPRINTER is GA-PLAN B12, AoBPrinterApp**, already scoped at 3–4 days in a
separate codebase, waiting on "which write-back path" (A1). Your description
matches it exactly: a virtual printer, local parse to JSON, and a lane to us.

The receiving end exists: `POST /inbound/print-jobs` accepts the envelope,
practice-scoped, answers 202. The sending end does not.

### 5a. Three ways the JSON gets to us

| | How | Verdict |
|---|---|---|
| **1. Reception drags and drops** | The file lands in a folder; reception uploads it on `/practice/...`. `PMS_to_AoB_Workflow.md` W5 | **The fallback**, not the path. It is what you do when the connector is down (hard rule 8) or when a practice will not install anything. Build it, because every mode needs it (`INTEGRATION-MODES.md` §1a) |
| **2. A desktop watcher** pushes new files | The driver writes JSON to a folder; a watcher posts it | Works, but it is **two processes to install, monitor and update** where one would do |
| **3. The driver posts directly** | The print driver is already a program running at the moment the page is printed. It parses and **POSTs the envelope itself**, with a local outbox for when we are unreachable | **This.** One install, one thing to keep alive, and the outbox gives you the watcher's resilience without the watcher |

Option 3 collapses your options 1 and 2 into one installed program: AOBPRINTER = driver +
parser + outbox. The outbox is a folder on disk, so if the practice ever wants
to *see* what was sent, or drag one in by hand, it is there.

**Mutual TLS, outbound only, per-practice credential, revocable from the
console** — the same posture `aob-tech-stack.md` already gives the Medtech
connector. The driver is a connector; it just gets its data from a print spool
instead of an API.

---

## 6. Getting the Signed Assignment Agreement back into the PMS

### 6a. Which folder — your annotation is right, with one correction

The PMS keeps a document folder per patient, outside the database (*"DB 12GB,
doc outside DB"*). Your annotation on the scan: *"use this [reference] for
filename for folder structure"*.

- **Folder = `patientRecordNumber`** — the Chart number, `00680`. It is the
  practice's own key, it is on every form, and it is what the PMS's folder is
  named for.
- **Filename = `formReference`** — `HSS0610012092026120300`. One per form, so
  a patient with three assignments in a year has three files that never
  collide, and the reference ties the file back to the PracSoft claim.

So: `<documents>/00680/HSS0610012092026120300.pdf` and beside it
`HSS0610012092026120300.json` — the manifest (§7, 3b).

**The correction:** the Chart number must be *confirmed* to be the folder name
at this practice, not assumed. PMS installations differ, and the day the folder
turns out to be named for something else is the day fifty signed consents land
in the wrong place. One question to the practice, recorded as a per-practice
setting.

### 6b. Three ways the file gets there

| | How | Verdict |
|---|---|---|
| **1. The desktop app pulls** | AOBPRINTER polls (or is pinged) for Signed Assignment Agreements and drops them into the folder | **This.** It is GA-PLAN **B13**, "import-folder write-back in the desktop app", already scoped at a day, and it is the same installed thing as §5. Pull, not push: an outbound-only client needs no inbound port on a practice PC |
| **2. Email to the practice, and an AI agent files it** | We email the PDF; an agent watches the inbox, reads sender and attachment, files it | **No**, and §6c says why at length |
| **3. Other** | Write straight to the PMS's document table — only if PracSoft documents it. A network share we write to over VPN — a support nightmare. Neither beats 1 |

### 6c. "Is this AI agent something we can sell?" — honestly, no

An inbox-watching agent that files attachments into patient folders is:

- **a generic robotic-process-automation product** with many incumbents, none
  of them ours to beat;
- **PHI over email**, the weakest channel we have, for a document whose whole
  value is evidential integrity;
- **a misfiling risk with no undo**: a signed consent filed into the wrong
  patient's folder is a privacy breach, and an "AI agent" that does it at scale
  does it at scale;
- and **unnecessary**, because 6b option 1 already puts the file exactly where
  it goes, from a process we control, with a hash on both ends.

If a practice genuinely cannot install anything, email the practice a **link**
to the Signed Assignment Agreement (the copy-link mechanism already exists, W6) and let a
person file it. Do not build the agent.

---

## 7. The six transactions, and the APIs

Your list, mapped onto what exists. Everything below is **practice-scoped,
idempotent, and answers synchronously** — the "b" of each pair is the HTTP
response, not a separate callback, because a connector's author needs to see
the platform disagree with them in the same breath (the arrival contract
already works this way).

| # | Direction | Transaction | Endpoint | State |
|---|---|---|---|---|
| **1a** | FROM PMS | All bookings for a day | `POST /inbound/print-jobs` with `documentType: "appointment_list"` and `appointments[]`; or `POST /pms/sync-appointments` | Envelope exists; `sync-appointments` exists against the mock |
| **1b** | TO PMS | Which were received | **The response to 1a**: `{ received: [...], refused: [{ key, reason }] }` per row | Pattern exists on `/arrivals` |
| **2a / 2b** | FROM / TO | One booking | Same endpoint, one entry | Same |
| **3a** | FROM PMS | One DB4 for approval | `POST /inbound/print-jobs` with `documentType: "db4_assignment"` and the §2 shape → creates the **arrival**, the **service record** (D5, D6b) and a **post-service agreement** through the existing pipeline | Envelope exists; the `db4_assignment` type and its handler do not |
| **3b** | TO PMS | The Signed Assignment Agreement back | `GET /inbound/print-jobs/signed?since=` lists what is ready; `GET /agreements/:id/artefact` (hash-verified, hard rule 13) plus the **Write-back Manifest** `{ formReference, patientRecordNumber, agreementId, signedAt, sha256, rendererVersion, formCode }`. AOBPRINTER pulls both and writes `<chart>/<reference>.pdf` + `.json` | The agreement download route exists for staff; the listing and the Write-back Manifest do not |

**Two rules that hold across all six:**

- **A resend of corrected data is not a retry** (D-2026-09-12-15). Same
  idempotency key means "you may not have heard me"; a new key naming the prior
  message means "what I told you was wrong". 3a inherits this from `/arrivals`.
- **Reception never chooses the agreement type and neither does the PMS.** The
  versioned visit policy does (hard rules 6 and 14). A DB4 arriving after the
  service decides `episodic_post` because a service record exists, not because
  the form says DB4.

**On "full automation": mode 3 in `INTEGRATION-MODES.md`.** 1a + 3a inbound,
3b outbound, and the connector is AOBPRINTER rather than an API — which means
**the D-01 blocker is answered for this practice by the print driver**, not by a
vendor. Worth recording as a decision when you are ready.

---

## 8. Entities

| Your entity | What exists | What is missing |
|---|---|---|
| **Patient** — add the practice patient id | `patientRecordNumber` exists and renders on both desks (12 Sep) | Nothing. Confirm it IS the folder name (§6a) |
| **Practitioner** — billing (paid) and other | `affiliations.billingRole` = servicing / works-under / not billable; `providerNumber` per practitioner-at-location | **Payee.** The form names who is *paid*, and that is a different person from who *rendered*. Add `payeeAffiliationId` on the **service record** (it is a property of the claim, not of the practitioner), defaulting to the servicing affiliation. Never on the Assignment Agreement — it names who rendered (D4) |
| **Invoice / claim** | `service_records` — `pmsInvoiceKey`, `serviceDate`, `mbsItemNumbers`. **This is the invoice table**; it is the thing a post-agreement is raised against | `formReference`, `claimStatus` ("STORED FOR LATER TRANSMISSION"), `payeeAffiliationId`, `locationId` (the `HSS06100`). **No amount column, ever** (hard rule 4) |
| **Form** | Nothing | A `pms_documents` row per ingested DB4: `formReference`, `formCode`, decided version, `sourceSha256`, `parserTemplateVersion`, the redacted copy of the PracSoft DB4, and which arrival and Assignment Agreement it produced. It is the audit trail from "what PracSoft printed" to the Signed Assignment Agreement |

---

## 9. AOBL — should AoB just be DocuSign for DB4s?

Your reasoning: *the auditor looks at the practice's clinical system, not at
AoB, so why track patients, practitioners and locations at all?*

### 9a. The premise is already the product's premise

I cannot verify the audit claim from anything I hold and will not pretend to
(CLAUDE.md: never invent regulatory facts). But it does not need verifying to
answer the question, because **the requirements were written on exactly that
assumption**:

> *"Write the signed agreement artefact **into the patient record**, so the
> compliance evidence lives **where an auditor looks**."* — `aob-requirements.md`
> line 306
>
> *"**Write-back is the product.** If the artefact cannot land in the PMS
> patient record, this is a form, not a compliance product."* — REQ-INT-02

So "the government looks at the practice's system" is not news to the design.
It is *why* write-back exists, why D-01 is the top blocker, and why AOBPRINTER
matters. **It does not distinguish AoB from AOBL — both have to get the
document into the PMS.** The question is only what the document is.

### 9b. What the auditor looks *at* versus what they look *for*

They look at the practice's record. What they look **for** is a **valid**
agreement: the complete s 65C data set, the post-1-July form, particulars fixed
before the signature (signing a draft is the criminal offence in this regime —
hard rule 2), no practitioner signature, a verifiable assignor. The practice is
the party that loses the benefit when the record fails.

**A signing tool signs whatever it is given.** If PracSoft is still printing the
pre-1-July DB4 (§1d), AOBL evidences a defective agreement beautifully, with a
hash, and files it in the right folder. The auditor finds a perfectly preserved
invalid form. Every element of the complexity you are questioning exists to
stop that: the versioned rule set, the locked particulars, the location and
provider on the record, the identity check.

### 9c. What AOBL would keep, and what it would lose

**What you would still need**, even for "just sign it":

| Kept | Why AOBL cannot drop it |
|---|---|
| Practice, and its locations | D4 is name **and place of practice**. The location is on the form and the folder is at a site |
| Practitioner, with servicing and payee numbers | On the form; the folder path and the claim depend on it |
| Patient record number | The folder name |
| The Signed Assignment Agreement, its hash, the signature event, the Evidence Vault | Or it is not evidence |
| Write-back to the PMS | The premise |

That is most of the schema. **The things AOBL drops are the things that make the
signature mean something:**

| Dropped | What you lose | Impact |
|---|---|---|
| **Identity verification** (REQ-VER) | Proof of *who* tapped the screen | A tap on an iPad proves a tap. The evidential weakness is exactly where an audit bites: "who signed this?" |
| **The rules engine and versioned rule sets** | Knowing the form is valid *before* it is signed | Regulatory whipsaw is the top project risk — the rules changed twice and reversed once, eight days before go-live, and cost a competitor about a million dollars. Versioning is the defence. AOBL has nothing to version; it is on the wrong form until PracSoft ships an update |
| **Pre-agreements and ongoing agreements** | Half the regime | DB4E is valid for **post**-assignment only (FAQ B2). A DB4 signing tool cannot do a pre-visit agreement or an ongoing one. It is the post-service half — the half where the patient has already left and 15–20% do not respond |
| **Reconciliation** (REQ-REC) | The outstanding list, the chase, the status per agreement | *"Not an afterthought — it is where the customer's pain actually lives"* (`aob-requirements.md` §REQ-REC). AOBL has no queue, so the practice keeps its spreadsheet |
| **The Conformance Statement** (REQ-65C-05) | *"The artefact a practice manager hands to an auditor"* | Cannot exist if we do not know what we validated |
| **The kiosk's own rules** | No staff entry on the patient surface; assignor rules; the 14+ self-assign; staff hard-blocked as assignors | AOBL is a tablet that shows a PDF |

### 9d. What AOBL actually is

**AOBL is case 2 of `PMS_to_AoB_Workflow.md` — PDF ingest — with the validator
switched off.** It is not a different product. It is a subset of the pipeline
we already designed, minus the step that gives the signature its value.

So the honest recommendation:

1. **Build the DB4 ingest path.** It is needed anyway (case 2, mode 2/3, this
   practice). DB4 Print Record in, Assignment Agreement on the tablet, Signed Assignment Agreement back to
   the folder. That IS the "sign a DB4 and file it" product the practice thinks
   it wants.
2. **Do not switch the validator off.** Run it, show the result on the desk,
   and — hard rule 8 — never block the signature or the billing on it. The
   practice signs anyway if they choose; they just *see* that the form is the
   old version, or that a field is missing. That is one screen of difference
   between AOBL and AoB, and it is the screen that keeps the practice out of
   trouble.
3. **If you want a cheaper tier to sell, sell the same pipeline with fewer
   features on** — no portal, no reconciliation, no pre-agreements. Never fork
   the product to remove validation. A tier is a price; a fork is two codebases.

### 9e. Where you are right

Two things in your note are correct and should change what gets built next:

- **The practice thinks in forms, folders and printing.** The DB4 path meets
  them where they are, and it should ship before the abstract "arrival" story
  is sold to anyone on PracSoft. AOBPRINTER is the connector for this practice.
- **The data model has grown faster than the customer-visible product.** That is
  a sequencing problem, not a reason to shrink the model. §7 and §8 are small
  additions; the rest exists.

---

## 11. Telehealth

Carl, 14 September 2026: *"what the Practice does after the doctor has completed
a telehealth consultation is to print the DB4 and then put a manual stamp
'TELEHEALTH'... As the patient is not in the Practice, we need to send the DB4
form to the patient to sign digitally."*

**This is the remote-link channel, which already exists, applied to a
post-service agreement.** The requirements name telehealth as one of the three
reasons the remote channel exists — *"for patients who left without signing,
telehealth, and pre-appointment capture"* (`aob-requirements.md` §252) — and the
capture channels are already `in_practice`, `sms_link`, `email_link`, `portal`
and `paper`.

**The flow, end to end:**

1. The consultation happens by phone or video. PracSoft raises the invoice.
2. Reception prints the DB4 to AOBPRINTER as they do today. The rubber stamp
   becomes a field: the DB4 Print Record carries `deliveryMode: "telehealth"`.
   (The MBS items themselves also say so, and the rules engine may cross-check
   the two — but the stamp is what the practice does, so it is what we carry.)
3. AoB drafts the post-service agreement and renders the **Signed-DB4 layout,
   unsigned**, exactly as it would for a patient in the room.
4. Instead of a tablet push, reception sends a **remote link** by SMS or email
   — **to the contact already on the patient's record, never one typed at the
   desk** (D-2026-09-11-03). The message is a link, never an attachment.
5. The patient opens the link, **verifies with three approved identifiers**
   (REQ-VER — the same floor as the kiosk, and the reason a link is not a
   loophole), reads the form, ticks the assignment statement, signs.
6. The Signed-DB4 is hashed, vaulted, and pulled back by AOBPRINTER into the
   patient's folder, stamped TELEHEALTH because the form says so — no rubber
   stamp.

**What is different from the in-room case, and it is only three things:** the
channel (link, not tablet), the identity check (typed identifiers, not
staff-verified at the desk), and the chase (a link may not be opened — the
reconciliation queue and the chase bands already handle that, and 15–20% not
responding is the design assumption). Everything else is the same pipeline.

**The one thing to decide:** whether a telehealth patient may ALSO be sent a
**pre-agreement** before the consultation. It is legal (§11a) and it captures
consent before the service, so there is nothing to chase afterwards. But the
practice does not use pre-agreements (§11a), and a pre-agreement is not a DB4 —
it is our own instrument. Offer it; do not assume it.

### 11a. The pre-consult form — what the rules actually say

Carl: *"please check the gov rules re the pre-consult form. According to Powell
St Practice, they do not use the pre-consult form."*

**From the requirements, not from memory:**

- s 65C(4) defines **two** episodic agreement types for ordinary MBS services:
  **item 5, the pre-agreement**, and **item 6, the post-agreement**
  (`aob-requirements.md` §18, REQ-REG-01 D3). Both are valid. **Nothing in the
  requirements makes the pre-agreement mandatory.** A practice may operate
  post-only.
- **The DB4E is valid for post-assignment only** (FAQ B2, REQ-TEST-03). So there
  is no government-printed form for a pre-agreement at all. A practice that
  lives on printed DB4s is, by construction, a post-only practice — which is
  exactly what Powell Street describes.
- A pre-agreement carries D6a, the Basic Service Description, and is tested by
  **containment**: if the service actually rendered falls inside the
  description the agreement stands; if it falls outside, a post-agreement is
  needed anyway (§75). And if the rendering practitioner differs from the one
  named, the same (REQ-SCOPE-03).

**So Powell Street is not breaking a rule.** What post-only costs them is
operational, not legal: **every consent is captured after the patient has
gone**, which is the chase, and the chase is *"where the customer's pain
actually lives"* (REQ-REC). The pre-agreement's whole value is that the patient
signs in the waiting room while they are standing there. That is a sale to
make, not a compliance finding.

## 12. The Signed-DB4 requirement — one form, the cost on it, the signature on it

Carl, 14 September 2026, from the practice:

> *"The Practice wants to see the exact same DB4 form with the patient's
> signature at the bottom. They do not want two forms in the document folder. So
> we need to print the cost on the form and print it out in the Signed-DB4. The
> patient's signature must be in the Signed-DB4."*

**This reverses D-2026-09-14-01 within the hour, and that is fine — the
register exists for exactly this.** It was made on my understanding of the
practice's concern; the practice has now said what it actually wants. Recorded
as D-2026-09-14-02.

**It is also the requirement that decides how much of the model survives**, so
it gets the careful treatment.

### 12a. The design move that keeps most of the rules: reproduce, do not sign their bytes

"The exact same DB4 form" can mean two things:

| Reading | What it means for us |
|---|---|
| **PracSoft's PDF bytes, with a signature stamped on** | Option 3 from §3. We sign a document we did not render, cannot re-render, and cannot verify against a hash of our own. Hard rule 13 gone, and every word PracSoft prints — right or wrong version — is what we evidence |
| **A form that looks identical, rendered by us from the DB4 Print Record** | Our deterministic render path draws the DB4's layout — same headings, same boxes, same rows, same amounts — from the data the driver captured, adds the signature block, hashes it. Hard rule 13 intact. The practice cannot tell the difference and does not need to |

**The second reading is the design.** It is what §3 option 1 always was, with
the template shaped to the DB4 pixel for pixel rather than "DB4-like". The
Signed-DB4 is **ours**, which is the only reason we can stand behind it.

It also removes something: **we no longer need to keep a redacted copy of the
PracSoft DB4 at all.** The DB4 Print Record plus `sourceSha256` is the
provenance. One form in the folder, one form in the Evidence Vault.

### 12b. The four hard rules it touches, honestly

| Rule | What the Signed-DB4 needs | What it costs, and my recommendation |
|---|---|---|
| **4 — no benefit or dollar amount** | The amounts printed on the form | **REQ-REG-04 says "not required — do not add", and names the risk as ours adding a figure.** It is not a statutory prohibition: the government's own approved form prints the amount. So **narrow the rule rather than delete it: AoB never originates or computes an amount; it may reproduce, verbatim, the amount the practice's billing software printed on its own DB4.** The figure is PracSoft's claim, carried in the DB4 Print Record, and any dispute about it is a dispute with the claim, not with us |
| **1 — the Medicare number is not an identifier** | The exact DB4 prints the Medicare card number and IRN | **Decided: printed in full** (D-2026-09-14-03). Carl: the patient recognises and validates it, and the auditor needs it to link the form to a valid Medicare number. **The rule itself does not move** — it was always about *identity*: the number is never used to verify who the patient is, never to find or match a patient, never in a log or an event, never sent to the rules service. What moves is the derived posture "we hold none": the Evidence Vault now holds Medicare numbers inside every Signed-DB4, so the threat model gets a section for it (TODO) and the number is treated as the high-value identifier it is — encrypted at rest as everything in the vault already is, mTLS in transit from AOBPRINTER, and never in a column that can be searched |
| **12 — never say "approved" of our forms** | Heading line 3 reproduced verbatim | The line is the government's statement about the government's form, reproduced on a reproduction of that form. **Keep it verbatim** — altering the DB4's own words would be the stranger act — and add one provenance line in the footer: *"Rendered by AoBPlatform from the practice's billing record, [date]."* So no reader can take the heading as a claim about us |
| **13 — one deterministic render path** | Untouched, by §12a | **Intact.** This is the rule that makes the Signed-DB4 evidence rather than a photocopy |

**And §1d does not go away.** If PracSoft prints the pre-1-July DB4, our
faithful reproduction is a faithful reproduction of an invalid form. The
validator still runs on the **data** — patient, provider, place, service,
items, dates — and still refuses to send an incomplete set. What it cannot fix
is the form version the practice's software chose. That remains the first
question for the practice.

### 12c. What survives of the model — the AOBL question, revisited

Nothing in §9 changes. The Signed-DB4 needs the patient (folder), the
practitioner and payee (on the form), the location (on the form), the service
record (the rows), the render path, the hash, the signature event, the Evidence
Vault and the write-back. It drops nothing. It only changes what the template
looks like.

## 10. What to decide, in order

0. **The Signed-DB4 rulings, §12b.** The amount: **D-2026-09-14-01 is
   reversed by D-2026-09-14-02** — printed on the Signed-DB4, reproduced
   verbatim from PracSoft, never computed by us. **The Medicare number: printed
   in full on the FORM, D-2026-09-14-03; MASKED on the TABLET,
   D-2026-09-27-01 part 3.** **The pathology box: RULED by D-2026-09-14-02 —
   it stays on the practice's paper, is carried as data and is NOT drawn on the
   page the patient signs.** (This entry said "not yet ruled" until 27 Sep 2026
   and a build brief believed it over `DECISIONS.md`, which produced a renderer
   that drew the box. Two documents disagreeing is what caused it.) Still
   recommended and not yet ruled: only the wording of the provenance footer
   that keeps the "approved form" heading verbatim without our claiming it
   (hard rule 12) — a default now ships in
   `packages/domain/content/signed-db4.json`, so changing it is a content edit.
0a. **Telehealth** (§11): confirm the remote link to the contact on record is
   the flow, and whether a pre-agreement is to be offered before the
   consultation at all, given the practice is post-only (§11a).
0b. **The tablet rulings, 27 September 2026 — RULED, D-2026-09-27-01.** The
   patient reads their own DB4 on the tablet, laid out as the form, **with the
   cost on it**, reproduced verbatim from PracSoft. This restores the intent of
   D-2026-09-14-01 (the patient must be informed of the cost), which -02
   reversed as to the *artefact* and never ruled on as to the *screen* — so the
   requirement sat in the gap between two records for thirteen days and was
   never built. **The Medicare card number is masked there and printed in full
   on the form**: a sheet of paper goes to one person, a tablet is held up in a
   waiting room. **DocuSign-style signing on a rendered PDF was considered and
   refused** — hard rule 13, hard rule 2, WCAG 2.2 AA and the zero-footprint
   kiosk, each sufficient on its own; the reasoning is in the decision.
0c. **No second kiosk URL — RULED, D-2026-09-27-02.** A practice with no PMS
   gets the **`standard`** surface profile (every surface except `db4`), which
   is the gap `PRACTICE-SURFACES.md` §6b named on 17 September. The DB4 form
   view is additive: the discriminator is the SESSION, not the practice, because
   `Agreement.sourcePrintJobId` is nullable and a DB4 practice still has
   walk-ups.
1. **Is PracSoft3 printing the post-1-July DB4E?** Ask the practice. §1d.
2. **What do they mean by ticking both boxes?** §1c. Pathology is not ours.
3. **Is the Chart number the document folder name?** §6a. One question, one
   setting.
4. **Option 1 for signing** — confirm, since it is the recommendation.
5. **AOBPRINTER as driver + parser + outbox in one**, posting directly (§5a
   option 3), pulling the Signed Assignment Agreement back (§6b option 1). This answers
   D-01 for this practice.
6. **No email agent.** §6c.
7. **AOBL as a tier, not a fork**, with the validator on and non-blocking. §9d.

## 13. The build - first slice of AoB, feature-flagged, not started

Carl, 14 September 2026 (D-2026-09-14-04): *"build it as the first slice of
AoB, feature flagged... lets keep calling it AoB... leave everything in place -
do not change anything."* And: *"Let me know before starting any build."*

**Not started.** This section is the order and the shape, so that when it
starts it starts from a decision.

### 13a. The pieces, in the order that shows something soonest

| # | Piece | Why this position | What exists | New |
|---|---|---|---|---|
| 1 | **`db4_assignment` on `POST /inbound/print-jobs`** - the handler that turns a DB4 Print Record into an arrival, a service record and a post-service agreement | It is the visible thing, and it can be demonstrated **without AOBPRINTER** by posting `DB4-print.example.json` by hand | The envelope, the arrival pipeline, `service-rendered`, the visit policy | The document type and its handler |
| 2 | **The Signed-DB4 template** - the DB4's layout as a versioned template, rendered from the particulars, with the cost, the Medicare number, the first statement and the signature block | With 1, a patient can sign on the tablet the practice already has | The template set, the renderer, the kiosk ceremony | One template, one render fixture |
| 3 | **Telehealth** - the remote link on a post-service agreement, the `deliveryMode` field, TELEHEALTH printed on the form | Mostly exists; small | `sms_link` / `email_link`, `openLink`, `verifyLink`, contact-on-record | The field and the printed word |
| 4 | **The write-back pull** - the signed-list endpoint, the Write-back Manifest, and the folder drop | The practice sees the file appear in the chart folder | The hash-verified download route | The listing, the manifest, and the desktop half (GA-PLAN B13) |
| 5 | **AOBPRINTER** - driver, parser, outbox, posting directly | Last, because 1-4 work without it and it is a separate codebase (GA-PLAN B12) | The receiving endpoint | The whole desktop app |
| 6 | **The practice flag** - which surfaces a practice sees | Small, and it is what makes this a slice rather than a fork | `practices.channelsEnabled` is the precedent | One setting, read by navigation |

**What the practice sees when the flag is on and nothing else is:** setup,
tablets, the DB4 desk (the tablet desk filtered to DB4 agreements), and the day
register. No kiosk walk-up, no rails, no ongoing agreements, no portal, no
practitioner pages.

### 13b. Which model builds which piece - and the honest answer on Sonnet

Carl asked whether building on Sonnet is a lower-quality build, with 35% of the
week's allowance left and other work pending.

**It is lower quality on exactly two things, and neither is most of this
list.** Judgement calls where the brief is ambiguous, and regulatory reasoning
where a rule has to be held in mind across many files. It is not lower quality
on implementing a clearly specified endpoint, a template from a fixture, or
tests from a named list - and pieces 1, 2, 3 and 6 are all of those.

| Piece | Model | Why |
|---|---|---|
| 1, 2, 3, 6 | **Sonnet** | Tightly specified, reuse-heavy, named tests already listed |
| 4 | Sonnet | The server half is small; the desktop half waits for 5 |
| 5 AOBPRINTER | **Opus** | A new codebase, a parser that must be deterministic, an outbox that must never lose or duplicate a form - judgement, not transcription |
| **Every review that touches a hard rule** | **Opus** | Reviews are far cheaper than builds, and this is where rules 1, 2, 4, 12 and 13 get checked. Today's pattern (Opus build, Sonnet review) inverts to Sonnet build, Opus review |

**The mitigation that matters more than the model choice is the brief:** the
reuse inventory named, the hard rules restated, the named tests listed, and the
reviewer pass mandatory. A good brief on Sonnet beats a vague one on Opus.

**On the budget.** This is roughly two weeks of agent time across the six
pieces. It does not fit inside 35% of a week alongside other work. Pieces 1 and
2 together are the smallest demonstrable slice - a DB4 Print Record posted by
hand, a Signed-DB4 on the tablet - and are the right thing to start with when
the allowance allows. Nothing starts until Carl says so.

## Change log
| Date | Change |
|---|---|
| 14 Sep 2026 | v1.0. Written from the scanned PracSoft DB4 and Carl's nine questions, including whether AoB should become a signing-only tool. |
| 14 Sep 2026 | §2 revised at Carl's direction: the amounts, privacy notice, both tick boxes and the four heading lines now travel in the JSON. §2a added: carried is not rendered — the amount meets hard rule 4, the "approved form" line meets hard rule 12, the pathology box is out of scope. Rulings requested, recommendations given. |
| 14 Sep 2026 | §10 item 0: the amount ruling is answered (D-2026-09-14-01) — screen only. The Signed Assignment Agreement is defined there as the signed PDF/A that is written back, byte for byte. |
| 14 Sep 2026 | Proper names throughout (Carl): PracSoft DB4, DB4 Print Record, Assignment Agreement, Signed Assignment Agreement, Write-back Manifest, Evidence Vault. "Artefact" survives only inside quotations from the requirements and in code identifiers. |
| 14 Sep 2026 | §11 telehealth — the existing remote-link channel on a post-service agreement, the TELEHEALTH stamp becomes a field. §11a: the pre-agreement is not mandatory (s 65C(4) items 5 and 6 are both valid; DB4E is post-only), so Powell Street is post-only and legal; what it costs is the chase. §12: the practice wants the exact DB4 with the cost and the signature on it — D-2026-09-14-01 reversed; the design is to REPRODUCE the DB4 from the Print Record rather than sign PracSoft's bytes (rule 13 intact); rules 4, 1 and 12 addressed one by one, with the Medicare number the hard one. |
| 14 Sep 2026 | Carl: no masking. The Medicare number and IRN are printed in full on the Signed-DB4 and travel in the DB4 Print Record (D-2026-09-14-03). §1a, §2 and §12b updated; hard rule 1's identity meaning unchanged. |
| 14 Sep 2026 | Section 13: the build as the first feature-flagged slice of AoB (D-2026-09-14-04), six pieces in the order that shows something soonest, model per piece with the honest answer on Sonnet, and the budget note. Not started. |
| 27 Sep 2026 | §10 items 0b and 0c added: the patient reads the DB4 on the tablet with the cost on it, the Medicare number masked there and full on the form (D-2026-09-27-01); the no-PMS practice gets the `standard` profile and there is no second kiosk URL (D-2026-09-27-02). |
| 27 Sep 2026 | §10 item 0: the pathology box is recorded as RULED (D-2026-09-14-02), not open. It had said "not yet ruled" and a build brief believed it over DECISIONS.md. Only the footer wording remains open, and it now has a shipped default in versioned content. |

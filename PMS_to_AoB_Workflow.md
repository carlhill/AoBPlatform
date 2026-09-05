# PMS → AoBPlatform: how an agreement reaches the patient
### v0.1 · 5 September 2026 · Carl's five use cases, what is built, what is left. Owner: Carl.

## 0. The use cases, as stated (Carl, 5 Sep 2026)

> Our use cases regarding sending the enduring/episodic agreement to the patient are:
> 1. PMS sends the raw data elements and AoBPlatform formats the page and the email and pdf if the patient wants a pdf. This helps with audit extracts.
> 2. PMS sends a pdf and AoBPlatform has to show this pdf to the patient and get the patient to approve. The pdf is kept for 2 years (soft setting). AoBPlatform has to extract the data elements from the pdf to help run the AoBPlatform and provide audit data.
> 3. A mix of 1 and 2.
> 4. Practice-reception-user can manually type in the details required in AoB and AoB will create the page (using a template with the Practice Address, Contact details, ABN, Name, and logo, with templated text to be filled in with the data the Practice-reception-user enters) and the pdf. Supports audit extracts.
> 5. So you can see 1 and 4 are similar — AoB creates the letter, page, pdf.
> 6. For all of the above, if the API is not working, the Practice-reception-user should be able to drag and drop into AoB.

## 1. Thoughts — the one design point that decides everything

**There are two sources and one signed instrument.** Cases 1, 4 and the "raw elements" half of 3 give us *data*; cases 2, the "PDF" half of 3, and 6 give us a *document*. Either way, the thing the patient signs should be **our** rendered agreement, produced by the one deterministic render path (hard rule 13: server-side PDF/A, hashed at render, byte-identical on re-render), from data elements that the rules engine has validated and locked (hard rule 2: particulars complete and locked before signature — signing a draft is the offence in this regime).

That means a PMS-supplied PDF is **evidence and input, not the instrument**:
- We keep it, hashed, in the vault as a supporting artefact (it is what the practice's system produced, and an auditor may want it).
- We **extract** the data elements from it (the artefacts module already has `extract-text.ts` for exactly this), **show the extracted elements to reception for confirmation** (staff confirm; the patient never types — "nothing on the patient surface is staff entry"), validate them with the rules engine, lock, and render **our** agreement for the patient to check and sign.
- The patient may also be shown the PMS PDF ("the document your practice prepared"), but what they approve and what we hash-bind to their signature is our render. Two renders of the same agreement are byte-identical; a PMS PDF has no such guarantee, and we cannot prove what it contained the moment before signing unless we hash it — which we do, as evidence.

If Carl or the requirements say the PMS's own PDF *must* be the signed instrument, that is a change to hard rule 13 and ADR-level; it needs a recorded decision before anyone builds toward it (§5 Q1). The recommendation is not to: it makes audit extracts weaker (we would be extracting from a document we did not author) and makes "the same agreement, twice" unprovable.

**Cases 1 and 4 are the same pipeline with a different keyboard.** Case 1 is the arrival contract (`POST /arrivals`) — the PMS or its connector posts the elements. Case 4 is a reception user typing the same elements into a console form. Both end in the same draft → lock → render → capture. Case 4's "template with practice address, contact details, ABN, name and logo" is the **practice letterhead** the renderer needs anyway: today the renderer carries only the patient name (an open item since 4 Sep), so the letterhead and the full s 65C data set are one piece of work that serves every case.

**Case 6 is the manual adapter.** Behind the FR-9.1 adapter interface, "drag and drop into AoB" is a third adapter alongside the (future) Medtech adapter and the mock: a file arrives (PDF → case 2 pipeline; CSV/JSON of elements → case 1 pipeline), and everything downstream is identical. The GA plan already anticipates this shape as **AoBPrinterApp** (a virtual printer the practice "prints" the PMS document to, parsed locally, queued to us) — drag-and-drop is the zero-install version of the same idea and should share its parser and its outbox. Uploads are the one place this product accepts a file from a practice, so: size cap (MAX_ARTEFACT_BYTES, already enforced), type allow-list (PDF, CSV, JSON), malware scan before parse, encrypted at rest, and a hash recorded before anything reads it.

**"Kept for 2 years (soft setting)."** The PMS PDF is part of the agreement's evidence, so its life is the record's life: two years from the related claim date, then destroy or de-identify (the retention module). A practice setting may lengthen that (some practices keep longer) but must never shorten it below the statutory floor — a soft setting with a hard minimum, the same pattern as the identifier floor of three.

**D-01 still governs the PMS side.** Nothing here guesses Medtech's API. Cases 1–3 describe what arrives; how it arrives (Evolution pushes, our connector polls, a virtual printer, a watched import folder) is the D-01 answer, and every case above is built so that answer slots in behind the adapter without touching the pipeline.

## 2. The pipeline every case feeds

```
  source ──► elements ──► reception confirms (if extracted or typed) ──► rules validate ──► lock ──► render (ours) ──► capture (tablet / link / paper) ──► sign ──► vault ──► write-back
   1 PMS elements ─────────────────────────────────────────────────────┐
   2 PMS PDF ──► store+hash ──► extract ──► confirm ───────────────────┤
   3 both ──► store PDF; elements win, PDF cross-checks ───────────────┤
   4 reception types ──► confirm ──────────────────────────────────────┤
   6 drag-and-drop file ──► (PDF → 2) or (CSV/JSON → 1) ──────────────┘
```

## 3. What is built (as of 5 Sep 2026)

| Piece | State | Serves |
|---|---|---|
| Arrival contract `POST /arrivals`: elements in, patient found/updated, visit policy decides type, draft + request + lock with the practice default D6a | **Built** (4 Sep) | 1, 3, 6 (element files) |
| Versioned visit policy (enduring / episodic / none; GP-only; per provider) | **Built** | all |
| Rules validation + lock before signature; episodic complete; enduring branch awaiting Carl | **Built / gated** | all |
| Deterministic render to PDF/A, hashed, re-verified on display | **Built**, but the render carries **only the patient name** — the full s 65C data set and the practice letterhead are not on the page yet | 1, 3, 4 (weak until fixed) |
| Capture: tablet push, walk-up kiosk, remote link, post-service | **Built** | all |
| Signature capture (drawn + tap-to-approve), hash-bound | **Built** | all |
| Email/SMS templates for the remote link and the portal invitation; sandbox gateway | **Built** for those purposes; **no "here is your agreement" email/PDF-on-request flow yet** (case 1's "email and pdf if the patient wants a pdf") — though the portal's "View as signed (PDF)" already gives the patient the PDF | 1 |
| Artefact upload (base64 JSON, 20 MB cap), artefact store, hashing | **Built** | 2, 3, 6 |
| Text extraction from PDF (`artefacts/extract-text.ts`) | **Built**, used for evidence text today; **not wired to element extraction or a confirm screen** | 2, 3, 6 |
| Practice entity: legal name, ABN verified against the register (live since 4 Sep), address, contacts | **Built**; **no logo** | 4 |
| Reception work page and queue; inline Correct; default D6a control | **Built** | 4 (the natural home of the "type it in" form) |
| Retention module (two years from the related claim; destroy/de-identify) | **Built**; no per-practice "keep longer" setting | 2 |
| Medtech adapter | **Mock only** (D-01) | 1–3 |
| AoBPrinterApp (virtual printer, local parse, outbox) | **Not started** (GA-PLAN B12) | 2, 6 |
| Audit extract | **Planned** (GovAudit.md) — every case above feeds it because the elements always end up in our tables | all |

## 4. What is left to build

| # | Item | Serves | Est. | Notes |
|---|---|---|---|---|
| W1 | **Renderer carries the full s 65C data set + practice letterhead** (name, address, contacts, ABN, logo; templated body text from a versioned content file per agreement type) | 1, 3, 4 | 2 days + human review of the template text | Fixes the 4-Sep open item; the letterhead is a practice setting with a logo upload (image, size-capped, stored as an artefact) |
| W2 | **Case 4 — "New agreement" form on the work page / queue**: reception types the elements (patient found-or-created by record number; provider; visit) → the arrival pipeline. Reuses the arrival service with `source: 'reception'` | 4 | 1 day | The form IS an arrival typed by hand; one pipeline |
| W3 | **Case 2 — PDF ingest**: upload/receive PDF → store + hash as supporting artefact → `extract-text` → element extraction (per-element patterns, versioned content, confidence per field) → **reception confirm screen** (extracted values shown beside the PDF; every field confirmed or corrected by staff; nothing auto-accepted below a confidence threshold) → arrival pipeline. Patient sees our render; the PMS PDF is attached as evidence | 2, 3 | 3 days | Extraction is heuristic by nature — the confirm step is what makes it safe. Never extract or store a Medicare number even if the PDF has one (hard rule 1): the extractor's field list is the six approved identifiers + the agreement particulars, nothing else |
| W4 | **Case 3 — both**: elements win; the PDF's extracted elements cross-check them; a disagreement is shown to reception before lock | 3 | 0.5 day on top of W3 | |
| W5 | **Case 6 — drag-and-drop adapter**: a drop zone on the work page and the queue; PDF → W3, CSV/JSON → arrival; type allow-list, size cap, malware scan, hash-before-read; every drop is a vault event with who dropped what (hash), never content | 6 | 1.5 days | The manual FR-9.1 adapter. Shares its parser with AoBPrinterApp when that is built |
| W6 | **"Send me a copy" for the patient**: after signing, offer email/SMS with a link to the signed PDF (the portal already serves it); a printed copy at the desk | 1 | 0.5 day | REQ-PORT-02 copy-on-request, from the tablet's complete screen |
| W7 | **Supporting-artefact retention**: PMS PDFs and dropped files live as long as the agreement's record; a practice setting `keepEvidenceMonths` with a hard minimum equal to the statutory retention | 2 | 0.5 day | Soft above the floor, never below |
| W8 | **Medtech adapter** (real) | 1–3 | 2–4 days | After D-01 |
| W9 | **AoBPrinterApp** | 2, 6 | 3–4 days, separate codebase | After D-01 decides whether it is the write-back path too |

Roughly **9–10 agent-days** for W1–W7, which make all five cases work today with the mock adapter and manual/drag-and-drop input; W8–W9 wait on D-01.

## 4a. A seventh interface: email in (Carl, 5 Sep 2026)

> Another interface could be that the patient and key details are sent in the header or the body of an email to a specific email address — `<practiceid>.agreement@aobplatform.com.au` or something like this.

**Worth building, as the universal adapter.** Every PMS on the market can email a document or a letter, every practice already emails, and it needs nothing installed and no API that Medtech has to publish. It is the pragmatic fallback to D-01 and the zero-install cousin of the virtual printer: the practice "emails the agreement to AoB" instead of printing it to AoB. It also covers case 6 for a receptionist who would rather forward than drag.

**What it feeds.** Nothing new downstream. Structured elements in the body or an attached CSV/JSON → the arrival pipeline (case 1). A PDF attachment → the PDF-ingest pipeline (case 2: store + hash, extract, **reception confirms**, lock, render ours). A body that cannot be parsed → a reception task "we received a message for <patient?> we could not read" with the safe parts shown. Email never locks an agreement on its own; the confirm step is what makes an unauthenticated channel safe to accept from.

**The four things that make it safe rather than a hole:**

1. **The address is a secret, not the practice id.** `<practiceid>.agreement@…` is guessable by anyone who knows a practice is a customer. Use an opaque, rotatable local part shown in the practice console — `k7f3…@agreements.aobplatform.com.au` — one per practice, regenerable from the console, and never printed on anything public. The console shows "email agreements to this address" beside the tablet settings.
2. **Sender authentication, then an allow-list.** Accept only mail that passes DMARC alignment for the sending domain (SPF/DKIM), *and* whose sender is on the practice's allow-list (its own domain, its PMS vendor's sending domain). Anything else is dropped and counted — never bounced, because auto-replies to spoofed senders are how we would start spamming third parties. A per-practice HMAC in the subject line is available for PMSes that can be configured to add one; it upgrades a message from "confirm everything" to "pre-confirmed elements, staff still press Lock".
3. **The raw email is not evidence we keep.** A PMS letter will very likely carry the Medicare card number. We may not hold one (hard rule 1), so the parser drops it and the **original message is not retained** — we keep the hash of the original (proof of what arrived), the extracted-and-redacted elements, and a redacted copy of any PDF attachment as the supporting artefact. Named test: `email_ingest_never_stores_a_medicare_number`.
4. **Transport and residency.** Inbound via a mail-receiving service in ap-southeast-2 (e.g. SES inbound → S3 → queue → `POST /arrivals` with `source: 'email'`), TLS required for receiving (MTA-STS + TLS-RPT on our domain), messages encrypted at rest and deleted from the mail store once parsed. The practice's own mail system keeps a "sent" copy — that is their existing practice, not something we introduce, but the collection notice should say the channel exists.

**What it costs.** ~2 agent-days after W3 (it shares the extractor and the confirm screen) plus a day of infra (receiving domain, DMARC/MTA-STS, the queue). Add to the table as **W10 — email-in adapter**.

**What I would not do.** Put the practice id in the address; accept mail that fails DMARC; auto-lock from email; keep raw messages; or reply to unknown senders.

## 5. Decisions for Carl

| # | Question | Proposed |
|---|---|---|
| Q1 | Is the PMS's PDF ever the **signed instrument**, or always supporting evidence with our render being signed? | Always evidence; we sign our render (hard rule 13 stands). If the requirements say otherwise, record the decision first |
| Q2 | Extraction confidence: may any extracted field be accepted **without** reception confirming it? | No — every field is confirmed by staff before lock, always. Speed comes from pre-filling, not from skipping the check |
| Q3 | Which agreement elements does the letterhead template carry, and who reviews the templated body text? | The s 65C data set per type from `aob-requirements.md`; text reviewed by Carl/counsel; versioned content |
| Q4 | Logo: stored per practice as an image artefact, shown on the render and the portal? | Yes, size-capped, optional |
| Q5 | Drag-and-drop file types in v1 | PDF, CSV, JSON only |
| Q6 | The "2 years (soft)" for PMS PDFs — confirm it means "at least the statutory period, longer if the practice chooses" | Yes |
| Q8 | Email-in: opaque rotatable address + DMARC + allow-list, raw mail never retained (§4a)? | Yes; build after W3 |
| Q7 | Should the patient be shown the PMS PDF at all on the tablet, or only our render? | Only our render on the patient surface (one document to check); the PMS PDF is in the record and the audit extract |

## 6. Named tests the build must carry
`pms_pdf_is_evidence_not_the_signed_instrument` · `extracted_elements_are_never_locked_without_staff_confirmation` · `extractor_never_captures_a_medicare_number` · `typed_and_arrived_agreements_share_one_pipeline` · `dropped_file_is_hashed_before_it_is_read` · `drop_rejects_disallowed_types_and_oversize` · `evidence_retention_never_below_the_statutory_floor` · `render_carries_the_full_data_set_and_letterhead` · `two_renders_of_one_agreement_are_byte_identical` (exists; must stay green).

## Change log
| Version | Date | Change |
|---|---|---|
| 0.1 | 5 Sep 2026 | First pass from Carl's five use cases: built/left tables, pipeline, decisions Q1–Q7. |

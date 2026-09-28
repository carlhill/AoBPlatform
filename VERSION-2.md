# VERSION-2.md — what comes after GA

### Started 28 September 2026. Owner: Carl. Nothing in here is built, scoped or committed.

**What belongs here and what does not.** `TODO.md` is work the current product
needs. `GA-PLAN.md` is what stands between here and April 2027. This file is
for things that are only worth doing *after* that — market moves worth
answering, capabilities worth having, questions worth asking again when the
first customer is live. An item graduates out of here by becoming a
`DECISIONS.md` entry and a `TODO.md` item, or by being struck through with a
reason.

**Nothing here is a commitment and nothing here is a plan.** Each item says
what was observed, why it might matter to us, and what we would have to
believe for it to be worth doing.

---

## 1. Agentic admin in the consulting room — Heidi II (28 September 2026)

**Source:** *Heidi Health expands into AI admin agents to challenge legacy
rivals*, Australian Financial Review, 28 September 2026.
<https://www.afr.com/technology/heidi-health-expands-into-ai-admin-agents-to-challenge-legacy-rivals-20260928-p610fz>

Carl flagged it. Everything in this section is **what the article reports**,
not what we have verified.

### 1a. What it says

- Heidi Health is launching **Heidi II**, a suite of AI agents beyond its
  scribe. Named use cases: a summarised view of a clinician's day, **filling
  in authorisation forms**, finding medication information, and identifying
  patients due for blood tests.
- Co-founder **Thomas Kelly**: *"There's a zero per cent chance that a medical
  record system can build safe, efficient agents from a cost profile."* His
  argument is economic — PMS vendors sell fixed annual subscriptions, and
  token usage under an agentic feature is variable and can make that
  unprofitable. He compares PMS vendors to SaaS businesses like Canva.
- Heidi claims a cost advantage from **in-house specialised models** (a mental
  health one is named): better than off-the-shelf on quality, and cheaper.
- It is **exploring selling its model infrastructure to competing practice
  management systems**.
- It operates in 190 countries, and faces rivals with tighter PMS
  relationships — **Lyrebird Health has a partnership with Best Practice**,
  and Epic and Oracle Health have built scribes into their platforms.
- **Agents are blocked from autonomously prescribing, diagnosing or ordering
  investigations**, because those tasks would put the product inside the TGA's
  definition of a *medical device*, which requires TGA approval.
- **Digital Rights Watch** called for tighter guardrails on clinical AI,
  saying patients are *"treated like guinea pigs"*; policy head **Tom Sulston**
  wants providers forced to demonstrate accountability for product quality.
  Kelly's reply: tighter regulation would be a **defensive moat**, though it
  can stifle innovation.
- The **TGA** has been reviewing AI in medical device software, including
  Heidi's scribe. Its spokesperson says the framework is *"fit for purpose and
  sufficiently flexible"*.
- After the **OpenAI Medicare breach**, Kelly said Heidi's agents are unlikely
  to go rogue because they operate **within tight URL boundaries**.

### 1b. Why it matters to us, and the one line that matters most

**"Filling in authorisation forms" is the line to watch, and we should not
over-read it.** The article does not say *Medicare assignment of benefit*, and
an "authorisation form" in a scribe's world most plausibly means a prior
authorisation, a referral or an imaging request. But it is the first time a
company in this room has named form-filling as a product. The distance from
"we fill in your authorisation forms" to "we fill in your bulk-billing
consent" is short, and the thing that makes it short is that they already sit
in the consultation while we sit at the desk.

**What they would still not have.** Filling a form in is not capturing
consent. This product's whole subject is the part after the form: a validated
s 65C data set, particulars locked before signature (hard rule 2), one
deterministic render (13), a hash chain and an append-only vault (11), and a
signature bound to the page the assignor actually saw. An agent that
*populates* a DB4 makes our input better; it does not make the evidence.
**That is the position to hold and the sentence to say out loud** — including
in `marketing.md`, which does not say it today.

### 1c. Four things worth doing, none of them started

| # | Item | What we would have to believe |
|---|---|---|
| **1** | **Say plainly, in `marketing.md` and the practice-facing copy, what an AI scribe or admin agent cannot do about consent.** Not a swipe at anybody — a statement of where the evidence comes from. | That practices will ask "doesn't Heidi already do this", and a practice that hears no answer assumes the answer is yes |
| **2** | **Treat a form-filling agent as an INPUT, not a competitor: a documented way for one to hand us a completed DB4.** We already take a DB4 Print Record over `POST /inbound/print-jobs` from a print driver; a scribe posting the same envelope is the same door (`INTEGRATION-MODES.md` mode 3). | That the thing filling the form and the thing proving the consent are better as two products than one — which is exactly Kelly's own argument about PMSs, turned around |
| **3** | **Record why we sit OUTSIDE the TGA medical-device boundary, before somebody asks.** We do not prescribe, diagnose or order investigations, and clinical features of any kind are explicitly out of scope (`CLAUDE.md` §8). The reasoning is sound and written nowhere. | That an enterprise buyer or a practice's insurer asks, and "we just don't do that" is weaker than a page that says which definition we fall outside and why |
| **4** | **Read the accountability argument as a tailwind and check our copy against it.** Sulston wants providers accountable for product quality; hard rule 12 already forbids us from claiming "certified", "approved" or "accredited" and permits only "checked against the s 65C data set" and "self-assessment". A market that gets stricter about claims rewards that. | Nothing — this one costs a re-read of the string table and `practice_legals.md` |

### 1d. Two notes to self, filed rather than acted on

- **The cost argument cuts at us too, if we ever add an agent.** Kelly's point
  is that a fixed annual subscription cannot absorb variable token cost. We
  sell to practices on a subscription. Any agentic feature here needs its unit
  economics worked out *before* it is built, not after — and `cube.md` is
  where that would go.
- **"Tight URL boundaries" is a weak control and worth remembering as one.**
  It is an allowlist, not a proof; our own defence against an agent reaching
  something it should not is that the vault has no update or delete endpoint
  at all (hard rule 11, ADR A-02) and that the rules service holds zero PII.
  Structural beats configured. If a customer ever asks how we constrain an
  agent, that is the honest answer — and it is only honest while it stays true.

**What would change any of this:** Heidi naming assignment of benefit
explicitly; a PMS vendor bundling consent capture; or the TGA moving the
medical-device line in a way that touches evidence capture rather than
clinical decision support. The first two are commercial, the third is the one
to watch in `aob-requirements.md`'s regulatory review.

### 1e. How the Heidi pipeline is actually built (28 September 2026)

A second note from Carl, and it is more useful than the article because it is
about mechanism rather than positioning. **Its source is Gemini** — Carl said
so on 28 September 2026, correcting the "unattributed" note this paragraph
carried when it was first written. So it is a model's account of how a
competitor is built, not a sourced fact and not a leak: useful as a set of
claims to check, worthless as a citation. Nothing below should be repeated
outside this file as though we know it.

**The scribe pipeline, in four stages:** ambient voice-to-text and speaker
diarisation across 110+ languages on ordinary hardware; context-aware
processing that turns the transcript into clinical entities against a medical
vocabulary; template selection that formats to SOAP notes, specialty progress
notes or discharge summaries in the clinician's own style; and a feedback loop
where clinician edits refine accuracy.

**On the models — and this contradicts the AFR.** The article quotes Kelly on
*"its own in-house specialised models"*. This note says Heidi did **not** train
a foundation model from scratch: a hybrid multi-model approach over open-weights
and partner models (fine-tuned Llama-architecture), with the engineering spend
going on domain fine-tuning and a proprietary clinical layer — context
management, prompt orchestration, feedback loops, and safety and compliance
validation.

**Both can be true** ("our own specialised model" is a fair description of a
fine-tune), but the difference matters when judging the moat. A fine-tune plus
an orchestration layer is a real asset and a reproducible one; a trained
foundation model is not. If the cost argument in §1a is the pitch — *a PMS
cannot afford agents, we can* — then the thing making it cheap is the fine-tune
and the routing, and **that is buyable by anybody, including a PMS, including
us.** Worth resolving before anyone here treats their cost position as durable.

**The admin work it claims, and the one line that has moved:**

| What it does | How close it is to us |
|---|---|
| Referral letters, handover notes, discharge summaries, test requests, patient handouts | Not close. Clinical documents; out of scope for us (`CLAUDE.md` §8) |
| Task and follow-up management from what was said in the consult | Not close |
| EHR integration — writing structured notes and codes back without copy-paste | **Adjacent.** This is write-back, the thing we have just built one route for (D-2026-09-28-02). Different payload, same problem, and they will hit the same wall: nothing writes into a PMS that does not want to be written into |
| **Automated medical coding and billing — extracting clinical detail to suggest ICD/CPT codes** | **Closest, and closer than §1b judged from the article alone** |

**Why the coding line matters.** Suggesting billing codes from a consultation
is one step from suggesting **MBS item numbers**, and item numbers are **D6b** —
a post-agreement's own particulars, the thing C7 refuses a lock without, and
the field whose change supersedes an agreement rather than repointing it. An
agent that proposes item numbers is proposing a particular.

**It does not change the position in §1b; it sharpens it.** Proposing a
particular is still input. What the regime cares about is that the particulars
were **complete and locked before the signature** (hard rule 2), rendered
deterministically, and assented to — and that nothing edited them afterwards
(hard rule 11). If anything, an upstream agent makes our lock *more* valuable,
because now there is a machine in the chain and somebody will eventually ask
what it changed and when. **We can answer that. A scribe cannot.**

**One thing to steal, honestly.** The feedback loop — clinician edits refining
the model — has an exact analogue here that costs no AI at all: every time
reception corrects a field on a reprint, we learn that the parser template
misread that field. `parserTemplateVersion` is already on every job and every
receipt, and `db4ParticularsChanged` already names which kind of particular
moved. **A count of corrections per template version per field is a parser
quality signal we are already holding all the data for and not looking at.**
That is a small, unglamorous piece of work with a real payoff, and it is
nobody's idea of AI.

---

### 1f. Where a scribe could go next — the whole encounter, before and after (28 September 2026)

A third note from Carl, **also from Gemini** (see the attribution correction in
§1e). It is not reporting; it is a model's answer to *"what could Heidi
plausibly expand into to cover the full global health workflow"*. Treat it as
a plausible map of the adjacent space, not as anybody's roadmap.

**What it lists**, in its own three stages:

- **Before the encounter** — autonomous pre-charting (years of fragmented
  records across different EHRs summarised into a clinician executive summary
  before the patient walks in); **conversational AI intake and triage agents
  that screen the patient prior to arrival**, collecting the chief complaint
  and preliminary history and routing urgent cases; and **prior-authorisation
  automation**, drafting and submitting insurer forms from the clinical
  indications captured live.
- **At the point of care** — real-time guideline adherence, flagging missed
  screenings, protocol deviations and medication interactions; care-gap
  prompts during the visit (an overdue HbA1c, a mammogram, a blood-pressure
  follow-up); and **real-time speech translation** for multicultural
  practices.
- **After the encounter** — plain-language discharge plans and patient
  education pushed by SMS or portal; autonomous chronic-care and remote
  patient monitoring follow-ups that flag non-compliance or adverse symptoms;
  and referral routing with closed-loop communication back to primary care.

**The shape of the list is the finding.** Every item extends *the
consultation* — earlier, deeper, later. Not one of them produces evidence that
a patient agreed to something. The gap §1b named does not narrow anywhere on
this list; it just gets surrounded. That is worth saying plainly, because a
list this long reads like encroachment and mostly is not.

**Three lines on it that do touch us, in order of how much:**

#### 1. Pre-arrival intake is the closest thing on either note to our own lane

An agent that screens a patient before they arrive is sitting in **exactly the
slot our pre-visit lane occupies**. Adding *"and do you agree to bulk
billing?"* to a pre-arrival questionnaire is a product decision, not an
engineering one, and somebody will make it.

**And it cannot produce a valid per-service agreement, for a structural reason
rather than a competitive one.** Before the service happens the particulars do
not exist: the servicing provider may not be settled, the date of service has
not occurred, and the **item numbers are not known — D6b**. Hard rule 2 says
the particulars must be complete and locked before the signature, and signing
a draft is the criminal offence in this regime. A pre-arrival consent to bulk
billing is therefore either an **enduring agreement** — per practitioner ×
patient, GP-only (hard rule 6) — or it is nothing, whatever the screen said.

We already know this, which is why the pre-visit lane works the way it does.
It is worth having written down, because it is the answer to *"couldn't the
intake agent just ask them?"* and the answer is "yes, and what it collects is
not an assignment of benefit."

#### 2. "Prior authorisation" here means insurer forms — which sharpens §1b's caution

§1b warned against over-reading the AFR's *"filling in authorisation forms"*.
This list uses the phrase in its ordinary sense: **insurer prior
authorisation**, a US-shaped workflow with no Medicare assignment-of-benefit
analogue. That is evidence for the cautious reading, not against it.

**The risk is the vocabulary, not the product.** A practice manager who hears
"it fills in your authorisation forms" and thinks bulk-billing consent has
been handled is a real hazard to us and to them, and it is the same hazard
hard rule 12 protects against from our own side: never let a phrase imply a
compliance outcome that was not actually reached. §1c item 1 (say plainly what
a scribe cannot do about consent) is the mitigation and this makes it more
worth doing, not less.

#### 3. Real-time translation is adjacent, and the naive version breaks two hard rules

This is the one item on the list with a direct counterpart in our own
requirements: **REQ-LANG**. A patient signing a consent in a language they
cannot read is a consent problem, not a convenience problem, and we already
hold the prerequisite — every user-facing string in the string table
(REQ-LANG-01), nothing inline.

**But model translation at render time is not available to us.** Hard rule 13
says one deterministic render path, hashed at render, byte-identical twice.
Hard rule 14 says the content is versioned and every stored agreement records
which version it used. A probabilistic translation produced at the moment of
display satisfies neither: two renders could differ, and no version names what
the assignor actually read.

**So the shape is forced and it is worth recording now, before somebody
proposes the easy version.** Translated consent content is **versioned
content, human-reviewed, with its own version recorded on the agreement** —
the same treatment as the Basic Service Description mappings. A model may
*help produce* a translation in advance; it may never *be* the translation
path at render. The interesting question that leaves open is what we show when
a patient's language has no reviewed version: refusing to display is honest,
displaying English is the status quo, and displaying an unreviewed machine
translation is the one option that is not available.

#### And the rest, briefly

- **Pre-charting, guideline adherence, care gaps, RPM** — clinical, out of
  scope (`CLAUDE.md` §8), and the middle two are the closest anything on
  either note comes to the TGA medical-device line the article describes
  Heidi's agents as staying behind. §1c item 3 stands.
- **Post-encounter outreach by SMS or portal** — mechanically the same channel
  as our chase bands, and a reminder that whatever we build there obeys hard
  rule 7: an **89AA notice is never chased**, has no approval semantics, and
  never gates payment. An outreach engine that treats every outbound message
  as a nudge towards a response is the wrong engine for that one artefact.
- **Referral routing with closed-loop communication** — not our workflow, but
  the same shape as the collection lane built today: publish, let the far end
  take it, and only believe it landed when the far end says what it holds
  (D-2026-09-28-02). Worth noting only because everyone in this space is
  discovering the same thing about PMS integration at once.

**What would change this section:** any of these shipping with a *consent*
step attached, rather than a clinical or administrative one. The trigger to
watch is not "Heidi does intake" — it is "Heidi's intake asks about billing".

---

## 2. Claude's own suggestions (28 September 2026)

Carl asked for these. They are ideas, not recommendations, and each one says
what would have to be true. They come from having read this codebase rather
than from a list of things products generally have — which also means they are
biased towards what I happened to look at.

### 2a. Replay a refusal against a different rule set — the whipsaw tool

`CLAUDE.md` calls regulatory whipsaw the **top project risk**: the rules
changed twice and reversed once, eight days before go-live, costing a
competitor about a million dollars. Versioning is named as the defence, and
rule 14 makes every stored agreement record its `ruleSetVersion` and
`mappingVersion`.

**But versioning is currently a record, not a tool.** We can say which rules an
agreement was judged under. We cannot answer *"if the rules that land in March
had been in force in January, which of our stored agreements would have failed,
and which of our refusals would have passed?"* — which is the question a
practice, an insurer and our own roadmap all ask the week a change is
announced.

**What it is:** a dry run in the rules service — feed stored particulars
against a *named* rule set version, get a verdict, change nothing. The service
already holds zero PII and already hosts the public tester, so it is the right
home and the blast radius is nil.

**What we would have to believe:** that rule sets will change again before GA
(they will), and that "which of our existing agreements does this break" is
worth knowing before a customer asks rather than after.

### 2b. An evidence pack an auditor can check without us

The product's whole claim is non-repudiation: the eight-link chain, the
append-only vault, RFC 3161 anchoring. Today that is checkable **by us, on our
infrastructure, by someone with an account.**

**What it is:** a date range in, one archive out — the Signed Assignment
Agreements, their hashes, the relevant chain segment, the anchor receipts, and
a verification script the auditor can run offline. `GovAudit.md` is where this
belongs.

**Why it might be the most commercially useful thing on this list:** it is the
difference between *"trust our dashboard"* and *"here, check it yourself"*, and
it is the artefact that survives us being unavailable, acquired or switched
off. It is also exactly what hard rule 12 leaves us able to say: not
"certified", but "here is the evidence, verify it".

**What we would have to believe:** that an auditor or a practice's insurer will
actually ask. Worth one question to Powell Street.

### 2c. A public verification page, zero PII

`GET /verify` with a form reference and a hash: *"yes, this platform holds a
signed agreement with that hash, signed on that date"* — and nothing else. No
name, no chart number, no document.

It belongs in the **Rules & Conformance** service, which already holds zero PII
and is already public-facing. It is the smallest possible surface that makes a
third party able to check a claim, and it is the kind of thing that ends an
argument in one link.

**The risk to think about first:** a hash oracle is an enumeration surface.
Hashes are not guessable, so it is probably fine — but "probably fine" is how
`aob-threat-model.md` earns its keep, and this goes nowhere until that file has
an opinion.

### 2d. Turn `documentFolderKey` into a per-PMS profile

We shipped the collection lane today with exactly one allowed value,
`patient_record_number`, and a database CHECK that refuses anything else
(D-2026-09-28-03). That is right for one customer and does not survive the
second: Best Practice, Medical Director and Zedmed each have their own incoming
folder, naming convention and import quirks.

**What it is:** a versioned profile per PMS — folder key, filename pattern,
whether a manifest sibling is wanted or ignored, and what the PMS does with a
file it does not recognise. Content under `packages/domain/content/`, schema
validated at load, per the option-lists rule in `CLAUDE.md` §7c. **Not** a
free-text field on the practice.

**What we would have to believe:** that we sell to a second PMS. Which is the
whole plan.

### 2e. "What would an audit find" — the self-assessment, on a screen

Hard rule 12 forbids "certified" and permits **"self-assessment"**. We have
never built the self-assessment.

The data is already there and already unread: services with no agreement (the
reconciliation queue knows), agreements never written back (`writtenBackAt`,
which today nothing renders — see the outbox item in `TODO.md`), verbal
captures after 30 June 2027, agreements whose rule set is no longer current,
print jobs refused and never reprinted. **One page that is honest about the
gaps rather than reassuring about the total.**

**Why it is the right shape for this product specifically:** a compliance
product that only ever shows green is a product nobody believes. A page that
says *"eleven things need your attention"* is one a practice manager opens on
Monday.

### 2f. A parser-quality signal from corrections we already collect

Described in §1e above, and repeated here because it is the cheapest item on
this list. Count corrections per `parserTemplateVersion` per particular kind.
We hold every input already. No model, no agent, no token cost.

### 2g. Two things I would NOT do

- **An AI agent inside AoBPlatform, for now.** Kelly's unit-economics argument
  applies to us with more force, not less: we sell a subscription to practices
  and our volumes are per-service. And our differentiator is that the evidence
  chain is deterministic — a hard rule 13 render is byte-identical twice, which
  is a promise a model cannot make. Adding a probabilistic step to a
  non-repudiation product needs a much better reason than the market having
  one.
- **Anything that reads a consultation.** The moment we ingest clinical
  content we are in a different regulatory conversation (see §1c item 3, the
  TGA medical-device line), and `CLAUDE.md` §8 puts clinical features out of
  scope for reasons that have not changed.

---

## 3. The policy weather — where health funding is said to be going (28 September 2026)

**Source:** a fourth note from Carl, a model-written summary of government
health reform in Australia and abroad, ending in a table of what it means "for
platforms like Heidi". Carl asked for **my own analysis**, not a transcript, so
the note is summarised in one paragraph and the rest of this section is mine.

**What it claims, in short:** Australian reform (the National Health Reform
Agreement is named) is pushing to join state hospitals and federally funded
primary care into one patient journey; money is moving from acute care
towards prevention and chronic disease management; **outcome-based funding is
gaining ground over fee-for-service**; nurses, pharmacists and allied health
are being moved to "top of licence" practice to relieve GPs. Globally:
interoperability mandates, hospital-at-home and remote monitoring,
tighter medical-device regulation of clinical AI (TGA, FDA, EMA), and funding
for rural and telehealth access. Its conclusion is that scribes must become
"healthcare infrastructure" — population analytics, registry integration,
closed-loop referral, value-based metrics.

### 3a. How much weight to give it

**Less than its confidence suggests.** It is a model's synthesis with no
citations, and it has at least one tell: *"European NHS frameworks"* — the NHS
is the United Kingdom's, not Europe's, which suggests the sentence was
assembled rather than checked. None of its policy claims should be repeated
outside this file until someone has read the primary document, and per
`CLAUDE.md` §7c none of them becomes a requirement until
`aob-requirements.md` says so.

**And the honest headline for this product: none of it moves a single item in
`GA-PLAN.md`.** What gates our April 2027 GA is s 65C, the 1 July 2026 changes
and the 30 June 2027 verbal sunset — dated, legislated, already in the
requirements. Funding reform in Australia moves in agreements that take years
to negotiate and longer to change a claim. A note like this is exactly the
kind of thing that justifies scope creep, and it should not.

That said, four of its lines land on this product more specifically than the
note itself realises, and one of them is uncomfortable.

### 3b. The uncomfortable one: this product is built on fee-for-service

**An assignment of benefit exists because Medicare pays per service.** The
patient assigns *their benefit for a service* to the provider; that is the
whole regime, and a per-service agreement is our unit of work. If funding
really does shift towards outcome-based, blended or capitated payment, the
number of per-service assignments falls. It does not fall to zero — Medicare
will keep item-based billing alongside any blended model for a long time —
but the direction is not our friend, and nobody here should pretend
otherwise.

**The half of this product that is shaped for where the note says things are
going is the enduring agreement.** Look at what the schema already holds:
`myMedicareRegistered` on the patient and the practice, `enduringPathway`
with its three values (`mymedicare | residential_aged_care | accho_ams`), and
89AA post-claim notices that exist **only** on the MyMedicare pathway
(REQ-END-05). MyMedicare is enrolment — a patient attached to a practice and a
provider over time — and enrolment is the chassis every blended-funding model
in this country has been bolted onto. An enduring agreement is **one signature
per practitioner × patient** (hard rule 6), which is the shape of a
continuing relationship rather than a transaction.

**And that half is the half we cannot finish.** Enduring registration is
**D-11**: no portal and no API published by Services Australia, so the data is
kept registrable-shaped behind a feature flag and nothing speculative is built
(`CLAUDE.md` §5). That is correct for GA. The point for version 2 is narrower
and I think important: **if the funding direction in this note is even half
right, D-11 stops being a backlog blocker and becomes the roadmap.** The
per-service desk is what gets us through 30 June 2027; the enduring lane is
what we are still selling in 2030.

**What we would have to believe:** that MyMedicare keeps growing as the
attachment mechanism (the recall-campaign notes in
`.claude/docs/aob-practice-recall-campaigns_1.md` already treat telehealth
eligibility as tied to it). **What to do now, cheaply:** keep the enduring
lane honest — every rule 6 and rule 7 test green, the 89AA lane one-way — so
that when D-11 lands we are wiring a door, not redesigning a room.

### 3c. Telehealth and rural access meet the verbal sunset

This is the line with the sharpest consequence for us, and the note does not
see it because it is not thinking about consent.

**A telehealth service needs an assignment of benefit too, and it has no
desk, no kiosk and no paper.** Every channel we have is built around a
patient standing in a practice: the desk push, the kiosk tablet, the
AOBPRINTER print lane. The remote lanes are the patient portal and — **until
30 June 2027 — verbal capture**, which hard rule 5 disables automatically on
that date.

So a policy that funds more telehealth for rural and disadvantaged patients,
landing in the same year that the verbal fallback ends, produces a specific
problem: **a growing share of services where the only consent channel left is
a link on a phone**, used by exactly the cohorts with the worst connectivity,
the lowest digital literacy and the most languages other than English.

**What would have to be true for this to be worth doing before it becomes
urgent:** that telehealth is a material share of a first customer's bulk-billed
services. We do not know that for Powell Street. **It is one question to ask
them**, and the answer decides whether the portal lane is a fallback or a
primary channel by mid-2027. It also makes §1f item 3 (reviewed, versioned
translations, never machine translation at render) more than a nice-to-have:
equity cohorts are where a consent the assignor could not read is most likely.

### 3d. Top-of-licence practice widens the per-service lane, not the enduring one

If nurse practitioners, pharmacists and allied health increasingly deliver and
bill services, **the number of non-GP providers taking assignments goes up.**
Hard rule 6 keeps enduring agreements GP-only and offers specialists, allied
health and optometry Treatment Plan Assignment instead. So this shift grows
our **per-service** lane and our Treatment Plan lane, at providers we
currently think of as secondary.

**Two consequences worth holding:**

- **"Provider, not GP" (`CLAUDE.md` §3) was the right call** and this is the
  reason it will keep paying. Anything in the UI or the copy that quietly
  assumes the provider is a GP is a defect under this future, not a style
  point. A sweep of the string table for "GP", "doctor" and "consult" is cheap.
- **Pharmacy is a different PMS world** (dispensing systems, not clinical
  PMSs), and the print lane plus the folder profile in §2d are the parts of
  this product that travel there. The Medtech adapter does not.

### 3e. Interoperability mandates: good for D-01, and no reason to build FHIR

The note says governments are ending proprietary data silos. For us that is
the most **directly useful** line in it, for a reason the note would not guess.

**Our write-back problem is a silo problem.** D-01 is unresolved because
Medtech has not published a write-back mechanism; the collection lane built
today (D-2026-09-28-02) drops a PDF into a folder precisely because no PMS we
serve documents a document API. An interoperability mandate with teeth is
**the thing most likely to resolve D-01 for us** — and it tells us how to
treat what we just built:

- **The folder drop is a bridge, not the architecture.** Keep the FR-9.1
  adapter interface as the primary shape; keep `WriteBackService` able to
  write through an adapter for any practice without a `documentFolderKey`
  (which it already does). The day a PMS documents an import API, that
  practice moves lanes by clearing one column.
- **Interoperability for us means verifiable evidence, not a FHIR server.**
  FHIR is deferred and out of scope (`CLAUDE.md` §8) and this note is not a
  reason to reopen it. What a mandate-minded buyer actually needs from a
  consent product is to fetch the evidence and check it without trusting us —
  which is §2b (the offline evidence pack) and §2c (the zero-PII verification
  page). **Those are our interoperability story**, and they are much smaller.
- **My Health Record integration stays out.** Consent-to-bill evidence in a
  national clinical record is a privacy conversation we should not start, and
  nothing in the regime asks for it.

### 3f. Tighter AI regulation is a tailwind we have already earned

The note says regulators are bringing any AI that predicts, diagnoses or
assists clinical decisions under medical-device rules, while leaving
administrative workflow lighter. That confirms §1c item 3 and §2g, and adds
one thing: **the direction of travel is towards demanding evidence of what
software did, and evidence of what happened is the only thing this product
makes.** Hard rule 12 (never "certified"; say "checked against the s 65C data
set" and "self-assessment") ages well in that world. A deterministic,
hash-chained, append-only record is the kind of system a stricter regulator
likes to see next to a probabilistic one — which is also why §2g's advice
against adding an agent to this product gets *stronger* under this note, not
weaker.

### 3g. Where I disagree with the note's own conclusion

The note ends: platforms must grow from productivity tools into "healthcare
infrastructure" — population analytics, value-based metric tracking across
networks. **For a scribe, maybe. For us, no.**

Population analytics is clinical data, out of scope (`CLAUDE.md` §8) and a
different privacy regime. Value-based metrics are outcomes, which we never
see. The version of "infrastructure" this product can honestly become is
narrower and, I think, more defensible: **the place a practice, an auditor or
a regulator goes to prove what a patient agreed to, for any provider type,
through any channel, under whichever rule set was in force at the time.** That
is §2a (replay against a rule set), §2b (evidence without us), §2c (a public
check), §2e (an honest self-assessment) and §3b (the enduring lane) — all of
which are about proof, and none of which is about care.

### 3h. What to do with this section

| # | Item | Cost | What would have to be true |
|---|---|---|---|
| **1** | **Ask Powell Street what share of their bulk-billed services are telehealth**, and what they do today when the patient is not in the room | One question | That the answer is non-trivial — in which case the portal lane is a primary channel by 30 June 2027, not a fallback (§3c) |
| **2** | **Sweep the string table and practice copy for "GP", "doctor" and "consult"** where "provider" and "service" are meant | An hour | Nothing — this is hard rule terminology (`CLAUDE.md` §3) and it pays off under §3d regardless |
| **3** | **Write down, in `DECISIONS.md`, that the folder-drop lane is a bridge** and the adapter interface stays primary | A paragraph | That a PMS will eventually publish an import API — which is what every interoperability push is for (§3e) |
| **4** | **Re-read D-11's reopen conditions against MyMedicare's trajectory** once a quarter, rather than only when Services Australia publishes | A calendar entry | That the enduring lane is where this product's long-term volume lives (§3b) |

**What would change this section:** a funding change that is legislated
rather than described — a blended-payment model that alters how MBS items are
claimed, a MyMedicare expansion that changes the enduring pathway, or an
interoperability requirement that names practice software. Any one of those
belongs in `aob-requirements.md` first and here second.

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
about mechanism rather than positioning. **Unattributed** — treat it as a
briefing to be checked, not as sourced fact.

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


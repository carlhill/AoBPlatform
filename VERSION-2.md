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

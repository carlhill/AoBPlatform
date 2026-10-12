# PATIENT-WORKFLOW-PAGE.md — one page per patient: what stands, what today needs, what to do
### v1.0 · 11 September 2026 · Owner: Carl. A plan, not yet built. Companion to CLAUDE.md §2 (hard rules 1, 4, 6, 7, 8, 9, 12, 14), ASSIGNOR-RULES.md and DECISIONS.md.

Carl, 11 September 2026: *"we need a page for the practice to check if the
patient has an enduring approval or if the patient needs an episodic approval.
What I mean is, we want to have a workflow page per patient."*

---

## 1. The question, stated so it can be answered

Reception is looking at one person and wants to know whether anything has to be
signed before this visit is billable. Today they find that out by arriving the
patient and reading what the queue says back. This page answers it **before**
that, and for any practitioner rather than only the one on today's appointment.

## 2. The rule that shapes the whole page

**There is no practice-level answer.** An enduring agreement is per
practitioner × patient and general-practitioner only (hard rule 6,
REQ-END-01/-01a). A patient may have one with Dr Chen, none with Dr Okafor, and
with a specialist the question never arises at all — the offer there is a
Treatment Plan Assignment.

So the page must be **structurally incapable** of rendering a single "has an
enduring agreement: yes / no" badge. That badge is the most likely way to build
this wrong. It would be wrong the first day a second GP sees the patient, and it
is a statutory misstatement rather than a display bug.

**And it is per PRACTITIONER, never per affiliation.** The affiliation is the
practitioner × location edge. A GP working Tuesdays at one clinic and Thursdays
at another is one practitioner holding one agreement, not two.
`enduring.coverage()` already says this in as many words and already takes a
`practitionerId`. The page groups by the person.

## 3. The shape: three bands

**Band 1 — true of the patient, whoever they see.** Details confirmed or
disputed today, any open correction request, the identity verification state,
and **whether they have declined an ongoing agreement before**. That last one is
an input to the decision in band 2 and is the easiest of the four to forget. No
practitioner appears anywhere in this band.

**Band 2 — the spine: one line per practitioner this patient sees here.**

| Practitioner | What stands | What a visit today would need | What to do |
|---|---|---|---|
| Dr Chen (GP) | Enduring, in force since 4 Mar 2026 | Nothing — covered | Open the agreement · End it |
| Dr Okafor (GP) | Nothing standing | An episodic agreement | Send to a tablet · Offer an ongoing one |
| Dr Halim (specialist) | Not applicable — enduring is GP-only | An episodic agreement | Send to a tablet · Treatment Plan Assignment |

Every cell is a fact the platform already holds or already computes. None of
them is a judgement this page makes for itself.

**Band 3 — history.** What has been signed, superseded, terminated and sent,
newest first. The existing timeline, unchanged.

## 4. Where each fact comes from — reuse, never recompute

| Fact | Source | Why not re-derive it |
|---|---|---|
| "What a visit today would need" | `decideVisitAgreement()` in `packages/domain/src/visit-policy.ts` | It is a versioned rule TABLE (hard rule 14), it already runs at every arrival, and it returns the answer **plus the rule key and the policy version**. A second implementation on this page would drift from what the arrival decides, and the drift would stay invisible until an audit asked. |
| "What stands" | `enduring.coverage(practiceId, { patientId, practitionerId, at })` | Already the single definition of coverage, already per practitioner, already scoped by row-level security. |
| Whether the practitioner is a GP | `providerType === 'general_practitioner'` | One field on the provider record. |
| Practice offers enduring by default; patient declined before | The practice setting and the patient record | Both are already inputs to the same decision at arrival. |

The page **displays the reason key** the rule table returns, so editing the
content file changes what the page says without a deploy. That is the
regulatory-whipsaw defence working as designed, and it only works if nothing
here hardcodes a threshold or a mapping.

## 5. What must never appear on this page

1. A practice-wide or patient-wide enduring yes/no (§2).
2. Any benefit or dollar amount (hard rule 4).
3. The words "certified", "approved", "accredited", "government-approved" (hard rule 12).
4. A Medicare card number used as an identifier, anywhere, for anything (hard rule 1).
5. Identifier values in any log or event this page emits — types and outcomes only (hard rule 9).
6. Approval semantics on an 89AA notice, and no control that chases one (hard rule 7).
7. Anything that blocks a patient being seen or billed. This is a view; a failure in it slows evidence and never care (hard rule 8).
8. A claim that an agreement is registered with Services Australia. No portal or API is published (blocker D-11). That state is absent, shown as not yet available, behind the existing flag — never inferred from anything.

## 6. The endpoint

One read: `GET /patients/:id/workflow`, returning the three bands assembled on
the server, because every input above is already server-side and the decision
must not be reassembled in a browser. It is a new method on the existing
patients controller, beside `:id/timeline` and `:id/details`.

Row-level security scopes it like every other patient read, and a cross-practice
request finds nothing.

## 7. Named tests

- `enduring_is_never_answered_for_the_practice_only_for_a_practitioner` — two GPs, one covered and one not, and the payload carries no patient-level verdict at all.
- `a_gp_at_two_locations_is_one_line_not_two` — coverage is per practitioner, not per affiliation.
- `a_specialist_is_never_offered_an_enduring_agreement` — the Treatment Plan Assignment line instead (REQ-END-01a).
- `the_workflow_page_uses_the_same_decision_the_arrival_used` — the same patient and practitioner through `decideVisitAgreement` and through a real arrival give the same type and the same reason key.
- `the_page_reports_the_policy_version_it_decided_under` — hard rule 14.
- `a_declined_enduring_is_not_asked_for_again` — the patient-level input reaches the decision.
- `registration_with_services_australia_is_never_claimed` — blocker D-11.
- `workflow_page_across_a_practice_boundary_finds_nothing` — fails closed.
- `workflow_page_carries_no_identifier_values` — hard rule 9.

## 8. What this depends on, and what it does not

**Nothing blocks the build.** The rule table, the coverage function, the patient
work page, the timeline and the push path all exist. Most of band 1 and all of
band 3 are already on screen; what is genuinely new is band 2 and the endpoint
behind it.

**Two open questions change what band 2 SAYS**, and both are waiting on Carl
(TODO, "Waiting on Carl"):

- **Termination effective time** — start or end of day. It decides whether a
  patient who terminated this morning reads as covered for a visit this
  afternoon.
- **The enduring commencement element** — what makes an agreement in force, and
  from when.

The page can be built before these are settled, because "in force" resolves
through `enduring.coverage()` and the page inherits whatever that function is
later taught. It should not **ship to a real practice** with them open, because
the first column would be confidently wrong at exactly the edges that matter.

## 9. Phasing

1. **The read.** `GET /patients/:id/workflow`, the three bands, the named tests. No user interface yet, so the rules are settled before any pixels argue with them.
2. **The spine.** Band 2 added to `PatientWorkView`; bands 1 and 3 are largely there already and get rearranged around it.
3. **The actions.** Each line's controls wired to paths that already exist — push to a tablet, offer an ongoing agreement, end one, Treatment Plan Assignment. Every one a shortcut to the answer rather than a direction to a screen (CLAUDE.md §7).

## Change log
| Date | Change |
|---|---|
| 11 Sep 2026 | v1.0. Written when Carl asked for a per-patient workflow page. Not built. |

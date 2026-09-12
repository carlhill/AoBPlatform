# ARRIVAL-WHO-IS-SEEN.md — an arrival carries who the patient came to see, and who the claim goes under
### v1.0 · 12 September 2026 · Owner: Carl. Build specification. Companion to `PRACTITIONER-QUEUE-PAGE.md` §6a, `ROLES.md`, `VISIT-WORKFLOW.md`.

Carl, 12 September 2026: *"build the arrival change so nurses can be arrived. It
is not just nurses — even the phlebotomists can be arrived, if someone has just
come for a blood test or some other specimen test."*

---

## 1. The problem in one paragraph

An arrival names one practitioner, and that one field is doing two jobs: who the
patient came to see, and who the claim goes under. For a GP they are the same
person and nobody notices. For a nurse or a phlebotomist they are not, and
because only a `servicing_provider` may be named on an agreement, the arrival is
**refused** and reception substitutes the billable provider. The person the
patient actually came to see is discarded, so nothing can show a nurse their own
queue, and a patient who came only for a blood test cannot be arrived at all.

## 2. The two facts

| Fact | Field | Rule |
|---|---|---|
| **Who the patient came to see** | `Arrival.seeingAffiliationId` — NEW | Anybody the practice rosters. A nurse, a phlebotomist, a registrar, a GP. Never refused on billing grounds |
| **Who the claim goes under** | `Arrival.affiliationId` — unchanged | Still restricted to a `servicing_provider`. Still what the agreement is anchored on |

**`affiliationId` keeps its present meaning and every present use.** Agreements
anchor on it, the visit policy reads it, the desk queue joins on it. Changing
that would touch far more than this feature needs. The new field is additive.

Where the person seen may bill — the ordinary GP visit — both fields name them
and nothing about today's behaviour changes.

## 3. What happens for each billing role

`billingRole` is versioned content (`packages/domain/content/billing-roles.json`)
and already has exactly the three cases needed.

| Billing role | Example | Arrival | Agreement |
|---|---|---|---|
| `servicing_provider` | A GP, a specialist | Accepted. Both fields name them | As today |
| `works_under_provider` | A registrar, a nurse working under a GP | **Accepted**, `seeingAffiliationId` set. A billing provider is still required before an agreement can be drafted | Under the supervising provider, once named |
| `not_billable` | A phlebotomist taking bloods, a nurse doing a dressing with no claim | **Accepted**, `seeingAffiliationId` set, **no billing provider and no agreement** | None. The visit decision is `none` and that is a correct, complete answer |

**The third row is the one Carl's blood-test example needs, and it is the one to
get right.** A patient who came only for a specimen collection may generate no
claim at all. Today that person cannot be arrived. After this they can, they
appear on the phlebotomist's queue, and the platform correctly asks nothing of
them.

## 4. What must not change

1. **A nurse may never be the provider on an agreement.** `mayBeProviderOnAgreement`
   is unchanged and still consulted. This work makes the arrival richer; it does
   not widen who may be named on a contract.
2. **Enduring agreements stay GP-only** (hard rule 6, REQ-END-01a).
   `providerIsGpFor` already requires BOTH a billable role and
   `general_practitioner`, and both halves stay.
3. **The refusal does not disappear.** An arrival that names somebody who cannot
   bill AND needs a claim (`works_under_provider`) still cannot produce an
   agreement until a billing provider is named. What changes is that the arrival
   is recorded rather than thrown away, and the desk asks for the missing half
   instead of asking reception to overwrite the whole answer.
4. **The decision stays versioned content** (hard rule 14). If a new reason code
   is needed for "seen by somebody who does not bill", it is a row in the policy
   table with a version, not a branch in TypeScript.
5. **No new identity identifier**, nothing in logs or events but ids and reason
   codes (hard rules 1, 9).

## 5. The reason codes

Today a refused arrival carries `provider_not_servicing`. After this:

| Situation | Outcome | Reason |
|---|---|---|
| Seen by a `not_billable` practitioner | `received` | Visit decision `none`, reason from the policy table — e.g. `seen_by_a_practitioner_who_does_not_bill` |
| Seen by `works_under_provider`, no billing provider named | `received`, agreement pending | `billing_provider_not_yet_named` — and the desk offers the fix, with the person seen already filled in |
| Sender named nobody resolvable at all | `refused` | `provider_not_servicing`, as today. This case is unchanged |

The middle row replaces most of what is refused today. It is a better answer:
the visit exists, the patient is on a queue, and one field is missing rather
than the whole arrival being rejected.

## 6. Migration

- `Arrival.seeingAffiliationId String? @db.Uuid`, nullable, no foreign key (the
  table carries none by design; RLS scopes it).
- **Backfill: existing rows get `seeingAffiliationId = affiliationId`.** For every
  arrival so far the two were the same fact, so this is true rather than a guess.
- Reversible, as every migration must be.

## 7. Named tests

- `a_phlebotomist_can_be_arrived_and_needs_no_agreement` — Carl's blood-test case, end to end.
- `a_nurse_can_be_arrived_and_the_nurse_is_not_thrown_away`.
- `a_nurse_still_cannot_be_the_provider_on_an_agreement` — hard rule, re-asserted.
- `an_enduring_agreement_is_still_never_offered_for_a_non_gp` — hard rule 6.
- `an_ordinary_gp_arrival_names_the_same_person_in_both_fields` — the no-change case.
- `an_arrival_naming_nobody_resolvable_is_still_refused`.
- `the_decision_for_a_non_billing_visit_comes_from_the_policy_table_with_its_version` — hard rule 14.
- `arrival_events_carry_ids_and_reason_codes_never_names` — hard rule 9.
- `an_arrival_across_a_practice_boundary_finds_nothing` — fails closed.

## 8. Not in this change

- The nurse's own queue page (`PRACTITIONER-QUEUE-PAGE.md`) — this is the data it
  will need, built first and separately.
- The nurse and phlebotomist ROLES themselves (`ROLES.md` §7). A practitioner
  record with the right billing role is enough for this work; the account roles
  are a separate job.
- Anything about who may claim for a specimen collection. That is a billing
  question and this platform does not answer billing questions.

## Change log
| Date | Change |
|---|---|
| 12 Sep 2026 | v1.0. Written to specify the arrival change Carl asked for, before building it. |

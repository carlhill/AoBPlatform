# AoBPlatform — what's built, and how to poke it

### 21 August 2026 · Everything below is running code, verified in CI

---

## 1. Start everything

```bash
cd C:\Users\carl\OneDrive\Documents\2026\AoBPlatform
docker compose up -d
```

That's everything: Postgres, Redis, immudb, Keycloak, Mailhog, the three app
services **and the console**. First run builds images (~3 min); after that it's
seconds. Then check all nine are healthy:

```bash
docker compose ps
```

**⚠ One rule:** run *either* the containers *or* the `npm run start:dev`
servers — never both. They share one database, so two copies of the outbox
relay split the evidence between two vaults. (Learned the hard way; the relay
now has a claim lease, but the topology is still confusing.)

| Surface | URL |
|---|---|
| **▶ Practice console — start here** | **http://localhost:21100** |
| Core API explorer | http://localhost:21001/openapi |
| Rules API explorer | http://localhost:21002/openapi |
| Vault API explorer | http://localhost:21003/openapi |
| Vault chain verification | http://localhost:21003/chain/verify |
| Keycloak admin console | http://localhost:21024 — `admin` / `admin` |
| Mailhog (sent mail) | http://localhost:21026 |
| Postgres | `localhost:21020` — `aobplatform` / `aobplatform` |
| immudb | `localhost:21022` — `immudb` / `immudb` |

*(Running the dev servers instead? The console is on **3100** and the services
on 3001/3002/3003 — same paths, different ports.)*

---

## 2. The five-minute UI walkthrough

Open the console. In order:

| # | Click | What to look for |
|---|---|---|
| 1 | — | **Platform services**: core / rules / vault all "Running". The **Vault chain** line shows `verified · N events` — that's a live hash-chain verification, not a status flag. |
| 2 | **Sign in with your passkey** | You land on Keycloak. **Count the password fields: there are none.** No "forgot password" link either. That's rule 15 enforced at the identity layer. Any username with no passkey enrolled is refused outright — there is no fallback to fall back to. To get an account that *can* sign in, do §2b first. |
| 3 | **Create sample practice** | Seeds a practice, a GP, a patient and a self-assignor. The practice ID appears below. |
| 4 | **Run capture journey** | The whole thing, live, against real services. Watch the journey log: draft → single-use link minted → content-blind landing → three-identifier verification → particulars locked & artefact hashed → **signed → validated → stored**. |
| 5 | — | The **Vault chain** counter jumps. Every step you just watched left immutable evidence. |
| 6 | **Sync PMS invoices** | Pulls three fixture invoices from the mock Medtech adapter into the **Outstanding agreements** table. |
| 7 | — | Read the table: three rows at ~351, ~65 and ~5 days remaining, colour-banded **standard / urgent / expired**. The expired row says *revenue forgone* and its **Resend button is disabled** — the twelve-month window has closed, so contacting the patient is cost with no possible return. |

### Things worth trying because they should fail

- Click **Resend** on the expired row (it's disabled — that's the point).
- Stop the rules service (`docker compose stop rules`) and re-run the journey: the lock step reports a clean failure instead of pretending.
- Set `RULES_REGISTER_DRAFT_SET: 'false'` on the `rules` service in `docker-compose.yml`, `docker compose up -d rules`, re-run the journey: lock now returns **501 — the honest "no rule set registered"** state, and signature stays unreachable.
- Set `NODE_ENV: production` on the `core` service and restart it: **it refuses to boot**, because the committed placeholder Keycloak secret is not allowed in production. (That guard genuinely blocked this stack's first build — it isn't decorative.)

---

## 2b. Onboarding a doctor so you can set up a passkey

The console's **Invite practitioner to enrol a passkey** button does all of
this. What it does under the covers, and why:

1. Creates a Keycloak account for that provider holding **no password at all**
   (verified: the credentials list comes back empty) and carrying the
   `webauthn-register-passwordless` required action.
2. Assigns the `provider` realm role and stamps `practice_id` / `provider_id`
   as attributes — that claim is what replaces the dev `x-practice-id` header
   once `AUTH_ENFORCE` is on.
3. Emails an enrolment link. Locally that lands in **Mailhog**.

Then: open http://localhost:21026, open *"Update Your Account"*, click
**"Click here to proceed"**, and register the passkey on your device.
After that the practitioner can sign in through the console.

### Why an emailed link rather than "log in and add a passkey"

The login flow **requires** a passkey (rule 15), so a practitioner who doesn't
have one yet can't log in to create one. Keycloak's action token resolves that
chicken-and-egg: it authenticates the holder for the duration of that one
required action, and nothing else. This is also exactly the model FR-1.9
specifies — *admin-attested invitation, not self-service reset*.

### By API

```bash
SEED=$(curl -s -X POST http://localhost:21001/dev/seed)
PRACTICE=$(echo $SEED | jq -r .practiceId); PROVIDER=$(echo $SEED | jq -r .providerId)

# Who can sign in right now
curl -s http://localhost:21001/identity/status -H "x-practice-id: $PRACTICE" | jq

# Invite — creates a passwordless account and emails the enrolment link
curl -s -X POST "http://localhost:21001/identity/providers/$PROVIDER/invite"   -H "x-practice-id: $PRACTICE" -H 'Content-Type: application/json'   -d '{"email":"dr.example@example.invalid"}' | jq

# Grab the enrolment link straight out of Mailhog
npm run invite:link
```

Staff work the same way: `POST /identity/staff/{staffId}/invite`. Practice
admins get passkeys too — rule 15 covers admin roles, not just clinicians.

### Onboarding a whole practice

```bash
curl -s -X POST http://localhost:21001/practices -H 'Content-Type: application/json' -d '{
  "name":"Sampletown Family Practice","pms":"medtech_evolution","state":"NSW",
  "locations":[{"address":"1 Example Street, Sampletown NSW 2000"}]}' | jq
# then POST /practices/{id}/providers, /staff, then invite each of them
```

`state` matters: it drives the public-holiday calendar behind 2-business-day
terminations. Default `NSW`.

### The enrolment ceremony comes first (REQ-PKI-01)

**No ceremony, no key.** The invite endpoint returns **403** until a ceremony
is on record — because a passkey is a strong credential, and binding one
through a weak ceremony produces confident, permanent, cryptographically-
attested attribution to a person nobody verified. Worse than no credential.

Three checks, performed by a human, recorded as append-only evidence:

```bash
curl -s -X POST http://localhost:21001/identity/ceremonies   -H "x-practice-id: $PRACTICE" -H 'Content-Type: application/json' -d '{
  "providerId": "'"$PROVIDER"'",
  "ahpraNumber": "MED0001234567",
  "ahpraRegistrationCurrent": true,
  "providerNumber": "1234567A",
  "providerNumberLocation": "1 Example Street, Sampletown NSW 2000",
  "providerNumberVerified": true,
  "personVerificationMethod": "video",
  "verifiedByName": "Robin Practicemanager",
  "evidenceNote": "AHPRA register sighted; video call 21 Aug 2026."
}' | jq
```

Then the invite works, and the vault event for the key binding cites the
ceremony that authorised it and who attested to it.

What the gate refuses:

| Attempt | Result |
|---|---|
| Invite with no ceremony | **403 REQ-PKI-01** — *"a key must not be bound to whoever answered the email"* |
| `personVerificationMethod: "email"` / `"phone"` | **400** — video or in person only |
| `ahpraRegistrationCurrent: false` | **400** — must be attested CURRENT, not merely recorded |
| Provider number with no location | **400** — valid elsewhere proves nothing here |
| Blank `verifiedByName` | **400** — a named human, never "system" |
| Malformed AHPRA number | **400** — three letters, ten digits (FR-1.11) |
| A practitioner attesting their own enrolment | **400** — self-attestation defeats the ceremony |
| Ceremony older than 30 days | **403 REQ-PKI-04** — they may have been deregistered since |
| Re-using a consumed ceremony | **403** — one ceremony authorises one binding |
| Re-inviting someone who already holds a key | **403 REQ-PKI-05** — that's *recovery*; needs `"steppedUp": true` |
| Editing a ceremony afterwards | **DB trigger refuses** — perform a fresh one |

### ⚠ Still manual, by design

The AHPRA lookup is **a human reading the register and attesting to it** —
FR-1.11 scopes v1 exactly that way ("existence check manual at onboarding;
automated re-verification is roadmap"). The platform does not verify AHPRA; it
guarantees that *someone named* attested, *recently*, that they *weren't the
subject*, and that the record *can't be edited afterwards*.

Two REQ-PKI siblings remain unbuilt: **REQ-PKI-02/03** (high-risk actions —
bulk enrolment, bulk termination, banking changes — signed over the hash of
the exact payload) and the automated half of **REQ-PKI-04** (re-checking AHPRA
status on a cadence).

---

## 3. Every endpoint

Base URLs: **core** `http://localhost:21001` · **rules** `http://localhost:21002` · **vault** `http://localhost:21003`
Practice-scoped calls need `x-practice-id: <uuid>` (or a bearer token once you're signed in).

### Core — practices & onboarding (M1.A)
| Method | Path | What |
|---|---|---|
| POST | `/practices` | Create a practice with locations + **state** (drives the holiday calendar) |
| GET | `/practices/{id}` | Read one |
| PATCH | `/practices/{id}/config` | Identifier set (floor 3, Medicare non-configurable), link expiry, go-live flags |
| POST | `/practices/{id}/staff` | Staff list — **activates the REQ-VUL-04 assignor block** |
| POST | `/practices/{id}/providers` | Provider (provider number optional — s 65C(5)(a) or (b)) |
| POST | `/practices/{id}/assignors` | Assignor — **refuses anyone on the staff list** |
| GET | `/practices/{id}/go-live-checklist` | Honest checklist; blocked until write-back + sender ID + rule set exist |

### Core — organisation onboarding (ORG-MODEL-PROPOSAL.md §4, §9)
Pre-tenant: `/organisations` and `/organisations/{id}/validate` take **no**
`x-practice-id` — the organisation *is* the tenant, and it does not exist yet.

| Method | Path | What |
|---|---|---|
| POST | `/organisations` | Register with an ABN. **Checksum, then ABR ACTIVE, then name match** against legal OR trading name. ACN derived, never asked for |
| GET | `/organisations/pending` | The human validation queue |
| POST | `/organisations/{id}/validate` | Approve or reject. **Named reviewer required**; a rejection needs a reason; no re-deciding |
| GET | `/organisations/locations` | Locations, with `active` and `addressValidated` |
| POST | `/organisations/locations` | Add a site. Created **INACTIVE** until the address is confirmed |
| POST | `/organisations/locations/{id}/activate` | Manual address confirmation, **named human** (until the G-NAF ingest lands) |
| GET·POST | `/organisations/departments` | Optional subdivisions of a location |

### Core — practitioners & affiliations (§5, §6)
| Method | Path | What |
|---|---|---|
| POST | `/practitioners` | Practitioner pre-registers themselves. **AHPRA format validated** |
| GET | `/practitioners/directory?ahpraNumber=` | **Exact match only.** Never returns a provider number or an email. A name is refused |
| GET | `/practitioners/{id}/affiliations` | The practitioner's own view, **across every practice**, with no provider numbers |
| POST | `/practitioners/{id}/affiliations/{affId}/respond` | Accept or reject. **Only the practitioner** — anyone else gets an indistinguishable 404 |
| POST | `/practitioners/{id}/deregister` | REQ-XFER-08 — **immediate**, every affiliation, no notice period |
| GET | `/affiliations` | The practice's own list, with `canCapture` and `blockReason` |
| POST | `/affiliations` | Invite by AHPRA number. Needs a **validated** org and an **active** location |
| POST | `/affiliations/{id}/notice` | Give notice. **`endsAt` must not precede the notice** |
| POST | `/affiliations/{id}/notice/withdraw` | The practitioner stayed |

### Core — agreements
| Method | Path | What |
|---|---|---|
| POST | `/agreements` | Create draft (enforces GP-only enduring, polymorphic anchor) |
| GET | `/agreements` | List (filter `?status=`) |
| GET | `/agreements/{id}` | Read one |
| POST | `/agreements/{id}/particulars` | **Lock**: server assembles the s 65C data set, validates, renders, hashes |
| POST | `/agreements/{id}/sign` | Sign → validated → stored, binds REQ-SIG-02 evidence, writes back to PMS |
| POST | `/agreements/{id}/transition` | Status move via the domain transition map |

### Core — verification (M3)
| Method | Path | What |
|---|---|---|
| POST | `/verification/challenges` | Start — approved identifiers only, minimum 3 |
| POST | `/verification/challenges/{id}/attempt` | Constant-time match; generic failure message; lockout at 5 |

### Core — capture cascade (M2)
| Method | Path | What |
|---|---|---|
| POST | `/capture` | Open a capture request; returns the single-use token **once** |
| POST | `/capture/{id}/complete` | Complete; cancels every other open channel |
| GET | `/capture/link/{token}` | 🌐 **Public** — content-blind landing |
| POST | `/capture/link/{token}/verify` | 🌐 **Public** — verify and advance |

### Core — PMS integration (M9)
| Method | Path | What |
|---|---|---|
| POST | `/pms/sync` | Pull invoices → service records (mock adapter until D-01) |

### Core — reconciliation (M7)
| Method | Path | What |
|---|---|---|
| GET | `/reconciliation/outstanding` | Ranked queue with chase bands |
| POST | `/reconciliation/{serviceRecordId}/resend` | One-click resend; hard-stops on expired + confidentiality |
| GET | `/reconciliation/metrics` | Band counts, capture rate, verbal countdown |

### Core — enduring lifecycle (M5)
| Method | Path | What |
|---|---|---|
| POST | `/enduring` | Create reg 65CB detail (notification method required) |
| GET | `/enduring/{agreementId}/scope-preview` | **The bulk-bill commitment, stated before signature** |
| POST | `/enduring/{agreementId}/terminate` | 2 **business** days, state holidays applied |
| POST | `/enduring/{agreementId}/cease` | Automatic cessation, pathway-checked |
| GET | `/enduring/coverage` | `?patientId=&providerId=` — is this covered? |
| GET | `/enduring/anniversary-pipeline` | The 65CA(8)(e) fuse nobody else tracks |
| GET | `/enduring/fourteenth-birthday-due` | 30-day lead on the 14th-birthday cessation |

### Core — reg 89AA notices (M6)
| Method | Path | What |
|---|---|---|
| POST | `/notices/claims` | Claim intake → notice (**MyMedicare only**) |
| POST | `/notices/{id}/dispatch` | Dispatch with method-fidelity check |
| POST | `/notices/{id}/delivered` | Carrier receipt |
| POST | `/notices/{id}/read` | Open signal — **evidential colour only** |
| POST | `/notices/{id}/correct` | Superseding correction (original never edited) |
| GET | `/notices/compliance-pack` | **The auditor artefact** — `?from=&to=` |

### Core — identity onboarding (FR-1.9, FR-1.5)
| Method | Path | What |
|---|---|---|
| GET | `/identity/status` | Who has an account and can sign in |
| POST | `/identity/ceremonies` | **REQ-PKI-01 — record the enrolment ceremony. Required before any invite** |
| GET | `/identity/ceremonies` | Ceremonies on record, with age and whether consumed |
| POST | `/identity/providers/{id}/invite` | **Passwordless account + passkey enrolment email** |
| POST | `/identity/staff/{id}/invite` | Same for practice staff |
| POST | `/identity/providers/{id}/revoke` | REQ-PKI-04 — departure/deregistration removes access |

### Core — dev & health
| Method | Path | What |
|---|---|---|
| GET | `/health` | 🌐 Public |
| POST | `/dev/seed` | Sample practice — refuses to run in production |
| GET | `/openapi.json` | Machine contract (24+ paths) |

### Rules service
| Method | Path | What |
|---|---|---|
| POST | `/validate` | C1–C14 with citations; `stage: pre_signature\|storage` |
| GET | `/rule-sets` | Registered versions |
| GET | `/health` · `/openapi` | |

### Vault service
| Method | Path | What |
|---|---|---|
| POST | `/events` | Append (whitelist-validated; **no update/delete exists**) |
| GET | `/events` | `?subjectId=&from=&to=` |
| GET | `/artefacts/{sha256}/verify` | Existence + timestamp, **no content** |
| GET | `/chain/verify` | Full-chain verification |
| GET | `/health` · `/openapi` | |

---

## 3b. Walking the org model end to end

```bash
B=http://localhost:21001
```

```bash
curl -s -X POST $B/organisations -H 'content-type: application/json' -d '{"name":"Sampletown Family Practice","abn":"53004085616"}'
```

That ABN is an offline fixture and belongs to nobody. Note the response: the
legal entity is *Sample Medical Holdings Pty Ltd*, you typed a **trading
name**, and it matched — which is the case strict legal-name matching gets
wrong. The ACN comes back derived, and `validationState` is `pending`.

Things worth trying that should FAIL:

```bash
curl -s -X POST $B/organisations -H 'content-type: application/json' -d '{"name":"Anything","abn":"53004085617"}'
```

```bash
curl -s -X POST $B/organisations -H 'content-type: application/json' -d '{"name":"Former Clinic Pty Ltd","abn":"13824753558"}'
```

```bash
curl -s "$B/practitioners/directory?ahpraNumber=Smith"
```

The first is a one-digit typo caught offline before any lookup; the second is a
CANCELLED ABN; the third is a name search, refused so the directory cannot be
enumerated.

Then: `POST /organisations/{id}/validate` with a `reviewerName`, add a
location, activate it with a `reviewerName`, `POST /practitioners`, and
`POST /affiliations`. The invitation sits at `invited` until the practitioner
themselves responds — a practice cannot accept on their behalf.

---

## 4. Copy-paste API walkthrough

```bash
# 1. Seed and capture the IDs
SEED=$(curl -s -X POST http://localhost:21001/dev/seed)
PRACTICE=$(echo $SEED | jq -r .practiceId); H="x-practice-id: $PRACTICE"

# 2. Draft an agreement
AGR=$(curl -s -X POST http://localhost:21001/agreements -H "$H" -H 'Content-Type: application/json' \
  -d "{\"type\":\"episodic_pre\",\"providerId\":\"$(echo $SEED|jq -r .providerId)\",\"patientId\":\"$(echo $SEED|jq -r .patientId)\",\"assignorId\":\"$(echo $SEED|jq -r .assignorId)\",\"assignorIsPatient\":true}" | jq -r .id)

# 3. Open a capture link — the token appears exactly once
TOKEN=$(curl -s -X POST http://localhost:21001/capture -H "$H" -H 'Content-Type: application/json' \
  -d "{\"agreementId\":\"$AGR\",\"channel\":\"sms_link\"}" | jq -r .token)

# 4. The patient's view: content-blind, names nobody
curl -s "http://localhost:21001/capture/link/$TOKEN" | jq

# 5. Verify, lock, sign
curl -s -X POST "http://localhost:21001/capture/link/$TOKEN/verify" -H 'Content-Type: application/json' \
  -d '{"stated":{"name":"Testpatient Alex","date_of_birth":"1957-03-14","address":"1 Example Street, Sampletown NSW 2000"}}' | jq
curl -s -X POST "http://localhost:21001/agreements/$AGR/particulars" -H "$H" -H 'Content-Type: application/json' \
  -d '{"serviceDate":"2026-08-21","basicServiceDescription":"General practitioner attendance"}' | jq '{ruleSetVersion,renderedArtefactHash}'
curl -s -X POST "http://localhost:21001/agreements/$AGR/sign" -H "$H" -H 'Content-Type: application/json' \
  -d '{"method":"tap_to_approve","channel":"sms_link"}' | jq '{status,writtenBackAt,pmsDocumentKey}'

# 6. The evidence
sleep 6 && curl -s http://localhost:21003/chain/verify | jq
curl -s "http://localhost:21003/events?subjectId=$AGR" | jq '[.[].type]'
```

### The compliance pack (the demo that sells it)

```bash
curl -s "http://localhost:21001/notices/compliance-pack" -H "$H" | jq '{dispatchedWithinWindowRate, noticeCount, breaches}'
```

---

## 5. What each hard rule looks like from outside

| Try this | Expect |
|---|---|
| `PATCH /practices/{id}/config` with `identifierTypes: ["name","date_of_birth","medicare_number"]` | **400** — Medicare number is not an approved identifier, non-configurably |
| `POST /practices/{id}/assignors` naming someone on the staff list | **400 REQ-VUL-04** |
| `POST /agreements` with `type: enduring` + a specialist | **400 REQ-END-01a** — enduring is GP-only |
| Sign before locking particulars | **400 REQ-REG-06** — the criminal-offence guard |
| A failed verification attempt | Generic *"Some of those details do not match"* — never which one |
| `PUT`/`DELETE` on `/events` | **404** — no such route exists on the vault |
| Dispatch a notice for an aged-care agreement | `noticeRequired: false` — MyMedicare only |
| Edit a dispatched notice in the DB | **REQ-DEL-06** — issue a superseding correction |

---

## 6. Known limits — read before judging

| Limit | Status |
|---|---|
| **Two DRAFT files await your review** | [REVIEW-REQUIRED.md](REVIEW-REQUIRED.md) — the s 65C rule set and the immudb store |
| **Passkey ceremony unproven** | Login redirect, PKCE, callback and token verification all work; the biometric tap needs a real device. Worth doing manually. |
| **Public holidays derived, not authoritative** | Calendar is real and per-state, but `DATASET.verified === false`. Every termination records `UNVERIFIED` in its evidence until someone checks the official lists. |
| **Basic Service Description mapping is a stub** | Five hand-typed strings. The real quarterly MBS Online ingest is unbuilt — a Phase 0/1 job. |
| **D-01 unresolved** | The Medtech adapter is a mock. Write-back works against it, not against Medtech. |
| **D-11 unresolved** | Anniversary fuse tracked and warned on; no registration mechanism has been published to integrate with. |
| **Auth enforcement staged** | `AUTH_ENFORCE=false` by default so the console isn't locked out before every surface has a login. Flipping it on is a release gate. |
| **Real sends disabled** | Sandbox gateway only. Real SMS/email needs your sign-off and a registered ACMA sender ID. |
| **No anchoring / HSM signing yet** | The chain is tamper-*evident*; RFC 3161 anchoring (what makes it non-*repudiable* against us) is still `TODO(HUMAN)`. |
| **Address validation is MANUAL** | `ADDRESS_VALIDATION_MODE=manual`. The G-NAF ingest is unbuilt, and the G-NAF validator **throws on construction** rather than marking every address validated — a validator that always says yes is worse than none. |
| **ABR lookup runs on fixtures** | No `ABR_API_GUID` means no network call. The live client is written but **unexercised** — its response shape is a hypothesis until run with a real GUID. |
| **Affiliation invitations do not email** | The invite is recorded; dispatch lands with the notification work. |
| **Capture still anchors to `Provider`** | `Agreement.affiliationId` exists and is immutable, but the capture path has not been cut over. Both anchors are immutable meanwhile, so nothing drifts. |

---

## 7. Running the tests

```bash
npm test                      # 259 unit tests
npm run test:e2e -w apps/core # 121 e2e against real Postgres
npm run test:e2e -w apps/vault# 14, incl. the immudb contract suite
npm run validate:realm        # rule 15 guard — passkey required, no password path
```

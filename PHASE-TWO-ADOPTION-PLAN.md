# Adopting Phase Two keycloak-orgs — plan

**Status:** plan, nothing adopted. Written 2026-08-22 at Carl's request:
*"we are building an industrial strength compliance gov app and we will have
more access management requirements."*

That reasoning is sound. If per-tenant roles, delegated admin and per-tenant SSO
are coming, adopting something mature beats growing our own.

**But verify §1 before committing anything.** It was checked against the
project itself, and it changes what "adopting" can mean.

---

## 1. It is NOT open source, and the licence bites exactly where we want it

Gemini described it as "open-source". It is not, any more.

> *"We've changed the license of our core extensions from the AGPL v3 to the
> Elastic License v2."* — p2-inc/keycloak-orgs

**Elastic License v2 is source-available.** Elastic's own FAQ draws the line:

| | |
|---|---|
| ✓ Permitted | *"freely use \[it\] inside your SaaS or self-managed application"* as a component |
| ✗ Not permitted | providing it *"as a service, where customers have direct access to substantial portions of the ... APIs and UI"* |

**The feature we want it for is the one nearest that line.** Phase Two's
headline is a **self-service portal for organisation admins** — and handing our
practice admins direct access to that extension's own UI is, on its face, the
restricted case.

Using it as a **backend** — organisation roles, invitations, membership, all
through its API, behind our own screens — is squarely on the permitted side.

**So the shape of any adoption is decided for us:** take the capabilities,
build the UI. Which, conveniently, is what we were going to build anyway.

⚠ **This is a legal question, not a technical one.** A compliance product should
not rest on my reading of a licence FAQ. If we adopt, it wants ten minutes of
actual legal advice — cheap now, expensive later.

## 2. What else the check turned up

| | |
|---|---|
| **No published releases** | The GitHub releases page is empty. 541 stars, 99 forks — real, but small. **Superseded by Phase 0.3**, which found the fuller picture: tags to v0.173 are cut, but Maven Central stopped at 0.106 in Dec 2024 and only the Docker image is maintained |
| **Compatibility claim stops short** | *"known to work with Keycloak > 17.0.0"*, with *"no guarantees ... other than those packaged in their Docker image"*. **Settled by Phase 0.2 — it works on 26.0.8**, verified against a throwaway instance |
| **The licence already changed once** | AGPL v3 → ELv2. A licence that has moved can move again, and we would be downstream of that |

None of these are disqualifying. All of them are things to know before putting
it inside the component that decides who may do what.

## 3. The honest alternative, stated fairly

**Native Keycloak Organizations + our own role model.**

Native gives — first-party, Apache 2.0, supported, and I verified each against
our own server today:

- organisations, membership, invitation-by-email (the invite mail arrived)
- **the organisation in the token**, via `oidc-organization-membership-mapper`
  (this is the point I had wrong and Gemini had right)
- per-organisation identity providers — the per-tenant SSO card

What it does not give is per-organisation ROLES. Those would live in our own
database: a small table keyed by practice, user and role, read by the API that
already scopes every request by practice.

**The trade:** a table and a lookup, against a source-available dependency
inside the identity layer.

## 4. Which I would choose, and why

**Native Organizations plus our own roles**, unless legal is comfortable with
ELv2 and the portal is genuinely what we want.

The deciding argument is not the licence, and not the missing releases. It is
this: **the self-service portal is the only part of Phase Two we cannot easily
build, and it is the part the licence most restricts.** Everything else it
offers — org roles, invitations, membership — is either native or is a table.

Adopting a source-available extension inside authentication, in a compliance
product, to obtain a feature we may not be permitted to expose, is a poor
trade. If the portal is off the table, so is most of the reason to adopt.

**What would change my mind:** legal saying the portal is fine, or a
requirement arriving that native genuinely cannot meet.

---

## 5. The plan, if we adopt Phase Two anyway

Written so it can be executed, and so it can be abandoned cheaply.

### Phase 0 — decide, before any code — **RUN 22 Aug 2026**

All four items below were executed. Findings first, then what they mean.

#### 0.1 Legal on ELv2 — **STILL OPEN, and it is the only true blocker**

The question: may practice admins use Phase Two’s own self-service portal?

Nothing found today changes §1’s reading. The licence text is unchanged and
still says the extensions are Elastic License v2, and ELv2 still forbids
providing the software *"as a service, where customers have direct access to
substantial portions of the ... APIs and UI"*.

Our practice admins **are** customers, and Phase Two’s portal **is** the
extension’s own UI. On its face that is the restricted case.

⚠ **This remains a lawyer question and I am not one.** But note what the
other three findings do to it: **it may not matter**. Every route to the
code (0.3) makes the portal impractical for us anyway, so the licence and
the engineering point the same way — backend only, our own screens.

**Decision: proceed on the assumption that the portal is out.** If legal
later says the portal is fine, we have lost nothing, because we were going
to build those screens regardless (§4).

#### 0.2 Compatibility — **PASSES on 26.0.8**

Stood up `quay.io/phasetwo/phasetwo-keycloak:26.0.8` in a throwaway
container: its own ephemeral H2 database, port 21099, no volumes, a realm
called `p2probe`. Our realm and our Postgres were not touched, and the
container was destroyed afterwards. Verified after teardown that
`aobplatform` still holds its 5 users.

```
Keycloak 26.0.8                        (identical to ours)
GET  /realms/p2probe/orgs         200  EXTENSION IS LIVE
POST /realms/p2probe/orgs         201  created
     /orgs/{id}/roles            200  10 items
     /orgs/{id}/members          200   1 item
     /orgs/{id}/invitations      200   0 items
     /orgs/{id}/idps             200   0 items
     /orgs/{id}/domains          200   0 items
```

The ten built-in organisation roles are exactly the axis we need:

```
view-organization      manage-organization
view-members           manage-members
view-roles             manage-roles
view-invitations       manage-invitations
view-identity-providers manage-identity-providers
```

**It works.** This item is no longer a risk.

#### 0.3 Pin something — **THE REAL FINDING, and it is not what §2 said**

§2 said *"no published releases"*. True, and incomplete. The full supply
picture:

| Route | State | Verdict |
|---|---|---|
| GitHub **Releases** | empty | nothing to pin |
| GitHub **tags** | v0.1 … **v0.173**, actively cut | pinnable by SHA |
| **Maven Central** `io.phasetwo.keycloak:keycloak-orgs` | 105 versions, **last was 0.106 in December 2024** | **abandoned 20 months ago** |
| **Docker image** `quay.io/phasetwo/phasetwo-keycloak` | rebuilt **21 Aug 2026**, tracks Keycloak 26.6.5 | the only maintained route |

So the JAR route is dead. **The supported way to consume keycloak-orgs is
their Docker image — which is a complete Keycloak distribution, not an
extension we drop into ours.**

That reframes the decision. Adopting keycloak-orgs is not "add a JAR". It is
**replacing the Keycloak we run with the one Phase Two builds.** Everything
in `infra/keycloak` — the realm export, the email theme, the passkey policy,
the audience mappers fixed today — would sit on top of somebody else’s
distribution.

And their line has moved past ours:

| Extension tag | Targets Keycloak |
|---|---|
| v0.80 | **26.0.2** — our line |
| v0.90 | 26.1.1 |
| v0.110 | 26.3.1 |
| v0.159 | 26.5.7 |
| **v0.173** (head) | **26.6.3** |

The `26.0` image tag exists and works (0.2 proves it) but **was last built 10
February 2025**. Pinning it means running an image that has had no security
rebuild in 18 months as the component that decides who may do what. That is
not a pin, it is a freeze.

**So there are two honest options, and no third:**

1. **Track their line** — move to Keycloak 26.6.x and take their
   distribution, accepting their upgrade cadence as ours.
2. **Build from source** at a pinned SHA against 26.0.8 — Java 21 + Maven, a
   build we own and must re-run for every Keycloak CVE.

For pinning if we proceed:

```
quay.io/phasetwo/phasetwo-keycloak@sha256:8ee43a55ba9e63b6f48d4b8cc9b91c9c3b8d0ab8d74543ef0fe86d7ee13f9fe2
```

(that is the `26.0.8` tag, resolved to a digest — never track a tag for this)

#### 0.4 Exit test — **EASY for data, HARD for the distribution**

Two very different answers, and the split is the point.

**Removing the DATA is easy**, and that is by design (§2’s boundary). Every
fact we care about is ours: `practices` stays authoritative, RLS is enforced
by Postgres, and an organisation is only an access-management projection
linked by id. To remove it we would:

1. Read members and roles out through the orgs API into our own tables
2. Swap the guard back to reading `practice_id` from a protocol mapper — the
   claim it already reads today
3. Delete the organisations

Nothing about consent records, evidence or the vault chain is involved. **A
day, maybe two.**

**Removing the DISTRIBUTION is harder**, and this is what 0.3 exposed. If we
adopt their image we are not exiting an extension, we are migrating a
Keycloak — with the credential store in it. PASSKEYS.md trap 4 is the exact
hazard: **a passkey cannot be re-derived**, the private half never leaves the
device, and losing the store means re-inviting everybody at their own
hardware.

It is survivable — the store is Postgres, not the container — but it is a
migration with a credential store in the blast radius, not a config change.

**Verdict on the exit test: passes, conditionally.** Reversible on the data
axis, expensive on the distribution axis. Which is an argument for taking
the capability and not the distribution, if we take it at all.

#### Phase 0 conclusion

Compatibility was the item we expected to fail, and it passed. Supply was
the item we thought was a footnote, and it is the decision.

**Recommendation: do not adopt now.** Not on licence grounds — on supply
grounds. The maintained route requires taking Phase Two’s Keycloak
distribution and their upgrade cadence, in exchange for capabilities (§3)
that native Organizations plus our own role model already largely give us,
first-party and Apache 2.0.

What would change the answer: Maven Central publication resuming, so the
extension can be a dependency rather than a distribution. That is worth
re-checking in six months, and it is one query — the table in 0.3 is the
check.

**Nothing below this line has been executed.** Phases 1–4 remain the plan if
the recommendation is overridden.

### Phase 1 — run it beside us, touching nothing

- Deploy into a **separate realm** in the same Keycloak.
- Create one organisation, attach test accounts, exercise roles and
  invitations through the API only.
- Confirm the org and its roles arrive in the token in a shape our guard can
  read.

**Nothing in `aobplatform` changes.** If this phase disappoints, we stop and
have lost a day.

### Phase 2 — the boundary, written down before the migration

The rule that keeps this reversible:

| Owns | Who |
|---|---|
| ABN, entity, checks, evidence, consent records | **Us.** Always. Not negotiable |
| The RLS boundary | **Postgres.** Keycloak informs a claim; the database enforces it |
| Who exists, and their credentials | **Keycloak** |
| Which practice a person belongs to, and their role there | **Phase Two**, projected into the token |

`practices` stays authoritative for the practice. An organisation is its
**access-management projection**, linked by id — created, renamed and disabled
in step by us.

### Phase 3 — migrate, additively

1. One organisation per validated practice, keyed to the practice id.
2. Attach existing accounts as members.
3. Grant `org-admin` to whoever currently holds the practice-admin account.
4. Add the org role claim to the token **alongside** `practice_id`, not
   instead of it.
5. Guards read the new claim, still accepting the old one.
6. Only once everything reads the new claim, stop writing the old one.

Steps 4–5 are the whole point: **at no moment is there a single flag day.**

### Phase 4 — what we still build regardless

- Location and department scoping. Phase Two scopes to the organisation; Carl
  asked for organisation, location AND department. Two of the three are ours
  either way.
- The inactivity lifecycle — six months to a warning, three more to
  deactivation, reactivation on request. No identity product does this for us.
- Our own invite screen, if the portal is off the table.

### Rollback

Reversible up to the end of Phase 3 step 5, because the old claim is still
being written. After that, rollback means re-populating `practice_id` from the
organisation membership — a script, not a rewrite.

---

## 5a. The screens — multi-tenant, and tenant self-service

Asked directly: *what screens will we have for multi-tenant, and for tenant
admins to self-manage their users?*

This list is **independent of the Phase Two decision.** Whether organisations
live in keycloak-orgs, in native Keycloak Organizations, or in our own
tables, these are the same screens — which is itself a useful signal that the
decision above is a plumbing decision, not a product one.

### What already exists

| Screen | Route | Who | State |
|---|---|---|---|
| Practice directory | `/practice` | Platform only | ✅ built — scoped users are redirected to their own hub, never shown the list |
| Review queue | `/review` | Platform | ✅ built |
| Application dossier | `/review/{id}` | Platform | ✅ built — edit mode, checks, decision |
| Identity dashboard | `/review/identity` | Platform admin | ✅ built |
| Setup hub | `/practice/setup` | Tenant | ✅ built |
| Entity dossier | `/practice/entity` | Tenant | ✅ built — read-only view of the full record |
| Locations & departments | `/practice/locations` | Tenant + platform | ✅ built — now with practice-side edit and reviewer confirm/reject |
| Practitioners | `/practice/practitioners` | Tenant | ✅ built |
| Affiliations | `/practice/affiliations` | Tenant | ✅ built |
| Channels | `/practice/channels` | Tenant | ✅ built |
| PMS | `/practice/pms` | Tenant | ✅ built |

**The tenant boundary is already enforced**, and not by the screens. The
token carries `practice_id`, the guard turns it into `x-practice-id`, and
Postgres RLS refuses anything else. A screen is a convenience on top of that
— which is why "show the practice their own data" was never the security
control.

### What is missing — tenant self-service

#### 1. `/practice/users` — the one that is actually asked for

A practice admin creates a user, names them, sets a role, and sends an
invitation to their email. Constraints already agreed:

| Rule | Value | Why |
|---|---|---|
| Users per scope | **5** each at organisation, location, department = 15 | Enough for a real practice; small enough that a compromised admin cannot quietly build an army |
| Admin accounts | **exactly one** per practice | The account belongs to the practice, not a person — that is what makes succession work when an admin leaves suddenly |
| Passkeys on the admin account | **max 6** | A laptop, an iPhone, an Android, and room for replacement. Anyone with the enrolment link can enrol, so the cap is the containment |
| Roles | `admin`, `other` for now | Deliberately thin until we know which practice roles need which pages |

The screen needs: a list, an invite form, a role control, deactivate,
reactivate, and — the part that is easy to forget — **a visible count against
each cap**, because a limit somebody discovers by hitting it reads as a bug.

#### 2. Inactivity lifecycle

Agreed rule: inactive **6 months** → message asking them to sign in →
**3 more months** → deactivated, **never deleted**. Reactivatable.

This is a background job plus two states on the user, not a screen of its
own; it surfaces as a badge in `/practice/users` and a notice at sign-in.
**No deletes** — the same rule as acting-as records, for the same reason: a
person who signed something must still be identifiable years later.

#### 3. `/practice/recertification`

Soft, not mandatory. The practice gets a link, signs in, and sees every data
point with a tick-box: *this is still correct*. Anything that is not, they
change. **Every data point must be addressed** — a half-answered
recertification is worse than none, because it looks complete.

Sent to `group_email` rather than a person, which is why that column exists.

#### 4. Their own credentials — NOT our screen

A link out to Keycloak’s Account Console:

```
<KEYCLOAK>/realms/aobplatform/account/#/security/signingin
```

This is the one place a practice admin legitimately touches Keycloak, and it
is deliberate. Only the FIRST passkey comes from an emailed link; devices 2–6
are added from a session already proved by the first, which collapses the
bearer-link attack surface from every enrolment to exactly one (PASSKEYS.md).

Everything **else** — managing other people — stays in AoBPlatform, because
changes made in Keycloak’s admin console land in Keycloak’s own event store,
which we do not anchor to the vault. For a product whose output is an
evidence record, user administration has to produce vault events like every
other act.

### What is missing — platform side

| Screen | Why |
|---|---|
| **Access overview** — who holds what, across every practice | We can answer "who is in this practice" but not "which practices does this person reach", which is the question an incident asks |
| **Acting-as log** | Agreed and specified in RECERTIFICATION-AND-ACTING-AS.md, not yet surfaced. Every impersonated session gets a key written to each record it touches; there is nowhere to read that back |
| **Inactivity queue** | The platform view of the lifecycle above |

### Where the Phase Two decision would actually show

Only in `/practice/users`, and only underneath:

| | If we adopt | If we do not |
|---|---|---|
| Membership | orgs API | our `practice_users` table |
| Roles | 10 built-in org roles | our own enum |
| Invitations | orgs invitations API | our existing invitation machinery, which already works for practitioners |

That last row is the quiet argument against adopting. **We already built and
tested an invitation flow** — token, code, expiry, attempt cap, acceptance
methods, all in `packages/domain/src/invitation.ts` with tests. Taking Phase
Two’s means running two invitation systems, or migrating the one that works.

## 6. What this does NOT change, whichever way it goes

- **Postgres enforces the tenant boundary.** RLS is the control; a claim is an
  input to it. No identity product becomes the thing that keeps one practice
  out of another's data.
- **The evidence model stays here.** Checks, artefacts, ceremonies, the vault.
- **Passkeys stay as they are.** This is about who somebody is *for*, not how
  they prove who they are.

## 7. Recommendation — **updated after Phase 0, 22 Aug 2026**

**Do not adopt keycloak-orgs now.** Take native Organizations if and when we
need them, and hold the role model ourselves.

The reason changed during Phase 0, and the change is worth stating plainly
because it is the opposite of what the risk register predicted.

**What we expected to decide it:** the licence, and whether it runs on our
Keycloak. Neither did. The licence question is still open but is probably
moot, and compatibility **passed** — it works on 26.0.8, verified.

**What actually decides it:** supply. Maven Central publication stopped at
0.106 in December 2024 while source went on to v0.173, so the only maintained
route is Phase Two’s **Docker image** — a complete Keycloak distribution.
Adopting therefore means running their Keycloak rather than ours, on their
upgrade cadence, with our realm export, email theme, passkey policy and
audience mappers sitting on top of it.

That is a large commitment for capabilities that native Organizations plus
our own role model largely already give us — first-party, Apache 2.0,
supported, and measured against our own server in
[KEYCLOAK-ORGANIZATIONS-EVALUATION.md](KEYCLOAK-ORGANIZATIONS-EVALUATION.md).

It also duplicates work we have already done and tested: our invitation flow
— token, code, expiry, attempt cap, acceptance methods — exists with tests in
`packages/domain/src/invitation.ts`.

**What would reopen it:** Maven Central publication resuming, so the
extension can be a dependency instead of a distribution. One query re-checks
that; the table in Phase 0.3 is the check. Worth revisiting in six months.

**What to build regardless:** §5a. Those screens are the same whichever way
this goes, and `/practice/users` is the one being asked for now.

## Related

- [KEYCLOAK-ORGANIZATIONS-EVALUATION.md](KEYCLOAK-ORGANIZATIONS-EVALUATION.md) — what native gives, measured
- [CRITICAL-ISSUES.md](CRITICAL-ISSUES.md) — §5, the impersonation and recertification rules this must not weaken
- [CONVENTIONS.md](CONVENTIONS.md) — §6, why the RLS boundary stays in the database

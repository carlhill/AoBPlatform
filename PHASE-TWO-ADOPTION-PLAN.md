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
| **No published releases** | The GitHub releases page is empty. 541 stars, 99 forks — real, but small, and there are no versioned artefacts to pin to |
| **Compatibility claim stops short** | *"known to work with Keycloak > 17.0.0"*, with *"no guarantees ... other than those packaged in their Docker image"*. We run **26.0.8**, and nothing states 26.x explicitly |
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

### Phase 0 — decide, before any code

1. **Legal on ELv2.** Specifically: may practice admins use Phase Two's own
   self-service portal? If no, the adoption is backend-only and §4 applies.
2. **Compatibility.** Stand it up against Keycloak **26.0.8** in a throwaway
   realm. Not our realm, not our database.
3. **Pin something.** With no releases, pin a commit SHA and build it
   ourselves, or pin their image digest. Never track a branch for the thing
   that decides who may do what.
4. **Exit test.** Write down how we would remove it. If that answer is
   difficult, the answer to adopting is no.

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

## 6. What this does NOT change, whichever way it goes

- **Postgres enforces the tenant boundary.** RLS is the control; a claim is an
  input to it. No identity product becomes the thing that keeps one practice
  out of another's data.
- **The evidence model stays here.** Checks, artefacts, ceremonies, the vault.
- **Passkeys stay as they are.** This is about who somebody is *for*, not how
  they prove who they are.

## 7. Recommendation, in one line

**Do Phase 0.** Legal on the portal question and a compatibility test against
26.0.8 cost a day between them, and they decide the rest. If the portal is not
usable, take native Organizations and hold roles ourselves — we lose one table's
worth of work and avoid a source-available dependency inside authentication.

## Related

- [KEYCLOAK-ORGANIZATIONS-EVALUATION.md](KEYCLOAK-ORGANIZATIONS-EVALUATION.md) — what native gives, measured
- [CRITICAL-ISSUES.md](CRITICAL-ISSUES.md) — §5, the impersonation and recertification rules this must not weaken
- [CONVENTIONS.md](CONVENTIONS.md) — §6, why the RLS boundary stays in the database

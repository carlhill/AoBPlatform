# Keycloak Organizations — evaluated, not adopted

**Question:** Carl asked whether an existing open-source application could
provide practice-user management — invite by email, roles, scoping — rather
than building it. Keycloak 26 ships an **Organizations** feature, and we
already run Keycloak, so it was the first candidate.

**Verdict: use Keycloak for credentials, keep the practice model here, build
the thin user-management UI ourselves.**

**Evaluated 2026-08-22** against Keycloak 26.0.8, by enabling the feature on
the real realm, creating an organisation, adding a member and sending an
invitation. Everything below was observed, not recalled. The test artefacts
were removed and the feature switched back off.

---

## What it does give

| | |
|---|---|
| Organisation entity | name, alias, domains — created cleanly (`201`) |
| Membership | `POST /organizations/{id}/members` → `201` |
| **Invitation by email** | `POST /organizations/{id}/members/invite-user` → `204`, and the mail arrived: *"Invitation to join the eval-xlevelup organization"* |
| Domain-based membership | users with a matching email domain can join automatically |
| Per-org identity providers | a practice could bring its own SSO later |

The invitation flow is real and works. That was the most promising part.

## What it does not give, and why that settles it

**1. No per-organisation roles.**

```
GET /organizations/{id}/roles          → 404
GET /organizations/{id}/members/roles  → 404
```

Roles stay realm-level or client-level. So "admin at this practice, read-only
at that one" is not modelled — and that is precisely the requirement: several
named people per practice, each with a role, scoped to an org, a location or a
department.

We would end up encoding the scope into role NAMES
(`practice_admin_<practiceId>`) which is the anti-pattern this feature was
supposed to remove.

**2. ~~No organisation claim in the token~~ — CORRECTED 2026-08-22. This was
wrong.**

I wrote that there was no `organization` client scope in 26.0.8. Gemini said
the organisation context IS injected into the token, and Gemini is right.
Re-checked:

```
mapper type oidc-organization-membership-mapper  → EXISTS
master realm has `organization` scope            → true
aobplatform realm has it                         → false
```

Our realm lacks the scope because it was **imported from a realm export that
predates the feature**, not because Keycloak cannot do it. That is a config gap
of exactly the kind we closed for `practice_id` this morning, and it would take
minutes.

**So this is not an argument against adopting Organizations.** Struck out
rather than deleted, because a written evaluation that quietly corrects itself
is worse than one that shows what it got wrong.

**3. It would create a second definition of "a practice" — a real cost, but a
smaller one than first stated.**

The `practices` table holds the ABN, the entity, the checks, the evidence, the
RLS boundary and the consent records. A Keycloak Organization would hold a name
and a domain, and the two would have to be created, renamed and disabled in
step.

In fairness this is an ordinary arrangement — most systems let the identity
provider know about a tenant while the application owns the domain model, and
they are linked by an id. It is a maintenance cost, not a design error. It is
listed because it is real, not because it is decisive.

---

## What we take from Keycloak anyway

- **Account Console** (`/realms/aobplatform/account/`) — self-service credential
  management, already enabled. This is the answer to "how does somebody add a
  second passkey without another emailed link", and there is no reason to build
  it ourselves.
- **Groups**, if location/department scoping ever needs to be in the token.
- **Everything we already use**: accounts, passkeys, required actions, enable
  and disable, the enrolment email.

## What we build, and it is small

Invite a user, list users, set a role, deactivate and reactivate. Against
Keycloak's admin API, with the practice model staying here. That is a few
endpoints and one screen — considerably less than reconciling two systems.

## What is genuinely worth not building, later

If the "which role sees which page" matrix grows past a handful of rules,
**[OpenFGA](https://openfga.dev)** (CNCF, Zanzibar-style) is the right tool and
worth adopting rather than hand-rolling. For two or three roles it is more
machinery than the problem.

---

---

## Phase Two (`p2-inc/keycloak-orgs`) — the option that would change this

Gemini raised it and it is the strongest argument for adopting rather than
building. It is a real, widely-used open-source extension, and it supplies the
two things native Organizations does not:

- **Tenant-scoped roles** — `org-admin`, `org-member`, distinct from realm
  roles. This is the exact requirement: several named people per practice, each
  with a role.
- **A ready-made self-service portal** — practice admins invite and manage their
  own people without us building a screen.

### Why it is still not the recommendation TODAY

**It is a third-party extension to the identity layer.** That is a different
class of commitment from a library: it deploys inside Keycloak, follows its own
release cadence, and has to keep pace with Keycloak upgrades. Betting
authentication on it is a decision to make deliberately, with a look at its
maintenance record — not as a side effect of wanting an invite screen.

**What we actually need now is small.** Invite a user, list users, set one of
two roles, deactivate, reactivate. That is a few endpoints against Keycloak's
admin API and one screen. Adopting an extension to avoid building it trades a
week of work for a permanent dependency.

**And the scoping we need is not org-shaped.** Carl asked for roles per
ORGANISATION, LOCATION and DEPARTMENT. Phase Two scopes to the organisation.
Locations and departments are ours either way, so the extension would cover one
of three levels.

### The trigger that WOULD flip this

**A practice asking for its own SSO.** A hospital or a large group wanting
Azure AD or Okta against their own directory is the thing we should not build,
and it is Phase Two's strongest card — native Organizations offers per-org
identity providers too, so either route beats writing it.

If that request arrives, revisit this immediately rather than extending the
hand-rolled version.

### Recorded so the decision is reversible

Nothing being built now forecloses it. Users are Keycloak accounts either way;
adopting Organizations later means creating an Organization per practice and
attaching existing accounts, which is a migration script rather than a rewrite.

## Also observed

Keycloak's own console now warns: *"You are logged in as a temporary admin
user."* That is the `admin/admin` bootstrap account already tracked in
TODO.md — Keycloak agrees it should not be permanent.

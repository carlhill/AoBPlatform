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

**2. No organisation claim in the token, in this version.**

There is no `organization` client scope in 26.0.8. Our entire scoping model is
`practice_id` in the token feeding `x-practice-id` and RLS. Organizations would
not populate that without a custom mapper — and we already have a custom mapper
that works, added this session.

**3. It would create a second definition of "a practice".**

The `practices` table holds the ABN, the entity, the checks, the evidence, the
RLS boundary and the consent records. A Keycloak Organization would hold a name
and a domain. Two records claiming to be the same practice, kept in step by
hand, is the same class of problem as a shared account: two sources of truth for
something that must have one.

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

## Also observed

Keycloak's own console now warns: *"You are logged in as a temporary admin
user."* That is the `admin/admin` bootstrap account already tracked in
TODO.md — Keycloak agrees it should not be permanent.

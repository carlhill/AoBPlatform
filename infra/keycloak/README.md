# Keycloak (identity)

Keycloak 26 is the OIDC issuer (tech stack doc). A realm export
(`realm-export.json`) is added here when identity work starts (Phase 1,
onboarding step), imported automatically by the local container on first boot.

Non-negotiables (rule 15, REQ-VAULT-04):

- **WebAuthn passkeys are mandatory for provider and admin accounts — no
  password-only paths.** Enforced as a Keycloak authentication-flow
  configuration, checked in application code via `acr`/`amr` claims for
  step-up-gated actions.
- Patient/assignor portal: passkey-first with the three-identifier bootstrap
  (FR-8.2); passkey enrolment optional and never a barrier (REQ-CLIENT-02).
- Practitioner recovery is admin-attested re-invitation, not self-service
  email reset (FR-1.9).

Touching auth flows requires asking Carl first (CLAUDE.md §7).

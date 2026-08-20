# Terraform (AWS ap-southeast-2)

Stood up in Phase 0 per the build plan: account-per-environment from day zero,
fully Terraform-provisioned, no manual console changes. Modules to mirror the
ReferralPlatform structure (network / database / ecs / secrets) plus the vault
additions: S3 Object Lock (WORM) evidence buckets, HSM-backed KMS keys, and
the RFC 3161 anchoring job.

Nothing here is applied against a real AWS account yet — AWS account setup is
a Phase 0 procurement task (build plan §Phase 0, item 3).

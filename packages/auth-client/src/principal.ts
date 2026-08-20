/**
 * Deliberately local copy rather than a dependency on @aobplatform/domain —
 * auth-client stays usable from non-Nest contexts (the connector, tooling)
 * without pulling the domain package. Domain is the source of truth if they
 * ever drift.
 */
export type PrincipalType = 'provider' | 'practice_staff' | 'patient' | 'assignor' | 'system';

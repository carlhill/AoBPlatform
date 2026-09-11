-- Keycloak's own database, in the Postgres we already run with a volume.
--
-- WHY THIS EXISTS. Keycloak's `start-dev` keeps its state in an H2 file inside
-- the container's writable layer. Recreating that container — for a port
-- change, an image bump, anything at all — destroys every user, every role
-- grant and every enrolled passkey.
--
-- For a passkey-only system that is not an inconvenience. A password can be
-- reset by whoever holds the admin credentials; a passkey CANNOT be
-- re-derived, because the private half never left the person's device. Losing
-- the store means re-inviting every administrator and every practitioner, each
-- of whom has to be present at their own hardware to enrol again.
--
-- We already run Postgres with a persistent volume and a backup story. Keycloak
-- uses it, in its own database, isolated from the application schema.
--
-- A SEPARATE DATABASE, not a schema in `aobplatform`. Identity and application
-- data have different access patterns, different retention, and — the part that
-- matters — different blast radius: a migration that goes wrong on the
-- application side must not be able to take the credential store with it.

CREATE ROLE keycloak WITH LOGIN PASSWORD 'keycloak';
CREATE DATABASE keycloak OWNER keycloak;

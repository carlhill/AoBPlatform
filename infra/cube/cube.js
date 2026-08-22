/**
 * Cube configuration — the reporting layer.
 *
 * THE REQUIREMENT THIS SERVES: people and organisations must not see each
 * other's data. Everything below is arranged so that holds even when one part
 * of it is wrong.
 *
 * THREE LAYERS, none of them load-bearing alone:
 *
 *   1. IDENTITY. Tokens are verified against Keycloak's JWKS. There is no
 *      second user store and no shared secret to leak — a request either
 *      carries a token this realm signed, or it is refused.
 *
 *   2. THE DATABASE. `driverFactory` hands out a connection whose
 *      `app.practice_id` is fixed for that tenant, against a role that RLS
 *      applies to. The reporting view is `security_invoker`, so those policies
 *      are enforced against the connecting role. If everything below this were
 *      wrong, Postgres would still return one practice's rows.
 *
 *   3. THE QUERY. `queryRewrite` injects a mandatory practice filter, so the
 *      narrowing is also visible in the SQL Cube composes rather than only in
 *      what the database is willing to answer.
 *
 * AND `contextToAppId`, WHICH IS NOT A DETAIL. Cube caches compiled schemas and
 * query results per app id. Leaving it constant across tenants is THE classic
 * way a multi-tenant Cube leaks: practice A runs a query, practice B runs the
 * same one, and B is served A's cached rows without either query being wrong.
 * It includes the practice, so two tenants can never share a cache entry.
 */

const { PostgresDriver } = require('@cubejs-backend/postgres-driver');

const KEYCLOAK_INTERNAL = process.env.CUBE_KEYCLOAK_URL || 'http://keycloak:8080';
const REALM = process.env.CUBE_KEYCLOAK_REALM || 'aobplatform';

/**
 * What the token says about who is asking.
 *
 * DEFAULT DENY. An unrecognised shape produces `platform: false` and no
 * practice, which every path below reads as "show nothing" rather than "show
 * everything". The dangerous version of this function is the one where a
 * missing claim falls through to an unfiltered query.
 */
function identify(securityContext) {
  const ctx = securityContext || {};
  const roles = (ctx.realm_access && ctx.realm_access.roles) || ctx.roles || [];

  return {
    platform: Array.isArray(roles) && roles.includes('platform_admin'),
    // Our own claim, set on the account when it is created.
    practiceId: ctx.practice_id || ctx.practiceId || null,
  };
}

module.exports = {
  /**
   * STATED, RATHER THAN DISCOVERED BY OPENING A CONNECTION.
   *
   * Without this Cube works the database type out by calling `driverFactory`
   * — including while compiling the schema, which happens with no security
   * context at all. Ours refuses a tenant-less call, correctly, so the schema
   * never compiled and `/v1/meta` returned an empty list of cubes with the
   * real reason buried in a stack trace about `getDbType`.
   *
   * The type of the database is not a per-tenant fact, so asking a per-tenant
   * function for it was always the wrong question.
   */
  dbType: 'postgres',

  /**
   * THE BROWSER TALKS TO CUBE DIRECTLY, carrying the same Keycloak token it
   * uses for everything else.
   *
   * The alternative — proxying every query through core — would put our own
   * API in front of a query engine whose entire value is answering questions
   * we did not anticipate. Every new report would need an endpoint, which is
   * the situation Cube was adopted to end.
   *
   * It is safe to expose because the token is what scopes it, and the scoping
   * does not depend on the caller being trusted: the practice comes off a
   * signed claim, the connection is pinned to it, and the database refuses
   * anything wider. A browser can ask any QUESTION; it cannot widen its scope
   * by asking differently.
   *
   * Origins are listed rather than `*`, because credentials travel on these
   * requests and a wildcard would let any page a user visits query on their
   * behalf.
   */
  http: {
    cors: {
      origin: (process.env.CUBE_CORS_ORIGINS || 'http://localhost:3100,http://localhost:21100').split(','),
      credentials: true,
    },
  },

  /*
   * Keycloak verifies the caller, not us. `jwkUrl` means the signing keys are
   * fetched and rotated by Cube rather than pinned in config, so a key roll
   * does not become an outage nobody can explain.
   */
  jwt: {
    jwkUrl: `${KEYCLOAK_INTERNAL}/realms/${REALM}/protocol/openid-connect/certs`,
    issuer: [
      // Tokens carry the PUBLIC issuer regardless of which host the request
      // reached — the same lesson that cost us a day of 401s in the console.
      process.env.CUBE_KEYCLOAK_ISSUER || 'http://localhost:21024/realms/aobplatform',
    ],
    algorithms: ['RS256'],
  },

  /**
   * THE CACHE KEY, and the reason it is not a constant.
   *
   * Cube caches compiled schemas and query results against this. Two tenants
   * sharing an id share a cache, and the second one to ask a question is
   * served the first one's answer — a leak that leaves no wrong query behind
   * to find later.
   */
  contextToAppId: ({ securityContext }) => {
    const who = identify(securityContext);
    return who.platform ? 'aob_platform' : `aob_practice_${who.practiceId || 'none'}`;
  },

  /** Same reasoning, for the pre-aggregation store. */
  contextToOrchestratorId: ({ securityContext }) => {
    const who = identify(securityContext);
    return who.platform ? 'aob_platform' : `aob_practice_${who.practiceId || 'none'}`;
  },

  /**
   * A CONNECTION PER SCOPE, and the credentials differ.
   *
   * A platform report necessarily reads across practices, so it uses a role
   * that may — and that role is reachable only by a token this realm signed
   * carrying `platform_admin`. Everyone else gets a connection pinned to one
   * practice through `app.practice_id`, against a role RLS applies to.
   *
   * Pinning it on the CONNECTION rather than per query is what makes it
   * survive Cube's pooling: the setting cannot be left behind by one request
   * and picked up by the next, because every connection in that pool was
   * opened with it.
   */
  driverFactory: ({ securityContext }) => {
    const who = identify(securityContext);

    if (who.platform) {
      return new PostgresDriver({
        host: process.env.CUBEJS_DB_HOST,
        port: Number(process.env.CUBEJS_DB_PORT || 5432),
        database: process.env.CUBEJS_DB_NAME,
        user: process.env.CUBE_PLATFORM_DB_USER,
        password: process.env.CUBE_PLATFORM_DB_PASS,
      });
    }

    if (!who.practiceId) {
      /*
       * No practice and not platform. Refusing outright rather than returning
       * a driver that would read nothing: an empty report reads as "you have
       * sent nothing", which is a claim, and it would be false.
       */
      throw new Error(
        'This token does not say which practice it is for, so there is nothing to report on. Sign out and ' +
          'in again; if it keeps happening, tell us.',
      );
    }

    return new PostgresDriver({
      host: process.env.CUBEJS_DB_HOST,
      port: Number(process.env.CUBEJS_DB_PORT || 5432),
      database: process.env.CUBEJS_DB_NAME,
      user: process.env.CUBE_DB_USER,
      password: process.env.CUBE_DB_PASS,
      // The GUC every RLS policy in this database reads. Set at connection
      // time, so it is a property of the pool rather than of a request.
      options: `-c app.practice_id=${who.practiceId}`,
    });
  },

  /**
   * The third layer: say it in the SQL too.
   *
   * The database would already refuse, but a filter that is only implicit is
   * one nobody can see when reading a generated query — and "why is this
   * empty?" is much harder to answer than "why is this filtered?".
   */
  queryRewrite: (query, { securityContext }) => {
    const who = identify(securityContext);
    if (who.platform) return query;

    if (!who.practiceId) {
      throw new Error('No practice on this token, so this query is refused.');
    }

    query.filters = query.filters || [];
    query.filters.push({
      member: 'OutboundMessages.practiceId',
      operator: 'equals',
      values: [who.practiceId],
    });
    return query;
  },
};

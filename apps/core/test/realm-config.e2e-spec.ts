import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The realm export, checked as configuration rather than exercised as code.
 *
 * WHY THIS EXISTS. The export listed ten client scopes and never said which of
 * them were the realm's DEFAULTS. Keycloak took that literally: every client it
 * creates for itself — `account`, `account-console`, `security-admin-console`,
 * `broker` — was created with no default scopes at all, so their tokens carried
 * no `roles` scope, so no `resource_access` claim, so the account REST API
 * refused every call with a bare 403.
 *
 * What that looked like from the outside was "Manage passkeys is broken". The
 * roles were right, the client was enabled, the user was signed in, and the
 * only wrong thing was an omission four levels away in a JSON file.
 *
 * Our own `web` client was unaffected, because the export names its scopes
 * explicitly — which is exactly why this went unnoticed. The thing that broke
 * was the half we did not write down.
 */
describe('keycloak realm export', () => {
  const realm = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'infra', 'keycloak', 'realm-export.json'), 'utf8'),
  ) as {
    clientScopes?: { name: string }[];
    defaultDefaultClientScopes?: string[];
    defaultOptionalClientScopes?: string[];
    clients?: { clientId: string; defaultClientScopes?: string[] }[];
  };

  it('declares which client scopes are the realm defaults', () => {
    expect(realm.defaultDefaultClientScopes ?? []).not.toHaveLength(0);
  });

  it('includes `roles` among them, which is what carries resource_access', () => {
    // Without this claim a token proves who somebody is and nothing about what
    // they may do, and every API that checks a client role rejects it.
    expect(realm.defaultDefaultClientScopes).toContain('roles');
  });

  it('names only scopes the export actually defines', () => {
    const defined = new Set((realm.clientScopes ?? []).map((s) => s.name));
    // `offline_access` is built in rather than declared here, so it is exempt.
    const named = [...(realm.defaultDefaultClientScopes ?? []), ...(realm.defaultOptionalClientScopes ?? [])].filter(
      (n) => n !== 'offline_access',
    );
    expect(named.filter((n) => !defined.has(n))).toEqual([]);
  });

  it('still lists the web client’s scopes explicitly', () => {
    // Belt and braces. The realm default now covers it, but `web` is ours and
    // the one client whose token shape we depend on directly.
    const web = (realm.clients ?? []).find((c) => c.clientId === 'web');
    expect(web?.defaultClientScopes).toContain('roles');
  });
});

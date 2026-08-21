#!/usr/bin/env node
/**
 * Invite a platform administrator.
 *
 * THE BOOTSTRAP PROBLEM, AND WHY THIS IS A CLI.
 *
 * Somebody has to create administrator number one, and that act cannot itself
 * be authenticated as an administrator — there is nobody to be yet. Every way
 * of solving that is a trade, and the three obvious ones are worse:
 *
 *   - A SELF-SERVICE SIGNUP PAGE. Anyone who reaches the URL becomes able to
 *     approve practices. The most privileged role in the system, granted by
 *     whoever finds the link.
 *   - A SEEDED ADMIN IN THE REALM EXPORT. A credential in version control, the
 *     same in every environment, and impossible to attribute — "who approved
 *     this" answers "the seed account".
 *   - AN ENDPOINT ON THE API. It would have to be unauthenticated to be usable
 *     at bootstrap, which is a permanent hole kept open for a one-off.
 *
 * So: a command, run deliberately, by somebody who already holds the Keycloak
 * administrator credentials. That person's authority is the root of trust, it
 * is authority they already have, and running this is a decision rather than a
 * side effect. The invitation it mints is single-use and expires.
 *
 * WHAT IT DOES NOT DO. It never sets a password, because there is no password
 * path in this realm. It creates the account with `webauthn-register-passwordless`
 * as a required action, so the invitee's first act is enrolling a passkey and
 * they cannot get in any other way.
 *
 * Usage:
 *   node infra/keycloak/invite-platform-admin.mjs --email you@example.com --name "Marta Ellis"
 *
 * Environment (all with sane local defaults):
 *   KEYCLOAK_BASE_URL, KEYCLOAK_REALM, KEYCLOAK_ADMIN_USER, KEYCLOAK_ADMIN_PASSWORD, CONSOLE_URL
 */

/*
 * 127.0.0.1 for the SERVER call, `localhost` for anything the BROWSER follows.
 *
 * They are not interchangeable and the distinction bites in both directions.
 * Node on Windows resolves `localhost` to ::1 first, where Docker's IPv6
 * forwarding accepts the connection and then fails the handshake — so a
 * server-side fetch to `localhost` dies with a bare "fetch failed".
 *
 * But the redirect URL is validated against the client's REGISTERED redirect
 * URIs, which say `localhost` because that is what a person types. Sending
 * 127.0.0.1 there gets a 400 with no explanation.
 */
const BASE = process.env.KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:21024';
const REALM = process.env.KEYCLOAK_REALM ?? 'aobplatform';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const CONSOLE_URL = process.env.CONSOLE_URL ?? 'http://localhost:3100';
const CLIENT_ID = 'console';
const ROLE = 'platform_admin';
/** Long enough to act on across a weekend, short enough that a stale copy is worthless. */
const INVITE_LIFETIME_SECONDS = 3 * 24 * 60 * 60;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function adminToken() {
  const res = await fetch(`${BASE}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
    }),
  });
  if (!res.ok) {
    die(
      `Could not authenticate to Keycloak at ${BASE} as "${ADMIN_USER}" (${res.status}).\n` +
        '  This command is deliberately restricted to whoever holds the Keycloak administrator\n' +
        '  credentials — that authority is the root of trust for the first platform admin.',
    );
  }
  return (await res.json()).access_token;
}

async function api(token, path, init = {}) {
  const res = await fetch(`${BASE}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function main() {
  const email = arg('--email');
  const name = arg('--name');

  if (!email || !name) {
    die(
      'Usage: node infra/keycloak/invite-platform-admin.mjs --email <address> --name "<full name>"\n\n' +
        '  Creates a passkey-only platform administrator and prints a single-use\n' +
        '  enrolment link. There is no password to set, and no way to set one.',
    );
  }

  const token = await adminToken();

  // The role must exist before anything is granted it — a user created and then
  // failed to be granted the role is a half-made account nobody notices.
  const roleRes = await api(token, `/roles/${ROLE}`);
  if (!roleRes.ok) {
    die(
      `The realm role "${ROLE}" does not exist in "${REALM}".\n` +
        '  Import infra/keycloak/realm-export.json first, or the account would be created with no\n' +
        '  permissions at all — which fails silently at the moment somebody tries to use it.',
    );
  }
  const role = await roleRes.json();

  /*
   * THE USERNAME IS THE EMAIL, and that is a decision about what Windows shows.
   *
   * When somebody enrols a passkey, Windows lists it by the WebAuthn username —
   * NOT by the label they typed into Keycloak's own prompt. So an admin who
   * carefully names their credential "AoBPasskey1" is later shown a chooser
   * offering "admin.carl", recognises neither the name nor the account, and
   * reasonably concludes their passkey is missing. That happened on the first
   * real enrolment and cost the best part of an hour.
   *
   * An email address is the one identifier a person will recognise in an
   * operating-system dialog they did not expect. Keycloak permits it as a
   * username, and nothing else here depends on the shape.
   *
   * Note this does NOT rename an existing credential: Windows recorded the
   * username at enrolment time, so an account created before this keeps showing
   * its old name until the passkey is re-enrolled.
   */
  const username = email.trim().toLowerCase();
  const [firstName, ...rest] = name.trim().split(/\s+/);

  const existing = await (await api(token, `/users?email=${encodeURIComponent(email)}&exact=true`)).json();
  let userId = existing[0]?.id;

  if (userId) {
    console.log(`\n  An account already exists for ${email}. Re-sending the enrolment link.`);
  } else {
    const create = await api(token, '/users', {
      method: 'POST',
      body: JSON.stringify({
        username,
        email,
        emailVerified: false,
        enabled: true,
        firstName,
        lastName: rest.join(' ') || firstName,
        // NO credentials array, and that is the point: this account has no
        // password and none can be set through this path.
        requiredActions: ['webauthn-register-passwordless'],
        attributes: {
          principal_type: ['platform_admin'],
          // Deliberately NO practice_id. A platform admin belongs to no
          // practice; everything they do is cross-tenant, and a practice claim
          // on this account would silently scope them to one.
        },
      }),
    });
    if (!create.ok) die(`Could not create the account: ${create.status} ${await create.text()}`);

    const located = await (await api(token, `/users?email=${encodeURIComponent(email)}&exact=true`)).json();
    userId = located[0]?.id;
    if (!userId) die('The account was created but could not be found again — check Keycloak.');
  }

  const grant = await api(token, `/users/${userId}/role-mappings/realm`, {
    method: 'POST',
    body: JSON.stringify([{ id: role.id, name: role.name }]),
  });
  if (!grant.ok && grant.status !== 409) {
    die(`The account exists but the ${ROLE} role could not be granted: ${grant.status} ${await grant.text()}`);
  }

  // Keycloak emails this itself when SMTP is configured; the link is printed
  // too, because in development it goes to a sink nobody watches.
  const link = await api(
    token,
    `/users/${userId}/execute-actions-email?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(CONSOLE_URL)}&lifespan=${INVITE_LIFETIME_SECONDS}`,
    { method: 'PUT', body: JSON.stringify(['webauthn-register-passwordless']) },
  );

  console.log(`\n  Platform administrator invited.\n`);
  console.log(`    Name      ${name}`);
  console.log(`    Email     ${email}`);
  console.log(`    Username  ${username}`);
  console.log(`    Role      ${ROLE}`);
  console.log(`    Sign-in   ${CONSOLE_URL}\n`);

  if (link.ok) {
    console.log('  An enrolment email has been sent. In development that goes to MailHog:');
    console.log('    http://localhost:21026\n');
  } else {
    console.log(`  Keycloak could not send the email (${link.status}). Mint a link manually with:`);
    console.log('    node infra/keycloak/latest-invite-link.mjs\n');
  }

  console.log('  Their first act is enrolling a passkey. There is no password on this account and');
  console.log('  no way to set one — the realm has no password form for this client.\n');
  console.log('  Note this down: WHO ran this command is the root of trust for that account.\n');
}

main().catch((err) => die(err.message));

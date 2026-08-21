#!/usr/bin/env node
/**
 * Add ANOTHER passkey to an existing account — a second device, not a recovery.
 *
 * WHY THIS IS A SEPARATE COMMAND FROM THE RESET.
 *
 * The two look similar and mean opposite things, and confusing them is
 * expensive in both directions:
 *
 *   - RECOVERY revokes every existing credential first, because "lost" and
 *     "stolen" are indistinguishable from the report and adding a credential
 *     without removing the old ones leaves an attacker's one live.
 *   - ADDING A DEVICE must revoke NOTHING. Somebody with a desktop at the
 *     clinic and a laptop at home needs both to work.
 *
 * Sharing one command with a flag would mean the destructive behaviour is one
 * mistyped argument away from somebody who only wanted a second laptop. Two
 * commands, two names, and the dangerous one says "recover" in its filename.
 *
 * WHY IT EXISTS AT ALL. Until this was written the only enrolment path was the
 * recovery tool, so in practice an account could only ever hold one passkey —
 * not because Keycloak limits it, and not because userVerification:required
 * limits it, but because the tooling only knew how to replace. That is a false
 * constraint, and "your passkey only works at one machine" is a fair objection
 * to the whole model. Passkeys do not have that limitation; our scripts did.
 *
 * Usage:
 *   node infra/keycloak/add-passkey-device.mjs --email you@example.com
 *   node infra/keycloak/add-passkey-device.mjs --email you@example.com --note "clinic laptop"
 */

/*
 * 127.0.0.1 for the SERVER call, `localhost` for anything the BROWSER follows.
 * Node on Windows resolves `localhost` to ::1 first, where Docker's IPv6
 * forwarding accepts the connection and then fails the handshake. But the
 * redirect is validated against the client's REGISTERED redirect URIs, which
 * say localhost. See PASSKEYS.md.
 */
const BASE = process.env.KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:21024';
const REALM = process.env.KEYCLOAK_REALM ?? 'aobplatform';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const CONSOLE_URL = process.env.CONSOLE_URL ?? 'http://localhost:3100';
const CLIENT_ID = 'console';

/**
 * Shorter than an invitation and shorter than a recovery.
 *
 * Adding a device is something somebody is doing RIGHT NOW, at the second
 * device, having just asked. A link that outlives the sitting is a credential
 * left lying about for no benefit.
 */
const LINK_LIFETIME_SECONDS = 60 * 60;

/** Providers known not to set the user-verification flag. See PASSKEYS.md. */
const PROVIDERS = {
  '08987058-cadc-4b81-b6e1-30de50dcbe96': { name: 'Windows Hello Hardware', uv: true },
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': { name: 'Windows Hello Software', uv: true },
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': { name: 'Windows Hello VBS', uv: true },
  'd3452668-01fd-4c12-926c-83a4204853aa': { name: 'Microsoft Password Manager', uv: false },
};

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
  if (!res.ok) die(`Could not authenticate to Keycloak at ${BASE} as "${ADMIN_USER}" (${res.status}).`);
  return (await res.json()).access_token;
}

async function api(token, path, init = {}) {
  return fetch(`${BASE}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function main() {
  const email = arg('--email');
  const note = arg('--note');

  if (!email) {
    die(
      'Usage: node infra/keycloak/add-passkey-device.mjs --email <address> [--note "<which device>"]\n\n' +
        '  Adds ANOTHER passkey to an existing account. Revokes nothing.\n' +
        '  To replace a lost or stolen credential, use reset-platform-admin-passkey.mjs\n' +
        '  instead — that one revokes first, on purpose.',
    );
  }

  const token = await adminToken();

  const found = await (await api(token, `/users?email=${encodeURIComponent(email)}&exact=true`)).json();
  const user = found[0];
  if (!user) {
    die(
      `No account exists for ${email} in realm "${REALM}".\n` +
        '  This command adds a device to an account that already exists. To create one,\n' +
        '  use invite-platform-admin.mjs.',
    );
  }

  const credentials = await (await api(token, `/users/${user.id}/credentials`)).json();
  const passkeys = (credentials ?? []).filter((c) => String(c.type).startsWith('webauthn'));

  console.log(`\n  Adding a passkey for ${user.username} <${email}>`);
  if (note) console.log(`    Device      ${note}`);
  console.log(`    Existing    ${passkeys.length} passkey(s), and NONE will be revoked\n`);

  /*
   * Report what is already registered, and flag anything that cannot produce a
   * verified assertion. Somebody adding their third device should be told that
   * their first one has been quietly unusable — that is the moment they are
   * paying attention to passkeys, and they will not look again for months.
   */
  for (const credential of passkeys) {
    let providerNote = '';
    try {
      const data = JSON.parse(credential.credentialData ?? '{}');
      const provider = PROVIDERS[String(data.aaguid).toLowerCase()];
      if (provider) {
        providerNote = provider.uv
          ? ` — ${provider.name}`
          : ` — ${provider.name}, WHICH CANNOT SIGN IN (see PASSKEYS.md)`;
      }
    } catch {
      // A credential we cannot parse is still a credential; say so and move on.
    }
    console.log(`    Keeping     ${credential.userLabel ?? '(unlabelled)'}${providerNote}`);
  }

  // Sessions are NOT ended. This is an ordinary act by somebody already
  // working; logging them out of the machine they are standing at would be
  // gratuitous, and it is what separates this from a recovery.
  const required = await api(token, `/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...user, requiredActions: ['webauthn-register-passwordless'] }),
  });
  if (!required.ok) die(`Could not set the enrolment requirement: ${required.status} ${await required.text()}`);

  const link = await api(
    token,
    `/users/${user.id}/execute-actions-email?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(CONSOLE_URL)}&lifespan=${LINK_LIFETIME_SECONDS}`,
    { method: 'PUT', body: JSON.stringify(['webauthn-register-passwordless']) },
  );

  console.log('\n  Done. The next sign-in on the NEW device enrols a passkey there.');
  console.log('  Every existing passkey keeps working.\n');

  if (link.ok) {
    console.log('  An enrolment email has been sent. In development that goes to MailHog:');
    console.log('    http://localhost:21026\n');
  } else {
    console.log(`  Keycloak could not send the email (${link.status}). Mint a link manually with:`);
    console.log('    node infra/keycloak/latest-invite-link.mjs\n');
  }

  console.log('  OPEN THE LINK ON THE DEVICE THE PASSKEY IS FOR. A passkey is created where it');
  console.log('  is enrolled — following this on the machine you are already using just adds a');
  console.log('  second credential to the same one.\n');
  console.log('  On Windows, check the dialog is headed "Windows Security". If it says');
  console.log('  "Microsoft Password Manager", that credential will not be able to sign in.\n');
}

main().catch((err) => die(err.message));

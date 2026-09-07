#!/usr/bin/env node
/**
 * Recover a platform administrator who has lost their passkey.
 *
 * NOT A BACKDOOR, and the distinction is the whole design. A backdoor is a
 * permanent bypass, and for the role that can approve practices a permanent
 * bypass is worth exactly as much as whatever protects it — if a phone call
 * can mint a new passkey, the passkey is worth a phone call.
 *
 * This is a RECOVERY PATH with the same root of trust as the bootstrap:
 * whoever holds the Keycloak administrator credentials. That is authority they
 * already have, exercised deliberately, at a keyboard, and recorded.
 *
 * LOST IS NOT STOLEN, and this treats them the same on purpose.
 *
 *   - Lost: the device is gone, nobody else can use it, and re-enrolling is
 *     enough.
 *   - Stolen: somebody else holds a working credential, and merely ADDING a new
 *     one leaves theirs live.
 *
 * The person reporting it cannot reliably tell the difference — a phone left in
 * a taxi is "lost" until it is not. So every reset REVOKES every existing
 * WebAuthn credential on the account before issuing a new enrolment. The cost
 * when it was merely lost is nil; the cost of guessing wrong the other way is
 * an attacker with standing access to practice approval.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   - It sets no password. There is no password path in this realm and this
 *     does not create one. An account that can fall back to a password is an
 *     account whose passkey is decorative.
 *   - It does not grant the role. If the account has lost its role that is a
 *     separate decision, made deliberately, not smuggled through a recovery.
 *   - It does not run unattended. No endpoint, no scheduled job, no API.
 *
 * THE LOCKOUT QUESTION. If the Keycloak administrator credential is ALSO lost,
 * nothing here helps — that credential is the last resort and must be stored
 * accordingly. In this repository it is admin/admin in docker-compose, which is
 * correct for a local sink and catastrophic anywhere else.
 *
 * Usage:
 *   node infra/keycloak/reset-platform-admin-passkey.mjs --email you@example.com --reason "lost phone, reported 22 Aug"
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
const INVITE_LIFETIME_SECONDS = 24 * 60 * 60;

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
        '  Recovery is restricted to whoever holds the Keycloak administrator credentials.\n' +
        '  That is the root of trust, and it is the same one used to create the account.',
    );
  }
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
  const reason = arg('--reason');

  if (!email || !reason) {
    die(
      'Usage: node infra/keycloak/reset-platform-admin-passkey.mjs --email <address> --reason "<why>"\n\n' +
        '  Revokes every passkey on the account and issues a fresh enrolment link.\n' +
        '  The reason is required and is printed into the record — "who reset this, and why"\n' +
        '  is the question somebody will ask later, and the answer should not be a guess.',
    );
  }

  const token = await adminToken();

  const found = await (await api(token, `/users?email=${encodeURIComponent(email)}&exact=true`)).json();
  const user = found[0];
  if (!user) die(`No account exists for ${email} in realm "${REALM}".`);

  const roles = await (await api(token, `/users/${user.id}/role-mappings/realm`)).json();
  const isPlatformAdmin = (roles ?? []).some((r) => r.name === ROLE);
  if (!isPlatformAdmin) {
    die(
      `${email} is not a ${ROLE}. This command recovers platform administrators only.\n` +
        '  Recovering an account into a role it does not hold would be a grant wearing a\n' +
        '  recovery costume, and grants are a separate, deliberate decision.',
    );
  }

  // A lockout check BEFORE anything is revoked. Losing the only administrator's
  // passkey should be recoverable; being the only administrator at all is a
  // standing risk worth naming out loud rather than discovering during one.
  const admins = await (await api(token, `/roles/${ROLE}/users`)).json();
  const adminCount = Array.isArray(admins) ? admins.length : 0;

  const credentials = await (await api(token, `/users/${user.id}/credentials`)).json();
  const passkeys = (credentials ?? []).filter((c) => String(c.type).startsWith('webauthn'));

  console.log(`\n  Recovering ${user.username} <${email}>`);
  console.log(`    Reason      ${reason}`);
  console.log(`    Passkeys    ${passkeys.length} currently registered`);
  console.log(`    Admins      ${adminCount} account(s) hold ${ROLE}\n`);

  /*
   * REVOKE FIRST, then re-enrol. Adding a credential without removing the old
   * ones is the version that fails when the device was stolen rather than lost
   * — and the person reporting it usually cannot tell which it was.
   */
  for (const credential of passkeys) {
    const res = await api(token, `/users/${user.id}/credentials/${credential.id}`, { method: 'DELETE' });
    if (!res.ok) die(`Could not revoke credential ${credential.id}: ${res.status} ${await res.text()}`);
    console.log(`    Revoked     ${credential.type} ${credential.id}`);
  }

  // Existing sessions die with the credential. A revoked passkey with a live
  // session is a revocation that has not happened yet.
  await api(token, `/users/${user.id}/logout`, { method: 'POST' });
  console.log('    Sessions    ended\n');

  const required = await api(token, `/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...user, requiredActions: ['webauthn-register-passwordless'] }),
  });
  if (!required.ok) die(`Could not set the enrolment requirement: ${required.status} ${await required.text()}`);

  const link = await api(
    token,
    `/users/${user.id}/execute-actions-email?client_id=${CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(CONSOLE_URL)}&lifespan=${INVITE_LIFETIME_SECONDS}`,
    { method: 'PUT', body: JSON.stringify(['webauthn-register-passwordless']) },
  );

  console.log('  Done. Their next sign-in enrols a new passkey; the old ones no longer work.\n');
  if (link.ok) {
    console.log('  An enrolment email has been sent. In development that goes to MailHog:');
    console.log('    http://localhost:21026\n');
  } else {
    console.log(`  Keycloak could not send the email (${link.status}). Mint a link manually with:`);
    console.log('    node infra/keycloak/latest-invite-link.mjs\n');
  }

  console.log('  The enrolment link is valid for 24 hours — shorter than an invitation, because a');
  console.log('  recovery is expected NOW, by somebody who just asked for it.\n');

  if (adminCount < 2) {
    console.log('  ⚠  THIS REALM HAS FEWER THAN TWO PLATFORM ADMINISTRATORS.');
    console.log('     Losing this one\'s passkey is recoverable only while the Keycloak administrator');
    console.log('     credential survives. Invite a second administrator:');
    console.log('       node infra/keycloak/invite-platform-admin.mjs --email <address> --name "<name>"\n');
  }

  console.log(`  Record this: ${new Date().toISOString()} — recovered by whoever ran this command.`);
  console.log(`  Reason given: ${reason}\n`);
}

main().catch((err) => die(err.message));

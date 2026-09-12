#!/usr/bin/env node
/**
 * TIER 3 STILL WORKS INSIDE THE TIER 2 REALM — proved, not assumed.
 *
 * The single riskiest claim in AUTH-TIERS.md §2 is "passkeys are never
 * removed": adding a password path to a realm is exactly the change that
 * quietly turns a passkey-only account into a passkey-optional one, or breaks
 * the ceremony outright. So this enrols a real WebAuthn credential in the
 * sandbox realm and signs in with it alone, through the same `web` client the
 * console uses, and reads the amr claim off the token that comes back.
 *
 * It also does it for a PLATFORM OPERATOR, whose account holds `platform_admin`
 * and therefore meets the operator subflow rather than the practice one
 * (D-2026-09-12-11: hard rule 15 still governs our own people).
 *
 * A CDP VIRTUAL AUTHENTICATOR stands in for the fingerprint reader. It is the
 * only way to drive the ceremony without a human and a device, and it is the
 * same mechanism the main realm's enrolment was verified with on 12 Sep 2026.
 * Everything either side of the tap is real.
 *
 *   node infra/keycloak/tier2-realm.mjs
 *   node infra/keycloak/tier2-verify-passkey.mjs
 *
 * Exit code 0 only if every check passed.
 */

import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const PUBLIC = process.env.KEYCLOAK_PUBLIC_URL ?? 'http://localhost:21024';
const ADMIN = process.env.KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:21024';
const MAILHOG = process.env.MAILHOG_URL ?? 'http://localhost:21026';
const REALM = 'aobplatform-tier2';
const REDIRECT = 'http://localhost:3100/';
const CLIENT = 'web';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

async function adminToken() {
  const res = await fetch(`${ADMIN}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: process.env.KEYCLOAK_ADMIN_USER ?? 'admin',
      password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin',
    }),
  });
  if (!res.ok) throw new Error(`admin token: ${res.status}`);
  return (await res.json()).access_token;
}

let TOKEN;
const api = (path, init = {}) =>
  fetch(`${ADMIN}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

async function recreateUser({ username, email, roles }) {
  for (const u of await (await api(`/users?username=${encodeURIComponent(username)}&exact=true`)).json()) {
    await api(`/users/${u.id}`, { method: 'DELETE' });
  }
  const created = await api('/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      email,
      firstName: 'Tier2',
      lastName: 'Passkey',
      enabled: true,
      emailVerified: true,
      // No password credential is ever created for these accounts, so a
      // sign-in that succeeds cannot have used one.
      requiredActions: ['webauthn-register-passwordless'],
      credentials: [],
    }),
  });
  if (!created.ok) throw new Error(`create ${username}: ${created.status} ${await created.text()}`);
  const user = (await (await api(`/users?username=${encodeURIComponent(username)}&exact=true`)).json())[0];
  if (roles?.length) {
    const all = await (await api('/roles')).json();
    await api(`/users/${user.id}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify(all.filter((r) => roles.includes(r.name))),
    });
  }
  return user;
}

async function invitationLinkFor(user, address) {
  const before = new Set(((await (await fetch(`${MAILHOG}/api/v2/messages`)).json()).items ?? []).map((m) => m.ID));
  const sent = await api(
    `/users/${user.id}/execute-actions-email?${new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, lifespan: '3600' })}`,
    { method: 'PUT', body: JSON.stringify(['webauthn-register-passwordless']) },
  );
  if (!sent.ok) throw new Error(`invitation: ${sent.status} ${await sent.text()}`);
  const { items = [] } = await (await fetch(`${MAILHOG}/api/v2/messages`)).json();
  const message = items.find((m) => !before.has(m.ID) && `${m.To?.[0]?.Mailbox}@${m.To?.[0]?.Domain}` === address);
  if (!message) throw new Error(`no invitation reached ${address}`);
  const body = (message.Content?.Body ?? '').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const link = body.match(/http:\/\/localhost:21024[^"'<\s]+/)?.[0];
  if (!link) throw new Error('the invitation carried no link');
  return link;
}

/** One headless browser with a virtual authenticator attached. */
async function openBrowser() {
  const ctx = await chromium.launchPersistentContext('', { headless: true });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      // USER VERIFICATION IS THE POINT. The realm requires it, and an
      // authenticator that only proves possession is refused - which is
      // precisely what Microsoft Password Manager does on Windows
      // (CRITICAL-ISSUES.md §2). Simulating it here keeps the check honest.
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  // The credential label prompt. Keycloak asks for one; nothing depends on it.
  page.on('dialog', (d) => d.accept('Tier 2 verification key'));
  return { ctx, page, cdp, authenticatorId };
}

function authorizeUrl(verifier) {
  return (
    `${PUBLIC}/realms/${REALM}/protocol/openid-connect/auth?` +
    new URLSearchParams({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid',
      state: randomBytes(8).toString('hex'),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })
  );
}

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

async function enrolPasskey(page, link) {
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  const proceed = page.locator('a[href*="key="], #kc-login, #kc-accept');
  if (await proceed.count()) {
    await proceed.first().click();
    await page.waitForLoadState('domcontentloaded');
  }
  await page.waitForSelector('#registerWebAuthn', { timeout: 20000 });
  await page.click('#registerWebAuthn');
  await page.waitForTimeout(5000);
}

/**
 * Sign in with the passkey and nothing else. Returns the token's claims plus
 * the fields every page along the way asked for, so "no password was typed"
 * is an observation rather than an inference.
 */
async function signInWithPasskey(page, username, verifier) {
  const asked = [];
  await page.goto(authorizeUrl(verifier), { waitUntil: 'domcontentloaded' });

  const identifier = page.locator('#username');
  if (await identifier.count()) {
    asked.push(...(await page.locator('input:not([type=hidden])').evaluateAll((els) => els.map((e) => e.name || e.type))));
    await identifier.fill(username);
    await page.locator('input[type="submit"], button[type="submit"]').first().click();
    await page.waitForLoadState('domcontentloaded');
  }
  await page.waitForTimeout(500);
  asked.push(...(await page.locator('input:not([type=hidden])').evaluateAll((els) => els.map((e) => e.name || e.type))));

  const start = page.locator('#authenticateWebAuthnButton');
  if (await start.count()) await start.first().click();
  else {
    const submit = page.locator('input[type="submit"], button[type="submit"]');
    if (await submit.count()) await submit.first().click();
  }

  await page.waitForURL((url) => url.searchParams.has('code') || url.searchParams.has('error'), { timeout: 25000 });
  const url = new URL(page.url());
  const code = url.searchParams.get('code');
  if (!code) throw new Error(`sign-in ended at ${url.searchParams.get('error')}`);

  const res = await fetch(`${PUBLIC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange: ${res.status} ${await res.text()}`);
  return { access: claims((await res.json()).access_token), asked };
}

async function prove({ username, email, roles, label }) {
  const user = await recreateUser({ username, email, roles });
  const link = await invitationLinkFor(user, email);
  const { ctx, page } = await openBrowser();
  try {
    await enrolPasskey(page, link);
    const credentials = await (await api(`/users/${user.id}/credentials`)).json();
    const passkeys = credentials.filter((c) => String(c.type).startsWith('webauthn'));
    const passwords = credentials.filter((c) => c.type === 'password');
    record(`${label}: a passkey enrolled and no password exists`, passkeys.length === 1 && passwords.length === 0,
      `credentials: ${credentials.map((c) => c.type).join(', ') || '(none)'}`);

    const verifier = randomBytes(32).toString('base64url');
    const { access, asked } = await signInWithPasskey(page, username, verifier);
    const amr = access.amr ?? [];
    record(`${label}: signs in with the passkey alone`, amr.includes('hwk') && !amr.includes('pwd') && !amr.includes('otp'),
      `amr=${JSON.stringify(amr)} preferred_username=${access.preferred_username}`);
    record(`${label}: no password field appeared anywhere in the flow`, !asked.includes('password'),
      `fields offered: [${[...new Set(asked)].join(', ')}]`);
  } finally {
    await ctx.close();
  }
}

async function main() {
  TOKEN = await adminToken();
  const realm = await (await api('')).json();
  if (realm.realm !== REALM) throw new Error(`realm ${REALM} is not there — run tier2-realm.mjs first`);
  console.log(`\n  Tier 2 sandbox, passkeys — ${PUBLIC}/realms/${REALM}\n`);

  await prove({
    username: 'tier2verify.passkeystaff',
    email: 'tier2verify.passkeystaff@aobplatform.local',
    roles: ['front_desk'],
    label: 'a practice account that prefers a passkey',
  });

  await prove({
    username: 'tier2verify.passkeyoperator',
    email: 'tier2verify.passkeyoperator@aobplatform.local',
    roles: ['platform_admin'],
    label: 'a_platform_operator_still_requires_a_passkey',
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(`\n  ${err.stack ?? err}\n`);
  process.exit(1);
});

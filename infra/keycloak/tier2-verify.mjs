#!/usr/bin/env node
/**
 * PROVE TIER 2 WORKS, against the live sandbox realm — not against a diagram.
 *
 * Every claim in AUTH-TIERS.md §4/§5 that can be checked without a phone is
 * checked here, end to end, through the real browser flow: the HTML forms
 * Keycloak serves, the cookies it sets, the authorization code it issues and
 * the token that comes back. The one-time codes are computed in Node from the
 * secret Keycloak generated during enrolment (RFC 6238, twenty lines below) —
 * the same arithmetic an authenticator app does, so no phone is in the loop
 * and the run is repeatable.
 *
 * WHAT IT DOES NOT COVER. The passkey half needs a WebAuthn authenticator; a
 * CDP virtual authenticator drives it in tier2-verify-passkey.mjs, which is
 * separate because it needs a browser and this does not.
 *
 *   node infra/keycloak/tier2-realm.mjs        # build the sandbox first
 *   node infra/keycloak/tier2-verify.mjs
 *
 * Exit code 0 only if every check passed. Accounts it creates are named
 * `tier2verify.*` and are recreated on each run.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

/*
 * `localhost` for anything a BROWSER would follow (redirect URIs are matched
 * as strings, and 127.0.0.1 is not on the registered list); 127.0.0.1 for the
 * admin calls, because Node on Windows resolves `localhost` to ::1 first and
 * Docker's IPv6 forwarding accepts the connection and then fails the
 * handshake. The same split as every other script in this directory.
 */
const PUBLIC = process.env.KEYCLOAK_PUBLIC_URL ?? 'http://localhost:21024';
const ADMIN = process.env.KEYCLOAK_BASE_URL ?? 'http://127.0.0.1:21024';
const MAILHOG = process.env.MAILHOG_URL ?? 'http://localhost:21026';
const REALM = 'aobplatform-tier2';
const REDIRECT = 'http://localhost:3100/';
const CLIENT = 'web';

/** A password that satisfies the realm policy. Test fixture, never a real secret. */
const GOOD_PASSWORD = 'brindabella-ridgeline-2026';
/** Ten characters: under the twelve the policy asks for. */
const SHORT_PASSWORD = 'wattletree';

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n          ${detail}` : ''}`);
};

// ---------------------------------------------------------------- admin API

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

async function recreateUser({ username, email, roles, requiredActions }) {
  const found = await (await api(`/users?username=${encodeURIComponent(username)}&exact=true`)).json();
  for (const u of found) await api(`/users/${u.id}`, { method: 'DELETE' });
  const created = await api('/users', {
    method: 'POST',
    body: JSON.stringify({
      username,
      email,
      firstName: 'Tier2',
      lastName: 'Verify',
      enabled: true,
      emailVerified: true,
      requiredActions,
      credentials: [],
    }),
  });
  if (!created.ok) throw new Error(`create ${username}: ${created.status} ${await created.text()}`);
  const user = (await (await api(`/users?username=${encodeURIComponent(username)}&exact=true`)).json())[0];
  if (!user) throw new Error(`created ${username} but could not read it back`);
  if (roles?.length) {
    const all = await (await api('/roles')).json();
    await api(`/users/${user.id}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify(all.filter((r) => roles.includes(r.name))),
    });
  }
  return user;
}

// -------------------------------------------------------------- RFC 6238

/**
 * The code an authenticator app would show, from the secret Keycloak put in
 * the setup form.
 *
 * TWO ENCODINGS, AND THE FORM CARRIES THE OTHER ONE. What a QR code holds is
 * the secret base32-encoded, and that is what everybody means by "the TOTP
 * secret". Keycloak's setup form does NOT post that: its hidden `totpSecret`
 * is the raw secret as characters, and Keycloak hashes those bytes directly
 * (`HmacOTP`, on `secret.getBytes()`). So this takes the raw value and uses
 * it as the key, which is the same arithmetic the phone does after decoding
 * the QR — and it is why there is no base32 anywhere in this file.
 */
function totp(rawSecret, { step = 0, period = 30, digits = 6, algorithm = 'sha1' } = {}) {
  const counter = Math.floor(Date.now() / 1000 / period) + step;
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm, Buffer.from(rawSecret, 'utf8')).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * A code this run has not spent yet.
 *
 * `otpPolicyCodeReusable` is false, deliberately (a code accepted twice is a
 * code an observer can replay), so a harness that signs in three times inside
 * one thirty-second window gets "Invalid authenticator code" on the second —
 * which looks exactly like a broken second factor and is in fact the second
 * factor working. Stepping forward a window gives a different code that the
 * realm still accepts, because otpPolicyLookAheadWindow is 1.
 */
const spentCodes = new Set();
const OTP_PERIOD = 30;
async function freshCode(secret) {
  // The realm accepts the previous, current and next window (lookAheadWindow 1).
  for (const step of [0, 1, -1]) {
    const code = totp(secret, { step });
    if (!spentCodes.has(code)) {
      spentCodes.add(code);
      return code;
    }
  }
  /*
   * All three spent. Waiting out the window is the honest answer rather than
   * loosening the realm: it is what a person with a phone would do, it happens
   * at most once in a run, and it is bounded by the period itself.
   */
  const wait = OTP_PERIOD * 1000 - (Date.now() % (OTP_PERIOD * 1000)) + 1000;
  console.log(`          (waiting ${Math.round(wait / 1000)}s for the next code window)`);
  await new Promise((resolve) => setTimeout(resolve, wait));
  return freshCode(secret);
}

// ------------------------------------------------------------ browser-ish

/** One session's cookies. Keycloak's flow is cookie-bound; a jar is the whole browser we need. */
function browser() {
  const jar = new Map();
  const cookies = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  return async function go(url, init = {}) {
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: { Cookie: cookies(), ...(init.headers ?? {}) },
    });
    for (const cookie of res.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return res;
  };
}

function parse(html) {
  const form = /<form[^>]*action="([^"]+)"[^>]*>/i.exec(html);
  return {
    html,
    action: form && form[1].replace(/&amp;/g, '&'),
    title: (/<title>([^<]*)<\/title>/i.exec(html) || [])[1] ?? '',
    /** Names of every input on the page — the honest answer to "what is it asking for". */
    fields: [...html.matchAll(/<input[^>]*\sname="([^"]+)"/gi)].map((m) => m[1]),
    hidden: Object.fromEntries(
      [...html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)]
        .map((m) => [/\sname="([^"]+)"/i.exec(m[0]), /\svalue="([^"]*)"/i.exec(m[0])])
        .filter(([n]) => n)
        .map(([n, v]) => [n[1], v ? v[1] : '']),
    ),
    message: [...html.matchAll(/<(?:p|span)[^>]*class="[^"]*(?:instruction|kc-feedback-text)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span)>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
      .filter(Boolean),
    /*
     * THE "CLICK HERE TO PROCEED" ANCHOR, which is not a form.
     *
     * An action-token link lands on a confirmation page first, deliberately:
     * a mail scanner that follows the link must not spend the token before the
     * person has seen it. So the invitation path has a GET in the middle of it
     * and a harness that only knows about forms stops here, one step short.
     */
    proceed: (/<div[^>]*id="kc-info-message"[\s\S]*?<a[^>]+href="([^"]+)"/i.exec(html) || [])[1]?.replace(/&amp;/g, '&'),
  };
}

const post = (go, action, fields) =>
  go(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

/** A PKCE authorization request, exactly as apps/web/app/auth.ts builds one. */
function authorizeUrl(verifier, clientId = CLIENT, extra = {}) {
  return (
    `${PUBLIC}/realms/${REALM}/protocol/openid-connect/auth?` +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'openid',
      redirect_uri: REDIRECT,
      state: randomBytes(8).toString('hex'),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...extra,
    })
  );
}

async function exchange(code, verifier, clientId = CLIENT) {
  const res = await fetch(`${PUBLIC}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange: ${res.status} ${await res.text()}`);
  return res.json();
}

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

/** Follow 302s until something that is not a redirect, or the app's own URL. */
async function follow(go, res, limit = 10) {
  let current = res;
  for (let i = 0; i < limit; i += 1) {
    const location = current.headers.get('location');
    if (!location) return current;
    if (location.startsWith(REDIRECT)) return current;
    current = await go(location);
  }
  return current;
}

function codeFrom(res) {
  const location = res.headers.get('location') ?? '';
  return new URL(location, REDIRECT).searchParams.get('code');
}

// ------------------------------------------------------------------ proofs

/**
 * ENROLMENT IN ONE PASS (AUTH-TIERS.md §4.4): the invitation link the platform
 * already sends, followed to a password and a registered authenticator app,
 * with nothing else in between. Returns the TOTP secret Keycloak generated.
 */
async function enrol(user, address) {
  const go = browser();
  const before = (await (await fetch(`${MAILHOG}/api/v2/messages`)).json()).items?.[0]?.ID;
  const sent = await api(
    `/users/${user.id}/execute-actions-email?${new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, lifespan: '3600' })}`,
    { method: 'PUT', body: JSON.stringify(['UPDATE_PASSWORD', 'CONFIGURE_TOTP']) },
  );
  if (!sent.ok) throw new Error(`invitation: ${sent.status} ${await sent.text()}`);

  const { items = [] } = await (await fetch(`${MAILHOG}/api/v2/messages`)).json();
  const message = items.find((m) => m.ID !== before && `${m.To?.[0]?.Mailbox}@${m.To?.[0]?.Domain}` === address);
  if (!message) throw new Error(`no invitation reached ${address}`);
  const body = (message.Content?.Body ?? '').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const link = body.match(/http:\/\/localhost:21024[^"'<\s]+/)?.[0];
  if (!link) throw new Error('the invitation carried no link');

  // The action-token landing page asks the person to confirm before the token
  // is spent — a link opened by a mail scanner must not consume the action.
  let page = parse(await (await follow(go, await go(link))).text());
  if (page.proceed) page = parse(await (await follow(go, await go(page.proceed))).text());

  /*
   * WHICHEVER FORM COMES FIRST. Keycloak orders required actions by their
   * registered priority, not by the order they were asked for, so this realm
   * serves the authenticator setup before the password. Asserting an order
   * here would be asserting a Keycloak default rather than anything tier 2
   * cares about — what matters is that BOTH are done before the person
   * reaches the application, and that is what the loop and the two flags
   * below actually check.
   */
  let secret;
  let policyRefused = '';
  let landed = '';
  let ending = '';
  for (let step = 0; step < 6; step += 1) {
    if (page.fields.includes('totp')) {
      secret = page.hidden.totpSecret;
      if (!secret) throw new Error('the authenticator setup page carried no secret');
      const res = await follow(
        go,
        await post(go, page.action, { totp: await freshCode(secret), totpSecret: secret, userLabel: 'Tier 2 verification' }),
      );
      landed = res.headers.get('location') ?? '';
      if (landed.startsWith(REDIRECT)) break;
      page = parse(await res.text());
      continue;
    }
    if (page.fields.includes('password-new')) {
      // The policy refuses a short one, and says so, before the good one is set.
      const refused = parse(
        await (await post(go, page.action, { 'password-new': SHORT_PASSWORD, 'password-confirm': SHORT_PASSWORD })).text(),
      );
      policyRefused = refused.message.join(' ');
      const res = await follow(
        go,
        await post(go, refused.action ?? page.action, { 'password-new': GOOD_PASSWORD, 'password-confirm': GOOD_PASSWORD }),
      );
      landed = res.headers.get('location') ?? '';
      if (landed.startsWith(REDIRECT)) break;
      page = parse(await res.text());
      continue;
    }
    /*
     * NO FORM LEFT TO FILL IN. The action-token flow finishes on an
     * information page ("Your account has been updated.") rather than
     * redirecting, so this is the ordinary end of enrolment, not a stall —
     * but only if both steps were actually done, which is what the two
     * assertions after the loop insist on.
     */
    ending = page.message.join(' ');
    break;
  }

  if (!secret) throw new Error('enrolment never reached the authenticator setup');
  if (!policyRefused) throw new Error('enrolment never reached the password form');
  if (!landed.startsWith(REDIRECT) && !ending) {
    throw new Error(`enrolment neither landed on the application nor finished: "${page.title}"`);
  }
  return { secret, policyRefused, ending: landed.startsWith(REDIRECT) ? `redirected to ${REDIRECT}` : ending };
}

/** A full sign-in: username, password, code. Returns the access token's claims. */
async function signIn(username, password, secret, { clientId = CLIENT, extra = {} } = {}) {
  const go = browser();
  const verifier = randomBytes(32).toString('base64url');
  let page = parse(await (await go(authorizeUrl(verifier, clientId, extra))).text());
  if (!page.fields.includes('username')) throw new Error(`expected the username form, got "${page.title}"`);

  let res = await post(go, page.action, { username });
  if (res.status !== 200) {
    const failed = parse(await res.text());
    throw new Error(`username step: ${res.status} ${failed.message.join(' ')}`);
  }
  page = parse(await res.text());
  if (!page.fields.includes('password')) throw new Error(`expected the password form, got [${page.fields.join(', ')}]`);

  res = await post(go, page.action, { username, password });
  page = parse(await res.text());
  if (!page.fields.includes('otp')) throw new Error(`expected the code form, got [${page.fields.join(', ')}] ${page.message.join(' ')}`);

  res = await follow(go, await post(go, page.action, { otp: await freshCode(secret) }));
  const code = codeFrom(res);
  if (!code) throw new Error(`no authorization code: ${res.status} ${parse(await res.text()).message.join(' ')}`);
  const tokens = await exchange(code, verifier, clientId);
  return { access: claims(tokens.access_token), id: claims(tokens.id_token), raw: tokens };
}

// -------------------------------------------------------------------- main

async function main() {
  TOKEN = await adminToken();
  const realm = await (await api('')).json();
  if (realm.realm !== REALM) throw new Error(`realm ${REALM} is not there — run tier2-realm.mjs first`);

  console.log(`\n  Tier 2 sandbox — ${PUBLIC}/realms/${REALM}\n`);

  // 1. A credential-less account is refused, not waved through.
  {
    const username = 'tier2verify.nocredential';
    await recreateUser({
      username,
      email: 'tier2verify.nocredential@aobplatform.local',
      roles: ['front_desk'],
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    });
    const go = browser();
    const verifier = randomBytes(32).toString('base64url');
    const page = parse(await (await go(authorizeUrl(verifier))).text());
    const res = await post(go, page.action, { username });
    const after = parse(await res.text());
    record(
      'an account with no credential cannot sign in at all',
      res.status !== 302 && !after.fields.includes('password') && after.message.length > 0,
      `${res.status} — ${after.message.join(' ')}`,
    );
  }

  // 2. Enrolment: one invitation, a password and an authenticator app.
  const address = 'tier2verify.frontdesk@aobplatform.local';
  const staff = await recreateUser({
    username: 'tier2verify.frontdesk',
    email: address,
    roles: ['front_desk'],
    requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
  });
  const { secret, policyRefused, ending } = await enrol(staff, address);
  record('enrolment sets a password and registers the authenticator app in one pass', Boolean(secret), ending);
  record(
    'the password policy refuses a short password',
    /12|length|invalid/i.test(policyRefused),
    policyRefused || '(no message captured)',
  );

  // 3. Every sign-in: password AND a code, and the token says so.
  {
    const session = await signIn('tier2verify.frontdesk', GOOD_PASSWORD, secret);
    const amr = session.access.amr ?? [];
    record(
      'a_session_records_how_it_authenticated — password and code',
      amr.includes('pwd') && amr.includes('otp') && !amr.includes('hwk'),
      `amr=${JSON.stringify(amr)} auth_time=${session.access.auth_time}`,
    );
    record('the session carries auth_time, so freshness can be judged', typeof session.access.auth_time === 'number');
    record(
      'the id token carries the same amr',
      JSON.stringify(session.id.amr ?? []) === JSON.stringify(amr),
      `id amr=${JSON.stringify(session.id.amr ?? [])}`,
    );
    record(
      'the token names core-service in its audience',
      [].concat(session.access.aud ?? []).includes('core-service'),
      `aud=${JSON.stringify(session.access.aud)}`,
    );
  }

  // 4. The code is not decoration: a wrong one refuses the sign-in.
  {
    const go = browser();
    const verifier = randomBytes(32).toString('base64url');
    let page = parse(await (await go(authorizeUrl(verifier))).text());
    page = parse(await (await post(go, page.action, { username: 'tier2verify.frontdesk' })).text());
    page = parse(await (await post(go, page.action, { username: 'tier2verify.frontdesk', password: GOOD_PASSWORD })).text());
    const res = await post(go, page.action, { otp: '000000' });
    const after = parse(await res.text());
    record(
      'a wrong one-time code refuses the sign-in',
      !codeFrom(res) && after.fields.includes('otp'),
      after.message.join(' '),
    );
  }

  // 5. The password alone is not enough — the code step is not skippable.
  {
    const go = browser();
    const verifier = randomBytes(32).toString('base64url');
    let page = parse(await (await go(authorizeUrl(verifier))).text());
    page = parse(await (await post(go, page.action, { username: 'tier2verify.frontdesk' })).text());
    const res = await post(go, page.action, { username: 'tier2verify.frontdesk', password: GOOD_PASSWORD });
    const after = parse(await res.text());
    record(
      'a password alone never reaches an authorization code',
      !codeFrom(res) && after.fields.includes('otp'),
      `next step asks for [${after.fields.join(', ')}]`,
    );
  }

  // 6. A platform operator meets the passkey, not the password — even here.
  {
    const username = 'tier2verify.operator';
    await recreateUser({
      username,
      email: 'tier2verify.operator@aobplatform.local',
      roles: ['platform_admin'],
      requiredActions: ['webauthn-register-passwordless'],
    });
    const go = browser();
    const verifier = randomBytes(32).toString('base64url');
    let page = parse(await (await go(authorizeUrl(verifier))).text());
    const res = await post(go, page.action, { username });
    const after = parse(await res.text());
    const passwordAsked = after.fields.includes('password') || /type="password"/i.test(after.html);
    record(
      'a_platform_operator_still_requires_a_passkey — at the practice client too',
      !passwordAsked,
      `${res.status}: [${after.fields.join(', ')}] ${after.message.join(' ')}`,
    );
  }

  // 7. Re-authentication is available, and it is a whole sign-in.
  {
    const session = await signIn('tier2verify.frontdesk', GOOD_PASSWORD, secret, { extra: { prompt: 'login' } });
    const amr = session.access.amr ?? [];
    record(
      'a_high_stakes_act_asks_for_the_second_factor_again — prompt=login re-runs both steps',
      amr.includes('pwd') && amr.includes('otp'),
      `amr=${JSON.stringify(amr)} auth_time=${session.access.auth_time}`,
    );
  }

  /*
   * 8. THE MAIN REALM IS STILL THERE AND STILL SERVING — nothing more, and the
   * check is named for exactly that.
   *
   * It is deliberately NOT called `a_patient_portal_sign_in_is_unaffected`,
   * which it would not prove: portal passkeys live in core, not Keycloak
   * (D-2026-09-04-02), so nothing in this realm could speak to them either
   * way. That named test is in apps/core/test/auth-tier2.e2e-spec.ts, where it
   * is checked structurally and behaviourally. What this catches is the thing
   * THIS script could actually break — the realm Carl signs in with, running
   * on the same Keycloak.
   */
  {
    const main = await fetch(`${ADMIN}/realms/aobplatform/.well-known/openid-configuration`);
    record('the main realm is untouched and still serving discovery', main.ok, `discovery ${main.status}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(`\n  ${err.stack ?? err}\n`);
  process.exit(1);
});

/**
 * Login-theme guard. Runs in CI with no Keycloak, beside realm-export.test.mjs.
 *
 *   node infra/keycloak/login-theme.test.mjs
 *
 * WHY THIS EXISTS. The passkey enrolment page is the only way anybody gets a
 * credential in a realm with no password path (rule 15), and its guidance panel
 * is rendered by a FreeMarker template out of a Java properties file. Two
 * things in that pairing fail quietly and one fails loudly:
 *
 *   - Keycloak runs every message through MessageFormat, so a LONE apostrophe
 *     in a value is silently swallowed and { } are read as placeholders. The
 *     text just comes out wrong, on a page nobody has a test for.
 *   - aobPasskeyStepCount<Platform> is read as a NUMBER, not printed. Get it
 *     wrong and ?number throws — and a FreeMarker error aborts the whole page.
 *     The template guards against that too, but a guard nobody can see fire is
 *     not a reason to skip the check that says why it would have.
 *   - Hard rule 12 words in user-facing copy. Every other string table in this
 *     repo has a named test for that; this one is user-facing copy as much as
 *     any of them.
 *
 * Read the file, don't trust the prose — the same lesson as
 * infra/keycloak/README.md §"A false claim, found and fixed".
 */
import { readFileSync } from 'node:fs';

const MESSAGES = new URL('./themes/aobplatform/login/messages/messages_en.properties', import.meta.url);
const TEMPLATE = new URL('./themes/aobplatform/login/webauthn-register.ftl', import.meta.url);
const THEME_PROPS = new URL('./themes/aobplatform/login/theme.properties', import.meta.url);

const raw = readFileSync(MESSAGES, 'utf8');
const template = readFileSync(TEMPLATE, 'utf8');
const themeProps = readFileSync(THEME_PROPS, 'utf8');

const failures = [];
const check = (label, condition) => {
  if (!condition) failures.push(label);
};

/** key -> value, comments and blanks dropped. */
const entries = new Map();
raw.split(/\r?\n/).forEach((line, i) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return;
  const eq = line.indexOf('=');
  if (eq === -1) {
    failures.push(`messages line ${i + 1} has no "=": ${trimmed.slice(0, 60)}`);
    return;
  }
  entries.set(line.slice(0, eq).trim(), line.slice(eq + 1));
});

check('the messages file has entries', entries.size > 0);

// --- MessageFormat hazards -------------------------------------------------
// A doubled '' is the correct escape; a lone one is the bug.
for (const [key, value] of entries) {
  check(`MessageFormat: lone apostrophe in ${key} (write it as '' or reword)`, !value.replaceAll("''", '').includes("'"));
  check(`MessageFormat: brace in ${key} (read as a placeholder)`, !/[{}]/.test(value));
  // Keycloak reads theme bundles as UTF-8, but a curly quote or dash that
  // arrived by paste is invisible in a diff and renders as mojibake anywhere
  // that does not. Keep this file plain.
  check(`non-ASCII character in ${key}`, /^[\x20-\x7e]*$/.test(value));
}

// --- hard rule 12 ----------------------------------------------------------
// Comments are excluded on purpose: the rule is quoted in this file's header.
for (const [key, value] of entries) {
  const hit = /\b(certified|approved|accredited|government-approved)\b/i.exec(value);
  check(`rule 12: "${hit?.[0]}" in ${key}`, hit === null);
}

// --- the count key that is read as a number --------------------------------
// The platform list is the template's, so a platform added to one and not the
// other is caught here rather than on the page.
const platforms = (/<#assign aobPlatforms = \[([^\]]*)\]>/.exec(template)?.[1] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/^"|"$/g, ''))
  .filter(Boolean);

check('the template declares its platform list', platforms.length > 0);

for (const platform of platforms) {
  const countKey = `aobPasskeyStepCount${platform}`;
  const countRaw = entries.get(countKey);
  check(`${countKey} exists`, countRaw !== undefined);
  const count = Number(countRaw);
  check(`${countKey} is a whole number (it is read with ?number)`, Number.isInteger(count) && count > 0);
  if (!Number.isInteger(count) || count <= 0) continue;

  for (let n = 1; n <= count; n += 1) {
    check(`aobPasskeyStep${platform}${n} exists (${countKey} says ${count})`, entries.has(`aobPasskeyStep${platform}${n}`));
  }
  // A step past the count is a step nobody will ever read.
  check(
    `no orphan aobPasskeyStep${platform}${count + 1} beyond ${countKey}=${count}`,
    !entries.has(`aobPasskeyStep${platform}${count + 1}`),
  );

  check(`aobPasskeyPlatform${platform} exists (the picker label)`, entries.has(`aobPasskeyPlatform${platform}`));
  check(`aobPasskeyNote${platform} exists`, entries.has(`aobPasskeyNote${platform}`));
}

// --- the keys the template asks for unconditionally ------------------------
for (const key of [
  'aobPasskeyGuidanceTitle',
  'aobPasskeyGuidanceIntro',
  'aobPasskeyPickerLabel',
  'aobPasskeyGuidanceHelp',
  'aobPasskeyNoteLabel',
]) {
  check(`${key} exists`, entries.has(key));
}

// --- rule 15: the override must not have grown an auth surface -------------
// The point of this theme is that it changes MARKUP AROUND the stock form and
// nothing inside it. A password input, a changed form action or a second form
// posting to loginAction would all be new authentication surface in a file
// that is not reviewed as authentication code.
check('rule 15: no password input in the template', !/type\s*=\s*["']password["']/i.test(template));
check('rule 15: no password message key rendered', !/msg\(\s*["'](password|doForgotPassword)["']/.test(template));
check(
  'the registration form still posts to url.loginAction',
  /<form id="register" action="\$\{url\.loginAction\}" method="post">/.test(template),
);
check(
  'the WebAuthn registration script is still the stock import',
  /import \{ registerByWebAuthn \} from "\$\{url\.resourcesPath\}\/js\/webauthnRegister\.js";/.test(template),
);
check('the six stock hidden fields are all present', [
  'clientDataJSON',
  'attestationObject',
  'publicKeyCredentialId',
  'authenticatorLabel',
  'transports',
  'error',
].every((id) => template.includes(`<input type="hidden" id="${id}" name="${id}"/>`)));

// --- the panel cannot take the page down -----------------------------------
check('the guidance panel is wrapped in #attempt', /<#attempt>[\s\S]*<aside class="aob-guidance"/.test(template));
check('the step count is parsed defensively', /<#attempt>\s*<#assign aobStepCount = aobCountRaw\?number>/.test(template));

// --- the theme is wired to the one it extends ------------------------------
check('the login theme extends keycloak.v2', /^parent=keycloak\.v2$/m.test(themeProps));
check("the parent's stylesheet is still listed", /^styles=.*\bcss\/styles\.css\b/m.test(themeProps));
check('our stylesheet is listed', /^styles=.*\bcss\/aob-login\.css\b/m.test(themeProps));

if (failures.length > 0) {
  console.error('Login theme FAILED:\n' + failures.map((f) => `  ✗ ${f}`).join('\n'));
  process.exit(1);
}
console.log(
  `Login theme OK — ${entries.size} messages, ${platforms.length} platforms (${platforms.join(', ')}), ` +
    'stock registration form intact.',
);

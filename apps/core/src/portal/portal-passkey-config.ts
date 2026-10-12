/**
 * THE RELYING PARTY — three strings, and getting any of them wrong is a passkey
 * that enrols and then never works again.
 *
 * WHY THIS IS CONFIGURATION AND NOT A CONSTANT. A WebAuthn credential is bound
 * to the RP ID at the moment it is created and can never be moved: enrol a
 * patient against `localhost` and that credential is useless on
 * `portal.aobplatform.com.au` forever. So the value has to differ per
 * environment, and it has to be impossible to ship a build with a development
 * default baked into it — hence `PORTAL_RP_ID` and `PORTAL_ORIGIN`, defaulted
 * only for the local dev pair (web on 3100, core on 3001).
 *
 * THE THREE ARE NOT INTERCHANGEABLE, and the failure modes are quiet:
 *
 *   PORTAL_RP_ID    the DOMAIN the credential is scoped to — `localhost`, or
 *                   `aobplatform.com.au`. No scheme, no port, no path. It must
 *                   be the origin's host or a registrable suffix of it, or the
 *                   browser refuses `navigator.credentials.create` with a
 *                   SecurityError that says nothing useful.
 *   PORTAL_ORIGIN   the full origin THE BROWSER IS ON — scheme, host and port,
 *                   `http://localhost:3100`. Compared as a string during
 *                   verification. This is the WEB app's origin, not core's:
 *                   the ceremony happens in the patient's browser on the page,
 *                   and core only checks what the browser reported.
 *   PORTAL_RP_NAME  what the passkey manager shows the patient when it asks
 *                   for their face or fingerprint. The one value here a person
 *                   ever reads, so it says what the thing is in plain words.
 *
 * MULTIPLE ORIGINS ARE SUPPORTED because a staging host and a production host
 * can legitimately share an RP ID; the value is comma-separated and every entry
 * is compared. It is a list, never a wildcard — an RP that accepts any origin
 * accepts a phishing page's origin.
 *
 * NOTHING HERE IS A SECRET. An RP ID and an origin are public by construction:
 * the browser is told both before the patient touches the sensor.
 */

export interface PortalRelyingParty {
  readonly rpID: string;
  readonly rpName: string;
  /** Every origin the ceremony may legitimately have happened on. Never a wildcard. */
  readonly origins: readonly string[];
}

/** The dev pair: web on 3100 in the browser, core on 3001 behind it. */
const DEFAULT_RP_ID = 'localhost';
const DEFAULT_ORIGIN = 'http://localhost:3100';

/**
 * NAMED WITHOUT "AoBPlatform" BEING THE WHOLE OF IT. This string is what a
 * patient sees in the system prompt on their own phone, months after they last
 * thought about us. "Bulk-billing record" is what they will recognise; a
 * product name on its own is not.
 *
 * It says nothing about being certified, approved or accredited (hard rule 12).
 */
const DEFAULT_RP_NAME = 'AoBPlatform — your bulk-billing record';

export function portalRelyingParty(env: NodeJS.ProcessEnv = process.env): PortalRelyingParty {
  const rpID = (env.PORTAL_RP_ID ?? DEFAULT_RP_ID).trim();
  const rpName = (env.PORTAL_RP_NAME ?? DEFAULT_RP_NAME).trim();
  const origins = (env.PORTAL_ORIGIN ?? DEFAULT_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  /*
   * FAIL AT BOOT RATHER THAN AT A PATIENT'S FIRST SIGN-IN. A blank RP ID or an
   * empty origin list produces a verification that refuses everything, which
   * looks exactly like an attack in the logs and exactly like a broken phone to
   * the patient. Neither is a diagnosis, so the process says so instead.
   */
  if (rpID.length === 0) {
    throw new Error('PORTAL_RP_ID is empty. It is the domain a passkey is bound to and has no safe default here.');
  }
  if (origins.length === 0) {
    throw new Error('PORTAL_ORIGIN is empty. It is the browser origin a passkey ceremony must have happened on.');
  }

  return { rpID, rpName, origins };
}

/**
 * WHICH PARTS OF AoB A PRACTICE ACTUALLY USES (D-2026-09-14-04).
 *
 * The first customer sees the DB4 path and nothing else: no waiting-room
 * walk-up, no ongoing agreements, no front-desk queue rails, no patient
 * portal, no practitioner pages. Those stay BUILT and stay OFF, and turning
 * one on is a column on the practice row — never a rebuild, never a branch,
 * never a deleted feature.
 *
 * THIS IS A SECOND CHECK BESIDE `mayReach`, NOT A CHANGE TO IT, and the
 * separation is the whole design. `mayReach` answers "may this KIND OF ACCOUNT
 * open this page" — it keys on audience alone, is synchronous, and has never
 * seen a practice. This answers "does THIS PRACTICE use this part of the
 * product", which is a different question with a different subject, and
 * folding it into the first would make one function whose answer depends on
 * two unrelated facts. Both must pass.
 *
 * IT IS A PERMISSION, AND THAT IS WHY IT IS NOT SHAPED LIKE THE SETTINGS
 * BESIDE IT. `usesQueueTickets` and `enduringByDefault` say in their own schema
 * comments that they are NOT permissions and gate nothing. This one gates: a
 * surface that is off is hidden in the console AND refused by the server, and
 * a setting that only hid things would be a setting that lies.
 *
 * THE LIST IS VERSIONED CONTENT, NOT CODE (hard rule 14, CLAUDE.md §7).
 * `content/practice-surfaces.json` declares the surfaces, which pages and
 * endpoints each covers, and the named profiles. A practice's profile is one
 * of those keys. Nothing in this module names a route, so a surface can gain a
 * page or an endpoint without a code change, and the version travels with the
 * record of every change to a practice's profile.
 *
 * NOT HERE: the display words. Every surface's name and the sentence that
 * explains it live in the string table keyed by surface key (REQ-LANG-01/-02).
 *
 * THE VALIDATION IS HAND-WRITTEN AND RUNS AT MODULE LOAD, for the reasons
 * `assignor-relationships.ts` gives at length: this package has zero runtime
 * dependencies by charter (CONVENTIONS.md §1), and a malformed edit must fail
 * the build at the bench rather than a practice in the morning.
 */

import { pageKeyFor } from './page-access';
import content from '../content/practice-surfaces.json';

/**
 * The answer for a page or endpoint that belongs to no optional surface:
 * signing in, setting the practice up, the day hub, the platform's own pages,
 * and the shared machinery every practice has. Never switchable.
 */
export const ALWAYS = 'always' as const;

/** A surface key, or `always`. Not a union type: the keys come from content. */
export type SurfaceOrAlways = string;

export interface PracticeSurface {
  /** Stable identifier. The string table is keyed by this; it is never shown. */
  readonly key: string;
  /** Console page paths — the `PAGES` keys of `page-access.ts`, exactly. */
  readonly pages: readonly string[];
  /** Core route prefixes, optionally `METHOD `-qualified, with `*` for a parameter. */
  readonly endpoints: readonly string[];
}

export interface SurfaceProfile {
  readonly key: string;
  readonly surfaces: readonly string[];
}

export interface PracticeSurfaceContent {
  /** Recorded on the event that changes a practice's profile. Bump on every edit. */
  readonly version: string;
  readonly always: { readonly pages: readonly string[]; readonly endpoints: readonly string[] };
  readonly surfaces: readonly PracticeSurface[];
  readonly profiles: readonly SurfaceProfile[];
}

/** The profile every practice has until somebody decides otherwise. */
export const DEFAULT_SURFACE_PROFILE = 'full';

/**
 * THE REASON CODE FOR "this practice does not use that part of AoB", named
 * once and read by both sides.
 *
 * Never a bare 403 (CLAUDE.md §7, "Shortcuts to the answer"). The refusal
 * carries this code and the surface key, the console maps the pair to copy and
 * a destination, and a code the console has not mapped shows its own code so
 * it can be diagnosed rather than becoming a shrug.
 *
 * IT IS NOT "that page is not for this account", which is the audience
 * refusal. Saying that here would be a lie: the account is fine, the practice
 * simply does not use the thing.
 */
export const SURFACE_REFUSED_CODE = 'practice_surface_not_in_use';

/**
 * Exhaustive, and it throws rather than repairing — the same posture as every
 * other content loader here. The reason the list is editable is that somebody
 * will edit it, so a shape the platform cannot use is a mistake to surface.
 */
export function parsePracticeSurfaceContent(raw: unknown): PracticeSurfaceContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/practice-surfaces.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a practice.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }

  const paths = (value: unknown, where: string): string[] => {
    if (!Array.isArray(value)) return fail(`${where} must be an array`);
    return value.map((entry, index) => {
      if (typeof entry !== 'string' || !/^(?:[A-Z]+ )?\/\S*$/.test(entry)) {
        return fail(`${where}[${index}] must be a path, optionally prefixed by an upper-case method`);
      }
      return entry;
    });
  };

  const always = doc.always;
  if (typeof always !== 'object' || always === null) return fail('`always` must be an object');
  const alwaysDoc = always as Record<string, unknown>;
  const alwaysPages = paths(alwaysDoc.pages, '`always.pages`');
  const alwaysEndpoints = paths(alwaysDoc.endpoints, '`always.endpoints`');

  if (!Array.isArray(doc.surfaces) || doc.surfaces.length === 0) {
    return fail('`surfaces` must be a non-empty array');
  }

  const seenKeys = new Set<string>();
  /*
   * A PAGE OR AN ENDPOINT BELONGS TO EXACTLY ONE SURFACE. Two claims on one
   * path is not an ambiguity to resolve by ordering — it is two people who
   * each believe they own a screen, and the loser would be whichever happened
   * to be declared second.
   */
  const claimedPages = new Map<string, string>();
  const claimedEndpoints = new Map<string, string>();
  const claim = (map: Map<string, string>, value: string, owner: string, what: string): void => {
    const already = map.get(value);
    if (already) fail(`${what} "${value}" is claimed by both ${already} and ${owner}`);
    map.set(value, owner);
  };
  for (const page of alwaysPages) claim(claimedPages, page, 'always', 'page');
  for (const endpoint of alwaysEndpoints) claim(claimedEndpoints, endpoint, 'always', 'endpoint');

  const surfaces = doc.surfaces.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`surfaces[${index}] is not an object`);
    const surface = entry as Record<string, unknown>;
    if (typeof surface.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(surface.key)) {
      return fail(`surfaces[${index}].key must be a lower_snake_case identifier`);
    }
    if (surface.key === ALWAYS) return fail(`surfaces[${index}].key may not be "${ALWAYS}"`);
    if (seenKeys.has(surface.key)) return fail(`surfaces[${index}].key "${surface.key}" appears twice`);
    seenKeys.add(surface.key);

    const surfacePages = paths(surface.pages, `surfaces[${index}].pages`);
    const surfaceEndpoints = paths(surface.endpoints, `surfaces[${index}].endpoints`);
    for (const page of surfacePages) claim(claimedPages, page, surface.key, 'page');
    for (const endpoint of surfaceEndpoints) claim(claimedEndpoints, endpoint, surface.key, 'endpoint');

    return { key: surface.key, pages: surfacePages, endpoints: surfaceEndpoints };
  });

  if (!Array.isArray(doc.profiles) || doc.profiles.length === 0) {
    return fail('`profiles` must be a non-empty array');
  }
  const seenProfiles = new Set<string>();
  const profiles = doc.profiles.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`profiles[${index}] is not an object`);
    const profile = entry as Record<string, unknown>;
    if (typeof profile.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(profile.key)) {
      return fail(`profiles[${index}].key must be a lower_snake_case identifier`);
    }
    if (seenProfiles.has(profile.key)) return fail(`profiles[${index}].key "${profile.key}" appears twice`);
    seenProfiles.add(profile.key);
    if (!Array.isArray(profile.surfaces)) return fail(`profiles[${index}].surfaces must be an array`);
    const chosen = profile.surfaces.map((name, at) => {
      if (typeof name !== 'string' || !seenKeys.has(name)) {
        return fail(`profiles[${index}].surfaces[${at}] must name a declared surface`);
      }
      return name;
    });
    return { key: profile.key, surfaces: chosen };
  });

  /*
   * THE DEFAULT PROFILE MUST EXIST AND MUST HOLD EVERYTHING.
   *
   * `full` is what every practice on the platform has until somebody chooses
   * otherwise, so a surface declared here and left out of `full` would switch
   * that surface OFF for all of them the moment this file was saved. The file
   * is meant to be edited by somebody who is thinking about one practice; this
   * is the check that stops that edit reaching every other one.
   */
  const full = profiles.find((p) => p.key === DEFAULT_SURFACE_PROFILE);
  if (!full) return fail(`there is no "${DEFAULT_SURFACE_PROFILE}" profile, which is every practice's default`);
  for (const key of seenKeys) {
    if (!full.surfaces.includes(key)) {
      return fail(
        `the "${DEFAULT_SURFACE_PROFILE}" profile does not list the surface "${key}", so saving this file ` +
          'would turn that surface off for every practice that has not chosen a profile',
      );
    }
  }

  return { version: doc.version, always: { pages: alwaysPages, endpoints: alwaysEndpoints }, surfaces, profiles };
}

/* -------------------------------------------------------------------------
 * MATCHING. Two shapes, because a console path and an API route are matched
 * differently: a page path is literal, an endpoint carries parameters.
 * ---------------------------------------------------------------------- */

function clean(path: string): string {
  return (path.split('?')[0] || '/').replace(/\/+$/, '') || '/';
}

/**
 * Which surface owns a console page, or `always`, or null when nobody has said.
 *
 * THE PATH IS RESOLVED BY THE ACCESS TABLE FIRST, and this is the one place
 * the two checks touch. `pageKeyFor` already knows that `/status/abc123` is
 * answered by `/status` and — crucially — that `/practice` does NOT answer for
 * a brand new `/practice/anything`, because `matchesChildren` is opt-in. A
 * prefix rule written here instead would be a second copy of that, and the
 * first thing it would get wrong is exactly the case the build-time test
 * exists to catch: an unclassified screen quietly inheriting its parent's
 * surface and never failing anything.
 *
 * So the LOOKUP is exact, against a declaration that is exact, and
 * `every_route_in_the_access_table_belongs_to_a_surface` is what keeps every
 * key declared once.
 */
export function surfaceOfPageIn(doc: PracticeSurfaceContent, path: string): SurfaceOrAlways | null {
  const key = pageKeyFor(path) ?? clean(path);
  if (doc.always.pages.includes(key)) return ALWAYS;
  for (const surface of doc.surfaces) if (surface.pages.includes(key)) return surface.key;
  return null;
}

/** Every declared endpoint pattern and its owner, `always` included. */
function declaredEndpoints(doc: PracticeSurfaceContent): Array<[string, string]> {
  const out: Array<[string, string]> = doc.always.endpoints.map((e) => [e, ALWAYS] as [string, string]);
  for (const surface of doc.surfaces) for (const endpoint of surface.endpoints) out.push([endpoint, surface.key]);
  return out;
}

/** A route pattern's parts, with `:id` and `*` both standing for one parameter. */
function segments(path: string): string[] {
  return clean(path)
    .split('/')
    .filter(Boolean)
    .map((part) => (part.startsWith(':') ? '*' : part));
}

/**
 * Does an endpoint pattern cover this call? `POST /kiosk/claim` covers
 * `POST /kiosk/claim` and nothing beneath it that a longer pattern claims;
 * `/portal` covers every route under `/portal`. A pattern with no method
 * covers every method.
 */
function endpointMatch(
  pattern: string,
  method: string,
  routeSegments: readonly string[],
): { score: number } | null {
  const space = pattern.indexOf(' ');
  const patternMethod = space > 0 ? pattern.slice(0, space) : null;
  if (patternMethod && patternMethod !== method) return null;
  const patternSegments = segments(space > 0 ? pattern.slice(space + 1) : pattern);
  if (patternSegments.length > routeSegments.length) return null;
  for (let i = 0; i < patternSegments.length; i += 1) {
    const want = patternSegments[i];
    if (want === '*') continue;
    if (want !== routeSegments[i]) return null;
  }
  /*
   * LONGEST WINS, AND A NAMED METHOD BREAKS THE TIE. `always` may hold
   * `/kiosk` while the walk-up holds `POST /kiosk/claim`; without the tie-break
   * a `PATCH /devices/*` and a `PATCH /devices/*\/walk-ups` of equal length
   * could not be ordered.
   */
  return { score: patternSegments.length * 2 + (patternMethod ? 1 : 0) };
}

/** Which surface owns a core route, or `always`, or null when nobody has said. */
export function surfaceOfEndpointIn(
  doc: PracticeSurfaceContent,
  method: string,
  path: string,
): SurfaceOrAlways | null {
  const verb = method.toUpperCase();
  const routeSegments = segments(path);
  let bestScore = -1;
  let owner: string | null = null;
  for (const [pattern, candidate] of declaredEndpoints(doc)) {
    const hit = endpointMatch(pattern, verb, routeSegments);
    if (!hit || hit.score <= bestScore) continue;
    bestScore = hit.score;
    owner = candidate;
  }
  return owner;
}

/** The surfaces a named profile switches on. Unknown profile: none of them. */
export function profileSurfacesIn(doc: PracticeSurfaceContent, profile: string): readonly string[] {
  return doc.profiles.find((p) => p.key === profile)?.surfaces ?? [];
}

/**
 * May a practice on this profile open this console page?
 *
 * DEFAULT-DENY FOR AN UNKNOWN PAGE, matching `mayReach`: a screen nobody
 * classified must not be offered, and the console is a courtesy surface where
 * being wrong costs a link rather than an act.
 */
export function profileAllowsPageIn(doc: PracticeSurfaceContent, profile: string, path: string): boolean {
  const surface = surfaceOfPageIn(doc, path);
  if (surface === null) return false;
  if (surface === ALWAYS) return true;
  return profileSurfacesIn(doc, profile).includes(surface);
}

/**
 * May a practice on this profile call this endpoint?
 *
 * AN UNCLASSIFIED ROUTE IS ALLOWED HERE, AND THAT IS DELIBERATE — the opposite
 * of the page check above, and the opposite of this codebase's usual
 * fail-closed instinct, so read this before "fixing" it.
 *
 * The platform never blocks care (hard rule 8, REQ-REC-04). Refusing an
 * endpoint a practice genuinely needs, because somebody added a controller and
 * did not classify it, would stop work at a desk with a patient in front of it
 * — a worse failure than a surface leaking into a practice that has not bought
 * it, which costs a feature being visible early. So the build-time test
 * (`every_core_route_belongs_to_a_surface`) is what catches an unclassified
 * route, loudly, at the bench, and the runtime lets it through.
 *
 * The blast radius is what makes that safe: `full` is the default and allows
 * everything, so a misclassification can only reach a practice somebody has
 * explicitly moved off it.
 */
export function profileAllowsEndpointIn(
  doc: PracticeSurfaceContent,
  profile: string,
  method: string,
  path: string,
): boolean {
  const surface = surfaceOfEndpointIn(doc, method, path);
  if (surface === null) return true;
  if (surface === ALWAYS) return true;
  return profileSurfacesIn(doc, profile).includes(surface);
}

/* -------------------------------------------------------------------------
 * The loaded file, and the same questions asked of it.
 * ---------------------------------------------------------------------- */

const parsed = parsePracticeSurfaceContent(content);

/** The whole parsed file, for the tests and for anything that wants to enumerate. */
export const PRACTICE_SURFACE_CONTENT: PracticeSurfaceContent = parsed;

/** Recorded on the event that changes a practice's profile. */
export const PRACTICE_SURFACES_VERSION: string = parsed.version;

/** Every surface, in file order. */
export const PRACTICE_SURFACES: readonly PracticeSurface[] = parsed.surfaces;

/** Just the keys, in file order — what the string table is keyed by. */
export const PRACTICE_SURFACE_KEYS: readonly string[] = parsed.surfaces.map((s) => s.key);

/** The profile keys a practice's column may hold. The DTO and the CHECK derive from this. */
export const SURFACE_PROFILE_KEYS: readonly string[] = parsed.profiles.map((p) => p.key);

/** True for a value this platform recognises as a profile. */
export function isSurfaceProfile(value: unknown): value is string {
  return typeof value === 'string' && SURFACE_PROFILE_KEYS.includes(value);
}

/** Which surface owns a console page, or `always`, or null. */
export function surfaceOf(path: string): SurfaceOrAlways | null {
  return surfaceOfPageIn(parsed, path);
}

/** Which surface owns a core route, or `always`, or null. */
export function surfaceOfEndpoint(method: string, path: string): SurfaceOrAlways | null {
  return surfaceOfEndpointIn(parsed, method, path);
}

/** The surfaces a named profile switches on. */
export function profileSurfaces(profile: string): readonly string[] {
  return profileSurfacesIn(parsed, profile);
}

/** May a practice on this profile open this console page? Unknown page: no. */
export function profileAllows(profile: string, path: string): boolean {
  return profileAllowsPageIn(parsed, profile, path);
}

/** May a practice on this profile call this endpoint? Unclassified route: yes — see above. */
export function profileAllowsEndpoint(profile: string, method: string, path: string): boolean {
  return profileAllowsEndpointIn(parsed, profile, method, path);
}

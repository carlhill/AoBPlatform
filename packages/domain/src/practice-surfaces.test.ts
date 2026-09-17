import { PAGES } from './page-access';
import {
  ALWAYS,
  DEFAULT_SURFACE_PROFILE,
  PRACTICE_SURFACE_CONTENT,
  PRACTICE_SURFACE_KEYS,
  PRACTICE_SURFACES_VERSION,
  SURFACE_PROFILE_KEYS,
  isSurfaceProfile,
  parsePracticeSurfaceContent,
  profileAllows,
  profileAllowsEndpoint,
  profileAllowsEndpointIn,
  profileAllowsPageIn,
  profileSurfaces,
  surfaceOf,
  surfaceOfEndpoint,
} from './practice-surfaces';

describe('the surface list is content, not code', () => {
  it('loads, and carries a version that can travel with a record', () => {
    expect(PRACTICE_SURFACES_VERSION).toMatch(/^practice-surfaces-/);
    expect(PRACTICE_SURFACE_KEYS).toEqual(
      expect.arrayContaining(['db4', 'kiosk_walk_up', 'enduring_agreements', 'queue_rails', 'portal', 'practitioner_pages']),
    );
    expect(SURFACE_PROFILE_KEYS).toEqual(expect.arrayContaining(['full', 'db4']));
    expect(isSurfaceProfile('full')).toBe(true);
    expect(isSurfaceProfile('posture')).toBe(false);
  });

  it('refuses a file whose default profile does not hold every surface', () => {
    /*
     * The edit that would do the damage: somebody adds a surface while thinking
     * about one practice, and every practice on the platform loses it, because
     * `full` is what they all have.
     */
    expect(() =>
      parsePracticeSurfaceContent({
        version: 'test-1',
        always: { pages: ['/'], endpoints: ['/health'] },
        surfaces: [{ key: 'one', pages: [], endpoints: [] }, { key: 'two', pages: [], endpoints: [] }],
        profiles: [{ key: 'full', surfaces: ['one'] }],
      }),
    ).toThrow(/does not list the surface "two"/);
  });

  it('refuses a page claimed by two surfaces', () => {
    expect(() =>
      parsePracticeSurfaceContent({
        version: 'test-1',
        always: { pages: ['/practice/day'], endpoints: [] },
        surfaces: [{ key: 'one', pages: ['/practice/day'], endpoints: [] }],
        profiles: [{ key: 'full', surfaces: ['one'] }],
      }),
    ).toThrow(/claimed by both always and one/);
  });
});

describe('which surface owns what', () => {
  it('every_route_in_the_access_table_belongs_to_a_surface', () => {
    /*
     * The same failure `page-access.test.ts` has for an unclassified audience,
     * for the second question. A page nobody classified would be refused for
     * every practice by `profileAllows` — so it must fail here, at the bench,
     * rather than as a screen somebody cannot open.
     *
     * DECLARED EXACTLY, not by prefix. Matching is by prefix at runtime so
     * `/status/abc123` resolves like its parent, but if the DECLARATION were
     * allowed to be a prefix then `/practice` would silently answer for every
     * new `/practice/...` screen and this test would never fail again.
     */
    const declared = new Set<string>(PRACTICE_SURFACE_CONTENT.always.pages);
    for (const surface of PRACTICE_SURFACE_CONTENT.surfaces) {
      for (const page of surface.pages) declared.add(page);
    }

    const unclassified = Object.keys(PAGES).filter((path) => !declared.has(path));
    expect(unclassified).toEqual([]);

    // And nothing declared that is not a page, which is how a rename leaves a
    // stale entry behind that classifies nothing.
    const stale = [...declared].filter((path) => !(path in PAGES));
    expect(stale).toEqual([]);
  });

  it('matches a token-bearing child to its parent, and refuses what nobody declared', () => {
    expect(surfaceOf('/status/abc123')).toBe(ALWAYS);
    expect(surfaceOf('/patient/portal/agreements')).toBe('portal');
    expect(surfaceOf('/practice/some-new-screen')).toBeNull();
    expect(profileAllows('full', '/practice/some-new-screen')).toBe(false);
  });

  it('keeps the longest endpoint pattern, so a surface can carve one route out of a shared base', () => {
    // `/kiosk` is `always` — a pushed agreement uses the same tablet — while
    // the walk-up front door is not.
    expect(surfaceOfEndpoint('GET', '/kiosk/me')).toBe(ALWAYS);
    expect(surfaceOfEndpoint('POST', '/kiosk/heartbeat')).toBe(ALWAYS);
    expect(surfaceOfEndpoint('POST', '/kiosk/claim')).toBe('kiosk_walk_up');
    expect(surfaceOfEndpoint('PATCH', '/devices/7b1/walk-ups')).toBe('kiosk_walk_up');
    expect(surfaceOfEndpoint('PATCH', '/devices/7b1')).toBe(ALWAYS);
    expect(surfaceOfEndpoint('POST', '/inbound/print-jobs')).toBe('db4');
  });
});

describe('what a profile allows', () => {
  it('an_existing_practice_sees_everything_by_default', () => {
    /*
     * THE WHOLE POINT OF THE DEFAULT. Every practice that exists today carries
     * `full`, and this build must be a no-op for all of them until somebody
     * sets a profile — so every page in the access table and every surface is
     * open on it.
     */
    expect(DEFAULT_SURFACE_PROFILE).toBe('full');
    expect(profileSurfaces('full')).toEqual(expect.arrayContaining([...PRACTICE_SURFACE_KEYS]));
    for (const path of Object.keys(PAGES)) {
      expect({ path, allowed: profileAllows('full', path) }).toEqual({ path, allowed: true });
    }
    for (const route of [
      ['POST', '/kiosk/claim'],
      ['GET', '/arrivals/expected'],
      ['POST', '/enduring'],
      ['GET', '/portal/agreements'],
      ['GET', '/practitioner-queue/waiting'],
      ['POST', '/inbound/print-jobs'],
    ] as const) {
      expect({ route, allowed: profileAllowsEndpoint('full', route[0], route[1]) }).toEqual({ route, allowed: true });
    }
  });

  it('a_db4_practice_cannot_reach_the_queue_rails', () => {
    expect(profileAllows('db4', '/practice/frontdesk')).toBe(false);
    expect(profileAllows('db4', '/practice/frontdesksmall')).toBe(false);
    // And the rest of what D-2026-09-14-04 switches off.
    expect(profileAllows('db4', '/patient/portal')).toBe(false);
    expect(profileAllows('db4', '/practitioner')).toBe(false);
    expect(profileAllows('db4', '/practice/practitioner/waiting')).toBe(false);
  });

  it('a_db4_practice_keeps_the_tablet_desk_and_the_day_register', () => {
    /*
     * The other half, and the half that is easy to break: switching surfaces
     * off must not take away the pages the first customer actually works from.
     */
    expect(profileAllows('db4', '/practice/tablet')).toBe(true);
    expect(profileAllows('db4', '/practice/day')).toBe(true);
    expect(profileAllows('db4', '/practice/patients')).toBe(true);
    expect(profileAllows('db4', '/practice/today')).toBe(true);
    expect(profileAllows('db4', '/practice/channels')).toBe(true);
    expect(profileAllows('db4', '/practice/setup')).toBe(true);
    // The tablet itself still works: only the walk-up door is shut.
    expect(profileAllows('db4', '/kiosk')).toBe(true);
    expect(profileAllowsEndpoint('db4', 'GET', '/kiosk/me')).toBe(true);
    expect(profileAllowsEndpoint('db4', 'POST', '/kiosk/heartbeat')).toBe(true);
  });

  it('decides the print door by profile, not by who is calling', () => {
    /*
     * Where the answer behind `a_db4_print_job_is_refused_when_the_practice_
     * does_not_use_db4` (apps/core, `surface.guard.spec.ts`) is actually
     * decided — the gate on AOBPRINTER being installable at a practice that
     * has not bought it (TODO.md, AOBPRINTER item 5).
     */
    const kioskOnly = parsePracticeSurfaceContent({
      ...PRACTICE_SURFACE_CONTENT,
      profiles: [
        ...PRACTICE_SURFACE_CONTENT.profiles,
        { key: 'kiosk_only', surfaces: PRACTICE_SURFACE_KEYS.filter((k) => k !== 'db4') },
      ],
    });
    expect(profileAllowsPageIn(kioskOnly, 'kiosk_only', '/practice/frontdesk')).toBe(true);
    expect(profileAllowsEndpoint('db4', 'POST', '/inbound/print-jobs')).toBe(true);
    expect(profileAllowsEndpointIn(kioskOnly, 'kiosk_only', 'POST', '/inbound/print-jobs')).toBe(false);
    expect(profileAllowsEndpointIn(kioskOnly, 'kiosk_only', 'GET', '/inbound/print-jobs/metrics')).toBe(false);
  });

  it('turning_a_surface_on_is_a_setting_not_a_deploy', () => {
    /*
     * The claim the whole design rests on. The SAME compiled code answers
     * differently for two profiles, and a profile that gains a surface gains
     * its pages — no branch, no build, no deleted feature. The third case
     * proves the list itself is content: a profile that exists only in an
     * edited copy of the file behaves exactly like one that ships in it.
     */
    expect(profileAllows('full', '/practice/frontdesk')).toBe(true);
    expect(profileAllows('db4', '/practice/frontdesk')).toBe(false);

    const withRails = parsePracticeSurfaceContent({
      ...PRACTICE_SURFACE_CONTENT,
      profiles: PRACTICE_SURFACE_CONTENT.profiles.map((p) =>
        p.key === 'db4' ? { key: 'db4', surfaces: ['db4', 'queue_rails'] } : p,
      ),
    });
    expect(profileAllowsPageIn(withRails, 'db4', '/practice/frontdesk')).toBe(true);
    expect(profileAllowsPageIn(withRails, 'db4', '/patient/portal')).toBe(false);
  });

  it('never blocks a call nobody classified, and never offers a page nobody classified', () => {
    /*
     * THE TWO HALVES POINT OPPOSITE WAYS ON PURPOSE (hard rule 8). A page is a
     * link: getting it wrong costs a door that is not offered. An endpoint is
     * an act: getting it wrong stops work at a desk with a patient in front of
     * it. So an unclassified ROUTE is allowed and the build-time test is what
     * catches it, and an unclassified PAGE is refused.
     */
    expect(profileAllowsEndpoint('db4', 'POST', '/something-nobody-classified')).toBe(true);
    expect(profileAllows('db4', '/practice/something-nobody-classified')).toBe(false);
  });

  it('gives an unknown profile nothing beyond what is always on', () => {
    // A column value no release recognises is not a licence: the always set
    // still answers, so nobody is locked out of signing in or of setup.
    expect(profileAllows('made_up', '/practice/setup')).toBe(true);
    expect(profileAllows('made_up', '/practice/frontdesk')).toBe(false);
  });
});

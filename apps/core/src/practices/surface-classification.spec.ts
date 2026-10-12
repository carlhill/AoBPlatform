import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ALWAYS, surfaceOfEndpoint } from '@aobplatform/domain';

/**
 * EVERY ROUTE THIS SERVICE SERVES IS CLASSIFIED INTO A SURFACE, OR INTO THE
 * SET THAT IS ALWAYS ON.
 *
 * WHY IT IS A TEST AND NOT A RUNTIME REFUSAL. `profileAllowsEndpoint` lets an
 * unclassified route through, deliberately: the platform never blocks care
 * (hard rule 8, REQ-REC-04), and refusing an endpoint a practice needs because
 * somebody added a controller and forgot to classify it would stop work at a
 * desk with a patient in front of it. The cost of that choice is that nothing
 * at runtime notices the omission — so this is the thing that notices, at the
 * bench and in CI, which is where noticing is free.
 *
 * WHY IT READS THE SOURCE RATHER THAN BOOTING NEST. Booting the application to
 * enumerate its router needs a database, a Keycloak issuer and a vault; this
 * needs none of them, runs in the unit suite, and fails in the same second as
 * the change that broke it. The cost is that it understands only the ordinary
 * decorator forms — which is every controller in this codebase, and a route
 * registered some other way would simply not be seen. If that ever happens,
 * the runtime behaviour is "allowed", which is the same direction this whole
 * mechanism errs in.
 *
 * It is the same shape, and the same reasoning, as
 * `every_route_in_the_access_table_belongs_to_a_surface` in the domain: one
 * table somebody can read in a minute and say "that is wrong" about.
 */

const SRC = join(__dirname, '..');
const HTTP_METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'];

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...controllerFiles(path));
    else if (entry.endsWith('.controller.ts')) out.push(path);
  }
  return out;
}

interface Route {
  method: string;
  path: string;
  file: string;
}

/**
 * Every `@Get('x')` under every `@Controller('base')`, paired by position in
 * the file — a file may declare more than one controller, and the nearest
 * `@Controller` above a handler is the one it belongs to.
 */
function routesIn(file: string): Route[] {
  const source = readFileSync(file, 'utf8');

  const bases: Array<{ base: string; at: number }> = [];
  const controllerPattern = /@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/g;
  let found: RegExpExecArray | null;
  while ((found = controllerPattern.exec(source))) {
    bases.push({ base: found[1] ?? found[2] ?? '', at: found.index });
  }

  const routes: Route[] = [];
  const handlerPattern = new RegExp(`@(${HTTP_METHODS.join('|')})\\(\\s*(?:'([^']*)'|"([^"]*)")?\\s*\\)`, 'g');
  while ((found = handlerPattern.exec(source))) {
    const at = found.index;
    const base = bases.filter((b) => b.at < at).sort((a, b) => b.at - a.at)[0]?.base ?? '';
    const sub = found[2] ?? found[3] ?? '';
    routes.push({
      method: found[1].toUpperCase(),
      path: `/${[base, sub].filter(Boolean).join('/')}`.replace(/\/+/g, '/'),
      file: file.slice(SRC.length + 1).split('\\').join('/'),
    });
  }
  return routes;
}

describe('every part of the API belongs to a surface', () => {
  const routes = controllerFiles(SRC).flatMap(routesIn);

  it('found the controllers at all', () => {
    // The guard rail on the guard rail: a scan that quietly matched nothing
    // would pass the test below for ever while classifying nothing.
    expect(routes.length).toBeGreaterThan(150);
  });

  it('every_core_route_belongs_to_a_surface', () => {
    const unclassified = routes
      .filter((route) => surfaceOfEndpoint(route.method, route.path) === null)
      .map((route) => `${route.method} ${route.path}  (${route.file})`)
      .sort();

    /*
     * WHAT TO DO WHEN THIS FAILS. Add the route to
     * `packages/domain/content/practice-surfaces.json` — to a surface if it
     * belongs to a part of AoB a practice may not have bought, and otherwise
     * to `always`, which is the honest answer for sign-in, setup, the
     * platform's own pages and the shared machinery every practice has.
     * `always` is also the SAFE answer: it can only make a surface visible
     * early, never refuse something a practice needs.
     */
    expect(unclassified).toEqual([]);
  });

  it('keeps the surfaces the first customer does not have off the always list', () => {
    /*
     * Named routes rather than a count, because a count passes while the wrong
     * route moves. These are the ones D-2026-09-14-04 actually turns off, and
     * a change that quietly reclassified one as `always` would make the whole
     * mechanism decorative.
     */
    expect(surfaceOfEndpoint('POST', '/inbound/print-jobs')).toBe('db4');
    expect(surfaceOfEndpoint('POST', '/kiosk/claim')).toBe('kiosk_walk_up');
    expect(surfaceOfEndpoint('GET', '/arrivals/expected')).toBe('queue_rails');
    expect(surfaceOfEndpoint('GET', '/portal/agreements')).toBe('portal');
    expect(surfaceOfEndpoint('POST', '/enduring')).toBe('enduring_agreements');
    expect(surfaceOfEndpoint('GET', '/practitioner-queue/waiting')).toBe('practitioner_pages');

    // And the shared machinery every practice keeps, whatever it has bought.
    expect(surfaceOfEndpoint('GET', '/health')).toBe(ALWAYS);
    expect(surfaceOfEndpoint('PATCH', '/practices/:id/config')).toBe(ALWAYS);
    expect(surfaceOfEndpoint('GET', '/arrivals/day')).toBe(ALWAYS);
    expect(surfaceOfEndpoint('POST', '/devices/:deviceId/push')).toBe(ALWAYS);
    expect(surfaceOfEndpoint('GET', '/kiosk/waiting-list')).toBe(ALWAYS);
  });
});

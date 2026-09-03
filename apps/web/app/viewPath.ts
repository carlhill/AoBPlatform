/**
 * A practice page, rewritten as its READ-ONLY twin.
 *
 *   /practice/locations  →  /platform/practices/<id>/locations
 *
 * ONE MAPPING, not two sets of links. A card or a gap added later reaches its
 * twin without anybody remembering to add it in a second place — which is the
 * failure this codebase has already had twice, once with the AHPRA register URL
 * and once with the amendable-fields list.
 *
 * WHY IT EXISTS AT ALL. A platform operator has no practice claim, so every
 * `/practice/...` link refuses them. Before the read-only tree existed the only
 * honest thing was to hide those links — which meant the person most likely to
 * ask "why does this practice say NO ADMINISTRATOR" was the one person not
 * shown the answer. Now the links work; they simply point at the version that
 * cannot change anything.
 *
 * A PAGE WITH NO TWIN YET GOES TO THE HUB, not to a 404 and not to the practice
 * route that would refuse. The read-only tree is being built a page at a time,
 * and until a page has its twin the hub is the truthful destination: it shows
 * the same practice, names the same gap, and has a card leading onward. A dead
 * link would be worse than the problem it was meant to solve.
 *
 * Adding a twin means adding one line here, next to the route that was created.
 */
const TWINS: readonly string[] = [
  '',
  '/practitioners',
  '/entity',
  '/locations',
  '/affiliations',
  '/channels',
  '/application',
  '/users',
  '/reports',
  '/reviews',
  '/queue',
  '/reconciliation',
];

export function toViewPath(href: string, practiceId: string): string {
  if (!href.startsWith('/practice')) return href;

  const rest = href.slice('/practice'.length);
  const base = `/platform/practices/${practiceId}`;
  return TWINS.includes(rest) ? `${base}${rest}` : base;
}

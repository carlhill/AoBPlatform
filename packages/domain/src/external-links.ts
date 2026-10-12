/**
 * Every link out of this product, in one place.
 *
 * WHY A FILE RATHER THAN A CONSTANT PER SCREEN. These were written wherever
 * they were first needed: `AHPRA_REGISTER` in the practitioners view,
 * `AHPRA_SEARCH` in the org console, another copy inside `checks.ts`. Three
 * spellings of the same destination, two of which had drifted to a URL that no
 * longer lands where it used to — and nothing to make them disagree loudly.
 *
 * These are also the links somebody OUTSIDE this codebase has an opinion about.
 * AHPRA moves its register, the ABR changes its lookup path, Services Australia
 * reorganises HPOS. When that happens the fix should be one line changed by
 * whoever noticed, not a search for every place a string was pasted.
 *
 * IN THE DOMAIN, so the console, the core service's wording and any future
 * surface all read the same value. A copy in `apps/web` would drift from the
 * copy in `checks.ts` the first time one of them was corrected.
 *
 * NOT CONFIGURATION. These are facts about the outside world, not settings: an
 * environment variable for the AHPRA register would let a deployment point
 * "check the public register" at somewhere that is not the public register,
 * which is precisely the kind of thing a reviewer is attesting they did not do.
 */

export interface ExternalLink {
  /** What to call it in a sentence, so screens do not each invent a name. */
  readonly label: string;
  readonly url: string;
  /** Why somebody would follow it — used as hint text next to the link. */
  readonly purpose: string;
}

export const EXTERNAL_LINKS = {
  /**
   * The AHPRA public register.
   *
   * The `#search-results-anchor` fragment lands on the search results rather
   * than the top of a long page, which is where somebody checking a specific
   * registration actually wants to be.
   *
   * There is no stable per-practitioner URL to deep-link to. AHPRA's register
   * is searched, not addressed, so the honest thing is to send people to the
   * search and tell them which number to type — rather than build a link that
   * looks specific and is not.
   */
  ahpraRegister: {
    label: 'AHPRA Register of Practitioners',
    url: 'https://www.ahpra.gov.au/Registration/Registers-of-Practitioners#search-results-anchor',
    purpose: 'Confirm a practitioner’s name, profession and registration status against the public register.',
  },

  /** ABN Lookup, for the entity rather than the person. */
  abnLookup: {
    label: 'ABN Lookup',
    url: 'https://abr.business.gov.au/',
    purpose: 'Confirm an ABN, its status, and the legal name it is registered to.',
  },

  /** The national directory of health services, for confirming a practice exists. */
  healthServicesDirectory: {
    label: 'National Health Services Directory',
    url: 'https://www.healthdirect.gov.au/australian-health-services',
    purpose: 'Confirm a practice is a real, operating health service at the address it gave.',
  },

  /** Health Professional Online Services — where a provider number is checked. */
  hpos: {
    label: 'Health Professional Online Services (HPOS)',
    url: 'https://www.servicesaustralia.gov.au/hpos',
    purpose: 'Confirm a provider number and a practitioner’s Medicare entitlement.',
  },
} as const satisfies Record<string, ExternalLink>;

export type ExternalLinkKey = keyof typeof EXTERNAL_LINKS;

/**
 * One ABN's page on ABN Lookup.
 *
 * A function rather than a template pasted at each call site, so the encoding
 * happens once and cannot be forgotten at the fourth one.
 */
export function abnLookupUrl(abn: string): string {
  return `https://abr.business.gov.au/ABN/View?abn=${encodeURIComponent(abn.replace(/\s/g, ''))}`;
}

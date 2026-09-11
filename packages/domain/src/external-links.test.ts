import { EXTERNAL_LINKS, abnLookupUrl } from './external-links';
import { CHECK_CATALOGUE } from './checks';

/**
 * THE POINT OF THE FILE IS THAT THERE IS ONE OF THEM.
 *
 * These links used to be written wherever they were first needed — three
 * spellings of the AHPRA register across two apps and `checks.ts`, two of which
 * had drifted. Nothing made them disagree loudly, so nothing did.
 */
describe('the external links', () => {
  it('are all absolute https URLs', () => {
    for (const [key, link] of Object.entries(EXTERNAL_LINKS)) {
      expect(`${key}: ${link.url}`).toMatch(/^\w+: https:\/\//);
    }
  });

  it('sends people to the AHPRA search results, not the top of a long page', () => {
    // The fragment is the difference between landing on the search and landing
    // on a page somebody then has to scroll.
    expect(EXTERNAL_LINKS.ahpraRegister.url).toContain('#search-results-anchor');
  });

  it('names every link, so screens do not each invent a name for it', () => {
    for (const link of Object.values(EXTERNAL_LINKS)) {
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.purpose.length).toBeGreaterThan(0);
    }
  });

  /*
   * THE ONE THAT ACTUALLY GUARDS SOMETHING. `checks.ts` tells a reviewer where
   * to go and verify a fact; that destination must be the same one the console
   * links to, or a reviewer and a practice administrator are looking at two
   * different pages while believing they are looking at one.
   */
  it('is what the reviewer checklist points at', () => {
    const urls = new Set(Object.values(EXTERNAL_LINKS).map((l) => l.url));
    const checkUrls = CHECK_CATALOGUE.map((c) => c.verifyAt?.url).filter((u): u is string => Boolean(u));

    expect(checkUrls.length).toBeGreaterThan(0);
    for (const url of checkUrls) {
      expect(urls).toContain(url);
    }
  });

  it('builds one ABN’s lookup page, encoding it once and in one place', () => {
    expect(abnLookupUrl('27 734 610 304')).toBe('https://abr.business.gov.au/ABN/View?abn=27734610304');
  });
});

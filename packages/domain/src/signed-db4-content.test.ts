import {
  parseSignedDb4Content,
  SIGNED_DB4_CONTENT,
  SIGNED_DB4_CONTENT_VERSION,
  SIGNED_DB4_LABEL_KEYS,
} from './signed-db4-content';

/**
 * THE SIGNED-DB4'S WORDS AND GEOMETRY ARE VERSIONED CONTENT (hard rule 14),
 * validated at load so a bad edit fails the build rather than a patient.
 *
 * The file matters more than most: it is the only part of this page that AoB
 * authors at all — everything else is reproduced from the practice's own
 * printed form — and one of the strings in it is the provenance line that
 * stops the reproduced "approved form" heading being read as our claim.
 */

/** A valid document, so each test can spoil exactly one thing. */
function good(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(SIGNED_DB4_CONTENT)) as Record<string, unknown>;
}

describe('the shipped content file', () => {
  it('loads, and carries a version that travels with every page made from it', () => {
    expect(SIGNED_DB4_CONTENT_VERSION).toMatch(/^signed-db4-/);
    expect(SIGNED_DB4_CONTENT.version).toBe(SIGNED_DB4_CONTENT_VERSION);
  });

  it('defines every label the renderer draws, and nothing it does not', () => {
    expect(Object.keys(SIGNED_DB4_CONTENT.labels).sort()).toEqual([...SIGNED_DB4_LABEL_KEYS].sort());
    for (const label of Object.values(SIGNED_DB4_CONTENT.labels)) expect(label.trim()).not.toHaveLength(0);
  });

  it('has a provenance line, which is the whole reason the footer exists', () => {
    expect(SIGNED_DB4_CONTENT.footer.provenance.trim().length).toBeGreaterThan(0);
    expect(SIGNED_DB4_CONTENT.footer.provenance).toMatch(/reproduc/i);
  });

  it('fits five service columns inside the A4 margins', () => {
    const { marginPoints, serviceColumnWidths } = SIGNED_DB4_CONTENT.layout;
    expect(serviceColumnWidths).toHaveLength(5);
    const total = serviceColumnWidths.reduce((sum, width) => sum + width, 0);
    expect(total).toBeLessThanOrEqual(595 - 2 * marginPoints);
  });
});

describe('the_signed_db4_never_claims_our_reproduction_is_approved (at load)', () => {
  /**
   * THE ONE EDIT THAT WOULD TURN THE GUARD INSIDE OUT. The footer is the line
   * that answers the government's heading; a footer that made the claim itself
   * would be worse than no footer at all, so it is refused here — at the
   * build, not at a render (hard rule 12, REQ-65C-05).
   */
  it.each([
    ['provenance', { provenance: 'This is the approved form.', lines: [] as string[] }],
    ['a footer line', { provenance: 'Reproduced by AoBPlatform.', lines: ['Certified by AoBPlatform.'] }],
    ['an accreditation claim', { provenance: 'Reproduced by AoBPlatform.', lines: ['AoBPlatform is accredited.'] }],
  ])('refuses a claim of approval in %s', (_where, footer) => {
    expect(() => parseSignedDb4Content({ ...good(), footer })).toThrow(/certified, approved or accredited/);
  });

  it('accepts the permitted self-assessment wording', () => {
    const footer = {
      provenance: 'Reproduced by AoBPlatform from the practice’s own billing record.',
      lines: ['Checked against the s 65C data set (self-assessment).'],
    };
    expect(() => parseSignedDb4Content({ ...good(), footer })).not.toThrow();
  });
});

describe('a content edit the renderer could not use fails the build', () => {
  it('refuses a missing version', () => {
    expect(() => parseSignedDb4Content({ ...good(), version: '  ' })).toThrow(/`version`/);
  });

  it('refuses a missing label', () => {
    const doc = good();
    const labels = { ...(doc.labels as Record<string, unknown>) };
    delete labels.patient;
    expect(() => parseSignedDb4Content({ ...doc, labels })).toThrow(/labels.patient/);
  });

  it('refuses a label the renderer does not draw, rather than ignoring it', () => {
    const doc = good();
    const labels = { ...(doc.labels as Record<string, unknown>), inventedLabel: 'Something' };
    expect(() => parseSignedDb4Content({ ...doc, labels })).toThrow(/inventedLabel/);
  });

  it('refuses a column set that would overflow the page', () => {
    const doc = good();
    const layout = { ...(doc.layout as Record<string, unknown>), serviceColumnWidths: [200, 200, 200, 200, 200] };
    expect(() => parseSignedDb4Content({ ...doc, layout })).toThrow(/are available inside the margins/);
  });

  it('refuses the wrong number of columns', () => {
    const doc = good();
    const layout = { ...(doc.layout as Record<string, unknown>), serviceColumnWidths: [50, 50, 50] };
    expect(() => parseSignedDb4Content({ ...doc, layout })).toThrow(/five numbers/);
  });

  it('refuses a non-positive measurement', () => {
    const doc = good();
    const layout = { ...(doc.layout as Record<string, unknown>), bodySize: 0 };
    expect(() => parseSignedDb4Content({ ...doc, layout })).toThrow(/layout.bodySize/);
  });

  it('refuses an empty footer line, which would print a blank row on evidence', () => {
    const doc = good();
    expect(() => parseSignedDb4Content({ ...doc, footer: { provenance: 'Reproduced.', lines: [''] } })).toThrow(
      /footer.lines\[0\]/,
    );
  });

  it('refuses something that is not a document at all', () => {
    expect(() => parseSignedDb4Content(null)).toThrow(/not an object/);
  });
});

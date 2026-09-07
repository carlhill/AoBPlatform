import { deflateSync } from 'node:zlib';
import { extractText } from './extract-text';

/**
 * These tests exist because of a false negative on a real file.
 *
 * An ABN Lookup page saved from a browser was reported as NOT containing the
 * ABN it plainly displayed. Two causes, and both are regression-tested here
 * because both would fail silently and look like a working check:
 *
 *   1. Font binaries were being scraped as if they were page text.
 *   2. Subset fonts encode "2" as a private glyph code, so nothing in the
 *      content stream resembles a digit until the ToUnicode map is applied.
 *
 * A false negative is worse here than no check at all: a reviewer who learns
 * the warning cries wolf stops reading it, including the time it is right.
 */

/** Build a minimal PDF with one Flate-compressed stream. */
function pdfWithStreams(streams: Array<{ dict: string; body: string }>): Uint8Array {
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  for (const s of streams) {
    parts.push(Buffer.from(`${s.dict}\nstream\n`, 'latin1'));
    parts.push(deflateSync(Buffer.from(s.body, 'latin1')));
    parts.push(Buffer.from('\nendstream\n', 'latin1'));
  }
  parts.push(Buffer.from('%%EOF\n', 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

describe('extractText', () => {
  it('reads a plain-text file directly', () => {
    const bytes = new Uint8Array(Buffer.from('ABN 27 734 610 304 is ACTIVE'));
    expect(extractText(bytes, 'text/plain')).toContain('27 734 610 304');
  });

  it('returns null for an image, because a screenshot is pixels to us', () => {
    expect(extractText(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png')).toBeNull();
  });

  it('reads an ASCII content stream', () => {
    const pdf = pdfWithStreams([
      { dict: '<< /Length 40 >>', body: 'BT /F1 12 Tf (ABN 27 734 610 304) Tj ET' },
    ]);
    const text = extractText(pdf, 'application/pdf');
    expect(text).not.toBeNull();
    expect(text!.replace(/\D/g, '')).toContain('27734610304');
  });

  /*
   * THE REGRESSION. A subset font maps code 0x03 to "2", 0x04 to "7" and so
   * on, so the content stream contains no digits at all. Before the ToUnicode
   * map was applied, this extracted nothing recognisable and the identifier
   * check reported a false absence.
   */
  it('decodes a subset font through its ToUnicode map', () => {
    // 0x03→'2' 0x04→'7' 0x05→'3' 0x06→'4' 0x07→'6' 0x08→'1' 0x09→'0'
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '9 beginbfchar',
      '<0003> <0032>',
      '<0004> <0037>',
      '<0005> <0033>',
      '<0006> <0034>',
      '<0007> <0036>',
      '<0008> <0031>',
      '<0009> <0030>',
      'endbfchar',
      'end',
    ].join('\n');

    // "27734610304" as two-byte glyph codes.
    const codes = ['0003', '0004', '0004', '0005', '0006', '0007', '0008', '0009', '0005', '0009', '0006'];
    const content = `BT /F1 12 Tf <${codes.join('')}> Tj ET`;

    const pdf = pdfWithStreams([
      { dict: '<< /Type /Font /ToUnicode 5 0 R >>', body: cmap },
      { dict: '<< /Length 60 >>', body: content },
    ]);

    const text = extractText(pdf, 'application/pdf');
    expect(text).not.toBeNull();
    expect(text!.replace(/\D/g, '')).toContain('27734610304');
  });

  it('handles a bfrange, which browsers emit for consecutive glyphs', () => {
    const cmap = ['1 beginbfrange', '<0003> <0005> <0031>', 'endbfrange'].join('\n');
    const content = 'BT <000300040005> Tj ET';
    const pdf = pdfWithStreams([
      { dict: '<< /ToUnicode 5 0 R >>', body: cmap },
      { dict: '<< /Length 30 >>', body: content },
    ]);
    expect(extractText(pdf, 'application/pdf')!.replace(/\D/g, '')).toContain('123');
  });

  /*
   * THE OTHER HALF OF THE REGRESSION. A PDF stores embedded fonts in streams
   * too, and inflating every stream yielded TrueType table names — glyf, hmtx,
   * loca — as "text", drowning the page in noise.
   */
  it('does not scrape embedded font binaries as text', () => {
    const fontish = 'cvt fpgm gasp glyf head hhea hmtx loca maxp name post prep';
    const pdf = pdfWithStreams([
      { dict: '<< /Type /FontFile2 /Subtype /TrueType >>', body: fontish },
      { dict: '<< /Length 30 >>', body: 'BT (Riverbank Family Practice) Tj ET' },
    ]);
    const text = extractText(pdf, 'application/pdf');
    expect(text).toContain('Riverbank Family Practice');
    expect(text).not.toContain('glyf');
  });

  it('returns null rather than nonsense when nothing readable is present', () => {
    const pdf = pdfWithStreams([{ dict: '<< /Subtype /Image >>', body: '\x00\x01\x02binary' }]);
    expect(extractText(pdf, 'application/pdf')).toBeNull();
  });

  it('survives a stream it cannot inflate, rather than failing the whole file', () => {
    const good = pdfWithStreams([{ dict: '<< /Length 20 >>', body: 'BT (Readable) Tj ET' }]);
    const broken = Buffer.concat([
      Buffer.from('%PDF-1.7\n<< /Length 5 >>\nstream\n', 'latin1'),
      Buffer.from([0x78, 0x9c, 0x00, 0xff, 0xff]),
      Buffer.from('\nendstream\n', 'latin1'),
      Buffer.from(good),
    ]);
    expect(extractText(new Uint8Array(broken), 'application/pdf')).toContain('Readable');
  });
});

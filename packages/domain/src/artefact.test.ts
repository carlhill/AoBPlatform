import {
  ArtefactError,
  MAX_ARTEFACT_BYTES,
  assertUploadAcceptable,
  detectContentType,
  downloadHeaders,
  sanitiseFilename,
} from './artefact';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);

const upload = (over: Record<string, unknown> = {}) => ({
  bytes: PNG,
  declaredContentType: 'image/png',
  filename: 'screenshot.png',
  purpose: 'entitlement_call',
  uploadedByName: 'Carl Hill',
  ...over,
});

describe('detecting a type from the bytes, not the claim', () => {
  it('recognises the four accepted formats', () => {
    expect(detectContentType(PDF)).toBe('application/pdf');
    expect(detectContentType(PNG)).toBe('image/png');
    expect(detectContentType(JPEG)).toBe('image/jpeg');
    expect(detectContentType(text('a note about the call'))).toBe('text/plain');
  });

  it('REFUSES SVG, however it is dressed up', () => {
    // The whole threat: an "image" that executes script in our origin against
    // a session that can approve practices.
    expect(detectContentType(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectContentType(text('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(detectContentType(text('   \n  <svg/>'))).toBeNull();
  });

  it('refuses SVG behind a UTF-8 BOM', () => {
    const bom = bytes(0xef, 0xbb, 0xbf);
    const svg = text('<svg/>');
    const combined = new Uint8Array(bom.length + svg.length);
    combined.set(bom);
    combined.set(svg, bom.length);
    expect(detectContentType(combined)).toBeNull();
  });

  it('refuses HTML', () => {
    expect(detectContentType(text('<!DOCTYPE html><html><script>alert(1)</script></html>'))).toBeNull();
  });

  it('refuses archives and executables', () => {
    expect(detectContentType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // zip / docx
    expect(detectContentType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull(); // exe
    expect(detectContentType(bytes(0x7f, 0x45, 0x4c, 0x46))).toBeNull(); // elf
  });

  it('refuses a GIF — recognisable is not the same as accepted', () => {
    expect(detectContentType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBeNull();
  });

  it('refuses an empty file', () => {
    expect(detectContentType(bytes())).toBeNull();
  });
});

describe('the declared type is a claim', () => {
  it('accepts a PNG that claims to be a PDF, using what it actually is', () => {
    const accepted = assertUploadAcceptable(upload({ declaredContentType: 'application/pdf' }));
    expect(accepted.detectedContentType).toBe('image/png');
    expect(accepted.declaredTypeMismatch).toBe(true);
  });

  it('REFUSES SVG THAT CLAIMS TO BE PNG — the extension decides nothing', () => {
    expect(() =>
      assertUploadAcceptable(
        upload({ bytes: text('<svg onload="alert(1)"/>'), declaredContentType: 'image/png', filename: 'photo.png' }),
      ),
    ).toThrow(/markup that can execute script/);
  });

  it('names what it thinks the file is, so the refusal is actionable', () => {
    expect(() => assertUploadAcceptable(upload({ bytes: bytes(0x50, 0x4b, 0x03, 0x04) }))).toThrow(/ZIP archive/);
    expect(() => assertUploadAcceptable(upload({ bytes: bytes(0x4d, 0x5a) }))).toThrow(/Windows executable/);
  });

  it('records no mismatch when the claim is honest', () => {
    expect(assertUploadAcceptable(upload()).declaredTypeMismatch).toBe(false);
  });
});

describe('the other upload rules', () => {
  it('requires a named uploader', () => {
    expect(() => assertUploadAcceptable(upload({ uploadedByName: '  ' }))).toThrow(/must record the human/);
  });

  it('requires a known purpose — evidence with no reason is just a file', () => {
    expect(() => assertUploadAcceptable(upload({ purpose: 'because' }))).toThrow(/not a known artefact purpose/);
  });

  it('refuses an empty file', () => {
    expect(() => assertUploadAcceptable(upload({ bytes: bytes() }))).toThrow(ArtefactError);
  });

  it('refuses anything over the size cap', () => {
    const huge = new Uint8Array(MAX_ARTEFACT_BYTES + 1);
    huge.set(PNG);
    expect(() => assertUploadAcceptable(upload({ bytes: huge }))).toThrow(/the limit is/);
  });
});

describe('filenames cannot carry a path or a control character', () => {
  it('keeps only the last segment', () => {
    expect(sanitiseFilename('/etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('C:\\Windows\\System32\\evil.png')).toBe('evil.png');
  });

  it('defuses traversal', () => {
    expect(sanitiseFilename('../../../../etc/shadow')).toBe('shadow');
    expect(sanitiseFilename('..')).toBe('.');
  });

  it('STRIPS A NUL BYTE — the classic extension smuggle', () => {
    expect(sanitiseFilename('evil.svg\u0000.png')).toBe('evil.svg.png');
  });

  it('strips other control characters', () => {
    expect(sanitiseFilename('note\u001b[31m.txt')).toBe('note_31m.txt');
  });

  it('replaces anything else unusual rather than dropping it silently', () => {
    expect(sanitiseFilename('re;port$.pdf')).toBe('re_port_.pdf');
  });

  it('never returns an empty name', () => {
    expect(sanitiseFilename('')).toBe('artefact');
    expect(sanitiseFilename(null)).toBe('artefact');
    expect(sanitiseFilename('///')).toBe('artefact');
  });

  it('caps the length', () => {
    expect(sanitiseFilename('a'.repeat(500)).length).toBe(120);
  });
});

describe('how an artefact is served', () => {
  const headers = downloadHeaders({ detectedContentType: 'image/png', filename: 'shot.png' });

  it('is ALWAYS an attachment, never inline', () => {
    expect(headers['Content-Disposition']).toMatch(/^attachment;/);
  });

  it('sets nosniff — without it a browser may render what we called a download', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sandboxes it and allows nothing to load', () => {
    expect(headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(headers['Content-Security-Policy']).toContain('sandbox');
  });

  it('never stores it in a shared cache', () => {
    expect(headers['Cache-Control']).toContain('no-store');
  });

  it('sanitises the filename on the way out too', () => {
    const nasty = downloadHeaders({ detectedContentType: 'image/png', filename: '../../evil"name.png' });
    expect(nasty['Content-Disposition']).not.toContain('..');
    // The header uses quotes as its delimiter, so what matters is that the
    // filename cannot introduce another pair and break out of them.
    expect(nasty['Content-Disposition'].split('"')).toHaveLength(3);
    expect(nasty['Content-Disposition']).toBe('attachment; filename="evil_name.png"');
  });

  it('cannot have a header injected through the filename', () => {
    const injected = downloadHeaders({
      detectedContentType: 'image/png',
      filename: 'a.png\r\nSet-Cookie: session=stolen',
    });
    expect(injected['Content-Disposition']).not.toContain('Set-Cookie:');
    expect(injected['Content-Disposition']).not.toMatch(/[\r\n]/);
  });
});

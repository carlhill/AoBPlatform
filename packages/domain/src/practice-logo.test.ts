import {
  ALLOWED_LOGO_TYPES,
  LogoError,
  MAX_LOGO_BYTES,
  assertLogoAcceptable,
} from './practice-logo';

/** A PNG header with the dimensions written into IHDR. No pixel data needed. */
function png(width: number, height: number, pad = 0): Uint8Array {
  const bytes = new Uint8Array(24 + pad);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  const write = (value: number, at: number) => {
    bytes[at] = (value >>> 24) & 0xff;
    bytes[at + 1] = (value >>> 16) & 0xff;
    bytes[at + 2] = (value >>> 8) & 0xff;
    bytes[at + 3] = value & 0xff;
  };
  write(width, 16);
  write(height, 20);
  return bytes;
}

/** SOI, one APP0 to skip past, then a SOF0 carrying the dimensions. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4 (2 payload bytes)
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
  ]);
}

describe('practice logo — the only attacker-supplied bytes embedded in a contract', () => {
  it('accepts a PNG and reads its real dimensions from the header', () => {
    expect(assertLogoAcceptable(png(400, 120))).toMatchObject({
      contentType: 'image/png',
      widthPx: 400,
      heightPx: 120,
    });
  });

  it('accepts a JPEG, walking past segments it does not care about', () => {
    expect(assertLogoAcceptable(jpeg(600, 200))).toMatchObject({
      contentType: 'image/jpeg',
      widthPx: 600,
      heightPx: 200,
    });
  });

  it('logo_upload_refuses_svg — it is a document that can run script', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(() => assertLogoAcceptable(svg)).toThrow(LogoError);
    expect(() => assertLogoAcceptable(svg)).toThrow(/SVG is not accepted/);
  });

  it('refuses a GIF, a PDF and plain text — the allowlist is two formats long', () => {
    expect(ALLOWED_LOGO_TYPES).toEqual(['image/png', 'image/jpeg']);
    for (const bytes of [
      new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]),
      new TextEncoder().encode('%PDF-1.7 not a logo'),
      new TextEncoder().encode('this is not an image at all, not even close'),
    ]) {
      expect(() => assertLogoAcceptable(bytes)).toThrow(/must be a PNG or a JPEG/);
    }
  });

  it('refuses anything over 512 KB before it reads a single pixel', () => {
    expect(() => assertLogoAcceptable(png(400, 120, MAX_LOGO_BYTES))).toThrow(/at most 512 KB/);
  });

  it('refuses a one-pixel mark and a photograph-sized one', () => {
    expect(() => assertLogoAcceptable(png(4, 4))).toThrow(/must be between/);
    expect(() => assertLogoAcceptable(png(9000, 200))).toThrow(/must be between/);
  });

  it('refuses an empty file', () => {
    expect(() => assertLogoAcceptable(new Uint8Array(0))).toThrow(/empty/);
  });
});

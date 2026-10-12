/**
 * The drawn signature rules (REQ-SIG-01/-02).
 *
 * The coupling between the METHOD and the PAYLOAD is the thing under test:
 * `drawn` must carry the mark, and nothing else may. Both directions matter —
 * a drawn signature with no strokes files a tap-to-approve as a drawing, and a
 * tap-to-approve carrying strokes files a drawing nobody made.
 */
import {
  assertSignatureCaptureAcceptable,
  MAX_SIGNATURE_RASTER_BYTES,
  MAX_SIGNATURE_VECTOR_BYTES,
  SignatureCaptureError,
  type DrawnSignatureCapture,
} from './signature';

/** A 1×1 PNG. Obviously not a signature; it is here to be a real PNG header. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function capture(overrides: Partial<DrawnSignatureCapture> = {}): DrawnSignatureCapture {
  return {
    vector: [
      {
        points: [
          { x: 10, y: 20, t: 0 },
          { x: 12.5, y: 22.25, t: 16, p: 0.4 },
          { x: 30, y: 40, t: 33 },
        ],
      },
    ],
    rasterPngBase64: TINY_PNG,
    padWidth: 600,
    padHeight: 200,
    ...overrides,
  };
}

describe('assertSignatureCaptureAcceptable', () => {
  it('drawn_signature_requires_strokes — a drawn signature with no payload is refused', () => {
    expect(() => assertSignatureCaptureAcceptable({ method: 'drawn' })).toThrow(SignatureCaptureError);
    expect(() => assertSignatureCaptureAcceptable({ method: 'drawn' })).toThrow(/strokes and the image/i);
  });

  it('refuses a drawn signature whose vector is empty', () => {
    expect(() => assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture({ vector: [] }) })).toThrow(
      /at least one stroke/i,
    );
  });

  it('refuses a payload sent with any method that has no mark to store', () => {
    for (const method of ['tap_to_approve', 'typed_name', 'wet_ink_scan', 'verbal_recorded']) {
      expect(() => assertSignatureCaptureAcceptable({ method, signature: capture() })).toThrow(
        SignatureCaptureError,
      );
    }
  });

  it('accepts tap-to-approve with nothing attached, and stores nothing for it', () => {
    expect(assertSignatureCaptureAcceptable({ method: 'tap_to_approve' })).toBeNull();
  });

  it('keeps the points exactly as captured — no rounding, no resampling, no thinning', () => {
    const accepted = assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture() })!;
    const stored = JSON.parse(Buffer.from(accepted.vectorBytes).toString('utf8'));
    expect(stored.strokes[0].points).toEqual([
      { t: 0, x: 10, y: 20 },
      { p: 0.4, t: 16, x: 12.5, y: 22.25 },
      { t: 33, x: 30, y: 40 },
    ]);
    expect(accepted.strokeCount).toBe(1);
    expect(accepted.pointCount).toBe(3);
    expect(accepted.padWidth).toBe(600);
    expect(accepted.padHeight).toBe(200);
  });

  it('serialises the same capture to the same bytes every time (rule 13)', () => {
    const a = assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture() })!;
    const b = assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture() })!;
    expect(Buffer.from(a.vectorBytes).equals(Buffer.from(b.vectorBytes))).toBe(true);
  });

  it('refuses an image that is not a PNG, whatever it claims to be', () => {
    const notAPng = Buffer.from('%PDF-1.7 this is a pdf').toString('base64');
    expect(() =>
      assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture({ rasterPngBase64: notAPng }) }),
    ).toThrow(/must be a PNG/i);
  });

  it('refuses a raster over the cap, measured on the decoded bytes', () => {
    // A real PNG header followed by filler, so the refusal is about SIZE.
    const header = Buffer.from(TINY_PNG, 'base64');
    const oversized = Buffer.concat([header, Buffer.alloc(MAX_SIGNATURE_RASTER_BYTES)]).toString('base64');
    expect(() =>
      assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture({ rasterPngBase64: oversized }) }),
    ).toThrow(/the limit is/i);
  });

  it('refuses a vector over the cap', () => {
    const points = Array.from({ length: 20_000 }, (_, i) => ({ x: i + 0.5, y: i + 0.25, t: i * 4 }));
    expect(() =>
      assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture({ vector: [{ points }] }) }),
    ).toThrow(new RegExp(`the limit is ${MAX_SIGNATURE_VECTOR_BYTES / 1024} KB`));
  });

  it('refuses a capture with no pad size — coordinates mean nothing without it', () => {
    expect(() =>
      assertSignatureCaptureAcceptable({ method: 'drawn', signature: capture({ padWidth: 0 }) }),
    ).toThrow(/logical size/i);
  });

  it('never repeats any part of the payload in a refusal', () => {
    const secretish = capture({ vector: [{ points: [{ x: 123456.789, y: 987654.321, t: 0 }] }], padWidth: 0 });
    try {
      assertSignatureCaptureAcceptable({ method: 'drawn', signature: secretish });
      throw new Error('expected a refusal');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('123456');
      expect(message).not.toContain('987654');
      expect(message).not.toContain(TINY_PNG.slice(0, 20));
    }
  });
});

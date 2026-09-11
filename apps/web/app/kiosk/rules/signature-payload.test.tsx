/**
 * K-4 — WHAT THE TABLET ACTUALLY SENDS.
 *
 * The REQ-SIG-02 gap lived exactly here. The pad captured a vector and a
 * raster, the ceremony read both and dropped them, and no test anywhere could
 * catch it because there was no composed value to assert on. These are the
 * assertions that would have failed.
 *
 * NO IDENTIFIER VALUE APPEARS IN THIS FILE. The fixture strokes are three
 * points on a grid; the raster is a 1x1 PNG. A signature is the assignor's own
 * hand, and a fixture that looked like one would be a fixture worth protecting.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { composeSignRequest } from './signature-payload';
import { SignaturePad, type SignaturePadHandle } from '../components/SignaturePad';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const CAPTURE = {
  vector: [
    { points: [{ x: 10, y: 40, t: 0 }, { x: 60, y: 80, t: 22, p: 0.35 }] },
    { points: [{ x: 120, y: 40, t: 410 }] },
  ],
  rasterPngBase64: TINY_PNG,
  padWidth: 600,
  padHeight: 200,
};

const CAPTURE_REQUEST_ID = '11111111-2222-3333-4444-555555555555';

describe('composeSignRequest', () => {
  it('drawn_signature_payload_includes_vector_and_raster', () => {
    const body = composeSignRequest('drawn', CAPTURE_REQUEST_ID, CAPTURE);

    expect(body).toEqual({
      method: 'drawn',
      captureRequestId: CAPTURE_REQUEST_ID,
      signature: CAPTURE,
    });

    // BOTH REPRESENTATIONS, and the pad's logical size with them — without it
    // the coordinates cannot be redrawn at any other size (REQ-SIG-01).
    expect(body!.signature!.vector).toHaveLength(2);
    expect(body!.signature!.rasterPngBase64).toBe(TINY_PNG);
    expect(body!.signature!.padWidth).toBe(600);
    expect(body!.signature!.padHeight).toBe(200);

    // AS CAPTURED. The timing survives composition — no rounding, no
    // resampling, no dropping of a point for being close to its neighbour.
    expect(body!.signature!.vector[0].points).toEqual([
      { x: 10, y: 40, t: 0 },
      { x: 60, y: 80, t: 22, p: 0.35 },
    ]);
  });

  it('tap_to_approve_sends_no_strokes', () => {
    const body = composeSignRequest('tap_to_approve', CAPTURE_REQUEST_ID, CAPTURE);

    // A tap IS the mark; there is nothing to draw. The capture is ignored even
    // when one is offered, and the server refuses a payload on this method
    // anyway — two independent refusals of the same mistake.
    expect(body).toEqual({ method: 'tap_to_approve', captureRequestId: CAPTURE_REQUEST_ID });
    expect(body).not.toHaveProperty('signature');
    expect(JSON.stringify(body)).not.toContain(TINY_PNG.slice(0, 16));
  });

  it('refuses to compose a drawn signature with nothing in it, rather than downgrading it', () => {
    // Returning null is what stops a tap-to-approve being filed under `drawn`.
    // The ceremony surfaces a failure and leaves tap-to-approve on screen, so
    // nobody is blocked from being seen or billed (rule 8).
    expect(composeSignRequest('drawn', CAPTURE_REQUEST_ID, null)).toBeNull();
  });
});

describe('the pad handle', () => {
  it('offers no capture before anybody has drawn anything', () => {
    const handleRef: { current: SignaturePadHandle | null } = { current: null };
    render(<SignaturePad handleRef={handleRef} onInkChange={() => undefined} />);

    expect(handleRef.current).not.toBeNull();
    expect(handleRef.current!.strokes()).toHaveLength(0);
    // Null, not a half-signature: a vector with no image stores one half of
    // what REQ-SIG-01 asks for and reads as though the other half was lost.
    expect(handleRef.current!.capture()).toBeNull();
  });
});

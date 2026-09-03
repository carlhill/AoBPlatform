/**
 * WHAT THE TABLET SENDS WHEN SOMEBODY SIGNS.
 *
 * A pure function, deliberately: composing the sign body is the step the
 * REQ-SIG-02 gap actually lived in — the pad captured a vector and a raster,
 * the ceremony read them and threw them away, and nothing anywhere could fail
 * a test about it because there was no value to assert on. There is one now.
 *
 * TWO METHODS, TWO SHAPES, AND NEITHER IS A DEGRADED VERSION OF THE OTHER.
 * A `drawn` signature carries the strokes and the image (REQ-SIG-01); a
 * `tap_to_approve` carries neither, because a tap IS the mark and there is
 * nothing to draw. The server refuses each of the mistakes this function
 * cannot make: a drawn signature with nothing in it, and a payload sent with a
 * method that has no drawing.
 *
 * NOTHING IS PERSISTED AND NOTHING IS LOGGED HERE. The strokes are the
 * assignor's own hand; they exist for the length of one fetch.
 */
import type { DrawnSignatureCapture } from '@aobplatform/domain';

export type KioskSignatureMethod = 'drawn' | 'tap_to_approve';

export interface SignRequestBody {
  readonly method: KioskSignatureMethod;
  readonly captureRequestId: string;
  readonly signature?: DrawnSignatureCapture;
}

/**
 * Returns null when a drawn signature has nothing to send — no ink, or a
 * canvas that could not rasterise itself. The caller must NOT fall back to
 * sending `drawn` without a payload: that is exactly the record this work
 * exists to stop, a tap-to-approve filed as a drawing. Tap-to-approve remains
 * on screen and remains a real signature, so nobody is blocked from being
 * seen or billed (rule 8).
 */
export function composeSignRequest(
  method: KioskSignatureMethod,
  captureRequestId: string,
  capture: DrawnSignatureCapture | null,
): SignRequestBody | null {
  if (method !== 'drawn') return { method, captureRequestId };
  if (!capture) return null;
  return { method, captureRequestId, signature: capture };
}

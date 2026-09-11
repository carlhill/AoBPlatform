/**
 * The drawn signature itself — REQ-SIG-01 (vector + raster) and the half of
 * REQ-SIG-02 that was missing.
 *
 * WHAT WAS WRONG. The kiosk's pad captured strokes and a PNG and uploaded
 * NEITHER, because `SignDto` took a method, a channel and a capture request
 * and no payload. The signature event bound the rendered agreement's hash, the
 * versions and the verification event — everything except the mark the person
 * actually made. A "drawn" signature that discards the drawing is a
 * tap-to-approve wearing a costume, and it would have been exactly that in a
 * dispute.
 *
 * SIGNALS ARE STORED, NEVER JUDGED. Each point carries the time it was
 * captured at and, where the device reports one, the pressure. They are kept
 * EXACTLY AS THE POINTER EVENTS DELIVERED THEM — no smoothing, no resampling,
 * no dropping of "redundant" points — because a stroke that has been tidied up
 * can no longer answer a question about how it was made, and those questions
 * (was this signed in one continuous motion? does the timing match a human
 * hand?) are the ones a dispute asks. This platform records the signals; it
 * does not score them, and nothing here decides whether a signature is
 * genuine.
 *
 * AND NEVER A BIOMETRIC TEMPLATE. What is stored is the drawing and its
 * timing — the same thing a paper signature is, on glass. No feature vector,
 * no enrolment, no matching model is derived from it, here or anywhere
 * downstream. A biometric template would be a new class of sensitive
 * information collected for no purpose this regime asks for.
 *
 * THE STROKES ARE IDENTIFIER-GRADE. They are the assignor's own hand: they go
 * to the encrypted artefact store and to nowhere else — never a log line,
 * never an error message, never the rules service (REQ-LOG-08, and the rules
 * service holds no PII at all).
 */

import { detectContentType } from './artefact';

/**
 * A captured point, in the pad's own logical coordinate space.
 *
 * `t` is MILLISECONDS SINCE THE FIRST POINT OF THE FIRST STROKE, not a wall
 * clock: the shape of the timing is the signal, and an absolute clock on the
 * patient's device is a fact about the device rather than about the signature.
 * `p` is the pointer pressure the device reported, omitted entirely where it
 * reported none (a mouse) rather than defaulted to a number nobody measured.
 */
export interface SignaturePoint {
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly p?: number;
}

/** One continuous contact with the glass. The gaps between strokes are data. */
export interface SignatureStroke {
  readonly points: readonly SignaturePoint[];
}

/**
 * What the tablet sends with a `drawn` signature.
 *
 * THE PAD'S LOGICAL SIZE TRAVELS WITH THE POINTS. Coordinates are relative to
 * the pad as it was on the device that captured them; without its width and
 * height the vector cannot be redrawn at any other size, and a tablet swapped
 * for a bigger one next year would silently reinterpret every stroke.
 */
export interface DrawnSignatureCapture {
  readonly vector: readonly SignatureStroke[];
  /** The same drawing as a PNG. Base64; a `data:` URL prefix is tolerated. */
  readonly rasterPngBase64: string;
  readonly padWidth: number;
  readonly padHeight: number;
}

export class SignatureCaptureError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'SignatureCaptureError';
  }
}

/**
 * 512 KB for the image and 200 KB for the strokes.
 *
 * Generous for a signature on a tablet (a 600×200 PNG of ink is tens of
 * kilobytes, and a long signature is a few thousand points) and small enough
 * that neither is a way to push arbitrary payloads through the sign endpoint.
 * They are checked on the DECODED bytes, because base64 lies about size by a
 * third.
 */
export const MAX_SIGNATURE_RASTER_BYTES = 512 * 1024;
export const MAX_SIGNATURE_VECTOR_BYTES = 200 * 1024;

/** The two artefact purposes a drawn signature produces. */
export const SIGNATURE_RASTER_PURPOSE = 'signature_raster';
export const SIGNATURE_VECTOR_PURPOSE = 'signature_vector';

/**
 * The method that carries a payload. One, deliberately: tap-to-approve is a
 * real signature (REQ-SIG-01) and has no mark to store, typed names and
 * scanned wet ink arrive by other routes, and verbal capture is a recording.
 */
const METHOD_WITH_PAYLOAD = 'drawn';

export interface AcceptedSignatureCapture {
  /** PNG bytes, verified as a PNG by signature rather than by what was claimed. */
  readonly rasterBytes: Uint8Array;
  /** The strokes, canonically serialised. What is hashed and what is stored. */
  readonly vectorBytes: Uint8Array;
  readonly strokeCount: number;
  readonly pointCount: number;
  readonly padWidth: number;
  readonly padHeight: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * CANONICAL, NOT NORMALISED — and the difference is the whole point.
 *
 * The numbers are written out exactly as they were captured; only the key
 * ORDER is fixed, so that hashing the same capture twice gives the same hash
 * (rule 13, applied to the signature as it already is to the agreement).
 * Nothing is rounded, merged, resampled or smoothed on the way through.
 */
function canonicalVectorJson(vector: readonly SignatureStroke[]): string {
  const strokes = vector.map((stroke) => ({
    points: stroke.points.map((point) =>
      point.p === undefined
        ? { t: point.t, x: point.x, y: point.y }
        : { p: point.p, t: point.t, x: point.x, y: point.y },
    ),
  }));
  return JSON.stringify({ strokes });
}

/** Strips a `data:` URL prefix and any whitespace a transport introduced. */
function decodeBase64(raw: string): Uint8Array {
  const cleaned = raw.replace(/^data:[^;]*;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length === 0) {
    throw new SignatureCaptureError('REQ-SIG-01', 'The signature image is not valid base64.');
  }
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

/**
 * Is this signature payload acceptable, and does it belong with this method?
 *
 * Returns null for every method that carries no payload, so the caller stores
 * nothing and the tap-to-approve path is untouched. Throws — and the caller
 * turns that into a 400 — for a drawn signature with nothing in it, for a
 * payload sent with a method that does not have one, and for anything over the
 * caps.
 *
 * NO MESSAGE HERE CONTAINS ANY PART OF THE PAYLOAD. A refusal names the rule
 * and the shape of the problem; the strokes are the assignor's hand and do not
 * belong in an error string any more than they belong in a log.
 */
export function assertSignatureCaptureAcceptable(input: {
  readonly method: string;
  readonly signature?: DrawnSignatureCapture;
}): AcceptedSignatureCapture | null {
  if (input.method !== METHOD_WITH_PAYLOAD) {
    if (input.signature !== undefined) {
      throw new SignatureCaptureError(
        'REQ-SIG-01',
        `Only a ${METHOD_WITH_PAYLOAD} signature carries strokes and an image; "${input.method}" does not. ` +
          'Sending one with any other method would file a drawing as evidence of a mark nobody drew.',
      );
    }
    return null;
  }

  const signature = input.signature;
  if (!signature) {
    throw new SignatureCaptureError(
      'REQ-SIG-02',
      'A drawn signature must arrive with the strokes and the image they produced. Without them the ' +
        'record is a tap-to-approve filed under the wrong method.',
    );
  }

  if (!finite(signature.padWidth) || !finite(signature.padHeight) || signature.padWidth <= 0 || signature.padHeight <= 0) {
    throw new SignatureCaptureError(
      'REQ-SIG-02',
      'The signature pad must report the logical size the strokes were captured against.',
    );
  }

  if (!Array.isArray(signature.vector) || signature.vector.length === 0) {
    throw new SignatureCaptureError('REQ-SIG-02', 'A drawn signature has at least one stroke.');
  }

  let pointCount = 0;
  for (const stroke of signature.vector) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) {
      throw new SignatureCaptureError('REQ-SIG-02', 'Every stroke must carry the points that make it up.');
    }
    for (const point of stroke.points) {
      if (!finite(point?.x) || !finite(point?.y) || !finite(point?.t)) {
        throw new SignatureCaptureError(
          'REQ-SIG-02',
          'Every captured point needs a position and the time it was captured at.',
        );
      }
      if (point.p !== undefined && !finite(point.p)) {
        throw new SignatureCaptureError('REQ-SIG-02', 'Reported pressure must be a number where it is present at all.');
      }
      pointCount += 1;
    }
  }

  const vectorBytes = new Uint8Array(Buffer.from(canonicalVectorJson(signature.vector), 'utf8'));
  if (vectorBytes.length > MAX_SIGNATURE_VECTOR_BYTES) {
    throw new SignatureCaptureError(
      'REQ-SIG-02',
      `The captured strokes are ${Math.round(vectorBytes.length / 1024)} KB; the limit is ` +
        `${MAX_SIGNATURE_VECTOR_BYTES / 1024} KB.`,
    );
  }

  const rasterBytes = decodeBase64(signature.rasterPngBase64);
  if (rasterBytes.length > MAX_SIGNATURE_RASTER_BYTES) {
    throw new SignatureCaptureError(
      'REQ-SIG-02',
      `The signature image is ${Math.round(rasterBytes.length / 1024)} KB; the limit is ` +
        `${MAX_SIGNATURE_RASTER_BYTES / 1024} KB.`,
    );
  }
  // By SIGNATURE, not by what was claimed — the same rule every other artefact
  // is admitted under (`detectContentType`), so there is one definition of
  // "this really is a PNG" rather than a second copy that can drift.
  if (detectContentType(rasterBytes) !== 'image/png') {
    throw new SignatureCaptureError('REQ-SIG-01', 'The signature image must be a PNG.');
  }

  return {
    rasterBytes,
    vectorBytes,
    strokeCount: signature.vector.length,
    pointCount,
    padWidth: signature.padWidth,
    padHeight: signature.padHeight,
  };
}

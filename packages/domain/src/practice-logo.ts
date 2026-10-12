/**
 * THE PRACTICE'S LOGO, AND WHY IT IS THE FUSSIEST IMAGE ON THE PLATFORM
 * (Carl, 5 Sep 2026; PMS_to_AoB_Workflow.md W1, Q4).
 *
 * It is the only attacker-supplied content that gets EMBEDDED IN A CONTRACT.
 * Every other artefact is stored and handed back as a download; this one goes
 * into the bytes that are hashed at lock and re-verified at every later
 * display (hard rule 13). That imposes two requirements the general artefact
 * rules do not:
 *
 *  1. DETERMINISM. The same stored logo must produce the same PDF bytes
 *     forever. It does, because the bytes are embedded VERBATIM — the artefact
 *     store is content-addressed, so "the same logo" means "the same sha256",
 *     and the renderer scales it into a fixed box rather than at whatever size
 *     the file happens to declare. That is a stronger guarantee than
 *     re-encoding on upload would give, and it costs no image library: a
 *     re-encoder is a dependency that can change its output between versions,
 *     which is exactly the failure mode rule 13 exists to prevent.
 *  2. NO SVG, EVER. `ALLOWED_ARTEFACT_TYPES` already refuses it — an SVG is an
 *     XML document that executes script — but it is worth saying twice for
 *     something that will be rendered into a page a patient reads.
 *
 * 512 KB, NOT THE 20 MB THE ARTEFACT STORE ALLOWS. A letterhead logo is a few
 * hundred pixels on an A4 page. A 12 MB photograph would be embedded whole
 * into every agreement the practice ever makes, and the practice would
 * discover it as a slow PDF rather than as a refusal at upload.
 *
 * DIMENSIONS ARE READ FROM THE FILE'S OWN HEADER, in about thirty lines,
 * because the two things worth refusing — a one-pixel image and a 20,000-pixel
 * one — are both invisible until something tries to draw them.
 */

/** 512 KB. A letterhead mark, not a photograph. */
export const MAX_LOGO_BYTES = 512 * 1024;
/** Below this in either direction the mark is an artefact of a bad export. */
export const MIN_LOGO_PIXELS = 32;
/** Above this it is a photograph somebody dragged in by mistake. */
export const MAX_LOGO_PIXELS = 5000;

/** The two raster formats. SVG is refused here and in the artefact allowlist. */
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg'] as const;
export type LogoContentType = (typeof ALLOWED_LOGO_TYPES)[number];

export class LogoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogoError';
  }
}

export interface AcceptedLogo {
  readonly contentType: LogoContentType;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly sizeBytes: number;
}

/**
 * Accept or refuse the bytes, and say which they are.
 *
 * THE DECLARED TYPE IS NOT CONSULTED. It is a claim by the uploader; the
 * leading bytes are the fact. The same rule `detectContentType` follows for
 * every other artefact, applied to a shorter allowlist.
 */
export function assertLogoAcceptable(bytes: Uint8Array): AcceptedLogo {
  if (bytes.length === 0) throw new LogoError('The file is empty.');
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new LogoError(
      `A logo may be at most ${Math.floor(MAX_LOGO_BYTES / 1024)} KB; this one is ` +
        `${Math.ceil(bytes.length / 1024)} KB. It is embedded in every agreement the practice makes.`,
    );
  }

  const png = readPngHeader(bytes);
  const jpeg = png ? null : readJpegHeader(bytes);
  const read = png ?? jpeg;
  if (!read) {
    throw new LogoError(
      'A logo must be a PNG or a JPEG. SVG is not accepted — it is a document that can run script, and ' +
        'this image is drawn into an agreement.',
    );
  }

  for (const [axis, px] of [
    ['width', read.widthPx],
    ['height', read.heightPx],
  ] as const) {
    if (px < MIN_LOGO_PIXELS || px > MAX_LOGO_PIXELS) {
      throw new LogoError(
        `The ${axis} is ${px} pixels; it must be between ${MIN_LOGO_PIXELS} and ${MAX_LOGO_PIXELS}.`,
      );
    }
  }

  return { ...read, sizeBytes: bytes.length };
}

interface ImageHeader {
  readonly contentType: LogoContentType;
  readonly widthPx: number;
  readonly heightPx: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPngHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return null;
  // IHDR is always the first chunk: 4-byte length, "IHDR", width, height.
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  return {
    contentType: 'image/png',
    widthPx: readUInt32(bytes, 16),
    heightPx: readUInt32(bytes, 20),
  };
}

/**
 * Walk the JPEG segment chain to the frame header. Not a decoder — it reads
 * lengths and skips, and gives up rather than guessing on anything malformed.
 */
function readJpegHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // Padding fill bytes between segments are legal.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // SOF0..SOF15, excluding the four that are not frame headers.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (isFrame) {
      return {
        contentType: 'image/jpeg',
        heightPx: (bytes[i + 5] << 8) | bytes[i + 6],
        widthPx: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + length;
  }
  return null;
}

function readUInt32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/**
 * HOW BIG THE LOGO IS DRAWN ON THE PAGE, in PDF points, and it is FIXED.
 *
 * The upload's own dimensions decide nothing about the render: the image is
 * fitted into this box preserving its aspect ratio, so two practices with
 * differently exported versions of the same mark get the same letterhead, and
 * a practice that re-exports at twice the resolution changes nothing about the
 * page. (The BYTES change, so the letterhead hash changes, so the agreement
 * records a different letterhead — which is correct: it is a different file.)
 */
export const LOGO_BOX_POINTS = { width: 140, height: 48 } as const;

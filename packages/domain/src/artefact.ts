/**
 * Evidence artefacts — the screenshots, PDFs and emails that support a
 * validation check.
 *
 * EVERY UPLOAD IS HOSTILE UNTIL PROVEN OTHERWISE. An artefact is
 * attacker-supplied content that we will later hand back to a reviewer's
 * browser. That is the whole threat: a file called "screenshot.png" that is
 * actually SVG or HTML runs script in our origin the moment somebody views it,
 * against a session that can approve practices.
 *
 * So three rules, and none of them are negotiable:
 *
 *   1. THE DECLARED CONTENT TYPE IS A CLAIM, not a fact. It comes from the
 *      uploader. Detect the real type from the leading bytes and act on that.
 *   2. ALLOWLIST, never blocklist. New dangerous formats appear; new safe ones
 *      do not appear often enough to justify the inversion.
 *   3. SERVE AS AN ATTACHMENT, always. Never inline, never with a type we did
 *      not detect ourselves.
 *
 * The bytes are addressed by SHA-256, which is also what goes into the
 * evidence chain — the same shape as `renderedArtefactHash` on an agreement.
 * immudb holds hashes and events; blobs live in object storage.
 */

export class ArtefactError extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(`[${rule}] ${message}`);
    this.name = 'ArtefactError';
  }
}

/** What an artefact is evidence OF. Free text would become unsearchable. */
export const ARTEFACT_PURPOSES = [
  'entitlement_call', // notes or a recording reference for the callback
  'domain_check', // the round-trip email, headers included
  'website_capture', // what the site showed, and its TLS certificate
  'credential', // an accreditation letter, HPI-O confirmation
  'identity_document', // something tying a person to the entity
  'address_evidence', // a lease, rates notice, register extract or letterhead for a site
  'other',
] as const;
export type ArtefactPurpose = (typeof ARTEFACT_PURPOSES)[number];

/**
 * The allowlist. Deliberately short.
 *
 * NOT PRESENT, and never to be added casually:
 *   - SVG — an XML document that executes script. It is an image in name only.
 *   - HTML — the same, without the disguise.
 *   - ZIP and its descendants (docx, xlsx) — a container for arbitrary files,
 *     including the two above. Plausible as evidence, which is exactly what
 *     makes it tempting; if it is ever needed, it needs its own unpacking and
 *     re-scanning story, not a line added here.
 */
export const ALLOWED_ARTEFACT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'] as const;
export type ArtefactContentType = (typeof ALLOWED_ARTEFACT_TYPES)[number];

/** 20 MB. A screenshot or a scanned letter; not a video. */
export const MAX_ARTEFACT_BYTES = 20 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((byte, i) => bytes[i] === byte);

/**
 * Formats we can recognise and will NOT accept.
 *
 * This list exists because the text inference below is not safe on its own.
 * "GIF89a" and the ELF header are both printable ASCII, so a purely
 * character-based test happily calls them plain text — and then we would store
 * an executable as a .txt and hand it back on request. Known binaries are
 * therefore rejected by signature BEFORE anything is inferred.
 */
const REJECTED_SIGNATURES: ReadonlyArray<{ readonly sig: readonly number[]; readonly what: string }> = [
  { sig: [0x50, 0x4b, 0x03, 0x04], what: 'a ZIP archive (or a format built on one, such as .docx or .xlsx)' },
  { sig: [0x50, 0x4b, 0x05, 0x06], what: 'an empty ZIP archive' },
  { sig: [0x4d, 0x5a], what: 'a Windows executable' },
  { sig: [0x7f, 0x45, 0x4c, 0x46], what: 'a Linux executable' },
  { sig: [0xca, 0xfe, 0xba, 0xbe], what: 'a Java class or Mach-O binary' },
  { sig: [0x47, 0x49, 0x46, 0x38], what: 'a GIF' },
  { sig: [0x52, 0x49, 0x46, 0x46], what: 'a RIFF container (WAV, AVI, WebP)' },
  { sig: [0x1f, 0x8b], what: 'a gzip archive' },
  { sig: [0x37, 0x7a, 0xbc, 0xaf], what: 'a 7-Zip archive' },
  { sig: [0x25, 0x21, 0x50, 0x53], what: 'a PostScript file' },
];

function rejectedSignature(bytes: Uint8Array): string | null {
  for (const entry of REJECTED_SIGNATURES) {
    if (startsWith(bytes, entry.sig)) return entry.what;
  }
  return null;
}

/**
 * Detect the type from the leading bytes.
 *
 * Returns null for anything not on the allowlist — INCLUDING formats we can
 * recognise perfectly well. Recognising a GIF is not a reason to accept one.
 */
export function detectContentType(bytes: Uint8Array): ArtefactContentType | null {
  if (bytes.length === 0) return null;

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // Everything below here is INFERENCE, so anything recognisable is ruled out
  // first. Order matters: a known binary must never reach the text test.
  if (rejectedSignature(bytes)) return null;
  if (looksLikeMarkup(bytes)) return null;
  if (isProbablyUtf8Text(bytes)) return 'text/plain';

  return null;
}

/** Names the format in a refusal, so the message is actionable. */
export function describeRejectedType(bytes: Uint8Array): string {
  const known = rejectedSignature(bytes);
  if (known) return known;
  if (looksLikeMarkup(bytes)) return 'SVG, HTML or XML — markup that can execute script when viewed';
  return 'an unrecognised format';
}

function looksLikeMarkup(bytes: Uint8Array): boolean {
  // Look past a BOM and any leading whitespace, then at the first real byte.
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i += 1;
  // A leading '<' is enough on its own — nothing we accept begins with one.
  return bytes[i] === 0x3c;
}

function isProbablyUtf8Text(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  for (const byte of sample) {
    // Tab, LF and CR are the only control characters text contains. DEL is
    // included in the rejection because it is how the ELF header opens.
    if (byte === 0x7f) return false;
    if (byte < 0x09) return false;
    if (byte > 0x0d && byte < 0x20) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip a filename down to something safe to store and echo back.
 *
 * Path separators, traversal, NUL and control characters all removed. The
 * result is used for display and for the download name — never to build a
 * storage path, which is derived from the hash instead.
 */
export function sanitiseFilename(raw: string | null | undefined): string {
  // Control characters first, including NUL — which truncates a filename in
  // some consumers and is the classic way to smuggle an extension past a
  // check. Written as escapes rather than literal bytes, because raw control
  // characters in source survive neither a formatter nor a code review.
  // eslint-disable-next-line no-control-regex -- deliberate: this strips them.
  const stripped = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '');
  // Then strip any path, so a traversal attempt cannot survive as a name.
  const base = stripped.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/\.{2,}/g, '.')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'artefact';
}

export interface UploadCandidate {
  readonly bytes: Uint8Array;
  readonly declaredContentType?: string | null;
  readonly filename?: string | null;
  readonly purpose: string;
  readonly uploadedByName: string;
}

export interface AcceptedUpload {
  readonly detectedContentType: ArtefactContentType;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly purpose: ArtefactPurpose;
  /** True when the uploader's claim disagreed with the bytes. Worth recording. */
  readonly declaredTypeMismatch: boolean;
}

export function assertUploadAcceptable(candidate: UploadCandidate): AcceptedUpload {
  if (!candidate.uploadedByName?.trim()) {
    throw new ArtefactError('REQ-LOG-08', 'An artefact must record the human who uploaded it.');
  }
  if (!(ARTEFACT_PURPOSES as readonly string[]).includes(candidate.purpose)) {
    throw new ArtefactError(
      'FR-1.1',
      `"${candidate.purpose}" is not a known artefact purpose. Evidence that is not attached to a reason is ` +
        'just a file.',
    );
  }
  if (candidate.bytes.length === 0) {
    throw new ArtefactError('FR-1.1', 'The file is empty.');
  }
  if (candidate.bytes.length > MAX_ARTEFACT_BYTES) {
    throw new ArtefactError(
      'FR-1.1',
      `The file is ${Math.round(candidate.bytes.length / 1024 / 1024)} MB; the limit is ` +
        `${MAX_ARTEFACT_BYTES / 1024 / 1024} MB.`,
    );
  }

  const detected = detectContentType(candidate.bytes);
  if (!detected) {
    throw new ArtefactError(
      'FR-1.1',
      `This file appears to be ${describeRejectedType(candidate.bytes)}. Accepted evidence is PDF, PNG, ` +
        'JPEG or plain text. The file extension is not what decides this — the contents are.',
    );
  }

  const declared = (candidate.declaredContentType ?? '').split(';')[0].trim().toLowerCase();
  return {
    detectedContentType: detected,
    filename: sanitiseFilename(candidate.filename),
    sizeBytes: candidate.bytes.length,
    purpose: candidate.purpose as ArtefactPurpose,
    // Not a refusal — browsers get this wrong innocently all the time — but a
    // deliberate mismatch is a probe, and probes are worth a record.
    declaredTypeMismatch: Boolean(declared) && declared !== detected,
  };
}

/**
 * How an artefact is served. There is one answer and it does not vary.
 *
 * `nosniff` matters as much as the disposition: without it a browser may
 * second-guess the type and render something we said was a download.
 */
export function downloadHeaders(artefact: {
  detectedContentType: string;
  filename: string;
}): Record<string, string> {
  return {
    // The DETECTED type. Never the declared one, and never inline.
    'Content-Type': artefact.detectedContentType,
    'Content-Disposition': `attachment; filename="${sanitiseFilename(artefact.filename)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, no-store',
  };
}

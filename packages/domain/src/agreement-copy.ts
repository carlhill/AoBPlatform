/**
 * "SEND ME A COPY" — W6, REQ-PORT-02, which automates the s 65C
 * copy-on-request obligation.
 *
 * WHAT THIS MODULE DECIDES, and it is only three things: which channels may be
 * offered to the person who just signed, what address each of them would reach
 * (shown MASKED, never in full), and how long the link that carries the copy
 * stays open. Everything else — minting the link, queueing the message,
 * serving the bytes — is the server's, and every one of those steps reads its
 * answer from here rather than deciding again.
 *
 * NO ADDRESS IS EVER TYPED ON THE TABLET (D-2026-09-11-03, 11 Sep 2026). The
 * offer is always to a contact ALREADY ON THE RECORD. When the contact is
 * wrong or missing there is no box to fix it in: the answer is reception, who
 * change it at the desk where records are edited. Three reasons line up on it —
 * a patient surface is not where records are changed, the patient's own contact
 * belongs to the patient record with the PMS as source of truth (REQ-DATA-10,
 * ASSIGNOR-RULES rule 6), and an address typed on glass has to live somewhere
 * between the keystroke and the send, which on a zero-footprint tablet is
 * nowhere (CLAUDE.md §7).
 *
 * WHOSE CONTACT (ASSIGNOR-RULES rules 5–6). If the patient signed for
 * themselves, the patient record's mobile and email. If somebody else signed,
 * THAT ASSIGNOR'S own mobile and email — never the patient's. The copy goes to
 * the person who signed, because the copy is of what they signed. Mixing the
 * two would post a patient's agreement to a carer who is no longer involved,
 * or send a carer's copy to a patient who never asked for it.
 *
 * MASKED, NOT HIDDEN. A blank offer ("we'll email it to you") cannot be checked
 * by the one person who knows whether the address is right. A full offer is
 * readable by whoever is standing behind them. So enough to recognise and not
 * enough to read: one leading character and the domain's suffix, or the last
 * three digits of a mobile.
 *
 * NOTHING HERE BLOCKS ANYTHING (hard rule 8). No contact, every channel
 * declined, the send failing later — the ceremony is complete in all three
 * cases, because the signature is what completes it. The copy is an extra.
 */
import content from '../content/copy-delivery-channels.json';
import { normaliseEmail, normalisePhone } from './contacts';

/** The transports a copy may actually take. `null` is the "no thanks" option. */
export const COPY_DELIVERY_TRANSPORTS = ['email', 'sms'] as const;
export type CopyDeliveryTransport = (typeof COPY_DELIVERY_TRANSPORTS)[number];

export interface CopyDeliveryOption {
  /** Stable identifier. The string table is keyed by this; it is never shown. */
  readonly key: string;
  /** The transport, or `null` for the option that sends nothing. */
  readonly channel: CopyDeliveryTransport | null;
  /** What the option is for. Never rendered. */
  readonly note: string;
}

export interface CopyDeliveryContent {
  /** Recorded against every copy request made from this list. Bump it on every edit. */
  readonly version: string;
  /** ORDER IS THE ORDER ON SCREEN. */
  readonly options: readonly CopyDeliveryOption[];
}

/**
 * Exhaustive, and it throws rather than repairing — the same charter every
 * other content loader in this package follows (CONVENTIONS.md §1: no runtime
 * dependencies, so no schema library). It runs at module load, so a bad edit
 * fails the build at the bench rather than a tablet in a waiting room.
 */
export function parseCopyDeliveryContent(raw: unknown): CopyDeliveryContent {
  const fail = (why: string): never => {
    throw new Error(
      `content/copy-delivery-channels.json is not usable: ${why}. This file is versioned content ` +
        '(hard rule 14) and is validated at load so a bad edit fails the build rather than a patient.',
    );
  };

  if (typeof raw !== 'object' || raw === null) return fail('it is not an object');
  const doc = raw as Record<string, unknown>;

  if (typeof doc.version !== 'string' || doc.version.trim().length === 0) {
    return fail('`version` must be a non-empty string');
  }
  if (!Array.isArray(doc.options) || doc.options.length === 0) {
    return fail('`options` must be a non-empty array');
  }

  const seen = new Set<string>();
  const options = doc.options.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) return fail(`options[${index}] is not an object`);
    const o = entry as Record<string, unknown>;

    if (typeof o.key !== 'string' || !/^[a-z][a-z0-9_]*$/.test(o.key)) {
      return fail(`options[${index}].key must be a lower_snake_case identifier`);
    }
    if (seen.has(o.key)) return fail(`options[${index}].key "${o.key}" appears twice`);
    seen.add(o.key);

    if (o.channel !== null && !COPY_DELIVERY_TRANSPORTS.includes(o.channel as CopyDeliveryTransport)) {
      return fail(
        `options[${index}] ("${o.key}").channel must be one of ${COPY_DELIVERY_TRANSPORTS.join(', ')} or null — ` +
          'a channel the platform cannot actually send on would be an offer it cannot keep',
      );
    }
    if (typeof o.note !== 'string' || o.note.trim().length === 0) {
      return fail(`options[${index}] ("${o.key}").note must say what the option is for`);
    }

    return { key: o.key, channel: o.channel as CopyDeliveryTransport | null, note: o.note };
  });

  if (!options.some((o) => o.channel === null)) {
    return fail(
      'no option sends nothing. A screen that offers only ways to say yes is not offering a choice, ' +
        'and a patient who wants no copy must be able to say so',
    );
  }

  return { version: doc.version, options };
}

const parsed = parseCopyDeliveryContent(content);

export const COPY_DELIVERY_CONTENT: CopyDeliveryContent = parsed;
/** Recorded on every copy request. Never derived from the option keys. */
export const COPY_DELIVERY_VERSION: string = parsed.version;

export function copyDeliveryOption(key: string): CopyDeliveryOption | undefined {
  return parsed.options.find((o) => o.key === key);
}

/**
 * How long a copy link stays open.
 *
 * SEVEN DAYS, matching the portal invitation rather than the capture link's 48
 * hours, and for the same reason: a signing link is time-critical because the
 * practice is waiting on it, while a copy of something already signed is the
 * patient's own document and a weekend is not a mistake. Still short enough
 * that a message sitting in an old inbox is not a standing key to a record.
 *
 * THE DURABLE COPY IS THE PORTAL (REQ-PORT-02). This link is delivery; the
 * patient's own page is where the copy lives for the retention period, which is
 * why a link that has lapsed is not a lost document.
 */
export const COPY_LINK_EXPIRY_HOURS = 24 * 7;

/* -------------------------------------------------------------------------
 * Masking
 * ---------------------------------------------------------------------- */

/** The character the masks are built from. One glyph, so a mask cannot be mistaken for a value. */
const DOT = '•';

/**
 * `carl@example.com` → `c•••@e•••.com`.
 *
 * ENOUGH TO RECOGNISE, NOT ENOUGH TO READ. The leading character and the
 * public suffix are what a person checks ("yes, that's my work one"); the rest
 * is what somebody behind them in the queue would otherwise read off the
 * screen. The number of dots is FIXED rather than proportional — a
 * proportional mask leaks the length, which for an address is most of the
 * guessing work.
 *
 * Anything that is not recognisably an address masks whole. A malformed value
 * is still somebody's data.
 */
export function maskEmail(value: string | null | undefined): string | null {
  const normalised = normaliseEmail(value ?? '');
  if (normalised.length === 0) return null;

  const at = normalised.lastIndexOf('@');
  if (at <= 0 || at === normalised.length - 1) return `${DOT}${DOT}${DOT}`;

  const local = normalised.slice(0, at);
  const domain = normalised.slice(at + 1);
  const dot = domain.indexOf('.');
  const head = domain.length > 0 ? domain[0] : '';
  const suffix = dot > 0 ? domain.slice(dot) : '';

  return `${local[0]}${DOT}${DOT}${DOT}@${head}${DOT}${DOT}${DOT}${suffix}`;
}

/**
 * `0408 169 971` → `•••••• 971`.
 *
 * THE LAST THREE DIGITS ARE THE CHECK every Australian already knows how to
 * make, and three is few enough that the number cannot be dialled from the
 * screen. The leading digits are masked at a FIXED width for the same reason
 * the email is: a proportional mask says how long the number is.
 */
export function maskMobile(value: string | null | undefined): string | null {
  const digits = normalisePhone(value ?? '');
  if (digits.length === 0) return null;
  const bare = digits.replace(/\D/g, '');
  if (bare.length < 3) return DOT.repeat(6);
  return `${DOT.repeat(6)} ${bare.slice(-3)}`;
}

/* -------------------------------------------------------------------------
 * The offer
 * ---------------------------------------------------------------------- */

/** A contact pair, from whichever record the signer's contact lives on. */
export interface SignerContact {
  readonly mobile?: string | null;
  readonly email?: string | null;
}

export interface CopyOfferInput {
  /**
   * D7 — explicit, never inferred from a missing assignor. The field that
   * decides WHOSE contact this offer reads (ASSIGNOR-RULES rules 5–6).
   */
  readonly assignorIsPatient: boolean;
  /** The patient record's own contact. Read only when the patient signed. */
  readonly patient: SignerContact;
  /** The signing assignor's own contact. Read only when somebody else signed. */
  readonly assignor?: SignerContact | null;
}

export interface CopyOfferChannel {
  /** The option key from the content file. The string table is keyed by it. */
  readonly key: string;
  readonly channel: CopyDeliveryTransport;
  /** What the patient sees. Masked, always — the value never leaves the server. */
  readonly masked: string;
}

/**
 * Why no channel could be offered. A reason code, mapped to copy and a
 * destination on the client — never a sentence composed here, and never a
 * generic fallback ("Shortcuts to the answer", Carl 4 Sep 2026).
 */
export type CopyOfferUnavailable = 'no_contact_on_file';

export interface CopyOffer {
  /** In content-file order. Empty when there is nothing to offer. */
  readonly channels: readonly CopyOfferChannel[];
  /** The option that sends nothing. Always present; the content loader insists. */
  readonly declineKey: string;
  /** Set only when `channels` is empty. */
  readonly unavailable?: CopyOfferUnavailable;
  /** Travels with the request the patient makes from this offer (hard rule 14). */
  readonly version: string;
}

/**
 * Which channels this signer may be offered, and the masked address each one
 * would reach.
 *
 * IT READS ONE RECORD, NOT BOTH. `assignorIsPatient` chooses, and the other
 * record is not consulted — so a carer's mobile can never be filled in from
 * the patient's row because the carer's was blank, which is the precise
 * failure ASSIGNOR-RULES rule 6 exists to stop.
 *
 * AN EMPTY OFFER IS AN ANSWER, not an error. `no_contact_on_file` is what the
 * tablet turns into "see reception" — there is no third branch where a box
 * appears (D-2026-09-11-03).
 */
export function copyOfferFor(input: CopyOfferInput): CopyOffer {
  const source: SignerContact = input.assignorIsPatient ? input.patient : (input.assignor ?? {});

  const masked: Record<CopyDeliveryTransport, string | null> = {
    email: maskEmail(source.email),
    sms: maskMobile(source.mobile),
  };

  const channels: CopyOfferChannel[] = [];
  for (const option of parsed.options) {
    if (option.channel === null) continue;
    const value = masked[option.channel];
    if (value === null) continue;
    channels.push({ key: option.key, channel: option.channel, masked: value });
  }

  const decline = parsed.options.find((o) => o.channel === null)!;

  return {
    channels,
    declineKey: decline.key,
    ...(channels.length === 0 ? { unavailable: 'no_contact_on_file' as const } : {}),
    version: parsed.version,
  };
}

/**
 * The address a chosen option actually reaches — SERVER SIDE ONLY.
 *
 * Separate from `copyOfferFor` on purpose: that function's result is sent to a
 * tablet and must not be able to carry a value, and this one's result is
 * handed straight to the outbound queue and never to a screen. Two functions
 * means the tablet's payload type has no field a real address could sit in.
 *
 * Returns null when the option is unknown, sends nothing, or has no contact —
 * all three are "do not send", and none of them is an error the patient sees.
 */
export function copyDestinationFor(
  input: CopyOfferInput,
  optionKey: string,
): { channel: CopyDeliveryTransport; destination: string } | null {
  const option = copyDeliveryOption(optionKey);
  if (!option || option.channel === null) return null;

  const source: SignerContact = input.assignorIsPatient ? input.patient : (input.assignor ?? {});
  const raw = option.channel === 'email' ? source.email : source.mobile;
  const destination = (raw ?? '').trim();
  if (destination.length === 0) return null;

  return { channel: option.channel, destination };
}

/** The template the copy message is written from. Words live in content, never here. */
export const AGREEMENT_COPY_TEMPLATE_KEY = 'agreement_copy_v1';

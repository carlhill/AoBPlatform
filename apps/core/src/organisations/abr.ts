import { Logger } from '@nestjs/common';
import type { AbrLookup } from '@aobplatform/domain';

/**
 * ABN lookup against the Australian Business Register.
 *
 * ⚠ THIS IS THE ONE RUNTIME NETWORK DEPENDENCY IN THE ONBOARDING PATH, and
 * CLAUDE.md §7 requires it to be signed off rather than assumed. It is here
 * because Carl asked for it explicitly ("implement the abn lookup", 4 September
 * 2026), and it is confined to organisation onboarding: nothing in the capture,
 * signing or evidence path can reach it, so the ABR being down delays a new
 * practice joining and does not stop a single consent being captured.
 *
 * That confinement is a TEST rather than a convention —
 * `abr_client_is_not_reachable_from_the_capture_path` in abr-boundary.spec.ts
 * fails if any module outside this directory imports this file.
 *
 * The address validator deliberately went the other way — G-NAF is held
 * locally precisely so nothing on the hot path needs the network.
 *
 * Default is the OFFLINE client. The live one is inert until an API GUID is
 * configured, so a misconfigured environment cannot silently start talking to
 * a government service.
 */

/**
 * WHY THERE ARE TWO ANSWERS AND NOT ONE.
 *
 * `lookup` collapses every unhappy outcome to null, which is exactly right for
 * registration: not found and cannot reach both mean "do not create an
 * organisation on this", and the manual attestation covers both.
 *
 * `probe` keeps them apart, because the APPLICANT looking at the form needs to
 * be told which one happened — "the register has no record of this ABN, check
 * the number" and "we could not reach the register, here is the attestation
 * panel" have different next steps, and a screen that guesses between them is
 * the generic-message defect Carl named on 4 September 2026. The `reason` is a
 * CODE, not prose: the web maps codes to copy and to a destination, and an
 * unmapped code is shown as itself so it can be diagnosed.
 */
export type AbrProbe =
  | { readonly status: 'found'; readonly lookup: AbrLookup }
  | { readonly status: 'not_found'; readonly reason: AbrReason }
  | { readonly status: 'unreachable'; readonly reason: AbrReason };

export type AbrReason =
  /** The register answered, and holds nothing against this ABN. */
  | 'no_record'
  /** The register would not treat the input as an ABN at all. */
  | 'invalid_search_text'
  /** OUR credential was refused. An operations problem, never the applicant's. */
  | 'register_refused'
  /** No GUID in this environment, so nothing was asked. */
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'unparseable';

export interface AbrClient {
  lookup(abn: string): Promise<AbrLookup | null>;
  probe(abn: string): Promise<AbrProbe>;
  readonly kind: 'offline' | 'live';
}

/**
 * Map the ABR's entity-type descriptions onto our vocabulary. Deliberately
 * conservative: an unrecognised type maps to OTHER and lands in the human
 * validation queue rather than being guessed at.
 */
export function mapEntityType(abrDescription: string): string {
  const d = abrDescription.toUpperCase();
  if (d.includes('PUBLIC COMPANY')) return 'PUBLIC_COMPANY';
  if (d.includes('PROPRIETARY') || d.includes('PRIVATE COMPANY')) return 'PTY_LTD';
  if (d.includes('SOLE TRADER') || d.includes('INDIVIDUAL')) return 'INDIVIDUAL_SOLE_TRADER';
  if (d.includes('TRUST')) return 'TRUST';
  if (d.includes('PARTNERSHIP')) return 'PARTNERSHIP';
  return 'OTHER';
}

/**
 * Offline client. Returns nothing except for the fixtures below, so an
 * unconfigured environment fails honestly ("the ABR could not be reached")
 * rather than waving practices through unverified.
 *
 * The fixtures use obviously-fake entities and checksum-valid ABNs that belong
 * to nobody (CLAUDE.md §7 — sample data uses obviously fake identities).
 */
export class OfflineAbrClient implements AbrClient {
  readonly kind = 'offline' as const;

  private static readonly FIXTURES: Record<string, AbrLookup> = {
    // A company, trading under a different name from its legal entity name —
    // the case that makes strict legal-name matching wrong.
    '53004085616': {
      abn: '53004085616',
      abnStatus: 'ACTIVE',
      legalName: 'Sample Medical Holdings Pty Ltd',
      businessNames: ['Sampletown Family Practice', 'Sampletown Skin Clinic'],
      entityType: 'PTY_LTD',
      gstRegistered: true,
    },
    // A sole trader: an ABN with no derivable ACN.
    '51824753556': {
      abn: '51824753556',
      abnStatus: 'ACTIVE',
      legalName: 'Example Jo',
      businessNames: ['Jo Example Medical'],
      entityType: 'INDIVIDUAL_SOLE_TRADER',
      gstRegistered: false,
    },
    // A cancelled ABN, so the ACTIVE gate can be exercised end to end.
    '13824753558': {
      abn: '13824753558',
      abnStatus: 'CANCELLED',
      legalName: 'Former Clinic Pty Ltd',
      businessNames: [],
      entityType: 'PTY_LTD',
      gstRegistered: false,
    },
  };

  async lookup(abn: string): Promise<AbrLookup | null> {
    return OfflineAbrClient.FIXTURES[abn.replace(/[\s-]/g, '')] ?? null;
  }

  /**
   * A fixture miss is UNREACHABLE, not "no record".
   *
   * The distinction is the whole point of the probe: this client never asked
   * the register anything, so it is in no position to say the register holds
   * nothing. Saying `not_configured` sends the applicant to the attestation
   * panel, which is the true and useful answer; saying `no_record` would tell
   * them their ABN does not exist, which we do not know and which is usually
   * false.
   */
  async probe(abn: string): Promise<AbrProbe> {
    const lookup = await this.lookup(abn);
    return lookup ? { status: 'found', lookup } : { status: 'unreachable', reason: 'not_configured' };
  }
}

// ---------------------------------------------------------------------------
// The live service
// ---------------------------------------------------------------------------

/**
 * What `AbnDetails` actually answers with.
 *
 * VERIFIED, NOT ASSUMED. One real response is recorded in
 * `__fixtures__/abr-ato.json` (the Australian Taxation Office's own ABN — a
 * public body, not a person) and the mapper below is tested against it, so
 * every field name here has been seen on the wire, on 4 September 2026.
 *
 * TWO THINGS ABOUT THE WIRE FORMAT that a plain `response.json()` gets wrong:
 *
 *   - IT IS JSONP. The body is `callback({ … })` and the content type is
 *     `text/javascript`, whether or not a callback parameter was sent.
 *   - NOTHING IS AN ERROR. An invalid ABN, an unknown ABN and a rejected GUID
 *     all come back HTTP 200 with every field empty and the reason in
 *     `Message`. Trusting the status code would read "not a valid ABN" as a
 *     successful match against a nameless entity.
 */
interface AbnDetailsPayload {
  Abn?: string;
  AbnStatus?: string;
  AbnStatusEffectiveFrom?: string;
  Acn?: string;
  AddressDate?: string | null;
  AddressPostcode?: string;
  AddressState?: string;
  /**
   * BUSINESS names, and only business names.
   *
   * THE ABR STOPPED COLLECTING TRADING NAMES IN MAY 2012. Anything still
   * described as a trading name in the register is a record of what somebody
   * called themselves before then, unmaintained since — so it must never be
   * used to decide that a typed name identifies this entity. `BusinessName`
   * on this method carries registered business names, which are current by
   * construction: there is no historical set to filter here, and no second
   * name array to be tempted by.
   */
  BusinessName?: string[];
  EntityName?: string;
  EntityTypeCode?: string;
  EntityTypeName?: string;
  /** The DATE GST registration took effect, or null. Not a boolean. */
  Gst?: string | null;
  /** Non-empty means the register is refusing, at HTTP 200. */
  Message?: string;
}

/** Strip the `callback( … )` padding the JSON endpoints answer with. */
export function unwrapJsonp(body: string): string {
  const trimmed = body.trim();
  const open = trimmed.indexOf('(');
  if (!trimmed.startsWith('callback') || open === -1 || !trimmed.endsWith(')')) return trimmed;
  return trimmed.slice(open + 1, -1);
}

/**
 * The register's answer, reduced to what we store.
 *
 * Returns null for every shape that is not a positive identification: any
 * `Message`, or an empty `Abn`. Null routes onboarding to manual attestation,
 * so the cost of being too strict here is that a named human types what the
 * register shows — which is the right way round.
 */
export function mapAbnDetails(payload: AbnDetailsPayload): AbrLookup | null {
  if (payload.Message && payload.Message.trim().length > 0) return null;
  const abn = (payload.Abn ?? '').replace(/[\s-]/g, '');
  if (!abn) return null;

  const gst = String(payload.Gst ?? '').trim();
  return {
    abn,
    abnStatus: (payload.AbnStatus ?? '').trim().toUpperCase(),
    legalName: (payload.EntityName ?? '').trim(),
    businessNames: (payload.BusinessName ?? []).map((n) => n.trim()).filter(Boolean),
    entityType: mapEntityType(payload.EntityTypeName ?? ''),
    // A date is a yes; null and the empty string are a no.
    gstRegistered: gst.length > 0,
    abnStatusEffectiveFrom: (payload.AbnStatusEffectiveFrom ?? '').trim() || undefined,
    acn: (payload.Acn ?? '').replace(/[\s-]/g, '') || undefined,
    mainBusinessState: (payload.AddressState ?? '').trim() || undefined,
    mainBusinessPostcode: (payload.AddressPostcode ?? '').trim() || undefined,
  };
}

/**
 * The live ABN Lookup web service — document-style JSON, method `AbnDetails`.
 *
 * WHAT IT DOES ON FAILURE, and why there is only one answer: it returns null
 * and logs a warning. Network down, HTTP 500, a rejected GUID, an unparseable
 * body — all null. The caller already has a path for "the register could not
 * answer", it is the manual attestation, and routing every fault into it means
 * a bad afternoon at the ABR delays an application rather than failing one.
 *
 * NO RETRIES IN THE REQUEST PATH. An applicant is waiting on this; a retry
 * loop turns a five-second wait into fifteen and still ends at the attestation
 * panel. A QUEUED RE-CHECK is the right home for persistence — an application
 * that fell back to attestation should be re-checked later and its provenance
 * upgraded — and it is deliberately a separate concern, recorded in TODO.md
 * rather than smuggled in here.
 *
 * THE GUID IS A CREDENTIAL. It comes from ABR_API_GUID and is never logged,
 * never returned to a caller, and never written into a fixture.
 */
export class AbrWebServicesClient implements AbrClient {
  readonly kind = 'live' as const;
  private readonly logger = new Logger(AbrWebServicesClient.name);

  constructor(
    private readonly guid: string,
    private readonly baseUrl = 'https://abr.business.gov.au/json',
    private readonly timeoutMs = 5000,
  ) {}

  async lookup(abn: string): Promise<AbrLookup | null> {
    const probe = await this.probe(abn);
    return probe.status === 'found' ? probe.lookup : null;
  }

  async probe(abn: string): Promise<AbrProbe> {
    const normalised = abn.replace(/[\s-]/g, '');
    const url =
      `${this.baseUrl}/AbnDetails.aspx?abn=${encodeURIComponent(normalised)}` +
      `&guid=${encodeURIComponent(this.guid)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        /*
         * NO ABN IN THE LOG LINE. A sole trader's ABN identifies a person, and
         * a log is the one store here with no encryption and no retention
         * story. What operations needs from this line is that lookups are
         * failing and with what status, which is what it says.
         */
        this.logger.warn(`ABR lookup returned HTTP ${response.status} — falling back to manual attestation.`);
        return { status: 'unreachable', reason: 'http_error' };
      }

      let payload: AbnDetailsPayload;
      try {
        payload = JSON.parse(unwrapJsonp(await response.text())) as AbnDetailsPayload;
      } catch {
        this.logger.warn('ABR lookup returned a body that is not the documented JSONP shape.');
        return { status: 'unreachable', reason: 'unparseable' };
      }

      const message = (payload.Message ?? '').trim();
      if (message.length > 0) {
        // The register's own words, which describe the QUERY rather than the
        // querier, so they are safe to log. All three of these were observed
        // on 4 September 2026 against the live service.
        this.logger.warn(`ABR lookup refused: ${message}`);
        return classifyMessage(message);
      }

      const mapped = mapAbnDetails(payload);
      if (!mapped) {
        this.logger.warn('ABR lookup returned neither an ABN nor a message.');
        return { status: 'unreachable', reason: 'unparseable' };
      }
      return { status: 'found', lookup: mapped };
    } catch (err) {
      // Never throw into onboarding: a network failure must present as "we
      // could not verify this right now", not a 500.
      const error = err as Error;
      const timedOut = error.name === 'AbortError' || error.name === 'TimeoutError';
      this.logger.warn(
        `ABR lookup failed: ${timedOut ? `timed out after ${this.timeoutMs}ms` : error.message}`,
      );
      return { status: 'unreachable', reason: timedOut ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * The register's three refusals, and which of them is OUR problem.
 *
 * Verified against the live service on 4 September 2026:
 *
 *   "No record found"                                    → the ABN is unknown
 *   "Search text is not a valid ABN or ACN"              → not an ABN at all
 *   "The GUID entered is not recognised as a Registered  → OUR credential is
 *    Party"                                                 wrong or revoked
 *
 * The third is the one that must never be shown to an applicant as though they
 * had done something wrong. It is `unreachable`, so they get the attestation
 * panel and an operator gets a log line naming the real fault.
 *
 * Anything unrecognised is treated as UNREACHABLE rather than as "no record":
 * a new message we have never seen is not evidence that an entity does not
 * exist, and guessing that it is would refuse a real practice.
 */
function classifyMessage(message: string): AbrProbe {
  const m = message.toLowerCase();
  if (m.includes('guid')) return { status: 'unreachable', reason: 'register_refused' };
  if (m.includes('no record')) return { status: 'not_found', reason: 'no_record' };
  if (m.includes('not a valid abn')) return { status: 'not_found', reason: 'invalid_search_text' };
  return { status: 'unreachable', reason: 'register_refused' };
}

/*
 * ACN LOOKUP IS NOT IMPLEMENTED, and that is a decision rather than an
 * oversight. `AcnDetails.aspx` exists and answers (verified 4 September 2026),
 * but `AbrLookup` has no ACN-first path: onboarding is always entered with an
 * ABN, the ACN is DERIVED from it by the domain gate, and `AbnDetails` already
 * returns the register's own `Acn` to check that derivation against. A second
 * endpoint would be a second network dependency with no caller.
 */

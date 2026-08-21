import { Logger } from '@nestjs/common';
import type { AbrLookup } from '@aobplatform/domain';

/**
 * ABN lookup against the Australian Business Register.
 *
 * ⚠ THIS IS THE ONE RUNTIME NETWORK DEPENDENCY IN THE ONBOARDING PATH, and
 * CLAUDE.md §7 requires it to be signed off rather than assumed. It is here
 * because Carl asked for it explicitly ("Do an ABN lookup and compare"), and
 * it is confined to organisation onboarding: nothing in the capture, signing
 * or evidence path can reach it, so the ABR being down delays a new practice
 * joining and does not stop a single consent being captured.
 *
 * The address validator deliberately went the other way — G-NAF is held
 * locally precisely so nothing on the hot path needs the network.
 *
 * Default is the OFFLINE client. The live one is inert until an API GUID is
 * configured, so a misconfigured environment cannot silently start talking to
 * a government service.
 */

export interface AbrClient {
  lookup(abn: string): Promise<AbrLookup | null>;
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
}

/**
 * The live ABN Lookup web service.
 *
 * ⚠ REVIEW BEFORE PRODUCTION USE. The response shape below is written from the
 * documented JSON search endpoint and has NOT been exercised against the real
 * service — treat the field names as a hypothesis until someone has run it
 * with a genuine GUID and confirmed them. Everything it cannot parse
 * confidently returns null, which routes the application to human validation
 * rather than approving it on a guess.
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
    const normalised = abn.replace(/[\s-]/g, '');
    const url = `${this.baseUrl}/AbnDetails.aspx?abn=${encodeURIComponent(normalised)}&guid=${encodeURIComponent(this.guid)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        this.logger.warn(`ABR lookup for ${normalised} returned HTTP ${response.status}`);
        return null;
      }
      // The endpoint answers with JSONP-ish padding in some modes; strip it.
      const text = (await response.text()).replace(/^callback\(/, '').replace(/\)\s*;?\s*$/, '');
      const data = JSON.parse(text) as Record<string, unknown>;

      if (!data.Abn || typeof data.Abn !== 'string') {
        this.logger.warn(`ABR lookup for ${normalised} returned no ABN — treating as not found.`);
        return null;
      }

      return {
        abn: String(data.Abn).replace(/[\s-]/g, ''),
        abnStatus: String(data.AbnStatus ?? '').toUpperCase(),
        legalName: String(data.EntityName ?? ''),
        businessNames: Array.isArray(data.BusinessName) ? (data.BusinessName as string[]) : [],
        entityType: mapEntityType(String(data.EntityTypeName ?? '')),
        gstRegistered: Boolean(data.Gst),
      };
    } catch (err) {
      // Never throw into onboarding: a network failure must present as "we
      // could not verify this right now", not a 500.
      this.logger.warn(`ABR lookup for ${normalised} failed: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

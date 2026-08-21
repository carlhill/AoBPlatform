import { Logger } from '@nestjs/common';

/**
 * Address validation for practice locations (ORG-MODEL-PROPOSAL.md §9).
 *
 * G-NAF, HELD LOCALLY. No runtime network dependency, and no address leaves
 * our infrastructure — which matters beyond this feature, because address is
 * one of the six approved patient identifiers (REQ-VER-02) and REQ-NFR-01
 * requires Australian data residency with no offshore processing. Whatever
 * validator exists for practice locations will eventually be pointed at
 * patient addresses; setting the posture now costs nothing.
 *
 * What validation means here: G-NAF says an address EXISTS and gives its
 * canonical form. It does not say the practice is at it. For gating location
 * activation that is the right bar — the human validation queue covers the
 * rest.
 */

export interface AddressValidationResult {
  readonly validated: boolean;
  /** The canonical G-NAF form. What renders on the agreement, not what was typed. */
  readonly canonical?: string;
  readonly gnafPid?: string;
  readonly gnafVersion?: string;
  readonly state?: string;
  /** Why it did not validate, in words an operator can act on. */
  readonly reason?: string;
  /** Near misses, when the dataset has them. Never auto-applied. */
  readonly suggestions?: readonly string[];
}

export interface AddressValidator {
  validate(address: string): Promise<AddressValidationResult>;
  readonly kind: 'gnaf' | 'manual';
}

/** The states/territories G-NAF canonicalises to — also the holiday calendars. */
const STATE_PATTERN = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/;

export function extractState(address: string): string | undefined {
  return STATE_PATTERN.exec(address.toUpperCase())?.[1];
}

/**
 * Validation against a locally-ingested G-NAF extract.
 *
 * ⚠ NOT YET WIRED TO A DATASET. The G-NAF extract is versioned content on the
 * same pattern as rule sets, the Basic Service Description mapping and public
 * holidays: ingested, versioned, refreshed quarterly, with a human-reviewed
 * diff. Until that ingest exists, constructing this class throws rather than
 * quietly passing every address — a validator that always says yes is worse
 * than no validator, because it puts `addressValidated = true` in the record.
 */
export class GnafAddressValidator implements AddressValidator {
  readonly kind = 'gnaf' as const;

  constructor(private readonly datasetVersion: string) {
    throw new Error(
      'G-NAF validation is not yet available: no dataset has been ingested. Run the practice in ' +
        'ADDRESS_VALIDATION_MODE=manual until the G-NAF ingest lands. Refusing to start rather than ' +
        'marking every address validated.',
    );
  }

  async validate(_address: string): Promise<AddressValidationResult> {
    throw new Error('unreachable');
  }
}

/**
 * The interim mode: a named human confirms the address, in the same validation
 * queue that already approves the organisation.
 *
 * This is honest about what it is. It does NOT set `addressValidated` on its
 * own — it reports `validated: false` with a reason, so a location stays
 * inactive until a person acts. What it does provide is the derived state,
 * which the holiday calendar needs and which is unambiguous from the text.
 */
export class ManualAddressValidator implements AddressValidator {
  readonly kind = 'manual' as const;
  private readonly logger = new Logger(ManualAddressValidator.name);

  async validate(address: string): Promise<AddressValidationResult> {
    const state = extractState(address);
    if (!state) {
      return {
        validated: false,
        reason:
          'No Australian state or territory could be read from this address. The state drives the ' +
          'public-holiday calendar used for 2-business-day terminations (REQ-OFF-03), so it cannot be left blank.',
      };
    }
    this.logger.log(`Address queued for manual validation (state ${state}).`);
    return {
      validated: false,
      state,
      reason:
        'ADDRESS_VALIDATION_MODE=manual: this address needs a named human to confirm it before the ' +
        'location can be activated. Automatic G-NAF validation is not yet ingested.',
    };
  }
}

export function createAddressValidator(mode: string | undefined, datasetVersion?: string): AddressValidator {
  if (mode === 'gnaf') return new GnafAddressValidator(datasetVersion ?? 'unknown');
  return new ManualAddressValidator();
}

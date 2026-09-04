import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';
import {
  CONFIRMABLE_DETAIL_TYPES,
  DISPUTE_RESOLUTION_OUTCOMES,
  type DisputeResolutionOutcome,
} from '@aobplatform/domain';

export { DISPUTE_RESOLUTION_OUTCOMES, type DisputeResolutionOutcome };

/*
 * THE TWO OUTCOMES LIVE IN THE DOMAIN, not here — `DISPUTE_RESOLUTION_OUTCOMES`
 * in packages/domain/src/tablet-session.ts, with the reasoning for why there
 * are two and no third. FOUR THINGS MUST AGREE ABOUT THEM: this DTO, the CHECK
 * constraint that stores them, the row the console renders, and the vault event
 * that evidences them. A second copy is the one that drifts, and a copy inside
 * a decorator is the one nobody notices has drifted.
 */

/**
 * `POST /tablet-sessions/:id/dispute-resolution` — reception closes a dispute.
 *
 * TYPES ONLY, AND THE LIST IS FIXED, exactly as on `confirm-details`. There is
 * no field here that could carry a value, so neither the detail as it stood
 * nor the detail as it now reads can reach the vault by this route
 * (REQ-VER-04, hard rule 9). The words are the same five the patient's
 * tick-boxes used, so the evidence reads in one vocabulary from the cross to
 * its resolution.
 *
 * `details` IS REQUIRED AND MUST NOT BE EMPTY. A resolution that names nothing
 * is a record that says only "somebody pressed a button", which is worse than
 * no record: it looks like evidence and answers no question.
 */
export class ResolveDisputeDto {
  @IsIn(DISPUTE_RESOLUTION_OUTCOMES as unknown as string[])
  outcome!: DisputeResolutionOutcome;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONFIRMABLE_DETAIL_TYPES.length)
  @IsString({ each: true })
  @IsIn(CONFIRMABLE_DETAIL_TYPES as unknown as string[], { each: true })
  details!: string[];
}

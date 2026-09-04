import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';
import { CONFIRMABLE_DETAIL_TYPES } from '@aobplatform/domain';

/**
 * HOW A DISPUTE ENDS, and there are exactly two honest answers (Carl, 4 Sep
 * 2026).
 *
 *  - `corrected`     — reception changed the detail on the platform's mirror.
 *                      That act has its own event (`patient.details_corrected`,
 *                      written by `PATCH /patients/:id/details`); this one says
 *                      WHY it was made.
 *  - `patient_error` — the detail we hold was right and the patient crossed it
 *                      anyway. It happens: a mis-tap, or an old address read
 *                      and disowned before the person remembers they moved.
 *
 * THE SECOND IS THE REASON THIS ENDPOINT EXISTS. Without it reception's only
 * way out of a dispute is to "correct" a detail that needs no correction —
 * which would put a correction event in the vault saying somebody changed
 * something when nobody did, and leave the cross unexplained either way.
 *
 * THERE IS NO THIRD OPTION AND NO FREE TEXT. "Something else happened" is not
 * a resolution, and a note field on a staff surface is where a patient's
 * details end up written out in prose next to an event that was designed to
 * carry none (REQ-LOG-08).
 */
export const DISPUTE_RESOLUTION_OUTCOMES = ['corrected', 'patient_error'] as const;
export type DisputeResolutionOutcome = (typeof DISPUTE_RESOLUTION_OUTCOMES)[number];

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

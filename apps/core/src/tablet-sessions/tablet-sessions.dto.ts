import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  CONFIRMABLE_DETAIL_TYPES,
  DEVICE_SETTABLE_TABLET_SESSION_STATES,
} from '@aobplatform/domain';

/**
 * `POST /devices/:deviceId/push` — send one locked agreement to one tablet.
 *
 * THE BODY IS ONE ID AND NOTHING ELSE, deliberately. Everything the push needs
 * it reads from its own records: the particulars from the agreement, the
 * person from the patient row, the party from the assignor row, and WHO IS
 * PUSHING from the verified session (never from the body — `SessionActor`'s
 * own reasoning). A client that could assert any of those could assert a
 * contract.
 */
export class PushToDeviceDto {
  @IsUUID()
  agreementId!: string;
}

/**
 * `POST /devices/:deviceId/out-of-use` — reception taking a tablet off the
 * floor, and putting it back (Carl, 4–5 Sep 2026).
 *
 * REQUIRED RATHER THAN OPTIONAL, and for the same reason `showsWaitingList`
 * is: this is a switch with two meanings, and "the caller forgot to send it"
 * must never be indistinguishable from "the caller asked for false". One
 * endpoint rather than two so the reversal cannot drift from the act.
 */
export class DeviceOutOfUseDto {
  @IsBoolean()
  outOfUse!: boolean;
}

/**
 * `POST /kiosk/session/:id/confirm-details` — the patient's answer to every
 * detail on the screen: a tick, or a cross (Carl, 4 Sep 2026).
 *
 * TYPES ONLY, AND THE LIST IS FIXED, ON BOTH ARRAYS. There is no field here
 * that could carry a value, so a device cannot send one back even by accident
 * (REQ-VER-04, hard rule 9) — and in particular a CROSS carries no correction:
 * the tablet has no field to type one into and this DTO has nowhere to put one
 * if it did. The patient says "that is wrong"; the person who says what is
 * right is a staff member at the desk, whose identity is recorded when they
 * do (`PATCH /patients/:id/details`).
 *
 * `mobile` and `email` are in the list and are CONTACT details, never identity
 * identifiers — showing and confirming them is right, counting them toward the
 * three would be the Medicare-number mistake one step sideways (REQ-VER-02).
 *
 * THIS IS NOT A VERIFICATION AND THE ENDPOINT IS NOT NAMED LIKE ONE. A value
 * displayed on a screen and confirmed by whoever is holding it proves nothing
 * about who is holding it; the verification was the staff check across the
 * desk that the push already recorded (REQ-VER-03).
 *
 * `disputed` IS OPTIONAL AND `confirmed` IS NOT, which keeps the all-ticks
 * request exactly the shape it has always been — the ordinary case stays the
 * simple one, and a device built against the earlier contract is not broken by
 * a screen it does not have.
 */
export class ConfirmDetailsDto {
  @IsArray()
  @ArrayMaxSize(CONFIRMABLE_DETAIL_TYPES.length)
  @IsString({ each: true })
  @IsIn(CONFIRMABLE_DETAIL_TYPES as unknown as string[], { each: true })
  confirmed!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONFIRMABLE_DETAIL_TYPES.length)
  @IsString({ each: true })
  @IsIn(CONFIRMABLE_DETAIL_TYPES as unknown as string[], { each: true })
  disputed?: string[];
}

/**
 * `POST /kiosk/session/:id/state` — the tablet says what it is showing.
 *
 * THREE STATES, AND THE OMISSIONS ARE THE DESIGN. A device may say it is
 * showing the agreement, that the person pressed "See reception" and left
 * (`walked_away`), or that its own inactivity clock ended the session with
 * nobody there (`timed_out`, Carl 4 Sep 2026 — same effect as `walked_away`,
 * a different label so reception can tell the two apart). It may not declare
 * itself SIGNED — a signature event says that, and a device that could assert
 * it could assert a contract. It may not RECALL itself either: recall is a
 * console act, for the same reason revoke is (a tablet that can un-pair itself
 * is a tablet a passer-by can un-pair). And it may not declare itself
 * EXPIRED — that is the server's own word for giving up on a screen after
 * thirty minutes of silence, not something a device asserts about itself.
 */
export class SetSessionStateDto {
  @IsIn(DEVICE_SETTABLE_TABLET_SESSION_STATES as unknown as string[])
  state!: string;

  /**
   * WHY A SIGNATURE WAS REFUSED — `signature_failed` only (Carl, 7 Sep 2026).
   *
   * THE SERVER'S OWN CODE, ECHOED BACK. The tablet asked
   * `POST /agreements/:id/sign`, was refused, and repeats the code it was
   * given; it composes nothing and diagnoses nothing.
   *
   * A SHAPE RATHER THAN A LIST, deliberately. `@IsIn(SIGNATURE_REFUSAL_REASONS)`
   * would mean a newer server refusing for a newer reason had its code
   * REJECTED on the way in, and reception would read a session that ended for
   * no stated reason — the opposite of the design principle, which is that an
   * unmapped code is shown as itself so it can be diagnosed (CLAUDE.md §7).
   *
   * THERE IS NOTHING HERE THAT COULD CARRY A VALUE. A snake_case token of at
   * most sixty characters cannot hold a name, a date of birth or an address,
   * which is what makes the no-values claim one about the shape rather than
   * about today's callers (REQ-VER-04, hard rule 9).
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'reason must be a lower_snake_case code, never a sentence and never a patient detail',
  })
  reason?: string;
}

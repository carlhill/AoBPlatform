import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID } from 'class-validator';
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
 * `POST /kiosk/session/:id/confirm-details` — which details the patient ticked
 * as correct.
 *
 * TYPES ONLY, AND THE LIST IS FIXED. There is no field here that could carry a
 * value, so a device cannot send one back even by accident (REQ-VER-04, hard
 * rule 9). `mobile` and `email` are in the list and are CONTACT details, never
 * identity identifiers — showing and confirming them is right, counting them
 * toward the three would be the Medicare-number mistake one step sideways
 * (REQ-VER-02).
 *
 * THIS IS NOT A VERIFICATION AND THE ENDPOINT IS NOT NAMED LIKE ONE. A value
 * displayed on a screen and confirmed by whoever is holding it proves nothing
 * about who is holding it; the verification was the staff check across the
 * desk that the push already recorded (REQ-VER-03).
 */
export class ConfirmDetailsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONFIRMABLE_DETAIL_TYPES.length)
  @IsString({ each: true })
  @IsIn(CONFIRMABLE_DETAIL_TYPES as unknown as string[], { each: true })
  confirmed!: string[];
}

/**
 * `POST /kiosk/session/:id/state` — the tablet says what it is showing.
 *
 * TWO STATES, AND THE OMISSIONS ARE THE DESIGN. A device may say it is showing
 * the agreement, and it may say the person walked away. It may not declare
 * itself SIGNED — a signature event says that, and a device that could assert
 * it could assert a contract. It may not RECALL itself either: recall is a
 * console act, for the same reason revoke is (a tablet that can un-pair itself
 * is a tablet a passer-by can un-pair).
 */
export class SetSessionStateDto {
  @IsIn(DEVICE_SETTABLE_TABLET_SESSION_STATES as unknown as string[])
  state!: string;
}

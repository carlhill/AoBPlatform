/**
 * `POST /agreements/:id/sign` — the wire contract.
 *
 * WHY IT IS HERE AND NOT ONLY IN THE DTO. The kiosk composes this body and
 * `apps/core` validates it, and until now the two agreed only by convention:
 * the tablet captured a vector and a raster (REQ-SIG-01) and sent neither,
 * because nothing in a shared place said what "sending them" would look like.
 * A contract both sides compile against is what stops that drifting again.
 *
 * The stroke types come from `@aobplatform/domain` rather than being restated,
 * so the shape the pad captures, the shape the wire carries and the shape the
 * server validates are one definition. `apps/core`'s `SignDto` is the runtime
 * validator for this contract and is what the generated OpenAPI document at
 * `/openapi.json` describes.
 */
import type { DrawnSignatureCapture } from '@aobplatform/domain';

export type { DrawnSignatureCapture, SignaturePoint, SignatureStroke } from '@aobplatform/domain';

/** REQ-SIG-01 — the five recognised marks. Only `drawn` carries a payload. */
export const SIGNATURE_METHODS = [
  'drawn',
  'tap_to_approve',
  'typed_name',
  'wet_ink_scan',
  'verbal_recorded',
] as const;
export type SignatureMethod = (typeof SIGNATURE_METHODS)[number];

export const SIGNATURE_CHANNELS = ['in_practice', 'sms_link', 'email_link', 'portal', 'paper'] as const;
export type SignatureChannel = (typeof SIGNATURE_CHANNELS)[number];

export interface SignAgreementRequest {
  readonly method: SignatureMethod;
  readonly channel: SignatureChannel;
  readonly captureRequestId?: string;
  readonly deviceFingerprint?: string;
  /**
   * REQUIRED when `method` is `drawn`, REFUSED for every other method — the
   * server enforces both, with a 400 either way. Absent from every existing
   * caller, which is why it is optional in the type: the remote link signs by
   * tap-to-approve (REQ-SIG-01) and sends none.
   */
  readonly signature?: DrawnSignatureCapture;
}

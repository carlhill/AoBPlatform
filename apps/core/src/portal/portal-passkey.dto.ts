import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * WHAT THE PASSKEY ENDPOINTS WILL ACCEPT.
 *
 * `whitelist: true` ON THE GLOBAL PIPE STRIPS EVERYTHING ELSE, which matters
 * more here than almost anywhere: these are the only unauthenticated write
 * endpoints in the portal, and a body that arrived carrying an account id, a
 * patient id or a practice id must never reach a service that could read it.
 * There is no field below for any of them, and there must never be one — WHO is
 * signing in is decided by a signature over a server-issued challenge, never by
 * anything the caller says.
 *
 * `response` IS `IsObject` AND NOTHING FINER, on purpose. It is a WebAuthn
 * credential as the browser produced it, and its shape is the specification's
 * business — re-declaring it here would be a second, staler copy of a schema
 * that `@simplewebauthn/server` already validates properly during verification.
 * What matters is that it is an object and not a string that could be
 * interpolated somewhere.
 */
export class PortalPasskeyRegistrationVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  response!: Record<string, unknown>;

  /**
   * The patient's own words for their own device. OPTIONAL, and never
   * generated for them from a user agent string — a device fingerprint is not
   * made acceptable by being displayed as a convenience. Capped so a label
   * cannot become a place to store something else.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label?: string;
}

export class PortalPasskeyAuthenticationVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  response!: Record<string, unknown>;
}

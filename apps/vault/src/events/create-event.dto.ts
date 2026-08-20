import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VAULT_EVENT_TYPES, type VaultEventType } from '@aobplatform/contracts';

/**
 * Runtime whitelist derived from the shared union — the two are kept in step
 * by a compile-time assertion below plus a contract test. Events with types
 * outside the whitelist are rejected with 400, never coerced (CONVENTIONS.md
 * §7: extend the union, never cast).
 */
export const VAULT_EVENT_TYPE_WHITELIST: readonly string[] = VAULT_EVENT_TYPES;

// Compile-time assertion: the whitelist IS the shared union's value set.
const _assertWhitelistMatchesUnion: readonly VaultEventType[] = VAULT_EVENT_TYPES;
void _assertWhitelistMatchesUnion;

export class ActorDto {
  @IsString()
  @IsNotEmpty()
  principalType!: string;

  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class SubjectDto {
  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class CreateEventDto {
  @IsIn(VAULT_EVENT_TYPE_WHITELIST)
  type!: VaultEventType;

  @ValidateNested()
  @Type(() => ActorDto)
  actor!: ActorDto;

  @ValidateNested()
  @Type(() => SubjectDto)
  subject!: SubjectDto;

  /**
   * Content-free structured detail only (hashes, versions, channels,
   * outcomes). REQ-LOG-08: no plaintext identifiers — enforced in the service
   * layer against the domain forbidden-field guard.
   */
  @IsOptional()
  @IsObject()
  payload?: Record<string, string | number | boolean>;
}

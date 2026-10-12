import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AOBPRINTER_EXCEPTION_STAGES, AOBPRINTER_HEARTBEAT_INTERVAL, AOBPRINTER_HEARTBEAT_LIMITS } from '@aobplatform/contracts';

/*
 * THE AOBPRINTER HEARTBEAT AT THE DOOR (PRINTER-HEARTBEAT.md §3,
 * D-2026-10-10-02). Every field the contract's `AobPrinterHeartbeat` names, and
 * nothing else: the global ValidationPipe runs with `whitelist: true`, so a
 * field this file does not declare is stripped before anything stores it.
 * That is what makes "counts, hashes, ids, codes and versions" structural
 * rather than a promise about today's host (hard rule 9).
 *
 * In a file of its own, not in the controller beside the print-job DTOs: it is
 * the one shape on that controller that is telemetry rather than a print, and
 * at ten classes it would bury the routes.
 */

const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9A-Za-z.+_-]{1,40}$/;
const CODE = /^[a-z0-9_]{1,40}$/;
/** 32-bit, like the column (decision 15). */
const MAX_INT = 2_147_483_647;

class ChainPointDto {
  @IsInt() @Min(0) @Max(MAX_INT) seq!: number;
  /**
   * REQUIRED: a hash, or an explicit null where the host holds no hash at that
   * seq — which at the anchor is itself a finding (rule 5). Omitted is refused:
   * an `undefined` hash would leave the column's old hash behind a new seq.
   */
  @ValidateIf((o: ChainPointDto) => o.hash !== null) @IsString() @Matches(SHA256) hash!: string | null;
}

/**
 * THE HOST'S OWN CHECK. Each field is required when its `ok` value declares it,
 * and checked whenever it is present, whatever `ok` says — so free text in
 * `why`, or a seq that is not an integer, never reaches the service. The
 * service then stores only the fields that `ok` value declares
 * (`storedLocalCheck`), so the stored shape is the contract's union exactly.
 */
class LocalCheckDto {
  @IsBoolean() ok!: boolean;
  @ValidateIf((o: LocalCheckDto) => o.ok === true || o.verifiedThroughSeq !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  verifiedThroughSeq?: number;
  @ValidateIf((o: LocalCheckDto) => o.ok === false || o.brokenAtSeq !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_INT)
  brokenAtSeq?: number;
  @ValidateIf((o: LocalCheckDto) => o.ok === false || o.why !== undefined) @IsIn(['link', 'content']) why?: 'link' | 'content';
}

class PrintStageCountsDto {
  @IsInt() @Min(0) received!: number;
  @IsInt() @Min(0) parse_exception!: number;
  @IsInt() @Min(0) queued!: number;
  @IsInt() @Min(0) sent!: number;
  @IsInt() @Min(0) send_exception!: number;
}

class ReturnStageCountsDto {
  @IsInt() @Min(0) received!: number;
  @IsInt() @Min(0) received_exception!: number;
  @IsInt() @Min(0) filed!: number;
  @IsInt() @Min(0) filing_exception!: number;
  @IsInt() @Min(0) confirmed!: number;
}

class OpenExceptionCountsDto {
  @IsInt() @Min(0) parse!: number;
  @IsInt() @Min(0) send!: number;
  @IsInt() @Min(0) received!: number;
  @IsInt() @Min(0) filing!: number;
}

class StageCountsDto {
  @ValidateNested() @Type(() => PrintStageCountsDto) prints!: PrintStageCountsDto;
  @ValidateNested() @Type(() => ReturnStageCountsDto) returns!: ReturnStageCountsDto;
  @ValidateNested() @Type(() => OpenExceptionCountsDto) openExceptions!: OpenExceptionCountsDto;
  @IsOptional() @IsISO8601() oldestQueuedAt!: string | null;
  @IsOptional() @IsISO8601() oldestFiledUnconfirmedAt!: string | null;
  @IsInt() @Min(0) staleQueued!: number;
  @IsInt() @Min(0) gapsLast24h!: number;
}

/** Ids and codes only. Never a form reference, chart number, path or note. */
class OpenExceptionDto {
  @IsIn(['out', 'in']) direction!: 'out' | 'in';
  @IsIn(AOBPRINTER_EXCEPTION_STAGES as unknown as string[]) stage!: (typeof AOBPRINTER_EXCEPTION_STAGES)[number];
  @IsString() @Matches(CODE) reason!: string;
  @IsISO8601() since!: string;
  @IsOptional() @IsString() @Matches(SHA256) sourceSha256?: string;
  @IsOptional() @IsUUID() agreementId?: string;
}

class FiledReturnDto {
  @IsUUID() agreementId!: string;
  @IsString() @Matches(SHA256) sha256!: string;
}

export class AobPrinterHeartbeatDto {
  @IsString() @Matches(SHA256) chainId!: string;
  @ValidateNested() @Type(() => ChainPointDto) head!: ChainPointDto;
  @IsOptional() @ValidateNested() @Type(() => ChainPointDto) atAnchor?: ChainPointDto;
  @ValidateNested() @Type(() => LocalCheckDto) localCheck!: LocalCheckDto;
  @ValidateNested() @Type(() => StageCountsDto) counts!: StageCountsDto;

  @IsArray()
  @ArrayMaxSize(AOBPRINTER_HEARTBEAT_LIMITS.openExceptions)
  @ValidateNested({ each: true })
  @Type(() => OpenExceptionDto)
  openExceptions!: OpenExceptionDto[];

  @IsString() @Matches(VERSION) printerVersion!: string;
  @IsString() @Matches(VERSION) templateVersion!: string;
  @IsInt() @Min(0) @Max(MAX_INT) schemaVersion!: number;
  @IsString() @Matches(VERSION) runtimeVersion!: string;
  @IsISO8601() startedAt!: string;
  @IsISO8601() sentAt!: string;
  @IsInt() @Min(AOBPRINTER_HEARTBEAT_INTERVAL.minMs) @Max(AOBPRINTER_HEARTBEAT_INTERVAL.maxMs) intervalMs!: number;
  @IsInt() @Min(0) @Max(MAX_INT) queueCount!: number;
  @IsBoolean() collecting!: boolean;
  @IsBoolean() retentionEnabled!: boolean;

  @IsArray()
  @ArrayMaxSize(AOBPRINTER_HEARTBEAT_LIMITS.awaitingOutcome)
  @IsString({ each: true })
  @Matches(SHA256, { each: true })
  awaitingOutcome!: string[];

  @IsArray()
  @ArrayMaxSize(AOBPRINTER_HEARTBEAT_LIMITS.filedUnconfirmed)
  @ValidateNested({ each: true })
  @Type(() => FiledReturnDto)
  filedUnconfirmed!: FiledReturnDto[];
}

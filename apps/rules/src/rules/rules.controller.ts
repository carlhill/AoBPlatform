import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type { ValidationResponse } from '@aobplatform/contracts';
import { RulesService } from './rules.service';
import type { ValidationPayload } from './rules-payload';

export class ValidateRequestDto {
  @IsObject()
  payload!: ValidationPayload;

  @IsOptional()
  @IsString()
  ruleSetVersion?: string;

  @IsOptional()
  @IsIn(['pre_signature', 'storage'])
  stage?: 'pre_signature' | 'storage';
}

/**
 * FR-4.1 — validate(payload, ruleSetVersion?) → per-rule pass/fail/warn with
 * citations. Invoked pre-signature (blocking), at storage (assert), and by
 * the public tester. This service holds zero PII (ADR A-07): nothing from the
 * payload is persisted or logged.
 */
@Controller()
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Post('validate')
  @HttpCode(200)
  validate(@Body() dto: ValidateRequestDto): ValidationResponse {
    return this.rules.validate(dto.payload, dto.ruleSetVersion, dto.stage ?? 'storage');
  }

  @Get('rule-sets')
  ruleSets(): { versions: string[] } {
    return this.rules.versions();
  }
}

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { VaultEventRecord } from '@aobplatform/contracts';
import { assertNoForbiddenAgreementFields, HardRuleViolation, type IsoTimestamp } from '@aobplatform/domain';
import { CHAIN_STORE, type ChainStore } from '../chain/chain-store';
import { verifyChainSegment, type ChainVerificationResult } from '../chain/verify';
import type { CreateEventDto } from './create-event.dto';

@Injectable()
export class EventsService {
  constructor(@Inject(CHAIN_STORE) private readonly store: ChainStore) {}

  async append(dto: CreateEventDto): Promise<VaultEventRecord> {
    // REQ-LOG-08 / HARD-03/04 defence in depth: a payload carrying a forbidden
    // field (Medicare number, identifier values disguised as benefit fields,
    // practitioner signatures) is rejected, never stored. An immutable log
    // full of personal information would be a liability with excellent
    // integrity.
    try {
      assertNoForbiddenAgreementFields(dto.payload ?? {});
    } catch (err) {
      if (err instanceof HardRuleViolation) throw new BadRequestException(err.message);
      throw err;
    }
    for (const value of Object.values(dto.payload ?? {})) {
      if (value !== null && typeof value === 'object') {
        throw new BadRequestException('Vault event payloads are flat: string | number | boolean values only.');
      }
    }
    return this.store.append({
      type: dto.type,
      actor: { principalType: dto.actor.principalType, id: dto.actor.id },
      subject: { type: dto.subject.type, id: dto.subject.id },
      payload: dto.payload,
    });
  }

  list(query: { subjectId?: string; from?: string; to?: string }): Promise<readonly VaultEventRecord[]> {
    return this.store.list({
      subjectId: query.subjectId,
      from: query.from as IsoTimestamp | undefined,
      to: query.to as IsoTimestamp | undefined,
    });
  }

  async verifyArtefactHash(sha256: string): Promise<{ exists: boolean; recordedAt?: string }> {
    const record = await this.store.findByArtefactHash(sha256);
    // Existence, timestamp and chain position only — never content (REQ-VAULT-09).
    return record ? { exists: true, recordedAt: record.recordedAt } : { exists: false };
  }

  /** Full-chain verification — the continuous verifier job calls this (an alarm, not a report). */
  async verifyChain(): Promise<ChainVerificationResult & { length: number }> {
    const all = await this.store.all();
    return { ...verifyChainSegment(all), length: all.length };
  }
}

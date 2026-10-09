/**
 * THE AOBPRINTER HEARTBEAT CONTRACT (PRINTER-HEARTBEAT.md §1, D-2026-10-10-02).
 *
 * Two programs on two machines have to agree on these words, and the host's
 * SQLite CHECKs copy the stage lists. A rename on one side fails silently on
 * the other, so the spelling is asserted here rather than trusted.
 */
import { describe, expect, it } from 'vitest';
import {
  AOBPRINTER_EXCEPTION_STAGES,
  AOBPRINTER_HEARTBEAT_INTERVAL,
  AOBPRINTER_HEARTBEAT_LIMITS,
  AOBPRINTER_PRINT_STAGES,
  AOBPRINTER_RETURN_STAGES,
} from './aobprinter-heartbeat';
import { VAULT_EVENT_TYPES } from './vault';

describe('the AOBPRINTER heartbeat contract', () => {
  it('spells the print and return stages the way the host stores them', () => {
    expect(AOBPRINTER_PRINT_STAGES).toEqual(['received', 'parse_exception', 'queued', 'sent', 'send_exception']);
    expect(AOBPRINTER_RETURN_STAGES).toEqual([
      'received',
      'received_exception',
      'filed',
      'filing_exception',
      'confirmed',
    ]);
  });

  it('names an exception stage only where a stage list has one', () => {
    const stages = new Set<string>([...AOBPRINTER_PRINT_STAGES, ...AOBPRINTER_RETURN_STAGES]);
    for (const stage of AOBPRINTER_EXCEPTION_STAGES) {
      expect(stage.endsWith('_exception')).toBe(true);
      expect(stages.has(stage)).toBe(true);
    }
  });

  it('carries the agreed interval and payload bounds', () => {
    // Decision 1: every 60 s, 15 s to 10 min, first beat 5 s after start.
    expect(AOBPRINTER_HEARTBEAT_INTERVAL).toEqual({
      defaultMs: 60_000,
      minMs: 15_000,
      maxMs: 600_000,
      firstDelayMs: 5_000,
    });
    // Decision 9 and section 1: 14 days, 100 per beat; 25 open exceptions.
    expect(AOBPRINTER_HEARTBEAT_LIMITS).toEqual({
      openExceptions: 25,
      awaitingOutcome: 100,
      filedUnconfirmed: 100,
      sentWindowDays: 14,
    });
  });

  it('declares the three chain events inside the vault event list', () => {
    // Outside the list the vault refuses them (wow.md §2 item 8).
    const types: readonly string[] = VAULT_EVENT_TYPES;
    for (const type of ['aobprinter.chain_anchored', 'aobprinter.chain_regressed', 'aobprinter.chain_rebaselined']) {
      expect(types).toContain(type);
    }
  });
});

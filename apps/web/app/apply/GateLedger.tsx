'use client';

/**
 * The gate ledger.
 *
 * THREE ROWS, ALWAYS ALL THREE, each with its own mark. Never one aggregate
 * tick — "your application failed" tells an applicant nothing, and the three
 * gates fail for entirely different reasons with entirely different remedies:
 *
 *   1. The ABN checksum is arithmetic. A failure is a typo, fixable in seconds.
 *   2. The ABR is a register. A failure means the entity is cancelled or named
 *      differently — nothing the applicant can retype their way out of.
 *   3. A named human is a judgement. It cannot be hurried and is not automatic.
 *
 * Showing all three at all times also does something subtler: it tells an
 * applicant that passing the first two is not approval, before they assume it
 * is.
 */

import { Chip, ui, type Tone } from '../ui';
import { strings } from '../strings';

/**
 * ATTESTED is deliberately its own state, not a flavour of `passed`.
 *
 * When the ABR cannot be reached, an applicant reads the register themselves
 * and types what it shows. Every rule still runs against those values — the ABN
 * must be ACTIVE and the name must match — so the CHECK genuinely passed. What
 * changed is who looked, and that is a difference in evidence quality that the
 * reviewer downstream has to be able to see. Painting it as PASSED would hide
 * the one fact most worth knowing: this line was typed by the applicant.
 */
export type GateState = 'not_run' | 'passed' | 'failed' | 'waiting' | 'attested';

export interface GateLedgerState {
  readonly checksum: GateState;
  readonly register: GateState;
  readonly human: GateState;
  readonly checksumDetail?: string;
  readonly registerDetail?: string;
  readonly humanDetail?: string;
}

const toneFor: Record<GateState, Tone> = {
  passed: 'ok',
  failed: 'stop',
  waiting: 'warn',
  // Warn, not ok. The check passed; the SOURCE is weaker, and the colour says so.
  attested: 'warn',
  not_run: 'neutral',
};

function markFor(state: GateState): string {
  return strings.gates.marks[state];
}

export function GateLedger({ state }: { state: GateLedgerState }) {
  const rows: Array<{ what: string; state: GateState; detail?: string; fallback: string }> = [
    {
      what: strings.gates.checksum,
      state: state.checksum,
      detail: state.checksumDetail,
      fallback: strings.gates.checksumIdle,
    },
    {
      what: strings.gates.register,
      state: state.register,
      detail: state.registerDetail,
      fallback: strings.gates.registerIdle,
    },
    {
      what: strings.gates.human,
      state: state.human,
      detail: state.humanDetail,
      fallback: strings.gates.humanIdle,
    },
  ];

  return (
    <div className={ui.ledger} aria-label={strings.gates.heading}>
      <div className={ui.ledgerHead}>{strings.gates.heading}</div>
      {rows.map((row) => (
        <div className={ui.ledgerRow} key={row.what}>
          <div>
            {/* The mark is a WORD, so the row reads without colour. */}
            <Chip tone={toneFor[row.state]}>{markFor(row.state)}</Chip>
          </div>
          <div>
            <div className={ui.ledgerWhat}>{row.what}</div>
            <p className={ui.ledgerDetail}>{row.detail ?? row.fallback}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

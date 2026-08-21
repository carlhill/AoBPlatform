'use client';

/**
 * Rendering for the review flags.
 *
 * The domain decides WHICH flags fire and how bad each is; this decides what
 * they look like. Keeping the split means a change to the policy is a change to
 * a tested function, not to a component.
 *
 * Every flag carries an icon AND a word. The icon is the thing the eye catches
 * when skimming twenty rows; the word is the thing that still works for the
 * roughly one man in twelve who cannot rely on the colour, and for anyone using
 * a screen reader. Neither is sufficient alone, which is why both are here.
 */

import { AlertTriangle, Info, Phone, ShieldAlert, User } from 'lucide-react';
import type { FlagSeverity, ReviewFlag } from '@aobplatform/domain';
import { Chip, type Tone } from '../ui';
import { strings } from '../strings';

const severityTone: Record<FlagSeverity, Tone> = {
  high: 'stop',
  medium: 'warn',
  low: 'neutral',
};

const ICONS: Record<string, typeof Info> = {
  attested: ShieldAlert,
  contacts_clash: Phone,
  no_manager: User,
  sole_trader: Info,
  weak_proof: AlertTriangle,
};

/** The word on the chip. A flag with no label would be a colour, which is not a status. */
export function flagLabel(flag: ReviewFlag): string {
  switch (flag.key) {
    case 'attested':
      return strings.review.flagAttested;
    case 'contacts_clash':
      // "Both contacts share a phone" / "… an email" — the channel matters,
      // because it changes what the reviewer should do about it.
      return `${strings.review.flagContactsClash} ${flag.detail === 'email' ? 'inbox' : 'phone'}`;
    case 'no_manager':
      return strings.review.flagNoManager;
    case 'sole_trader':
      return strings.review.flagSoleTrader;
    case 'weak_proof':
      return strings.review.flagWeakProof;
    default:
      return flag.key;
  }
}

export function flagWhy(flag: ReviewFlag): string | null {
  switch (flag.key) {
    case 'attested':
      return strings.review.flagAttestedWhy;
    case 'contacts_clash':
      return strings.review.flagContactsClashWhy;
    case 'no_manager':
      return strings.review.flagNoManagerWhy;
    case 'weak_proof':
      return strings.review.flagWeakProofWhy;
    default:
      // A sole-trader note needs no justification — it is a fact about the
      // entity, not a concern about the application.
      return null;
  }
}

export function FlagChip({ flag }: { flag: ReviewFlag }) {
  const Icon = ICONS[flag.key] ?? Info;
  return (
    <Chip tone={severityTone[flag.severity]}>
      <Icon size={13} aria-hidden="true" strokeWidth={2.25} />
      {flagLabel(flag)}
    </Chip>
  );
}

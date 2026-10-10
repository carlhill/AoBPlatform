import { describe, expect, it } from 'vitest';
import { VAULT_EVENT_TYPES } from './vault';

/**
 * THE UNSIGNED-DRAFT EVENTS ARE INSIDE THE VAULT'S LIST (D-2026-10-10-09).
 * The vault's whitelist is this list; a type outside it is refused with a
 * 400 and the outbox row would retry for ever (wow.md §2 item 8).
 */
describe('unsigned-draft vault events', () => {
  it('declares the association event inside the vault event list', () => {
    const types: readonly string[] = VAULT_EVENT_TYPES;
    expect(types).toContain('agreement.service_associated');
  });
});

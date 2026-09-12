/**
 * THE NUMBER ON THE CARD IN THE PATIENT'S HAND (`QUEUE-TICKETS.md`).
 *
 * The two rules worth pinning here are the ones a later reader is most likely
 * to "tidy": a ticket is a STRING and not an integer, and allocation counts
 * only what this platform itself has issued.
 */
import {
  nextAllocatedTicket,
  normaliseQueueTicket,
  QUEUE_TICKET_MAX_LENGTH,
  QUEUE_TICKET_SOURCES,
} from './queue-ticket';

describe('queue tickets', () => {
  it('a_queue_ticket_is_a_short_string_and_never_a_number', () => {
    /*
     * §3: *"a short string, not an integer — practices use `A12` and `012` as
     * well as `12`"*. `012` is not `12` to the person holding the card, and a
     * parse would make them the same.
     */
    expect(normaliseQueueTicket('012')).toBe('012');
    expect(normaliseQueueTicket('  a12 ')).toBe('A12');
    expect(normaliseQueueTicket('')).toBeNull();
    expect(normaliseQueueTicket('   ')).toBeNull();
    expect(normaliseQueueTicket(undefined)).toBeNull();
    expect(normaliseQueueTicket(null)).toBeNull();
    expect(normaliseQueueTicket('ABCDEFGHIJ')).toHaveLength(QUEUE_TICKET_MAX_LENGTH);
  });

  it('the_three_sources_are_in_precedence_order', () => {
    /*
     * D-2026-09-12-18: their card, then their software, then one we allocate.
     * THE ORDER OF THE ARRAY IS THE RULE, so a reader cannot learn the rule
     * from the document and the order from somewhere else — and the database
     * CHECK `arrivals_ticket_source_check` mirrors exactly these three.
     */
    expect(QUEUE_TICKET_SOURCES).toEqual(['practice_card', 'practice_software', 'allocated']);
  });

  it('an_allocated_ticket_counts_only_what_we_allocated', () => {
    /*
     * A number off the practice's own card box says nothing about where OUR
     * sequence has got to. The caller passes only the allocated ones, and this
     * proves the arithmetic they get: the highest so far, plus one, as digits.
     */
    expect(nextAllocatedTicket([])).toBe('1');
    expect(nextAllocatedTicket(['1', '2', '3'])).toBe('4');
    // Out of order, and with a gap, because arrivals are not deleted in order.
    expect(nextAllocatedTicket(['3', '1'])).toBe('4');
    // Anything unparseable is simply not a number we issued; it cannot lower
    // the next one, and it must not make this throw in front of a patient.
    expect(nextAllocatedTicket(['A12', '7'])).toBe('8');
    expect(nextAllocatedTicket(['A12'])).toBe('1');
  });
});

/**
 * How the portal writes a date and — in exactly one card — an amount.
 *
 * en-AU EVERYWHERE, because "03/09/2026" means two different days on two sides
 * of the world and this page is read by the person the record is about. Dates
 * that are calendar dates (`2026-08-19`) are pinned to UTC so the browser's own
 * timezone cannot walk them back a day; instants (`…T02:41:00Z`) are shown in
 * the reader's local time, which is what "when did that happen to me" means.
 */

/** A calendar date — `YYYY-MM-DD`. Never shifted by the reader's timezone. */
export function calendarDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** An instant — when something happened, in the reader's own time. */
export function instant(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

/**
 * THE ONLY MONEY FORMATTER IN THE PRODUCT, and it is used by one card.
 *
 * A benefit amount belongs on a reg 89AA notice and nowhere else (hard rule 4,
 * REQ-REG-04). It lives here rather than in a shared module so that anybody
 * reaching for it has to import it from the portal's 89AA card's neighbourhood
 * and read this comment on the way.
 */
export function aud(cents: number): string {
  const value = Number.isFinite(cents) ? cents / 100 : 0;
  return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

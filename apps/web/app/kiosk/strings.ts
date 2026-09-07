/**
 * The kiosk's view of the one string table (REQ-LANG-01).
 *
 * There is no second table here. `apps/web/app/strings.ts` holds every word,
 * and this module names the `kiosk` branch of it so a screen can write
 * `strings.verify.heading` rather than `strings.kiosk.verify.heading` twelve
 * times a file. The indirection is a rename, not a copy: change the table and
 * this changes with it, and nothing can be added here that is not in the table.
 *
 * It also gives the copy tests one thing to walk. `no_dollar_amount_on_any_
 * agreement_artefact` and `never_claims_certification_or_approval` assert over
 * THIS subtree rather than the whole platform table, because the console
 * legitimately says "Approved by" about a practice application and the kiosk
 * may never say it about our forms (hard rule 12).
 */
import { strings as platformStrings } from '../strings';

export const strings = platformStrings.kiosk;

export type KioskStrings = typeof strings;

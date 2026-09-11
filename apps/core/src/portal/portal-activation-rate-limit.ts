import { PortalPasskeyAttemptLimit } from './portal-passkey-rate-limit';

/**
 * THE ACTIVATION LINK'S OWN WINDOW — the same mechanism as passkey sign-in,
 * deliberately, and a separate budget.
 *
 * WHY IT IS A SUBCLASS AND NOT A SECOND ALGORITHM. Everything in the note on
 * `PortalPasskeyAttemptLimit` applies here unchanged: keyed by address because
 * an unauthenticated caller has offered nothing else, in memory per process and
 * said out loud rather than pretended otherwise, capped so the limiter cannot
 * itself be turned into the memory leak. A third copy of that reasoning would
 * be a third place to get it wrong.
 *
 * WHY THE BUDGET IS SEPARATE. A patient reloading an invitation link and a
 * patient fumbling a passkey prompt are different people having different bad
 * days; a rush of challenge reads must not spend the sign-in allowance of
 * whoever shares that address, and neither must lock the other out.
 *
 * IT IS NOT THE DEFENCE AGAINST GUESSING, AND THAT MATTERS HERE MORE THAN IT
 * DOES FOR PASSKEYS. What stops somebody grinding identifiers against a stolen
 * link is `PORTAL_ACTIVATION_MAX_ATTEMPTS`: three wrong answers and the
 * INVITATION is finished, permanently, whatever address the fourth attempt
 * comes from. This limiter only stops a script enumerating tokens cheaply.
 *
 * IT NEVER BLOCKS CARE (hard rule 8) AND NEVER BLOCKS SIGNING (REQ-PORT-08).
 * The worst it can do is make somebody wait to look at their own record.
 */
export class PortalActivationAttemptLimit extends PortalPasskeyAttemptLimit {}

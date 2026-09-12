import { randomBytes } from 'node:crypto';
import {
  assertPracticeCode,
  extendPracticeCode,
  generatePracticeCode,
  isGeneratedPracticeCode,
  proposePracticeCode,
} from '@aobplatform/domain';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * ALLOCATE THE PRACTICE'S CODE -- once, then never again
 * (PRACTICE-SCOPED-LOGIN.md section 5; D-2026-09-12-10).
 *
 * A plain function rather than a service, deliberately. Three places create or
 * complete a practice -- `PracticesService.create`, `OrganisationsService.register`
 * (through the `register_organisation` SECURITY DEFINER function) and the dev
 * seed -- and they sit in modules that already import each other in one
 * direction. Wiring a fourth provider through that graph would buy nothing: an
 * allocation is a read, a loop and a write, and what makes it correct is the
 * UNIQUE index, not where it is injected from.
 *
 * IT IS IDEMPOTENT AND IT NEVER MOVES A CODE. Called on a practice that already
 * has one it returns that one and writes nothing. This is the enforcement of
 * "a practice renaming does not move its code" (section 3b): renaming does not
 * call this, and if it did, this would refuse to change the answer.
 *
 * THE DATABASE DECIDES UNIQUENESS. The candidate loop is an optimisation that
 * usually gets it right first time; the UNIQUE index is what makes it true.
 * Two practices registering at the same instant both propose `xlevelup`, both
 * see it free, and one of the writes loses -- so a lost write is caught and the
 * next candidate tried, rather than being reported as an error nobody can act
 * on.
 */

/** Prisma's unique-constraint failure. Narrow, so a real error still surfaces. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/**
 * Enough attempts to walk past a genuinely popular name and any concurrent
 * loser, and few enough that a bug becomes an error rather than a spin. The
 * dev database's worst case today is fourteen "Testville Family Medical" rows.
 */
const MAX_ALLOCATION_ATTEMPTS = 64;

export interface AllocatedPracticeCode {
  code: string;
  /** True when the name yielded no usable slug and one was generated (section 3b rule 4). */
  generated: boolean;
  /** False when the practice already had a code, so nothing was written. */
  allocated: boolean;
}

export async function allocatePracticeCode(
  prisma: PrismaService,
  practiceId: string,
): Promise<AllocatedPracticeCode> {
  const practice = await prisma.withPractice(practiceId, (tx) =>
    tx.practice.findFirst({
      where: { id: practiceId },
      select: { id: true, name: true, tradingNames: true, code: true, codeGenerated: true },
    }),
  );
  if (!practice) {
    throw new Error(`Cannot allocate a code: practice ${practiceId} does not exist.`);
  }

  // ALREADY ALLOCATED. Return it and write nothing -- the code is fixed for the
  // life of the practice because a username is fixed for the life of a passkey.
  if (practice.code) {
    return { code: practice.code, generated: practice.codeGenerated, allocated: false };
  }

  // Proposed from the trading name, else the practice name, NEVER the legal
  // name -- the parameter type is what stops one being passed.
  const slug = proposePracticeCode({ name: practice.name, tradingNames: practice.tradingNames });

  for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    // A generated code is re-rolled on each pass rather than suffixed: it is
    // already 48 bits of randomness, so a fresh one is a better answer to a
    // collision than `pa1b2c3d4e5f62`.
    const candidate = slug
      ? extendPracticeCode(slug, attempt)
      : generatePracticeCode((bytes) => randomBytes(bytes).toString('hex'));
    assertPracticeCode(candidate);

    try {
      await prisma.withPractice(practiceId, (tx) =>
        tx.practice.update({
          where: { id: practiceId },
          data: { code: candidate, codeGenerated: isGeneratedPracticeCode(candidate) },
        }),
      );
      return { code: candidate, generated: isGeneratedPracticeCode(candidate), allocated: true };
    } catch (err) {
      // Somebody else holds this one. That is the UNIQUE index doing its job,
      // not a failure -- try the next candidate. Anything else is a real error
      // and must not be swallowed into a retry loop.
      if (!isUniqueViolation(err)) throw err;
    }
  }

  throw new Error(
    `Could not allocate a practice code for ${practiceId} in ${MAX_ALLOCATION_ATTEMPTS} attempts. Either a ` +
      'name is shared by that many practices, or the unique index is rejecting for a reason other than a ' +
      'collision.',
  );
}

/**
 * The code, allocating one if this practice predates the scheme or was created
 * by a path that has not been taught to allocate yet.
 *
 * Every account-naming call site goes through this rather than reading the
 * column, so a missing code is a thing the platform fixes rather than a thing
 * that stops somebody being invited. It never moves an existing one.
 */
export async function practiceCode(prisma: PrismaService, practiceId: string): Promise<string> {
  return (await allocatePracticeCode(prisma, practiceId)).code;
}

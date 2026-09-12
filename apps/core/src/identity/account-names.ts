import type { KeycloakAdminClient } from '@aobplatform/auth-client';
import { adminUsername, personUsername } from '@aobplatform/domain';
import type { PrismaService } from '../prisma/prisma.service';
import { practiceCode } from '../practices/practice-code';

/**
 * THE ONE PLACE A PRACTICE-SCOPED USERNAME IS DECIDED.
 *
 * Four services create Keycloak accounts, and before this file three of them
 * built a name of their own -- a person-name slug plus eight hex characters, a
 * bare email, and `admin.<practiceId>` with two legacy fallbacks. Three
 * builders is three chances to drift, and a drifted username is not a cosmetic
 * problem: `createPasskeyOnlyUser` RETURNS the account when the name matches,
 * so a name built two ways either creates a duplicate or silently hands
 * somebody else's account over.
 *
 * The shapes themselves are in `@aobplatform/domain` (`account-naming.ts`),
 * with no I/O. What lives here is the part that needs the database and the
 * realm: which code this practice holds, and whether an account already
 * exists.
 *
 * GRANDFATHERING IS THE POINT OF THIS FILE (PRACTICE-SCOPED-LOGIN.md §3
 * property 2 and §8; Carl, 12 Sep 2026). Accounts issued before the scheme --
 * `admin.821709fb`, `drjhuang@gmail.com`, `jo.example@example.invalid` -- keep
 * their usernames FOR EVER. A passkey is bound to a username, so renaming one
 * orphans the credential and locks a real person out of a practice they are
 * standing in. So every resolver here asks "is there an account already?"
 * BEFORE it asks "what would this be called today", and the new shapes only
 * ever name an account being created for the first time.
 */

/** What the caller needs to know, and why it is what it is. */
export interface ResolvedUsername {
  username: string;
  /**
   * True when the name came from an account that already exists rather than
   * from the current scheme. Logged, never acted on differently -- the point
   * is that a grandfathered name is used exactly like a new one.
   */
  grandfathered: boolean;
}

/**
 * The username of an account we already recorded the id of.
 *
 * Returns null when there is no id, or when the id points at nothing (the
 * account was deleted in the realm and our column is stale) -- in which case
 * the caller falls through to the current scheme, which is correct: there is
 * no credential left to orphan.
 */
export async function existingUsername(
  keycloak: KeycloakAdminClient,
  keycloakUserId: string | null | undefined,
): Promise<string | null> {
  if (!keycloakUserId) return null;
  const existing = await keycloak.findById(keycloakUserId);
  return existing?.username ?? null;
}

/**
 * A PERSON, AT ONE PRACTICE -- `audrey@hillsempire.com.xlevelup`.
 *
 * `keycloakUserId` is whatever the domain row already holds. When it names a
 * live account that account's own name is returned unchanged, whatever shape
 * it is in.
 */
export async function usernameForPersonAtPractice(
  deps: { prisma: PrismaService; keycloak: KeycloakAdminClient },
  input: { practiceId: string; email: string; keycloakUserId?: string | null },
): Promise<ResolvedUsername> {
  const kept = await existingUsername(deps.keycloak, input.keycloakUserId);
  if (kept) return { username: kept, grandfathered: true };

  const code = await practiceCode(deps.prisma, input.practiceId);
  return { username: personUsername(input.email, code), grandfathered: false };
}

/**
 * THE PRACTICE'S OWN ACCOUNT -- `admin.xlevelup`. Not a person's, which is why
 * there is no email in it (ROLES.md rule 3, PRACTICE-SCOPED-LOGIN.md §3a).
 *
 * Three grandfathering paths, in order, because this account has worn three
 * names:
 *
 *   1. The id on the practice row. Authoritative -- it is the account we
 *      actually created and the one holding the passkeys.
 *   2. `admin.<full practice id>`, the scheme immediately before this one.
 *   3. `admin.<first 8 hex of the practice id>`, the oldest, and the one that
 *      motivated the whole change: eight hex characters is 32 bits and the
 *      account it finds may belong to a DIFFERENT practice. So it is claimed
 *      only when its `practice_id` attribute says it is ours -- the check the
 *      short form never had.
 */
export async function usernameForPracticeAdmin(
  deps: { prisma: PrismaService; keycloak: KeycloakAdminClient },
  input: { practiceId: string; adminKeycloakUserId?: string | null },
): Promise<ResolvedUsername> {
  const kept = await existingUsername(deps.keycloak, input.adminKeycloakUserId);
  if (kept) return { username: kept, grandfathered: true };

  const previous = `admin.${input.practiceId}`;
  if (await deps.keycloak.findByUsername(previous)) {
    return { username: previous, grandfathered: true };
  }

  const oldest = `admin.${input.practiceId.slice(0, 8)}`;
  const shortNamed = await deps.keycloak.findByUsername(oldest);
  if (shortNamed && shortNamed.attributes?.practice_id?.[0] === input.practiceId) {
    return { username: oldest, grandfathered: true };
  }

  const code = await practiceCode(deps.prisma, input.practiceId);
  return { username: adminUsername(code), grandfathered: false };
}

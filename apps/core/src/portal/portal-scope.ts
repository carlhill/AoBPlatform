import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE SECOND KEY, for rows that belong to a PERSON rather than to a practice.
 *
 * `PrismaService.withPractice` fences on `app.practice_id` and
 * `withPractitioner` on `app.practitioner_id` — two keys already, for the same
 * reason: a practitioner is not inside one practice, so a policy written on the
 * practice key would fail closed against the very person the rows are about. A
 * portal account is the third case of that shape. It spans every practice the
 * patient linked, and it belongs to none of them.
 *
 * SAME `is_local = true`, SAME REASON. The setting dies with the transaction;
 * there is no way to leave a pooled connection carrying somebody's account
 * scope into the next request. Policies are OR'd against the practice key, so
 * a practice still sees its own links and an account still sees only its own —
 * neither widens the other.
 *
 * `withPortalSession` EXISTS FOR EXACTLY ONE QUERY: resolving the cookie, when
 * the account is not yet known. It names one session row by primary key. A
 * request with no cookie sets nothing and therefore sees nothing.
 *
 * IT LIVES IN THIS MODULE RATHER THAN ON `PrismaService`, because the portal is
 * the only thing that has ever needed it and a shared service that grows a
 * method per feature stops being a fence and becomes a junk drawer. If a second
 * module ever needs the account key, that is the moment to move it.
 */
@Injectable()
export class PortalScope {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the signed-in patient does, fenced on their own account id. */
  withAccount<T>(accountId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.portal_account_id', ${accountId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Both keys at once: activation writes a link row that belongs to an account
   * AND reads the agreement, patient and practice rows behind it. One
   * transaction, because the link, the session and their vault events commit
   * together or not at all (hard rule 11) — an account linked to a patient with
   * no record of the check that linked it is the shape this product exists to
   * prevent.
   */
  withAccountAtPractice<T>(
    accountId: string,
    practiceId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.portal_account_id', ${accountId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.practice_id', ${practiceId}, true)`;
      return fn(tx);
    });
  }

  /** Cookie resolution only. One row, by primary key. */
  withSession<T>(sessionId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.portal_session_id', ${sessionId}, true)`;
      return fn(tx);
    });
  }

  /**
   * ONE PASSKEY CHALLENGE, BY PRIMARY KEY — the `withSession` shape again, and
   * for the same reason (FR-8.2 passkeys, D-2026-09-04-02).
   *
   * A SIGN-IN CHALLENGE BELONGS TO NOBODY YET. It is minted before the person
   * has identified themselves — that is what "sign in without a username" means
   * — so there is no account key to fence it with. The verify call names the row
   * it is finishing and this scopes to exactly that row.
   *
   * IT IS ALSO WHAT LETS THE ROW BE INSERTED. The policy's `WITH CHECK` is the
   * same clause as its `USING`, so the service generates the id, sets it here,
   * and writes. A challenge is a nonce, two timestamps and a purpose; there is
   * nothing in the row to disclose.
   */
  withChallenge<T>(challengeId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.portal_challenge_id', ${challengeId}, true)`;
      return fn(tx);
    });
  }

  /**
   * ONE CREDENTIAL, BY THE CREDENTIAL ID THE AUTHENTICATOR SENT.
   *
   * THE FIRST THING A DISCOVERABLE SIGN-IN NEEDS is to turn a credential id
   * into an account, and at that moment there is no account scope to be inside.
   * So this names one row by its unique key, exactly as `withSession` names one
   * session by its.
   *
   * WHAT IT DISCLOSES, SAID PLAINLY: a caller holding a credential id can read
   * that credential's PUBLIC key, its counter and its account id. None of those
   * is a patient identifier, none is a name, and none of them lets anybody in —
   * the assertion still has to verify against that public key and the counter
   * check still has to pass. RLS is the floor under the application's scoping
   * here, not the thing doing the authenticating.
   */
  withCredential<T>(credentialId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.portal_credential_id', ${credentialId}, true)`;
      return fn(tx);
    });
  }
}

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Every practice-scoped read or write goes through withPractice() — RLS
 * policies (FORCE, fail closed) filter on the transaction-local
 * app.practice_id setting, so a query outside withPractice() sees no
 * practice-scoped rows at all. This is the DB layer of the scoping story;
 * the application layer must still pass the right practice id from the
 * authenticated principal.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  withPractice<T>(practiceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      // is_local=true — the setting dies with the transaction; there is no
      // way to leave a connection polluted with another practice's scope.
      await tx.$executeRaw`SELECT set_config('app.practice_id', ${practiceId}, true)`;
      return fn(tx);
    });
  }

  /**
   * The same fence, keyed on a PERSON rather than a practice.
   *
   * A practitioner is not inside one practice — that is the whole point of the
   * identity being person-level — so `app.practice_id` can never match their
   * rows, and a policy written on it would fail closed against the very person
   * the row is about. `app.practitioner_id` is the second key the reporting
   * views and `pending_email_changes` are both written against; policies are
   * OR'd, so the two coexist without either widening the other.
   *
   * Same is_local=true, same reason: the scope dies with the transaction.
   */
  withPractitioner<T>(practitionerId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.practitioner_id', ${practitionerId}, true)`;
      return fn(tx);
    });
  }
}

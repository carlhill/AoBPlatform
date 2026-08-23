import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PractitionerEmailService, type ResolvedChange } from '../src/identity/practitioner-email.service';
import { PendingEmailService } from '../src/organisations/pending-email.service';
import { MESSAGING_GATEWAY, type MessagingGateway } from '../src/messaging/gateway';

/**
 * Changing a PRACTITIONER's own email address, held until it is proved.
 *
 * WHAT THIS PINS. Until now this saved directly. A practice administrator's
 * address was held pending proof and announced to the address it replaced; a
 * practitioner's applied on save, silently. That is the weaker control on the
 * address that receives SIGN-IN LINKS — redirect it and the next enrolment
 * message issues a passkey in somebody else's name.
 *
 * So the tests are written against that failure rather than the happy path:
 * the address must NOT move on request, the old address AND the backup must be
 * told, and a stop must UNDO a change that already took effect.
 */
describe('a held practitioner email change (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: PractitionerEmailService;
  let pending: PendingEmailService;
  let practitionerId: string;

  const sent: { to: string; subject: string; body: string }[] = [];

  const ahpra = `TEST${Date.now().toString().slice(-8)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_GATEWAY)
      .useValue({
        mode: 'test',
        dispatch: async (m) => {
          sent.push({ to: m.to, subject: m.subject ?? '', body: m.body });
          return { accepted: true };
        },
      } as MessagingGateway)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(PractitionerEmailService);
    pending = app.get(PendingEmailService);

    // No RLS on `practitioners` — the identity is person-level and crosses
    // practices by design, so there is no practice scope to set here.
    const created = await prisma.practitioner.create({
      data: {
        ahpraNumber: ahpra,
        familyName: 'Testworth',
        givenNames: 'Alex',
        providerType: 'general_practitioner',
        email: 'alex.old@example.invalid',
      },
    });
    practitionerId = created.id;
  });

  afterAll(async () => {
    if (practitionerId) {
      await prisma.withPractitioner(practitionerId, (tx) =>
        tx.pendingEmailChange.deleteMany({ where: { practitionerId } }),
      );
      await prisma.practitioner.deleteMany({ where: { id: practitionerId } });
    }
    await app?.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  /** The token is the only way in, so tests resolve it the way the link does. */
  async function resolve(kind: 'confirm' | 'stop'): Promise<ResolvedChange> {
    const row = await prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practitionerId }, orderBy: { requestedAt: 'desc' } }),
    );
    const token = kind === 'confirm' ? row!.confirmToken : row!.stopToken;
    const found = await pending.resolve(token, kind);
    expect(found).toBeDefined();
    return found!;
  }

  async function codeOf(): Promise<string> {
    const row = await prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practitionerId }, orderBy: { requestedAt: 'desc' } }),
    );
    return row!.confirmCode;
  }

  it('does not move the address on request, and tells the address it would replace', async () => {
    const result = await service.request(practitionerId, 'alex.new@example.invalid', 'Alex Testworth');

    expect(result.requestedEmail).toBe('alex.new@example.invalid');

    // THE ADDRESS HAS NOT MOVED. This is the whole point of the change.
    const after = await prisma.practitioner.findFirst({ where: { id: practitionerId } });
    expect(after?.email).toBe('alex.old@example.invalid');

    // The new address is asked to prove itself...
    expect(sent.some((m) => m.to === 'alex.new@example.invalid')).toBe(true);
    // ...and the OLD one is told, with a way to object.
    const warning = sent.find((m) => m.to === 'alex.old@example.invalid');
    expect(warning).toBeDefined();
    expect(warning!.body).toContain('stop-email-change');
    expect(result.warned).toBe(1);
    expect(result.unwitnessed).toBe(false);
  });

  it('refuses a code that does not match, and counts the attempt', async () => {
    const found = await resolve('confirm');
    await expect(service.confirm(found, '000000')).rejects.toThrow(/does not match/i);

    const row = await prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practitionerId }, orderBy: { requestedAt: 'desc' } }),
    );
    expect(row!.attempts).toBe(1);
    // Still not moved.
    const after = await prisma.practitioner.findFirst({ where: { id: practitionerId } });
    expect(after?.email).toBe('alex.old@example.invalid');
  });

  it('moves the address when the new one answers with its code, and keeps the passkey', async () => {
    const found = await resolve('confirm');
    const result = await service.confirm(found, await codeOf());

    expect(result.confirmed).toBe(true);
    const after = await prisma.practitioner.findFirst({ where: { id: practitionerId } });
    expect(after?.email).toBe('alex.new@example.invalid');

    /*
     * NOT A HANDOVER. A practice administrator account changes hands, so
     * confirming there revokes its passkeys. A practitioner's credential is
     * their own — revoking it would lock somebody out for updating their own
     * address, and the message must not promise otherwise.
     */
    expect(result.detail).toMatch(/passkey you already have/i);

    // The window opens now, not at the request.
    const row = await prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.findFirst({ where: { practitionerId }, orderBy: { requestedAt: 'desc' } }),
    );
    expect(row!.effectiveAt).not.toBeNull();
  });

  it('undoes a change that already took effect, within the cooling-off window', async () => {
    const found = await resolve('stop');
    // Confirmed a moment ago in the test above, so this is the late-objection
    // path rather than the "stop it before it happens" one.
    expect(found.outcome).toBe('confirmed');

    const result = await service.stop(found);
    expect(result.stopped).toBe(true);

    // PUT BACK, not merely marked. Marking it stopped and leaving the new
    // address in place would leave the objector still unable to receive
    // anything.
    const after = await prisma.practitioner.findFirst({ where: { id: practitionerId } });
    expect(after?.email).toBe('alex.old@example.invalid');
  });

  it('refuses to undo one that went through more than the cooling-off ago', async () => {
    await service.request(practitionerId, 'alex.later@example.invalid', 'Alex Testworth');
    const confirmable = await resolve('confirm');
    await service.confirm(confirmable, await codeOf());

    // Backdated past the window, which is the only way to reach this branch
    // without waiting a week.
    const long = new Date();
    long.setUTCDate(long.getUTCDate() - 30);
    await prisma.withPractitioner(practitionerId, (tx) =>
      tx.pendingEmailChange.updateMany({
        where: { practitionerId, outcome: 'confirmed' },
        data: { effectiveAt: long },
      }),
    );

    const found = await resolve('stop');
    await expect(service.stop(found)).rejects.toThrow(/more than a week ago/i);

    // Put back for the tests that follow.
    await prisma.practitioner.update({
      where: { id: practitionerId },
      data: { email: 'alex.old@example.invalid' },
    });
  });

  describe('the backup address', () => {
    it('is warned as well as the old address', async () => {
      await service.setBackup(practitionerId, 'alex.backup@example.invalid');
      sent.length = 0;

      const result = await service.request(practitionerId, 'alex.third@example.invalid', 'Alex Testworth');

      expect(result.warned).toBe(2);
      expect(sent.some((m) => m.to === 'alex.old@example.invalid')).toBe(true);
      expect(sent.some((m) => m.to === 'alex.backup@example.invalid')).toBe(true);
    });

    it('cannot be the same as the primary', async () => {
      await expect(service.setBackup(practitionerId, 'alex.old@example.invalid')).rejects.toThrow();
    });

    it('cannot be silently promoted to the primary', async () => {
      /*
       * Moving the primary ONTO the backup would collapse two channels into
       * one, and the warning would arrive at the address about to become the
       * primary — so the only witness is the destination.
       */
      await expect(
        service.request(practitionerId, 'alex.backup@example.invalid', 'Alex Testworth'),
      ).rejects.toThrow(/backup address/i);
    });
  });

  it('refuses a fourth request inside a month', async () => {
    /*
     * CHURN IS ITS OWN SIGNAL. Counted over REQUESTS rather than completions,
     * because the attempts are the behaviour. Earlier tests in this file have
     * already spent the allowance, which is exactly the situation the rule is
     * about.
     */
    await expect(service.request(practitionerId, 'alex.spam@example.invalid', 'Alex Testworth')).rejects.toThrow(
      /3 times in the last month/i,
    );
  });
});

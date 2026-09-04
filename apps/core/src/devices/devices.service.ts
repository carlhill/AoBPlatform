import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  DEVICE_LABEL_MAX_LENGTH,
  PAIRING_CODE_TTL_MS,
  deviceState,
  isPairingCodeShape,
  kioskBuildIsStale,
  normalisePairingCode,
  type DeviceRow,
} from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import type { Actor } from '../auth/actor.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashSecret,
  mintDeviceCredential,
  mintPairingCode,
  parseDeviceCredential,
} from './device-credential';
import { PairingRateLimit } from './pairing-rate-limit';

/** What the guard needs to know about the caller, and nothing more. */
export interface ResolvedDevice {
  deviceId: string;
  practiceId: string;
  label: string;
}

/**
 * DEVICE PAIRING — the one credential the zero-footprint rule allows on a
 * tablet (CLAUDE.md §7; TODO.md "Zero-footprint kiosk", "Push-to-device
 * capture").
 *
 * ⚠ THREAT MODEL, because this module is the whole of it.
 *
 * A tablet in a waiting room is a device a hundred strangers touch in a
 * morning, and one of those mornings it will leave in somebody's bag. What
 * that person gets is ONE opaque credential and nothing else: no practice
 * name, no patient data, no identifier value, no session for anything but the
 * kiosk's own read. Revoking it in the console clears the hash, and the next
 * request the tablet makes — within two seconds, on a practice with anybody
 * waiting — answers 401 and the screen drops to "this tablet needs to be
 * paired". There is no un-pair control on the device, deliberately: a tablet
 * that can un-pair itself is a tablet a passer-by can un-pair, and a tablet
 * that can RE-pair itself would only need a code somebody left on a screen.
 *
 * WHAT IT REPLACED. `/kiosk` was scoped by a build-time environment variable,
 * so anybody who reached the URL saw a practice's waiting list — patient
 * names. The route could not be deployed anywhere reachable. This is what
 * gates it.
 *
 * WHY NOT A LOGIN. Practitioner and admin auth is WebAuthn passkeys (hard rule
 * 15) and that is not being touched here: PAIRING IS NOT A KEYCLOAK LOGIN. It
 * is a device credential, in the sense a payment terminal is paired to a
 * merchant — there is no person to authenticate at a tablet, and a shared
 * staff password on one would be worse than the hole it closed.
 *
 * EVERY ACT HERE IS EVIDENCE. Register, pair, revoke and rotate each write a
 * vault event through the outbox in the SAME transaction as the row they
 * evidence (hard rule 11), and none of those events carries the credential,
 * its hash, or the pairing code — the device id, the label and the actor, and
 * nothing else (REQ-LOG-08).
 */
@Injectable()
export class DevicesService {
  /** Shared across requests deliberately — a per-request limiter limits nothing. */
  private readonly limiter = new PairingRateLimit();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register a tablet and issue its first pairing code.
   *
   * THE ACTOR IS REQUIRED AND THE REFUSAL IS THE POINT. This is the act that
   * hands out the credential which opens a practice's waiting list. Recorded
   * as `unattributed` it would be a security event nobody can be asked about
   * later, which is worse than a refusal — the same reasoning
   * `ServiceDescriptionsService` gives, and the same one `SessionActor`'s own
   * comment gives.
   */
  async register(
    practiceId: string,
    label: string,
    actor: Actor | undefined,
  ): Promise<{ deviceId: string; label: string; code: string; expiresAt: string }> {
    const named = this.requireActor(
      actor,
      'Registering a tablet hands out the credential that opens this practice’s waiting list, so it is ' +
        'recorded against the person who did it. This request carries no signed-in user, so it is refused ' +
        'rather than recorded as nobody.',
    );
    const clean = this.requireLabel(label);

    const { code, codeHash } = mintPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

    const deviceId = await this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.findFirst({});
      if (!practice) throw new NotFoundException('Practice not found.');

      const device = await tx.device.create({
        data: { practiceId, label: clean, createdBy: named.name, createdById: named.id },
      });
      await tx.devicePairingCode.create({
        data: { practiceId, deviceId: device.id, codeHash, expiresAt },
      });
      await enqueueVaultEvent(tx, {
        type: 'device.registered',
        actor: { principalType: 'staff', id: named.id },
        subject: { type: 'Device', id: device.id },
        // The label and who registered it. No credential — there is not one
        // yet — and never the code.
        payload: { label: clean, registeredBy: named.name, pairingExpiresAt: expiresAt.toISOString() },
      });
      return device.id;
    });

    // The ONLY time the code exists outside a hash. It goes straight to the
    // console screen that asked for it and is never stored or re-displayed.
    return { deviceId, label: clean, code, expiresAt: expiresAt.toISOString() };
  }

  /**
   * The tablet exchanges a code for its credential. Public, once, and never
   * again for that code.
   *
   * SINGLE USE IS THE UPDATE, NOT A READ-THEN-WRITE. Consuming the code is an
   * `updateMany` on `consumedAt IS NULL AND expiresAt > now`, so two tablets
   * racing on the same code produce exactly one credential and one refusal —
   * a read followed by a write would produce two credentials and a story
   * nobody could reconstruct.
   *
   * ONE REFUSAL FOR EVERY FAILURE. Wrong, expired, already used and
   * belonging-to-a-revoked-device all answer the same sentence: telling a
   * caller that a code was RIGHT but expired is telling them their guess was
   * right.
   */
  async pair(
    rawCode: string,
    callerKey: string,
  ): Promise<{ credential: string; deviceId: string; practiceName: string; label: string }> {
    if (this.limiter.isLimited(callerKey)) {
      // A REAL 429, not a 400 with a number in the body: the status is the
      // part a client, a proxy or a log can act on without reading English.
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Too many pairing attempts from here. Wait a few minutes and ask reception for a fresh code.',
          retryAfterSeconds: this.limiter.retryAfterSeconds(callerKey),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = normalisePairingCode(rawCode ?? '');
    if (!isPairingCodeShape(code)) {
      this.limiter.recordFailure(callerKey);
      throw this.pairingRefused();
    }

    /*
     * THE ONE UNSCOPED READ IN THE MODULE, and the table is shaped so that it
     * can be. `device_pairing_codes` carries a hash, an expiry and two ids and
     * no patient data of any kind (see the migration); establishing a practice
     * scope is the entire point of this call, so a policy on `app.practice_id`
     * would fail closed against its only caller. Everything after this line
     * runs inside `withPractice`.
     */
    const pending = await this.prisma.devicePairingCode.findUnique({
      where: { codeHash: hashSecret(code) },
    });
    if (!pending || pending.consumedAt || pending.expiresAt.getTime() <= Date.now()) {
      this.limiter.recordFailure(callerKey);
      throw this.pairingRefused();
    }

    const minted = mintDeviceCredential(pending.practiceId);

    const result = await this.prisma.withPractice(pending.practiceId, async (tx) => {
      const consumed = await tx.devicePairingCode.updateMany({
        where: { id: pending.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) return null;

      const device = await tx.device.findFirst({ where: { id: pending.deviceId } });
      // Revoked between the code being issued and the code being typed. The
      // revoke wins, and it wins silently.
      if (!device || device.revokedAt) return null;

      const paired = await tx.device.update({
        where: { id: device.id },
        data: { credentialHash: minted.credentialHash, pairedAt: new Date() },
      });
      const practice = await tx.practice.findFirst({});

      await enqueueVaultEvent(tx, {
        type: 'device.paired',
        /*
         * THE ACTOR IS THE DEVICE ITSELF, and saying so is more honest than
         * attributing it to the staff member who registered it: nobody signed
         * in to do this, somebody typed a code into a tablet. Who caused it to
         * be possible is on `device.registered`, which is where that question
         * belongs.
         */
        actor: { principalType: 'device', id: device.id },
        subject: { type: 'Device', id: device.id },
        // NOT the credential, NOT its hash, NOT the code. What happened, to
        // which device, and which registration it completed.
        payload: { label: device.label, registeredBy: device.createdBy, repaired: device.pairedAt !== null },
      });

      return { device: paired, practiceName: practice?.name ?? '' };
    });

    if (!result) {
      this.limiter.recordFailure(callerKey);
      throw this.pairingRefused();
    }

    return {
      credential: minted.credential,
      deviceId: result.device.id,
      practiceName: result.practiceName,
      label: result.device.label,
    };
  }

  /**
   * Resolve a credential to a device. The kiosk's whole authentication, and
   * the only place it happens.
   *
   * INSIDE THE RLS FENCE. The practice id is the routing half of the
   * credential, so `withPractice` is entered before the lookup rather than
   * after it — there is no query in this system that reads every tenant's
   * devices.
   *
   * A REVOKED DEVICE HAS NO HASH TO MATCH, because revoke clears it. So a
   * revoked credential is not "found and then refused", it is simply not
   * found, and the database CHECK constraint refuses a row that is revoked and
   * still holds one.
   */
  async resolveCredential(credential: string): Promise<ResolvedDevice | null> {
    const parsed = parseDeviceCredential(credential);
    if (!parsed) return null;
    return this.prisma.withPractice(parsed.practiceId, async (tx) => {
      const device = await tx.device.findFirst({
        where: { credentialHash: parsed.credentialHash, revokedAt: null },
      });
      if (!device) return null;
      return { deviceId: device.id, practiceId: device.practiceId, label: device.label };
    });
  }

  /**
   * The heartbeat, and why it is not written on every request.
   *
   * A busy practice polls every two seconds. Writing `lastSeenAt` on each poll
   * is a row update per tablet per two seconds — call it forty thousand writes
   * a day per device — for a column somebody reads once a fortnight when a
   * tablet stops working. Once a minute answers the same question ("was it
   * alive this morning?") for one six-hundredth of the cost.
   *
   * THE BUILD IS WRITTEN WHENEVER IT CHANGES, throttle or no throttle: a
   * tablet that has just reloaded onto a new build should say so immediately,
   * because the next question anybody asks is whether the rollback landed.
   */
  async touch(deviceId: string, practiceId: string, kioskBuild: string | null): Promise<void> {
    const now = new Date();
    await this.prisma.withPractice(practiceId, async (tx) => {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      if (!device) return;
      const buildChanged = (kioskBuild ?? null) !== (device.lastKioskBuild ?? null);
      const stale = !device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > 60_000;
      if (!buildChanged && !stale) return;
      await tx.device.update({
        where: { id: deviceId },
        data: { lastSeenAt: now, ...(buildChanged ? { lastKioskBuild: kioskBuild } : {}) },
      });
    });
  }

  /** Whether this tablet is below the practice's build floor and must reload. */
  async shouldReload(practiceId: string, kioskBuild: string | null): Promise<boolean> {
    const practice = await this.prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({}));
    return kioskBuildIsStale(kioskBuild, practice?.minimumKioskBuild ?? null);
  }

  /** The console's list. No credential and no hash — there is nothing to show. */
  async list(practiceId: string): Promise<{ devices: DeviceRow[]; minimumKioskBuild: string | null }> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const rows = await tx.device.findMany({ orderBy: { createdAt: 'asc' } });
      const codes = rows.length
        ? await tx.devicePairingCode.findMany({
            where: { deviceId: { in: rows.map((d) => d.id) }, consumedAt: null },
            orderBy: { expiresAt: 'desc' },
          })
        : [];
      const liveCodeFor = new Map<string, Date>();
  /**
   * ONE TABLET, BY ID, WITHIN THE PRACTICE — the module API another module
   * asks before it does anything to a device (`tablet-sessions` pushes to one).
   *
   * It answers `null` for a device belonging to another practice, because RLS
   * filters on the transaction-local scope: the caller cannot tell a
   * cross-practice id from a made-up one, which is the correct amount to
   * learn from a refusal.
   *
   * NO CREDENTIAL AND NO HASH. There is nothing to show, and no caller has
   * business with one.
   */
  async find(
    practiceId: string,
    deviceId: string,
  ): Promise<{ id: string; label: string; state: DeviceRow['state'] } | null> {
    return this.prisma.withPractice(practiceId, async (tx) => {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      if (!device) return null;
      return { id: device.id, label: device.label, state: deviceState(device) };
    });
  }

      for (const code of codes) {
        if (code.expiresAt.getTime() <= Date.now()) continue;
        if (!liveCodeFor.has(code.deviceId)) liveCodeFor.set(code.deviceId, code.expiresAt);
      }
      const practice = await tx.practice.findFirst({});
      return {
        minimumKioskBuild: practice?.minimumKioskBuild ?? null,
        devices: rows.map((device) => ({
          id: device.id,
          label: device.label,
          state: deviceState(device),
          createdBy: device.createdBy,
          createdAt: device.createdAt.toISOString(),
          pairedAt: device.pairedAt?.toISOString() ?? null,
          lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
          lastKioskBuild: device.lastKioskBuild,
          revokedAt: device.revokedAt?.toISOString() ?? null,
          revokedBy: device.revokedBy,
          pairingExpiresAt: liveCodeFor.get(device.id)?.toISOString() ?? null,
        })),
      };
    });
  }

  /**
   * Take the credential back. The tablet learns on its next request.
   *
   * IT CLEARS THE HASH RATHER THAN SETTING A FLAG. A flag is a thing a future
   * query can forget to check; a cleared hash is a credential that resolves to
   * nothing, everywhere, by construction. Any outstanding pairing code goes
   * with it, so a revoked device cannot be re-paired with a code somebody
   * still has on a screen — rotate is the deliberate act that issues a new one.
   */
  async revoke(
    practiceId: string,
    deviceId: string,
    reason: string | undefined,
    actor: Actor | undefined,
  ): Promise<{ deviceId: string; revokedAt: string }> {
    const named = this.requireActor(
      actor,
      'Revoking a tablet is recorded against the person who did it. This request carries no signed-in user, ' +
        'so it is refused rather than recorded as nobody.',
    );
    const revokedAt = new Date();
    await this.prisma.withPractice(practiceId, async (tx) => {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      // A cross-practice id finds nothing — RLS filters on the
      // transaction-local scope, so this fails closed as a 404 rather than
      // admitting the device exists somewhere else.
      if (!device) throw new NotFoundException('Device not found.');
      if (device.revokedAt) return;

      await tx.device.update({
        where: { id: deviceId },
        data: { credentialHash: null, revokedAt, revokedBy: named.name, revokedReason: reason ?? null },
      });
      await tx.devicePairingCode.updateMany({
        where: { deviceId, consumedAt: null },
        data: { consumedAt: revokedAt },
      });
      await enqueueVaultEvent(tx, {
        type: 'device.revoked',
        actor: { principalType: 'staff', id: named.id },
        subject: { type: 'Device', id: deviceId },
        payload: { label: device.label, revokedBy: named.name, reason: reason ?? '', wasPaired: device.pairedAt !== null },
      });
    });
    return { deviceId, revokedAt: revokedAt.toISOString() };
  }

  /**
   * The same tablet, a new credential.
   *
   * IT IS A REVOKE AND A RE-REGISTER IN ONE ROW, on purpose. The history has
   * to stay attached to the tablet on the desk: "this one was re-paired in
   * March" and "this is a different tablet" are different facts, and REQ-SIG-02
   * binds a device fingerprint into every signature — a signature from
   * February should still resolve to the device it was made on.
   */
  async rotate(
    practiceId: string,
    deviceId: string,
    actor: Actor | undefined,
  ): Promise<{ deviceId: string; label: string; code: string; expiresAt: string }> {
    const named = this.requireActor(
      actor,
      'Rotating a tablet’s credential is recorded against the person who did it. This request carries no ' +
        'signed-in user, so it is refused rather than recorded as nobody.',
    );
    const { code, codeHash } = mintPairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

    const label = await this.prisma.withPractice(practiceId, async (tx) => {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      if (!device) throw new NotFoundException('Device not found.');

      await tx.device.update({
        where: { id: deviceId },
        data: {
          // The credential on the device stops working NOW, not when the new
          // code is typed. A rotation that left the old one live until somebody
          // got round to the tablet would not be a rotation.
          credentialHash: null,
          pairedAt: null,
          // Rotating an un-revoked device is the ordinary case; rotating a
          // revoked one is how a practice brings a tablet back, and the
          // revocation is lifted deliberately rather than as a side effect.
          revokedAt: null,
          revokedBy: null,
          revokedReason: null,
        },
      });
      await tx.devicePairingCode.updateMany({
        where: { deviceId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.devicePairingCode.create({ data: { practiceId, deviceId, codeHash, expiresAt } });
      await enqueueVaultEvent(tx, {
        type: 'device.rotated',
        actor: { principalType: 'staff', id: named.id },
        subject: { type: 'Device', id: deviceId },
        payload: {
          label: device.label,
          rotatedBy: named.name,
          liftedRevocation: device.revokedAt !== null,
          pairingExpiresAt: expiresAt.toISOString(),
        },
      });
      return device.label;
    });

    return { deviceId, label, code, expiresAt: expiresAt.toISOString() };
  }

  /**
   * The build floor for this practice's tablets — staged rollout with instant
   * rollback (TODO.md "Zero-footprint kiosk").
   *
   * One act with a fleet-wide effect, which is exactly the kind that has to be
   * attributable: every tablet below the floor reloads on its next poll.
   */
  async setMinimumKioskBuild(
    practiceId: string,
    build: string | null,
    actor: Actor | undefined,
  ): Promise<{ minimumKioskBuild: string | null }> {
    const named = this.requireActor(
      actor,
      'Moving the kiosk build floor reloads every tablet in this practice, so it is recorded against the ' +
        'person who did it. This request carries no signed-in user, so it is refused.',
    );
    const clean = build === null ? null : build.trim();
    if (clean !== null && (clean.length === 0 || clean.length > 40)) {
      throw new BadRequestException('A build id is a short ordered string, such as 2026.09.03-2, or none.');
    }

    const updated = await this.prisma.withPractice(practiceId, async (tx) => {
      const practice = await tx.practice.findFirst({});
      if (!practice) throw new NotFoundException('Practice not found.');
      const row = await tx.practice.update({
        where: { id: practice.id },
        data: { minimumKioskBuild: clean },
      });
      await enqueueVaultEvent(tx, {
        type: 'practice.minimum_kiosk_build_set',
        actor: { principalType: 'staff', id: named.id },
        subject: { type: 'Practice', id: practice.id },
        payload: { minimumKioskBuild: clean ?? '', cleared: clean === null, setBy: named.name },
      });
      return row;
    });
    return { minimumKioskBuild: updated.minimumKioskBuild };
  }

  /**
   * DEV ONLY — a registered, code-bearing device with no signed-in user.
   *
   * It exists for one reason: the Playwright ceremony suite has to pair a
   * tablet before it can run, and `register` REFUSES an unattributed request
   * by design. Weakening that refusal to make a test pass would remove the
   * very property the test suite is meant to protect, so the dev surface takes
   * the weight instead — behind `NODE_ENV !== 'production'`, in the module
   * that already creates whole practices out of nothing, and attributed
   * honestly to a seed rather than to a person.
   */
  async registerForDev(practiceId: string, label: string): Promise<{ deviceId: string; code: string; expiresAt: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev device pairing does not exist in production.');
    }
    const registered = await this.register(practiceId, label, {
      id: 'dev-seed',
      name: 'dev seed (not a signed-in user)',
      principalType: 'system',
      roles: [],
    });
    return { deviceId: registered.deviceId, code: registered.code, expiresAt: registered.expiresAt };
  }

  /** DEV ONLY, and the twin of `registerForDev`. Same guard, same reasoning. */
  async revokeForDev(practiceId: string, deviceId: string): Promise<{ deviceId: string; revokedAt: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev device pairing does not exist in production.');
    }
    return this.revoke(practiceId, deviceId, 'dev seed', {
      id: 'dev-seed',
      name: 'dev seed (not a signed-in user)',
      principalType: 'system',
      roles: [],
    });
  }

  private requireActor(actor: Actor | undefined, message: string): Actor {
    if (!actor) throw new ForbiddenException(message);
    return actor;
  }

  private requireLabel(label: string): string {
    const clean = (label ?? '').trim();
    if (clean.length === 0) {
      throw new BadRequestException('Give the tablet a name somebody could find it by — "Reception tablet 1".');
    }
    if (clean.length > DEVICE_LABEL_MAX_LENGTH) {
      throw new BadRequestException(`A tablet’s name is at most ${DEVICE_LABEL_MAX_LENGTH} characters.`);
    }
    return clean;
  }

  /**
   * ONE SENTENCE FOR EVERY WAY A PAIRING CAN FAIL. Wrong code, expired code,
   * already-used code and revoked device are indistinguishable from outside —
   * telling a caller their code was right but stale is telling them their
   * guess was right.
   */
  private pairingRefused(): UnauthorizedException {
    return new UnauthorizedException(
      'That pairing code is not usable. Ask reception for a new one — codes last ten minutes and work once.',
    );
  }
}

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  DEVICE_LABEL_MAX_LENGTH,
  PAIRING_CODE_TTL_MS,
  deviceHeartbeatIsStale,
  deviceState,
  isPairingCodeShape,
  kioskBuildIsStale,
  kioskCommandIsLive,
  kioskPollMs,
  normalisePairingCode,
  type DeviceRow,
  type KioskCommand,
  type KioskCommandKind,
  type KioskScreen,
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
  /**
   * A TEST DEVICE — the only kind shown the waiting list (Carl, 4 Sep 2026).
   * Resolved with the credential so `/kiosk/waiting-list` never has to make a
   * second read to find out whether it may answer with names.
   */
  showsWaitingList: boolean;
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
      return {
        deviceId: device.id,
        practiceId: device.practiceId,
        label: device.label,
        showsWaitingList: device.showsWaitingList,
      };
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

  /**
   * THE HEARTBEAT — where this tablet is, every poll, on every screen
   * (Carl, 4–5 Sep 2026; TODO.md "Tablet heartbeat and Return to Begin").
   *
   * IT WRITES EVERY TIME, unlike `touch` above, and the difference is the
   * whole point. `touch` answers "was this tablet alive this morning?" and a
   * once-a-minute write is plenty for that. This answers "where is it RIGHT
   * NOW", which reception reads off a row while a patient stands at the desk —
   * a throttled write would make every tablet in a busy practice read as
   * stale, which is the opposite of what the line is for. A device row is a
   * handful of small columns and a practice has a handful of tablets.
   *
   * NO VAULT EVENT. A heartbeat is telemetry, not evidence: thirty rows a
   * minute per tablet in an append-only store would bury the events that
   * matter for no evidentiary gain. The acts that ARE evidence — the reset
   * request, taking a tablet out of use — write their own (hard rule 11).
   *
   * NO PATIENT DATA REACHES THIS FUNCTION. `screen` is one of `KIOSK_SCREENS`
   * (the DTO refuses anything else) and `sessionId` is opaque; there is no
   * parameter here that could carry a name, and none that could carry an
   * identifier value (REQ-VER-04, hard rule 9).
   *
   * IT NEVER BLOCKS CARE. A device that has gone missing between the guard and
   * here answers an empty command rather than throwing: the tablet in a
   * patient's hands must not be broken by a write about telemetry
   * (REQ-REC-04).
   */
  async recordHeartbeat(
    device: ResolvedDevice,
    input: {
      screen: KioskScreen;
      sessionId: string | null;
      kioskBuild: string | null;
      /** The command this tablet has just carried out. Clears it, once. */
      ackCommandId: string | null;
    },
  ): Promise<{ command: KioskCommand | null; outOfUse: boolean }> {
    const now = new Date();
    return this.prisma.withPractice(device.practiceId, async (tx) => {
      const row = await tx.device.findFirst({ where: { id: device.deviceId } });
      if (!row) return { command: null, outOfUse: false };

      /*
       * SERVED ONCE, AND ONLY WHILE IT IS FRESH.
       *
       * Three things can be true of the pending command, and each has its own
       * answer. The tablet has ACKNOWLEDGED it (the id comes back on this
       * heartbeat) — clear it, it landed. It has EXPIRED — clear it silently,
       * because a tablet that was asleep when reception pressed the button
       * must not clear tomorrow's patient off the screen tomorrow morning
       * (`KIOSK_COMMAND_TTL_MS`). Otherwise it is LIVE, and it is served again
       * on every heartbeat until the acknowledgement arrives, so a command
       * lost to one dropped request is not a command lost.
       */
      const pending =
        row.pendingCommandId && row.pendingCommandKind && row.pendingCommandIssuedAt
          ? {
              id: row.pendingCommandId,
              kind: row.pendingCommandKind as KioskCommandKind,
              issuedAt: row.pendingCommandIssuedAt,
            }
          : null;
      const acknowledged = pending !== null && input.ackCommandId === pending.id;
      const expired = pending !== null && !kioskCommandIsLive(pending.issuedAt, now);
      const clearCommand = pending !== null && (acknowledged || expired);
      const serve = pending !== null && !acknowledged && !expired ? pending : null;

      await tx.device.update({
        where: { id: device.deviceId },
        data: {
          lastSeenAt: now,
          currentScreen: input.screen,
          currentSessionId: input.sessionId,
          ...(input.kioskBuild !== null && input.kioskBuild !== row.lastKioskBuild
            ? { lastKioskBuild: input.kioskBuild }
            : {}),
          ...(clearCommand
            ? {
                pendingCommandId: null,
                pendingCommandKind: null,
                pendingCommandIssuedAt: null,
                pendingCommandIssuedBy: null,
              }
            : {}),
        },
      });

      return {
        command: serve
          ? { id: serve.id, kind: serve.kind, issuedAt: serve.issuedAt.toISOString() }
          : null,
        outOfUse: row.outOfUseAt !== null,
      };
    });
  }

  /**
   * "RETURN TO BEGIN" — reception asking for the tablet back (Carl, 4 Sep
   * 2026).
   *
   * THIS HALF IS ONLY THE FLAG ON THE DEVICE. Recalling whatever session is
   * live on the tablet is `TabletSessionsService`'s act, in its own
   * transaction with its own event, because sessions are its table and its
   * rules — a device module that ended sessions would be the second place the
   * rule for ending one lives, and the second place is the one that drifts.
   *
   * IDEMPOTENT BY REPLACEMENT. A second press while one is pending replaces
   * it: somebody pressing twice wants the tablet back once, and a queue of
   * two resets would take two heartbeats to work through for no reason.
   *
   * THE EVENT IS WRITTEN IN THE SAME TRANSACTION AS THE FLAG (hard rule 11),
   * and carries the device, the command, and who pressed it — never a patient,
   * because the tablet may have had anybody's ceremony on it and this record
   * is about the act, not its subject (REQ-LOG-08).
   */
  async requestReturnToBegin(
    practiceId: string,
    deviceId: string,
    actor: Actor | undefined,
    context: { recalledSessionId: string | null },
  ): Promise<{ deviceId: string; commandId: string; issuedAt: string }> {
    const named = this.requireActor(
      actor,
      'Sending a tablet back to the start can take a screen away from a patient standing at it, so it is ' +
        'recorded against the person who did it. This request carries no signed-in user, so it is refused ' +
        'rather than recorded as nobody.',
    );
    const commandId = randomUUID();
    const issuedAt = new Date();

    await this.prisma.withPractice(practiceId, async (tx) => {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      // A cross-practice id finds nothing — RLS filters on the
      // transaction-local scope, so this fails closed as a 404 rather than
      // admitting the device exists somewhere else.
      if (!device) throw new NotFoundException('Device not found.');

      await tx.device.update({
        where: { id: deviceId },
        data: {
          pendingCommandId: commandId,
          pendingCommandKind: 'return_to_begin' satisfies KioskCommandKind,
          pendingCommandIssuedAt: issuedAt,
          pendingCommandIssuedBy: named.id,
        },
      });
      await enqueueVaultEvent(tx, {
        type: 'tablet.return_to_begin_requested',
        actor: { principalType: 'staff', id: named.id },
        subject: { type: 'Device', id: deviceId },
        payload: {
          label: device.label,
          commandId,
          requestedBy: named.name,
          // WHETHER A SCREEN WAS TAKEN OFF SOMEBODY, as an id and never a name.
          recalledSessionId: context.recalledSessionId ?? '',
          interruptedScreen: device.currentScreen ?? '',
        },
      });
    });

    return { deviceId, commandId, issuedAt: issuedAt.toISOString() };
  }

  /**
   * TAKE A TABLET OUT OF USE, AND PUT IT BACK (Carl, 4–5 Sep 2026; TODO.md
   * "Tablets: make one inactive").
   *
   * IT IS RECEPTION'S SWITCH AND NOT AN ADMINISTRATOR'S REVOKE, and the whole
   * value is in that distinction. A flat battery, a tablet gone for repair, a
   * tablet on the wrong desk: the credential is fine and throwing it away
   * would cost somebody a rotate and a walk to the device to type a code in.
   * So this refuses pushes, shows a quiet "not in use" screen, and reverses
   * with one press — while the tablet keeps heartbeating, so it is still
   * visible on the console rather than indistinguishable from one switched off.
   *
   * IDEMPOTENT AND SILENT ABOUT IT. Setting the state it is already in writes
   * no row and no event: an audit trail of non-changes is one nobody reads.
   */
  async setOutOfUse(
    practiceId: string,
    deviceId: string,
    outOfUse: boolean,
    actor: Actor | undefined,
    context: { recalledSessionId: string | null } = { recalledSessionId: null },
  ): Promise<{ deviceId: string; outOfUse: boolean }> {
    const named = this.requireActor(
      actor,
      'Taking a tablet out of use stops agreements reaching it, so it is recorded against the person who ' +
        'did it. This request carries no signed-in user, so it is refused rather than recorded as nobody.',
    );

    const value = await this.prisma.withPractice(practiceId, async (tx) => {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      if (!device) throw new NotFoundException('Device not found.');
      const already = device.outOfUseAt !== null;
      if (already === outOfUse) return already;

      await tx.device.update({
        where: { id: deviceId },
        data: outOfUse
          ? { outOfUseAt: new Date(), outOfUseBy: named.name }
          : { outOfUseAt: null, outOfUseBy: null },
      });
      await enqueueVaultEvent(tx, {
        type: outOfUse ? 'device.taken_out_of_use' : 'device.put_back_in_use',
        actor: { principalType: 'staff', id: named.id },
        subject: { type: 'Device', id: deviceId },
        // The label, who did it, and whether a live screen was taken back to
        // make it true. No patient and no name of one (REQ-LOG-08).
        payload: {
          label: device.label,
          setBy: named.name,
          recalledSessionId: context.recalledSessionId ?? '',
        },
      });
      return outOfUse;
    });

    return { deviceId, outOfUse: value };
  }

  /** Whether this tablet is below the practice's build floor and must reload. */
  async shouldReload(practiceId: string, kioskBuild: string | null): Promise<boolean> {
    const practice = await this.prisma.withPractice(practiceId, (tx) => tx.practice.findFirst({}));
    return kioskBuildIsStale(kioskBuild, practice?.minimumKioskBuild ?? null);
  }

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
      // `deviceState` reads `outOfUseAt` too, so a caller asking "may I push to
      // this?" gets `inactive` from the same function the console renders —
      // one place decides what a device IS.
      return { id: device.id, label: device.label, state: deviceState(device) };
    });
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
      for (const code of codes) {
        if (code.expiresAt.getTime() <= Date.now()) continue;
        if (!liveCodeFor.has(code.deviceId)) liveCodeFor.set(code.deviceId, code.expiresAt);
      }
      const practice = await tx.practice.findFirst({});

      /*
       * STALENESS IS THE SERVER'S ANSWER, NOT THE CONSOLE'S GUESS (Carl, 5 Sep
       * 2026). "Not seen for 3 min" has to mean "missed two heartbeats", and
       * the heartbeat cadence is the server's — fast while somebody is
       * waiting, slow while nobody is. A console that hardcoded a number would
       * be a second place for the cadence to be wrong, and it would be wrong
       * in the direction that matters: calling a live tablet dead.
       */
      const waitingCount = await tx.captureRequest.count({
        where: { channel: 'in_practice', status: 'open' },
      });
      const pollMs = kioskPollMs(waitingCount);
      const now = new Date();

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
          showsWaitingList: device.showsWaitingList,
          /*
           * WHERE THE TABLET IS. A screen NAME from `KIOSK_SCREENS` and an
           * opaque session id — no patient is looked up to decorate this row,
           * because reception already has the name on the session row and a
           * second copy on a second screen buys nothing (Carl, 5 Sep 2026).
           */
          currentScreen: (device.currentScreen as DeviceRow['currentScreen']) ?? null,
          currentSessionId: device.currentSessionId,
          stale: deviceHeartbeatIsStale(device.lastSeenAt, pollMs, now),
          outOfUse: device.outOfUseAt !== null,
          outOfUseAt: device.outOfUseAt?.toISOString() ?? null,
          outOfUseBy: device.outOfUseBy,
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
          /*
           * A ROTATED TABLET COMES BACK CLEAN. Out of use, and a reset command
           * nobody ever collected, are both statements about the tablet that
           * WAS on this row — the one whose credential has just been thrown
           * away. Carrying them across would greet a freshly paired device
           * with "not in use" and a reset from last week.
           */
          outOfUseAt: null,
          outOfUseBy: null,
          pendingCommandId: null,
          pendingCommandKind: null,
          pendingCommandIssuedAt: null,
          pendingCommandIssuedBy: null,
          currentScreen: null,
          currentSessionId: null,
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
   * TURN THE WAITING LIST ON FOR ONE TABLET, FROM THE CONSOLE (Carl, 4 Sep
   * 2026 — "the list page is only for testing purposes").
   *
   * WHAT IT ACTUALLY SWITCHES ON IS A DISCLOSURE. A device with this flag is
   * shown other patients' names; every other device is shown nobody's, and
   * finds its one patient by what that patient types. So this is a security
   * setting wearing the clothes of a convenience toggle, and it is treated as
   * one: console only, staff actor required, and an event in the vault for
   * every change.
   *
   * NEVER FROM THE TABLET. There is no endpoint a device credential can reach
   * that sets this, for the same reason there is no un-pair control on the
   * device: a tablet that can widen its own disclosure is a tablet a
   * passer-by can widen.
   *
   * IT IS IDEMPOTENT AND SAYS SO IN THE EVENT. Setting a flag to the value it
   * already has writes no event — an audit trail of non-changes is an audit
   * trail nobody reads.
   */
  async setShowsWaitingList(
    practiceId: string,
    deviceId: string,
    showsWaitingList: boolean,
    actor: Actor | undefined,
  ): Promise<{ deviceId: string; showsWaitingList: boolean }> {
    const named = this.requireActor(
      actor,
      'Showing a tablet the waiting list puts other patients’ names on a screen anybody in the room can ' +
        'read, so it is recorded against the person who did it. This request carries no signed-in user, so ' +
        'it is refused rather than recorded as nobody.',
    );

    const value = await this.prisma.withPractice(practiceId, async (tx) => {
      const device = await tx.device.findFirst({ where: { id: deviceId } });
      // A cross-practice id finds nothing — RLS filters on the
      // transaction-local scope, so this fails closed as a 404 rather than
      // admitting the device exists somewhere else.
      if (!device) throw new NotFoundException('Device not found.');
      if (device.showsWaitingList === showsWaitingList) return device.showsWaitingList;

      const updated = await tx.device.update({ where: { id: deviceId }, data: { showsWaitingList } });
      await enqueueVaultEvent(tx, {
        type: 'device.waiting_list_visibility_set',
        actor: { principalType: 'staff', id: named.id },
        subject: { type: 'Device', id: deviceId },
        // The label, the new value and who set it. No patient data — this
        // event is about a device setting, and there is no name to carry.
        payload: { label: device.label, showsWaitingList, setBy: named.name },
      });
      return updated.showsWaitingList;
    });

    return { deviceId, showsWaitingList: value };
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
  async registerForDev(
    practiceId: string,
    label: string,
    /**
     * A DEV TABLET THAT SHOWS THE LIST. The Playwright ceremony suite drives
     * the list path, and Carl pairs his own tablet from the command line —
     * both need the test-device flag, and neither has a console session to
     * set it with. Default false, so a dev device is a walk-up device unless
     * somebody asks for the other thing.
     */
    showsWaitingList = false,
  ): Promise<{ deviceId: string; code: string; expiresAt: string; showsWaitingList: boolean }> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev device pairing does not exist in production.');
    }
    const seed: Actor = {
      id: 'dev-seed',
      name: 'dev seed (not a signed-in user)',
      principalType: 'system',
      roles: [],
    };
    const registered = await this.register(practiceId, label, seed);
    if (showsWaitingList) {
      await this.setShowsWaitingList(practiceId, registered.deviceId, true, seed);
    }
    return {
      deviceId: registered.deviceId,
      code: registered.code,
      expiresAt: registered.expiresAt,
      showsWaitingList,
    };
  }

  /**
   * DEV ONLY — flip an already-paired tablet's test-device flag without a
   * console session. The twin of `registerForDev`, same guard, same reasoning:
   * `PATCH /devices/:id` refuses an unattributed request by design, and a
   * developer watching a live `/kiosk` tab has no passkey session to satisfy
   * it with. The vault event is the same one the console act writes.
   */
  async setShowsWaitingListForDev(
    practiceId: string,
    deviceId: string,
    showsWaitingList: boolean,
  ): Promise<{ deviceId: string; showsWaitingList: boolean }> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Dev device pairing does not exist in production.');
    }
    return this.setShowsWaitingList(practiceId, deviceId, showsWaitingList, {
      id: 'dev-seed',
      name: 'dev seed (not a signed-in user)',
      principalType: 'system',
      roles: [],
    });
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

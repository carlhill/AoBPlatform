import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { aobPrinterHostLiveness } from '@aobplatform/domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SILENCE IS THE ALARM THAT MATTERS (D-2026-10-10-02, decision 3).
 *
 * A console page only helps somebody looking at it. Every five minutes this
 * reads every host's last beat and logs `ALERT` once when a host goes offline
 * (fifteen minutes silent, decision 2 — the domain decides, through
 * `aobPrinterHostLiveness`) and once when it comes back.
 *
 * LOG ONLY, NEVER A VAULT EVENT. Silence is an operational fact about a PC at
 * a practice, not evidence about an agreement; the evidence about the chain is
 * written by the heartbeat itself.
 *
 * "ONCE" IS PER PROCESS. Which hosts have been said to be offline is held in
 * memory, so a restart says it again of a host still silent — once — rather
 * than never saying it of a host that went quiet while the platform was down.
 *
 * IT NEVER BLOCKS CARE (hard rule 8): it reads, and it logs.
 */
@Injectable()
export class AobPrinterHostsSweep {
  private readonly logger = new Logger(AobPrinterHostsSweep.name);
  private readonly saidOffline = new Set<string>();

  static readonly EVERY_MS = 5 * 60 * 1000;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(AobPrinterHostsSweep.EVERY_MS)
  async sweep(): Promise<void> {
    const now = new Date();
    /*
     * PRACTICE IDS ONLY, through a SECURITY DEFINER function granted to
     * `aob_app` alone — the same shape as the post-service chase sweep. RLS is
     * FORCEd on `aobprinter_hosts`, so an unscoped read would correctly return
     * nothing; every read that follows goes back through `withPractice`.
     */
    const practices = await this.prisma.$queryRaw<Array<{ practiceId: string }>>`
      SELECT * FROM core.aobprinter_host_practices()`;
    const seen = new Set<string>();
    for (const { practiceId } of practices) {
      try {
        const hosts = await this.prisma.withPractice(practiceId, (tx) =>
          tx.aobPrinterHost.findMany({ select: { id: true, lastSeenAt: true, intervalMs: true } }),
        );
        for (const host of hosts) {
          seen.add(host.id);
          const offline = aobPrinterHostLiveness(host.lastSeenAt, host.intervalMs, now) === 'offline';
          if (offline && !this.saidOffline.has(host.id)) {
            this.saidOffline.add(host.id);
            this.logger.error(
              `ALERT: AOBPRINTER host ${host.id} at practice ${practiceId} is offline: not heard from since ` +
                `${host.lastSeenAt.toISOString()}.`,
            );
          } else if (!offline && this.saidOffline.has(host.id)) {
            this.saidOffline.delete(host.id);
            this.logger.error(`ALERT: AOBPRINTER host ${host.id} at practice ${practiceId} is back and reporting again.`);
          }
        }
      } catch (err) {
        // One practice's failure must not stop the next practice's sweep.
        this.logger.error(`AOBPRINTER silence sweep failed for practice ${practiceId}: ${(err as Error).message}`);
      }
    }
    // A host row that no longer exists has nothing left to come back from.
    for (const id of [...this.saidOffline]) if (!seen.has(id)) this.saidOffline.delete(id);
  }
}

/**
 * The HTTP half of the heartbeat (PRINTER-HEARTBEAT.md §2).
 *
 * THE SAME SHAPE AS `collection-client.ts`, AND THE SAME CREDENTIAL. The URL
 * is derived from the one the installer already got right — `${ingest}/heartbeat`,
 * which the platform serves at `POST /inbound/print-jobs/heartbeat` — and it
 * sends the same three headers. `x-practice-id` is the recorded posture until
 * mutual TLS lands (decision 12).
 *
 * A BEAT IS CHEAP TO LOSE. Fifteen seconds and it gives up; the next one is a
 * minute away. The caller's signal is combined with the timeout, so a stop
 * aborts a beat in flight rather than waiting on a slow link.
 */
import type { AobPrinterHeartbeat, AobPrinterHeartbeatReply } from '@aobplatform/contracts';
import type { AobPrinterConfig } from './config';
import { HeartbeatHttpError, type HeartbeatClient } from './heartbeat';
import { readPackageVersion } from './version';

const TIMEOUT_MS = 15_000;

/** Exported for a test and a banner: where the heartbeat goes, without a credential. */
export function heartbeatUrlOf(config: AobPrinterConfig): string {
  return `${config.endpoint.replace(/\/+$/, '')}/heartbeat`;
}

export function makeHttpHeartbeatClient(config: AobPrinterConfig): HeartbeatClient {
  const url = heartbeatUrlOf(config);
  const headers = {
    'content-type': 'application/json',
    'x-practice-id': config.practiceId,
    'x-aobprinter-version': readPackageVersion(),
    // Names the program, never a person; the same as collection.
    'x-read-by': 'aobprinter',
  } as const;

  return {
    async beat(body: AobPrinterHeartbeat, signal: AbortSignal): Promise<AobPrinterHeartbeatReply> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const onAbort = () => controller.abort();
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        if (!response.ok) throw new HeartbeatHttpError(response.status);
        return (await response.json()) as AobPrinterHeartbeatReply;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

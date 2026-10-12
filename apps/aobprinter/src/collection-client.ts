/**
 * The HTTP half of collection — the three calls, and the URLs they are at.
 *
 * BESIDE `poster.ts` RATHER THAN INSIDE IT. That file's first line is "the
 * one place this program talks to AoB", and it earned that by being the only
 * one; splitting the outbound and inbound directions keeps each file's
 * failure posture readable, because they are not the same. A post that fails
 * is retried forever, because a captured form must never be lost. A
 * collection that fails is simply retried next sweep, because the platform
 * still holds the document and still publishes it.
 *
 * THE URLS ARE DERIVED, NOT CONFIGURED. An installer already gets one thing
 * right — the full URL of `POST /inbound/print-jobs` — and asking it for
 * three more is three more chances to point half of this program at the
 * wrong host. The collection routes sit under the ingest route on purpose
 * (`inbound-print-jobs.controller.ts`), and the artefact download is at the
 * same origin.
 *
 * THE SAME CREDENTIAL AND THE SAME OPEN GAP. `x-practice-id` over whatever
 * the configured URL says, exactly as the poster does, and mutual TLS is the
 * recorded posture that is not built yet (`config.ts`). One connector, one
 * credential — so when that decision lands it lands for both directions at
 * once.
 */
import type { CollectedConfirmation, SignedFormForCollection } from '@aobplatform/contracts';
import type { CollectionClient } from './collector';
import type { AobPrinterConfig } from './config';
import { redactError, type Logger } from './log';
import { readPackageVersion } from './version';

/** As generous as the poster's, for the same reason: a slow link is not a fault. */
const TIMEOUT_MS = 20_000;

/** A download may be a megabyte of PDF/A over a practice's ADSL. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function makeHttpCollectionClient(config: AobPrinterConfig, logger: Logger): CollectionClient {
  const printerVersion = readPackageVersion();
  const ingest = config.endpoint.replace(/\/+$/, '');
  const origin = new URL(ingest).origin;
  const headers = {
    'x-practice-id': config.practiceId,
    'x-aobprinter-version': printerVersion,
    /*
     * WHO READ IT, FOR THE ARTEFACT DOWNLOAD'S OWN ACCESS RECORD. The route
     * attributes every read, and "unattributed" on a document leaving the
     * vault would be a gap in exactly the trail this product sells. It names
     * the program, never a person — this runs unattended on a desktop.
     */
    'x-read-by': 'aobprinter',
  } as const;

  return {
    async pending(): Promise<readonly SignedFormForCollection[]> {
      return withTimeout(TIMEOUT_MS, async (signal) => {
        const response = await fetch(`${ingest}/signed`, { headers, signal });
        if (!response.ok) {
          throw new Error(`The platform answered ${response.status} when asked what is waiting.`);
        }
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) throw new Error('The waiting list was not a list.');
        return body as SignedFormForCollection[];
      });
    },

    async download(artefactId: string): Promise<Uint8Array> {
      return withTimeout(DOWNLOAD_TIMEOUT_MS, async (signal) => {
        const response = await fetch(`${origin}/artefacts/${artefactId}/content`, { headers, signal });
        if (!response.ok) {
          throw new Error(`The platform answered ${response.status} for a document it published.`);
        }
        return new Uint8Array(await response.arrayBuffer());
      });
    },

    async confirm(agreementId: string, body: CollectedConfirmation): Promise<void> {
      return withTimeout(TIMEOUT_MS, async (signal) => {
        const response = await fetch(`${ingest}/signed/${agreementId}/collected`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
        if (!response.ok) {
          /*
           * A 400 HERE IS OURS TO FIX AND IS SAID SO. The platform re-checks
           * the hash before it will record that the practice holds the
           * document, so a refusal means what was filed is not what was
           * published — worth a loud line rather than a quiet retry, even
           * though the retry happens anyway.
           */
          if (response.status >= 400 && response.status < 500) {
            logger.error('collect.confirm_refused', { agreementId, status: response.status });
          }
          throw new Error(`The platform answered ${response.status} to a confirmation.`);
        }
      });
    },
  };
}

/** Exported for the startup banner: says where this half is pointed, without a credential. */
export function collectionEndpointsOf(config: AobPrinterConfig): { list: string; artefacts: string } {
  try {
    const ingest = config.endpoint.replace(/\/+$/, '');
    return { list: `${ingest}/signed`, artefacts: `${new URL(ingest).origin}/artefacts` };
  } catch (err) {
    return { list: redactError(err), artefacts: '' };
  }
}

/**
 * Where AOBPRINTER is pointed, and at whom.
 *
 * NOTHING HERE IS IN CODE OR IN A FIXTURE (CLAUDE.md §7). The practice id and
 * the endpoint are per-install facts that the installer writes and an
 * administrator can change; a build with a practice baked into it is a build
 * that can only be installed once.
 *
 * TRANSPORT IS AN OPEN GAP, AND IT IS SAID OUT LOUD RATHER THAN INVENTED.
 * `aob-tech-stack.md` gives the site connector outbound-only MUTUAL TLS with a
 * per-practice credential, revocable from the console, and AOBPRINTER is a
 * connector that happens to read a print spool instead of an API — so it should
 * have the same posture. It does not yet: this build sends the `x-practice-id`
 * header the endpoint already takes, over whatever the configured URL says.
 * That is enough to prove the channel on a bench and is NOT enough for a
 * practice. The certificate fields below are where the credential goes; they
 * are unread until the decision is made, and the program says so at startup.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_TEMPLATE_VERSION } from './template';

export interface AobPrinterConfig {
  /** The practice this install belongs to. Sent as `x-practice-id`. */
  readonly practiceId: string;
  /** Full URL of `POST /inbound/print-jobs`. */
  readonly endpoint: string;
  /** The single file path the AOBPRINTER port writes to. Every job overwrites it. */
  readonly spoolFile: string;
  /** Where claimed jobs, the outbox and the log live. */
  readonly dataDir: string;
  /** How often the spool file is looked at. */
  readonly pollMs: number;
  /** How long a job must stop growing before it is claimed. */
  readonly settleMs: number;
  readonly templateVersion: string;
  /** Reserved for the mutual-TLS credential; unread until that decision lands. */
  readonly clientCertPath?: string;
  readonly clientKeyPath?: string;
}

export const DEFAULT_DATA_DIR = 'C:\\ProgramData\\AoBPlatform';
export const DEFAULT_SPOOL_FILE = 'C:\\ProgramData\\AoBPlatform\\spool\\aobprinter-out.pdf';
export const DEFAULT_CONFIG_PATH = 'C:\\ProgramData\\AoBPlatform\\aobprinter.config.json';

function requireString(raw: Record<string, unknown>, key: string, path: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `${path} is missing "${key}". AOBPRINTER will not start without it: a practice id and an endpoint ` +
        'are per-install configuration and are never defaulted.',
    );
  }
  return value.trim();
}

function optionalNumber(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`"${key}" must be a positive number of milliseconds.`);
  }
  return value;
}

export function parseConfig(raw: unknown, path: string): AobPrinterConfig {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${path} is not a JSON object.`);
  const doc = raw as Record<string, unknown>;

  return {
    practiceId: requireString(doc, 'practiceId', path),
    endpoint: requireString(doc, 'endpoint', path),
    spoolFile: typeof doc.spoolFile === 'string' ? doc.spoolFile : DEFAULT_SPOOL_FILE,
    dataDir: typeof doc.dataDir === 'string' ? doc.dataDir : DEFAULT_DATA_DIR,
    pollMs: optionalNumber(doc, 'pollMs', 500),
    settleMs: optionalNumber(doc, 'settleMs', 750),
    templateVersion: typeof doc.templateVersion === 'string' ? doc.templateVersion : DEFAULT_TEMPLATE_VERSION,
    clientCertPath: typeof doc.clientCertPath === 'string' ? doc.clientCertPath : undefined,
    clientKeyPath: typeof doc.clientKeyPath === 'string' ? doc.clientKeyPath : undefined,
  };
}

export function loadConfig(path = process.env.AOBPRINTER_CONFIG ?? DEFAULT_CONFIG_PATH): AobPrinterConfig {
  return parseConfig(JSON.parse(readFileSync(path, 'utf8')), path);
}

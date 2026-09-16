/**
 * The log, and the redaction pass every line goes through.
 *
 * WHY A REDACTOR AND NOT JUST A RULE. This program is the one place in the
 * platform that holds a whole printed DB4 in memory — name, address, date of
 * birth, Medicare card number, IRN, the lot (D-2026-09-14-03). It also runs on
 * a receptionist's desktop, writing to a file somebody will one day email to
 * support. "Do not log PII" as a convention lasts until the first
 * three-in-the-morning debugging session; as a function every log line is
 * pushed through, it lasts.
 *
 * WHAT IS LOGGED: job ids, hashes, template versions, counts, HTTP status
 * codes, durations, state names. Things that answer "what happened" without
 * saying who it happened to (CLAUDE.md §6, hard rule 9).
 *
 * WHAT IS REDACTED: anything that looks like a Medicare card number, an IHI, a
 * phone number or any other long run of digits, wherever it appears — including
 * inside an error message from `fetch` or the filesystem, which is exactly
 * where an unredacted value would otherwise arrive. The patterns are
 * deliberately greedy: a redacted invoice total is a small loss, a logged
 * Medicare number is a reportable one.
 *
 * WHAT IS NEVER PASSED IN AT ALL: a parsed record, a page of extracted text, or
 * a patient's name. Redaction is the second line; not handing it the data is
 * the first. `logger.job()` takes a fixed set of fields for that reason.
 */

/** A hex-ish hash is 64 characters of [0-9a-f] and must survive redaction. */
const HASH = /^[0-9a-f]{8,64}$/;

/**
 * Replace every long digit run with a marker.
 *
 * ORDER MATTERS. The Medicare pattern runs first so that a card number printed
 * as "2999 88887 1" is replaced whole rather than leaving its trailing IRN
 * behind as a stray digit. What is left afterwards is any run of eight or more
 * digits separated by spaces, which covers an IHI and a phone number, and any
 * unbroken run of six or more.
 *
 * HYPHENS ARE A SEPARATOR ONLY FOR THE MEDICARE PATTERN, and that is a
 * correction, not a subtlety. The first version treated hyphens as a digit
 * separator everywhere, and the first real log line it produced read
 * `template=pracsoft3-db4-[redacted]` — it had eaten the parser template
 * version, and the claimed job's timestamp with it. Both are exactly what a
 * support call needs, and a redactor that destroys the diagnostics gets turned
 * off by the third person who needs one. A date or a version is
 * hyphen-separated; a card or phone number printed on a form is
 * space-separated. The Medicare rule keeps the hyphen because its shape
 * (4-5-1 digits) cannot be confused with a date, and it is the one value where
 * a miss is reportable.
 */
export function redact(value: string): string {
  if (HASH.test(value)) return value;
  return value
    .replace(/\b\d{4}[ -]?\d{5}[ -]?\d\b(?:\s*(?:IRN:?\s*)?\d\b)?/g, '[redacted]')
    .replace(/\b\d[\d ]{6,}\d\b/g, '[redacted]')
    .replace(/\b\d{6,}\b/g, '[redacted]');
}

/** An error, with its message redacted and its stack dropped. */
export function redactError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return redact(message).slice(0, 300);
}

export type LogFields = Record<string, string | number | boolean | undefined>;

function render(level: string, event: string, fields: LogFields): string {
  const parts = [`${new Date().toISOString()} ${level} ${redact(event)}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    /*
     * EVERY value, not just the string ones. The first version redacted strings
     * and passed numbers through with `String(value)`, on the reasoning that
     * every numeric field today is a count, a status code or a duration. That
     * reasoning is about today's call sites, and the promise this file makes is
     * about every line it will ever render — the next person to log a numeric
     * identifier would have had no idea they had stepped outside it.
     */
    parts.push(`${key}=${redact(String(value))}`);
  }
  return parts.join(' ');
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/**
 * A sink so tests can read what was written. Console by default; the installed
 * program points it at a rolling file.
 */
export type LogSink = (line: string) => void;

export function makeLogger(sink: LogSink): Logger {
  return {
    info: (event, fields = {}) => sink(render('INFO', event, fields)),
    warn: (event, fields = {}) => sink(render('WARN', event, fields)),
    error: (event, fields = {}) => sink(render('ERROR', event, fields)),
  };
}

export const consoleLogger: Logger = makeLogger((line) => console.error(line));

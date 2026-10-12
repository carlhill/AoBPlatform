/*
 * A BUSY MORNING AT XLEVELUP MEDICAL — ninety arrivals, three practitioner
 * queues, two tablets in use and six people already finished.  (DEV ONLY)
 *
 * WHY THIS EXISTS. Seven patients flatters every wide layout: short rails hide
 * the cost of five headings, and a desk that reads beautifully at seven can be
 * unusable at ninety. Carl asked for volume data to choose between
 * /practice/frontdesk and /practice/frontdesksmall on a REALISTIC morning —
 * one practitioner sees about thirty patients a day, so three practitioners is
 * ninety arrivals and ten would be three hundred.
 *
 *   cd apps/core && npx ts-node -T ../../scripts/dev/seed-busy-day.ts
 *
 * It ADDS to whatever is already there and deletes nothing. Re-running it adds
 * another ninety arrivals for the same ninety (stable) fake identities, which
 * is exactly what arrive.sh does and for the same reason: an arrival is an
 * event, and the same person can walk in twice.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS TYPESCRIPT AND NOT A .sh LIKE ITS NEIGHBOURS
 *
 * The arrivals go through the front door over HTTP, exactly as arrive.sh does
 * and for the reasons its header gives. But PUSHING TO A TABLET AND SIGNING
 * NEED AN ACTOR: `POST /tablet-sessions/devices/:id/push` refuses an
 * unattributed caller by design (`pushRefusals.noActor`), because a push
 * writes a staff-verified event and an audit line naming nobody is worse than
 * a refusal. There is no dev header that fakes one — `request.principal` is
 * set only by the auth guard from a verified token — so a shell script cannot
 * reach those two steps at all.
 *
 * So the script boots a Nest application context and calls the services
 * directly for those two steps, with a synthetic actor that says out loud that
 * it is a seed and not a person. Everything else stays on HTTP, because the
 * point of the exercise is the timing of the real endpoints.
 *
 * IT DISABLES THE SCHEDULERS IT INHERITS, immediately after boot. AppModule
 * registers `ScheduleModule.forRoot()` and a dozen `@Interval`/`@Cron` sweeps
 * (outbound sends, the vault relay, the chase sweep). Core is ALREADY RUNNING
 * on :3001 with all of them; a second copy inside this script would be a
 * second outbound worker against the same tables for as long as it lives.
 * `SchedulerRegistry` is emptied before the first tick can fire.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PRODUCES (targets; the run prints what it actually got)
 *
 *   90 arrivals today, ~30 in each of three practitioner queues
 *    6 finished   — pushed to a tablet, details confirmed, signed. Finished rail
 *    2 on tablets — pushed and left live, so two tablets are genuinely busy
 *    8 blocked    — assignor never confirmed, so "Needs a look" is not empty
 *    2 signed for by somebody other than the patient
 *   the rest ready to send
 *
 * THE THIRD QUEUE. XLEVELUP has only two live practitioner-at-a-location
 * affiliations, so the script creates a third practitioner through the
 * ordinary endpoints — POST /practitioners, POST /affiliations, and the
 * practitioner's own POST .../respond — rather than reviving the `ended`
 * Savva-at-Riverview row. It is idempotent on the AHPRA number: a second run
 * finds the affiliation and uses it.
 *
 * ---------------------------------------------------------------------------
 * AND IT MEASURES ITSELF, which may matter more than the data
 *
 * Every arrival locks particulars and renders a hashed PDF/A artefact, so
 * ninety of them is the first real load this pipeline has seen. The run prints
 * total wall clock, median / p95 / worst per arrival, the first ten against the
 * last ten (does it degrade as the day fills?), and the three page reads the
 * console makes — /tablet-sessions/pushable, /arrivals/day and
 * /practitioner-queue/waiting — timed BEFORE the ninety and again after.
 *
 * ---------------------------------------------------------------------------
 * Fake identities only. Ninety generated names, obviously invented family
 * names, @example.invalid addresses, and no Medicare number anywhere — there
 * is no column for one in this system and there never will be (hard rule 1).
 */

import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CONFIRMABLE_DETAIL_TYPES } from '@aobplatform/domain';
import { AppModule } from '../../apps/core/src/app.module';
import { TabletSessionsService } from '../../apps/core/src/tablet-sessions/tablet-sessions.service';
import { AgreementsService } from '../../apps/core/src/agreements/agreements.service';
import type { Actor } from '../../apps/core/src/auth/actor.decorator';
import type { ResolvedDevice } from '../../apps/core/src/devices/devices.service';

// --- what it talks to -------------------------------------------------------

const CORE = process.env.CORE ?? 'http://localhost:3001';
const PRACTICE_ID = process.env.PRACTICE_ID ?? '821709fb-7f89-4fcf-95c0-27c5eb55cec8'; // XLEVELUP Medical (dev)
const ARRIVALS = Number(process.env.ARRIVALS ?? 90);
/**
 * The prefix on every patient record number this run creates.
 *
 * IT IS THE IDENTITY SPACE, not decoration. The platform matches its patient
 * mirror on the practice's own record number, so two runs with the same prefix
 * are the same ninety people arriving twice — which is what you want. A
 * SMALLER trial run wants its own prefix (`RECORD_PREFIX=SMOKE ARRIVALS=6`),
 * because a patient who has already signed today may be decided `none` on a
 * second arrival, and that would quietly hollow out the real run.
 */
const RECORD_PREFIX = process.env.RECORD_PREFIX ?? 'BUSY';

/**
 * The two tablets this script is allowed to touch.
 *
 * `e1e2c073-…` "Carl browser tablet" IS DELIBERATELY ABSENT and must stay
 * absent: Carl drives the kiosk from it by hand, and a push from a seed would
 * take the screen out from under him mid-test.
 */
const TABLETS: readonly string[] = (
  process.env.TABLETS ??
  '4d390c73-1fd2-48bf-9dc6-e1a806208fae,461b9fca-d7c7-4633-85aa-5206f9dcbe30'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** The third practitioner this script creates if one does not exist yet. */
const THIRD = {
  ahpraNumber: 'MED9000000903',
  familyName: 'Notional',
  givenNames: 'Dr Omar',
  providerType: 'general_practitioner',
  email: 'omar.notional@example.invalid',
};

/**
 * WHO THE SEED SAYS IT IS. Not a person, and it says so in the name that lands
 * in the audit line — the same honesty `dev-seed.controller.ts` uses when it
 * conjures a tablet ("dev seed (not a human review)"). A seed that borrowed a
 * real staff member's name would put a fact in the vault that nobody did.
 */
const SEED_ACTOR: Actor = {
  id: 'dev-seed-busy-day',
  name: 'dev seed: busy day (not a person)',
  principalType: 'staff',
  roles: ['practice_admin'],
  practiceId: PRACTICE_ID,
  authMethod: 'unknown',
};

// --- the ninety -------------------------------------------------------------

/**
 * Ten given names by nine family names is ninety distinct people, generated
 * rather than hand-written, and every family name is a word no registrar has
 * ever issued a Medicare card to.
 */
const GIVEN = ['Ada', 'Bo', 'Cleo', 'Dara', 'Emin', 'Fern', 'Gus', 'Hana', 'Ivo', 'Juno'];
const FAMILY = [
  'Fictional',
  'Sampleton',
  'Placeholder',
  'Specimen',
  'Testcase',
  'Notional',
  'Dummyfield',
  'Exampleton',
  'Mockford',
];

const STREETS = [
  '2 Example Street, Sampletown NSW 2000',
  '7 Sample Road, Sampletown NSW 2000',
  '12 Placeholder Street, Sampletown NSW 2000',
  '3 Dummy Lane, Sampletown NSW 2000',
  '41 Notional Parade, Sampletown NSW 2000',
];

interface Person {
  index: number;
  fullName: string;
  givenNames: string;
  familyName: string;
  dateOfBirth: string;
  address: string;
  email: string;
  mobile: string;
  recordNumber: string;
}

function people(count: number): Person[] {
  const out: Person[] = [];
  for (let i = 0; i < count; i += 1) {
    const givenNames = GIVEN[i % GIVEN.length];
    const familyName = FAMILY[Math.floor(i / GIVEN.length) % FAMILY.length];
    // Deterministic, spread across adult ages, and never a real person's.
    const year = 1938 + ((i * 7) % 70);
    const month = String(1 + (i % 12)).padStart(2, '0');
    const day = String(1 + (i % 27)).padStart(2, '0');
    const slug = `${givenNames}-${familyName}`.toLowerCase();
    out.push({
      index: i,
      fullName: `${givenNames} ${familyName}`,
      givenNames,
      familyName,
      dateOfBirth: `${year}-${month}-${day}`,
      address: STREETS[i % STREETS.length],
      email: `${slug}@example.invalid`,
      // Obviously not a real range, and not an identifier either way: a mobile
      // is CONTACT, never one of the six approved identifiers (hard rule 1).
      mobile: `+6140000${String(1000 + i).slice(-4)}`,
      recordNumber: `${RECORD_PREFIX}-${slug.toUpperCase()}`,
    });
  }
  return out;
}

type Role = 'finished' | 'on_tablet' | 'blocked' | 'other_signer' | 'ready';

/**
 * How many of each, and WHY each number.
 *
 *   finished     — the morning's first six, already gone. The Finished rail
 *   on_tablet    — two tablets genuinely in someone's hands right now
 *   blocked      — nobody has answered "who is signing", so "Needs a look"
 *                  has something in it. This is the rail seven patients hide
 *   other_signer — a spouse signing, because assignorIsPatient is a real
 *                  discriminator and a desk that never shows one is untested
 */
const WANTED: ReadonlyArray<readonly [Role, number]> = [
  ['finished', 6],
  ['on_tablet', 2],
  ['other_signer', 2],
  // Last, because it is the largest and would otherwise eat every free slot
  // on a small trial run and leave the rarer kinds untested.
  ['blocked', 8],
];

/**
 * Deal the roles out at even intervals so no one practitioner's queue gets all
 * of a kind — the arrivals rotate through three affiliations, so a role landing
 * every third index would put every finished patient in one queue.
 */
function assignRoles(count: number): Role[] {
  const roles: Role[] = new Array<Role>(count).fill('ready');
  let cursor = 0;
  for (const [role, wanted] of WANTED) {
    const stride = Math.max(1, Math.floor(count / Math.max(1, wanted)));
    for (let n = 0; n < wanted; n += 1) {
      // Walk forward from the natural slot until an unclaimed one turns up, so
      // a small ARRIVALS (a trial run) degrades to "as many as fit" rather
      // than silently overwriting an earlier role.
      let at = (cursor + n * stride) % count;
      let tries = 0;
      while (roles[at] !== 'ready' && tries < count) {
        at = (at + 1) % count;
        tries += 1;
      }
      if (tries < count) roles[at] = role;
    }
    cursor += 1; // offset each kind so they interleave rather than stack
  }
  return roles;
}

// --- small helpers ----------------------------------------------------------

interface Timed<T> {
  ms: number;
  value: T;
}

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const started = performance.now();
  const value = await fn();
  return { ms: performance.now() - started, value };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[at];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ms(value: number): string {
  return `${value.toFixed(0)} ms`;
}

const HEADERS = { 'x-practice-id': PRACTICE_ID, 'content-type': 'application/json' };

/**
 * ONE CALL, RETRIED THROUGH A DROPPED CONNECTION.
 *
 * The dev core runs under a file watcher and restarts itself when another
 * agent saves a file; a run of ninety takes long enough to catch one, and on
 * 12 September one did — `ECONNRESET` at arrival 16 killed the whole seed and
 * left twenty-five orphans behind. Retrying is safe precisely because the
 * arrival carries an idempotency key: that field exists for a connector on a
 * practice's ADSL, and this is the same situation.
 */
async function api<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  attempt = 1,
): Promise<{ status: number; body: T }> {
  let response: Response;
  try {
    response = await fetch(`${CORE}${path}`, {
      method,
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (attempt >= 6) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    return api<T>(method, path, body, attempt + 1);
  }
  if ((response.status === 502 || response.status === 503) && attempt < 6) {
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    return api<T>(method, path, body, attempt + 1);
  }
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* left as text; the caller prints it */
  }
  return { status: response.status, body: parsed as T };
}

/**
 * The three reads the console makes, timed as one set.
 *
 * These are the numbers the exercise is FOR. A desk that takes two seconds to
 * load at ninety rows is a finding regardless of how the rails are laid out,
 * and it is invisible at seven.
 */
async function timePageReads(label: string): Promise<void> {
  const reads: Array<[string, string]> = [
    ['GET /tablet-sessions/pushable', '/tablet-sessions/pushable'],
    ['GET /arrivals/day', '/arrivals/day'],
    ['GET /practitioner-queue/waiting', '/practitioner-queue/waiting'],
  ];
  console.log(`\n  page reads — ${label}`);
  for (const [name, path] of reads) {
    // Three passes: the first pays for any cold plan, and a screen that is
    // refreshed all morning pays the warm price, so both are worth seeing.
    const runs: number[] = [];
    let rows = 0;
    for (let i = 0; i < 3; i += 1) {
      const run = await timed(() => api('GET', path));
      runs.push(run.ms);
      rows = countRows(run.value.body);
    }
    console.log(
      `    ${name.padEnd(34)} ${ms(runs[0]).padStart(9)} cold  ` +
        `${ms(Math.min(runs[1], runs[2])).padStart(9)} warm   ${rows} rows`,
    );
  }
}

function countRows(body: unknown): number {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows.length;
    if (Array.isArray(record.groups)) {
      return (record.groups as Array<{ rows?: unknown[] }>).reduce((n, g) => n + (g.rows?.length ?? 0), 0);
    }
  }
  return 0;
}

// --- the three queues -------------------------------------------------------

interface Affiliation {
  id: string;
  status: string;
  billingRole?: string;
  canCapture?: boolean;
  practitioner?: { practitionerId: string; familyName: string; givenNames: string; ahpraNumber: string };
  location?: { id: string; code?: string };
}

function nameOf(a: Affiliation): string {
  return a.practitioner ? `${a.practitioner.givenNames} ${a.practitioner.familyName}` : a.id.slice(0, 8);
}

/** Live and servicing — the affiliations an arrival may be anchored on. */
function liveServicing(all: readonly Affiliation[]): Affiliation[] {
  return all.filter(
    (a) => ['active', 'ending', 'invited'].includes(a.status) && a.billingRole === 'servicing_provider',
  );
}

/**
 * Three live servicing affiliations, creating the third through the ORDINARY
 * endpoints if it is not there yet.
 *
 * Not by reviving the `ended` Savva-at-Riverview row and not by SQL: a genuine
 * third practitioner exercises pre-registration, invitation and acceptance,
 * and puts a third distinct NAME on the screen — which is what the layout
 * decision is actually looking at.
 */
async function threeQueues(): Promise<Affiliation[]> {
  const listed = await api<Affiliation[]>('GET', '/affiliations');
  const all: Affiliation[] = Array.isArray(listed.body) ? listed.body : [];
  const live = liveServicing(all);
  if (live.length >= 3) {
    console.log(`  three queues already: ${live.slice(0, 3).map(nameOf).join(', ')}`);
    return live.slice(0, 3);
  }

  const locationId = live[0]?.location?.id;
  if (!locationId) throw new Error('No live affiliation to take a location from. Set the practice up first.');

  console.log(`  only ${live.length} live queues — creating a third practitioner through the ordinary endpoints`);

  // 1. Pre-register the identity. A ConflictException means a previous run
  //    already made them, which is the idempotent case and not an error.
  const pre = await api('POST', '/practitioners', THIRD);
  if (pre.status >= 400 && pre.status !== 409) {
    throw new Error(`POST /practitioners refused (${pre.status}): ${JSON.stringify(pre.body)}`);
  }
  console.log(`    practitioner ${THIRD.givenNames} ${THIRD.familyName}: ${pre.status === 409 ? 'already there' : 'created'}`);

  // 2. The practice invites them to a location.
  const invited = await api<{ id?: string }>('POST', '/affiliations', {
    ahpraNumber: THIRD.ahpraNumber,
    locationId,
    invitedByName: 'dev seed: busy day (not a person)',
  });
  if (invited.status >= 400) {
    throw new Error(`POST /affiliations refused (${invited.status}): ${JSON.stringify(invited.body)}`);
  }

  // 3. The PRACTITIONER answers — a practice cannot accept on their behalf,
  //    which is why this is a separate call on a practitioner-owned route.
  const afterInvite = await api<Affiliation[]>('GET', '/affiliations');
  const theirs = (Array.isArray(afterInvite.body) ? afterInvite.body : []).find(
    (a) => a.practitioner?.ahpraNumber === THIRD.ahpraNumber,
  );
  if (theirs?.practitioner && theirs.status === 'invited') {
    const answered = await api(
      'POST',
      `/practitioners/${theirs.practitioner.practitionerId}/affiliations/${theirs.id}/respond`,
      { decision: 'accept' },
    );
    console.log(`    affiliation accepted: ${answered.status < 400 ? 'yes' : `no (${answered.status}) — stays "invited", which still anchors an arrival`}`);
  }

  const again = await api<Affiliation[]>('GET', '/affiliations');
  const nowLive = liveServicing(Array.isArray(again.body) ? again.body : []);
  if (nowLive.length < 3) {
    throw new Error(`Still only ${nowLive.length} live servicing affiliations. Cannot build three queues.`);
  }
  console.log(`    three queues: ${nowLive.slice(0, 3).map(nameOf).join(', ')}`);
  return nowLive.slice(0, 3);
}

// --- the run ----------------------------------------------------------------

async function main(): Promise<void> {
  // The Sydney calendar day, which is the day /arrivals/day answers for.
  const runTag = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
  console.log(`A busy morning at ${PRACTICE_ID} — ${ARRIVALS} arrivals, three queues, two tablets, six finished.`);
  console.log(`Core: ${CORE}\n`);

  // BEFORE. Whatever is on the screens now — today's seven — is the baseline
  // the ninety are measured against.
  await timePageReads('before (today as it stands)');

  console.log('\n  queues');
  const queues = await threeQueues();

  const cohort = people(ARRIVALS);
  console.log(`\n  arrivals — ${ARRIVALS} through POST /arrivals, source "reception"`);

  /*
   * WHEN THEY ARRIVED. Spread back across the morning so the queues look like a
   * morning rather than like a script, and clamped so nothing lands before
   * midnight in Sydney — /arrivals/day is a Sydney calendar day, and an arrival
   * an hour the wrong side of it simply would not appear.
   */
  const now = Date.now();
  const spanMs = Math.min(4 * 3600_000, Math.max(0, now - startOfSydneyDay(now) - 60_000));
  const gap = spanMs / Math.max(1, ARRIVALS);

  const durations: number[] = [];
  const refusals: string[] = [];
  for (const person of cohort) {
    const arrivedAt = new Date(now - Math.round((ARRIVALS - person.index) * gap)).toISOString();
    const run = await timed(() =>
      api<{ arrivalId?: string; reason?: string; message?: string; decision?: { type: string } }>(
        'POST',
        '/arrivals',
        {
          pmsPatientRecordNumber: person.recordNumber,
          familyName: person.familyName,
          givenNames: person.givenNames,
          dateOfBirth: person.dateOfBirth,
          address: person.address,
          mobile: person.mobile,
          email: person.email,
          affiliationId: queues[person.index % queues.length].id,
          arrivedAt,
          source: 'reception',
          /*
           * DETERMINISTIC, PER PERSON PER DAY — so a run interrupted halfway
           * TOPS UP rather than duplicating when it is started again. A random
           * per-run tag looks tidier and is the wrong answer: the first
           * interrupted run of this script left twenty-five arrivals that no
           * later run could recognise as its own.
           *
           * The cost is worth stating: a SECOND full run on the same day is
           * then measuring the dedupe path, not the create path. Use a fresh
           * RECORD_PREFIX when the timing is what you are after.
           */
          idempotencyKey: `busy-day-${runTag}-${person.recordNumber}`,
        },
      ),
    );
    durations.push(run.ms);
    if (!run.value.body?.arrivalId) {
      refusals.push(`${person.fullName}: ${run.value.body?.reason ?? run.value.status} ${run.value.body?.message ?? ''}`);
    }
    if ((person.index + 1) % 15 === 0) {
      console.log(`    ${String(person.index + 1).padStart(3)} arrived   last: ${ms(run.ms)}`);
    }
  }

  reportArrivalTiming(durations, refusals);

  // WHO IS SIGNING. The arrival deliberately leaves this unanswered — nobody
  // has been asked yet — so this is the desk's answer, given for everybody
  // except the handful left blocked on purpose.
  console.log('\n  who is signing');
  const day = await api<{ rows: Array<{ patientRecordNumber: string; agreementId: string | null }> }>(
    'GET',
    '/arrivals/day',
  );
  const agreementByRecord = new Map<string, string>();
  for (const row of day.body?.rows ?? []) {
    if (row.agreementId) agreementByRecord.set(row.patientRecordNumber, row.agreementId);
  }

  const dealt = assignRoles(cohort.length);
  const roles = new Map<string, Role>();
  let confirmed = 0;
  let leftBlocked = 0;
  let others = 0;
  let noAgreement = 0;
  for (const person of cohort) {
    const role = dealt[person.index];
    roles.set(person.recordNumber, role);
    const agreementId = agreementByRecord.get(person.recordNumber);
    if (!agreementId) noAgreement += 1;
    if (!agreementId) continue;
    if (role === 'blocked') {
      leftBlocked += 1;
      continue; // "Needs a look" needs somebody in it
    }
    if (role === 'other_signer') {
      const answered = await api('POST', `/agreements/${agreementId}/assignor`, {
        assignorIsPatient: false,
        name: `Robin ${person.familyName}`,
        authorityBasis: 'spouse',
        relationship: 'spouse',
        declaresEighteenOrOver: true,
        mobile: '+61400000111',
      });
      if (answered.status < 400) others += 1;
      continue;
    }
    const answered = await api('POST', `/agreements/${agreementId}/assignor`, { assignorIsPatient: true });
    if (answered.status < 400) confirmed += 1;
  }
  console.log(
    `    ${confirmed} the patient, ${others} somebody else, ${leftBlocked} left unanswered on purpose` +
      (noAgreement ? `, ${noAgreement} with no agreement of their own today` : ''),
  );

  // TABLETS AND SIGNATURES. In-process from here — see the header.
  await tabletPhase(cohort, roles, agreementByRecord);

  // AFTER.
  await timePageReads(`after (${ARRIVALS} more arrivals)`);

  console.log('\n  what to open');
  console.log('    http://localhost:3100/practice/frontdesk');
  console.log('    http://localhost:3100/practice/frontdesksmall');
  console.log('    http://localhost:3100/practice/practitioner/waiting');
}

/** Midnight in Australia/Sydney, as a UTC epoch, without pulling in a tz library. */
function startOfSydneyDay(at: number): number {
  const sydney = new Date(at).toLocaleString('en-CA', {
    timeZone: 'Australia/Sydney',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const [, time] = sydney.split(', ');
  const [h, m, s] = time.split(':').map(Number);
  return at - ((h % 24) * 3600 + m * 60 + s) * 1000;
}

function reportArrivalTiming(durations: number[], refusals: string[]): void {
  const sorted = [...durations].sort((a, b) => a - b);
  const total = durations.reduce((a, b) => a + b, 0);
  const firstTen = durations.slice(0, 10);
  const lastTen = durations.slice(-10);
  console.log('\n  arrival timing');
  console.log(`    total wall clock       ${(total / 1000).toFixed(1)} s for ${durations.length}`);
  console.log(`    median                 ${ms(percentile(sorted, 50))}`);
  console.log(`    p95                    ${ms(percentile(sorted, 95))}`);
  console.log(`    worst                  ${ms(sorted[sorted.length - 1] ?? 0)}`);
  console.log(`    best                   ${ms(sorted[0] ?? 0)}`);
  console.log(`    first 10 mean          ${ms(mean(firstTen))}`);
  console.log(`    last 10 mean           ${ms(mean(lastTen))}`);
  const drift = mean(lastTen) - mean(firstTen);
  console.log(
    `    degradation            ${drift >= 0 ? '+' : ''}${drift.toFixed(0)} ms ` +
      `(${((drift / Math.max(1, mean(firstTen))) * 100).toFixed(0)}% ${drift >= 0 ? 'slower' : 'faster'} by the end)`,
  );
  if (refusals.length > 0) {
    console.log(`    REFUSED                ${refusals.length}`);
    for (const line of refusals.slice(0, 10)) console.log(`      ${line}`);
  }
}

/**
 * The two steps HTTP cannot reach: pushing a locked agreement to a tablet, and
 * the signature that follows. Both need an attributed actor.
 */
async function tabletPhase(
  cohort: readonly Person[],
  roles: ReadonlyMap<string, Role>,
  agreementByRecord: ReadonlyMap<string, string>,
): Promise<void> {
  console.log('\n  tablets and signatures (in-process — the HTTP push refuses an unattributed caller)');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  /*
   * SILENCE THE INHERITED SWEEPS BEFORE THEY FIRE. Core is already running
   * every one of these on :3001; a second copy would be a second outbound
   * worker and a second vault relay against the same tables.
   */
  const scheduler = app.get(SchedulerRegistry);
  for (const name of [...scheduler.getIntervals()]) scheduler.deleteInterval(name);
  for (const name of [...scheduler.getTimeouts()]) scheduler.deleteTimeout(name);
  for (const [name] of [...scheduler.getCronJobs()]) scheduler.deleteCronJob(name);

  const sessions = app.get(TabletSessionsService);
  const agreements = app.get(AgreementsService);

  const device = (deviceId: string): ResolvedDevice => ({
    deviceId,
    practiceId: PRACTICE_ID,
    label: 'seeded',
    showsWaitingList: false,
    acceptsWalkUps: false,
  });

  /*
   * FREE THE TWO SEED TABLETS FIRST.
   *
   * One tablet shows one patient, so a session left live by an earlier run
   * refuses every push after it and the whole phase silently produces nothing.
   * Recall is the console's own act and it is what a receptionist would do
   * with a tablet somebody walked away from. Only ever the two tablets named
   * in TABLETS — Carl's browser tablet is not one of them and must not be.
   */
  for (const deviceId of TABLETS) {
    const live = await sessions.currentFor(device(deviceId));
    const sessionId = (live.session as { id?: string } | null)?.id;
    if (!sessionId) continue;
    await sessions.recall(PRACTICE_ID, sessionId, SEED_ACTOR).catch(() => undefined);
    console.log(`    recalled a session left on ${deviceId.slice(0, 8)} by an earlier run`);
  }

  const finished = cohort.filter((p) => roles.get(p.recordNumber) === 'finished');
  const onTablet = cohort.filter((p) => roles.get(p.recordNumber) === 'on_tablet');

  let signed = 0;
  const signTimes: number[] = [];
  const pushTimes: number[] = [];

  // The six who are already done. Each one takes a tablet, confirms their
  // details and signs, which frees the tablet for the next — the same sequence
  // a morning actually runs, and the reason six people share two devices.
  for (const [i, person] of finished.entries()) {
    const agreementId = agreementByRecord.get(person.recordNumber);
    if (!agreementId) continue;
    const deviceId = TABLETS[i % TABLETS.length];
    try {
      const push = await timed(() => sessions.push(PRACTICE_ID, deviceId, agreementId, SEED_ACTOR));
      pushTimes.push(push.ms);
      const sessionId = (push.value as { id: string }).id;
      // Every row on K-3 ticked. TYPES, never values — the record says which
      // details were shown and answered, and nothing about what they said.
      await sessions.confirmDetails(device(deviceId), sessionId, [...CONFIRMABLE_DETAIL_TYPES], []);

      /*
       * THE STATEMENT KEYS COME OFF THE STORED DOCUMENT, which is where the
       * kiosk and the remote link both read them from. A signature is a
       * signature to what the document SAYS, so the server refuses one that
       * does not carry every statement of the template the agreement was
       * rendered from — and it is right to. Reading the practice's CURRENT
       * template instead would be reading a different document.
       */
      const stored = await agreements.get(PRACTICE_ID, agreementId);
      const statements =
        (stored.renderPayload as { template?: { statements?: Array<{ key: string }> } } | null)?.template
          ?.statements ?? [];

      const sign = await timed(() =>
        agreements.sign(PRACTICE_ID, agreementId, {
          method: 'tap_to_approve',
          channel: 'in_practice',
          affirmations: statements.map((s) => s.key),
        }),
      );
      signTimes.push(sign.ms);
      signed += 1;
    } catch (err) {
      console.log(`    ${person.fullName}: ${(err as Error).message.slice(0, 160)}`);
    }
  }

  // And the two still holding a tablet when Carl looks at the screen.
  let live = 0;
  for (const [i, person] of onTablet.entries()) {
    const agreementId = agreementByRecord.get(person.recordNumber);
    if (!agreementId) continue;
    const deviceId = TABLETS[i % TABLETS.length];
    try {
      const push = await timed(() => sessions.push(PRACTICE_ID, deviceId, agreementId, SEED_ACTOR));
      pushTimes.push(push.ms);
      live += 1;
    } catch (err) {
      console.log(`    ${person.fullName}: ${(err as Error).message.slice(0, 160)}`);
    }
  }

  console.log(`    ${signed} signed, ${live} still on a tablet`);
  if (pushTimes.length) console.log(`    push  mean ${ms(mean(pushTimes))}  worst ${ms(Math.max(...pushTimes))}`);
  if (signTimes.length) console.log(`    sign  mean ${ms(mean(signTimes))}  worst ${ms(Math.max(...signTimes))}`);

  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

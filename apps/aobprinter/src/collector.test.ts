/**
 * Filing a signed form into the PMS's document-import folder.
 *
 * WHAT THESE PIN, and every one of them is a way a practice loses or
 * misplaces a signed consent rather than a way this code looks untidy:
 *
 *  - The pair lands at `<chart>/<reference>.pdf` and `.json`, which is the
 *    practice's own folder and the practice's own filename (DB4-AND-AOBL.md
 *    §6a). Get either wrong and the document is in a stranger's record.
 *  - A page whose hash disagrees is NEVER written. Hard rule 13 applied to a
 *    copy: what is filed must be the bytes the platform rendered and hashed.
 *  - A folder or filename that is not a plain name is REFUSED, not repaired.
 *    Both come off the wire, and `..` in either is a signed consent written
 *    somewhere nobody will ever look — or over something that mattered.
 *  - The confirmation carries the hash of what is ON DISK. `writtenBackAt` is
 *    the platform's claim that the practice HOLDS the document.
 *  - Nothing it does can throw at the loop that captures forms (hard rule 8),
 *    and nothing it logs names a patient (hard rule 9, REQ-LOG-08).
 *
 * The client is a stub. What is under test is what this code does with an
 * answer, not whether Node can make a request — the HTTP half is its own
 * file, the same split the poster's tests make.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SignedFormForCollection } from '@aobplatform/contracts';
import { Collector, type CollectionClient } from './collector';
import { makeLogger } from './log';

const CHART = '00680';
const REFERENCE = 'HSS0610012092026120300';
const PAGE = Buffer.from('%PDF-1.7 a signed reproduction of the practice DB4', 'utf8');
const PAGE_SHA = createHash('sha256').update(PAGE).digest('hex');

function aRow(over: Partial<SignedFormForCollection> = {}): SignedFormForCollection {
  return {
    agreementId: '11111111-2222-4333-8444-555555555555',
    patientRecordNumber: CHART,
    formReference: REFERENCE,
    artefactId: '99999999-8888-4777-8666-555555555555',
    sha256: PAGE_SHA,
    signedAt: '2026-09-28T02:00:00.000Z',
    rendererVersion: 'signed-db4-1',
    contentVersion: 'signed-db4-2026-09-1',
    formCode: 'DB4',
    ...over,
  };
}

interface Stub extends CollectionClient {
  readonly downloads: string[];
  readonly confirmations: { agreementId: string; artefactSha256: string; pmsDocumentKey: string }[];
}

function aClient(rows: SignedFormForCollection[], over: Partial<CollectionClient> = {}): Stub {
  const downloads: string[] = [];
  const confirmations: Stub['confirmations'] = [];
  return {
    downloads,
    confirmations,
    async pending() {
      return rows;
    },
    async download(artefactId) {
      downloads.push(artefactId);
      return new Uint8Array(PAGE);
    },
    async confirm(agreementId, body) {
      confirmations.push({ agreementId, ...body });
    },
    ...over,
  };
}

describe('filing a signed form back into the PMS', () => {
  let root: string;
  let lines: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aob-collect-'));
    lines = [];
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const collectorFor = (client: CollectionClient) =>
    new Collector(client, root, makeLogger((line) => lines.push(line)), '1.2.3', () => new Date('2026-09-28T03:00:00.000Z'));

  it('a_signed_form_lands_in_the_chart_folder_beside_its_manifest', async () => {
    const client = aClient([aRow()]);
    const result = await collectorFor(client).sweep();

    expect(result).toEqual({ filed: 1, skipped: 0, failed: 0 });

    // THE FOLDER IS THE CHART NUMBER, THE FILENAME IS THE FORM REFERENCE.
    const pdf = join(root, CHART, `${REFERENCE}.pdf`);
    expect(readFileSync(pdf).equals(PAGE)).toBe(true);

    /*
     * AND THE MANIFEST BESIDE IT, so the folder can be checked without us:
     * a practice, an auditor or a support engineer holding the file can tie
     * it to the agreement, to the form PracSoft printed and to the hash the
     * platform holds, with no call to anybody.
     */
    const manifest = JSON.parse(readFileSync(join(root, CHART, `${REFERENCE}.json`), 'utf8'));
    expect(manifest).toEqual({
      formReference: REFERENCE,
      patientRecordNumber: CHART,
      agreementId: aRow().agreementId,
      signedAt: '2026-09-28T02:00:00.000Z',
      sha256: PAGE_SHA,
      rendererVersion: 'signed-db4-1',
      contentVersion: 'signed-db4-2026-09-1',
      formCode: 'DB4',
      collectedAt: '2026-09-28T03:00:00.000Z',
      printerVersion: '1.2.3',
    });
  });

  it('the_confirmation_carries_the_hash_of_what_is_on_disk', async () => {
    /*
     * NOT THE HASH THAT ARRIVED. The platform will record that the practice
     * HOLDS this document; a truncated write or a mangled file has to be
     * caught here, and the only way to catch it is to read back what was
     * written.
     */
    const client = aClient([aRow()]);
    await collectorFor(client).sweep();

    expect(client.confirmations).toEqual([
      {
        agreementId: aRow().agreementId,
        artefactSha256: PAGE_SHA,
        pmsDocumentKey: `${CHART}/${REFERENCE}.pdf`,
      },
    ]);
  });

  it('a_page_whose_hash_disagrees_is_never_written_and_never_confirmed', async () => {
    const client = aClient([aRow()], {
      async download() {
        return new Uint8Array(Buffer.from('not the page that was hashed', 'utf8'));
      },
    });
    const result = await collectorFor(client).sweep();

    expect(result).toEqual({ filed: 0, skipped: 0, failed: 1 });
    expect(existsSync(join(root, CHART, `${REFERENCE}.pdf`))).toBe(false);
    expect(client.confirmations).toEqual([]);
  });

  it.each([
    ['..', 'a parent'],
    ['../../Windows', 'a traversal'],
    ['C:\\Windows\\System32', 'an absolute path'],
    ['with space', 'a space'],
    ['', 'nothing at all'],
  ])('a_folder_name_that_is_%s_is_refused_rather_than_repaired', async (folder) => {
    /*
     * THE FOLDER AND THE FILENAME COME OFF THE WIRE. A value we had to repair
     * is a value we did not understand, and guessing at where a signed
     * consent goes is the one mistake with no recovery — so it is refused,
     * the row stays on the platform's list, and FR-9.3's staleness alert asks
     * a human what this practice's folders are really called.
     */
    const client = aClient([aRow({ patientRecordNumber: folder })]);
    const result = await collectorFor(client).sweep();

    expect(result).toEqual({ filed: 0, skipped: 0, failed: 1 });
    expect(client.downloads).toEqual([]);
    expect(client.confirmations).toEqual([]);
  });

  it('a_form_reference_that_is_a_path_is_refused_too', async () => {
    const client = aClient([aRow({ formReference: '../../../autoexec' })]);
    expect(await collectorFor(client).sweep()).toEqual({ filed: 0, skipped: 0, failed: 1 });
    expect(client.confirmations).toEqual([]);
  });

  it('a_form_already_on_disk_is_confirmed_again_without_being_downloaded_again', async () => {
    /*
     * THE RESUMABLE CASE, and the reason the whole thing is at-least-once. A
     * sweep that wrote the pair and died before confirming — or whose
     * confirmation was lost on the wire — must not re-fetch a megabyte and
     * must not rewrite a file the PMS may already have picked up. The bytes
     * are hashed where they lie and only the confirmation is repeated.
     */
    mkdirSync(join(root, CHART), { recursive: true });
    writeFileSync(join(root, CHART, `${REFERENCE}.pdf`), PAGE);

    const client = aClient([aRow()]);
    expect(await collectorFor(client).sweep()).toEqual({ filed: 1, skipped: 0, failed: 0 });
    expect(client.downloads).toEqual([]);
    expect(client.confirmations).toHaveLength(1);
  });

  it('a_file_of_that_name_that_is_not_ours_is_replaced', async () => {
    /*
     * A SUPERSEDED FORM, RE-RENDERED. The filename is the FORM's reference
     * and the newest signed reproduction of that form is what the record
     * should hold — so this overwrites rather than refusing, which is the one
     * case where writing over something is right.
     */
    mkdirSync(join(root, CHART), { recursive: true });
    writeFileSync(join(root, CHART, `${REFERENCE}.pdf`), Buffer.from('an older reproduction', 'utf8'));

    const client = aClient([aRow()]);
    expect(await collectorFor(client).sweep()).toEqual({ filed: 1, skipped: 0, failed: 0 });
    expect(client.downloads).toHaveLength(1);
    expect(readFileSync(join(root, CHART, `${REFERENCE}.pdf`)).equals(PAGE)).toBe(true);
  });

  it('a_confirmation_that_fails_leaves_the_file_and_reports_a_failure', async () => {
    // The row stays published, so the next sweep finds it and tries again.
    const client = aClient([aRow()], {
      async confirm() {
        throw new Error('the platform answered 503');
      },
    });
    expect(await collectorFor(client).sweep()).toEqual({ filed: 0, skipped: 0, failed: 1 });
    expect(readFileSync(join(root, CHART, `${REFERENCE}.pdf`)).equals(PAGE)).toBe(true);
  });

  it('a_platform_that_cannot_be_asked_is_not_an_exception', async () => {
    /*
     * HARD RULE 8. The caller is a timer, and an unhandled rejection from a
     * timer takes the process down — which would stop this program capturing
     * forms because it could not file one. Filing is the less urgent half.
     */
    const client = aClient([], {
      async pending() {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(collectorFor(client).sweep()).resolves.toEqual({ filed: 0, skipped: 0, failed: 0 });
  });

  it('nothing_it_logs_names_the_patient_or_the_form', async () => {
    /*
     * HARD RULE 9 (REQ-LOG-08), the same discipline `receipts.ts` keeps. The
     * chart number is the folder and the form reference is the filename, and
     * neither belongs in a log line: an agreement id and eight characters of
     * a hash are enough to trace one.
     */
    const client = aClient([aRow(), aRow({ patientRecordNumber: '../oops' })]);
    await collectorFor(client).sweep();

    const everything = lines.join('\n');
    expect(everything).not.toContain(CHART);
    expect(everything).not.toContain(REFERENCE);
    // And it did say something, so the assertions above are not vacuous.
    expect(everything).toContain('collect.filed');
    expect(everything).toContain('collect.unsafe_name');
  });
});

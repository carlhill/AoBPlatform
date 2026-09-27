import { SIGNED_DB4_CONTENT_VERSION } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { SignedDb4Service } from './signed-db4.service';
import { SignedDb4Renderer } from '../render/signed-db4-renderer';
import type { PrismaService } from '../prisma/prisma.service';
import type { ArtefactsService } from '../artefacts/artefacts.service';
import type { RendererRegistry } from '../render/renderer-registry';
import type { PrintRecordsService } from '../inbound/print-records.service';

jest.mock('@aobplatform/vault-client', () => ({ enqueueVaultEvent: jest.fn().mockResolvedValue(undefined) }));

/**
 * PRODUCING THE SIGNED-DB4 — the gate in front of it, and the promise that a
 * failure here costs nothing.
 *
 * Two named tests carry the weight. `a_signed_db4_is_only_produced_for_an_
 * agreement_that_came_from_a_db4` is the gate: without a source print job
 * there is no form to reproduce, and assembling one from an agreement's own
 * particulars would be a page we invented wearing the government's layout.
 * `a_failed_signed_db4_render_never_unsigns_the_agreement` is hard rule 8: by
 * the time this runs the signature has committed, and nothing in this service
 * may take it back, delay it, or make a caller think it failed.
 */

const PRACTICE = '33333333-3333-4333-8333-333333333333';
const AGREEMENT = '44444444-4444-4444-8444-444444444444';
const PRINT_JOB = '55555555-5555-4555-8555-555555555555';
const MARK_SHA = 'a'.repeat(64);
const RENDER_SHA = 'b'.repeat(64);
const ARTEFACT_ID = '66666666-6666-4666-8666-666666666666';

type AgreementRow = {
  id: string;
  status: string;
  sourcePrintJobId: string | null;
  signatureEventId: string | null;
  signedDb4Sha256: string | null;
  renderedLanguages: string[];
};

function signedFromDb4(overrides: Partial<AgreementRow> = {}): AgreementRow {
  return {
    id: AGREEMENT,
    status: 'stored',
    sourcePrintJobId: PRINT_JOB,
    signatureEventId: '77777777-7777-4777-8777-777777777777',
    signedDb4Sha256: null,
    renderedLanguages: ['en'],
    ...overrides,
  };
}

/** The bare minimum the renderer is handed. The renderer's own spec draws it. */
function envelope() {
  return {
    documentType: 'db4_assignment',
    sourceSha256: '0'.repeat(64),
    parserTemplateVersion: 'pracsoft3-db4-2026-09-1',
    pms: 'pracsoft3',
    capturedAt: '2026-09-12T02:03:41.000Z',
    heading: { lines: ['MEDICARE - ONLINE CLAIMING'] },
    form: { formCode: 'DB4', formReference: 'TEST0001' },
    patient: { patientRecordNumber: '00001', givenNames: 'Alex', familyName: 'Testpatient' },
    services: [{ mbsItemNumber: '23', benefitAssigned: '45.05' }],
  };
}

function serviceWith(options: {
  agreement?: AgreementRow | null;
  signatureRasterSha256?: string | null;
  printRecord?: unknown;
  render?: jest.Mock;
  /** 0 when somebody else claimed the row while this render was in flight. */
  claimedCount?: number;
}) {
  const agreement = options.agreement === undefined ? signedFromDb4() : options.agreement;
  const tx = {
    agreement: {
      findFirst: jest.fn().mockResolvedValue(agreement),
      updateMany: jest.fn().mockResolvedValue({ count: options.claimedCount ?? 1 }),
      update: jest.fn().mockResolvedValue({ id: AGREEMENT }),
    },
    signatureEvent: {
      findFirst: jest.fn().mockResolvedValue({
        signatureRasterSha256:
          options.signatureRasterSha256 === undefined ? MARK_SHA : options.signatureRasterSha256,
        method: 'drawn',
        channel: 'in_practice',
        createdAt: new Date('2026-09-12T02:10:00.000Z'),
      }),
    },
  };
  const prisma = {
    withPractice: jest.fn().mockImplementation((_id: string, run: (t: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaService;

  const stage = jest.fn().mockResolvedValue({ sha256: RENDER_SHA, purpose: 'signed_db4' });
  const recordStaged = jest.fn().mockResolvedValue({ id: ARTEFACT_ID, sha256: RENDER_SHA });
  const artefacts = { stage, recordStaged } as unknown as ArtefactsService;

  const render =
    options.render ??
    jest.fn().mockResolvedValue({
      bytes: Buffer.from('%PDF-1.3 pretend'),
      sha256: RENDER_SHA,
      rendererVersion: SignedDb4Renderer.VERSION,
      mediaType: 'application/pdf',
    });
  const get = jest.fn().mockReturnValue({ render });
  const renderers = { get } as unknown as RendererRegistry;

  const envelopeFor = jest
    .fn()
    .mockResolvedValue(options.printRecord === undefined ? envelope() : options.printRecord);
  const printRecords = { envelopeFor } as unknown as PrintRecordsService;

  return {
    service: new SignedDb4Service(prisma, artefacts, renderers, printRecords),
    tx,
    stage,
    recordStaged,
    render,
    get,
    envelopeFor,
  };
}

beforeEach(() => (enqueueVaultEvent as jest.Mock).mockClear());

describe('a_signed_db4_is_only_produced_for_an_agreement_that_came_from_a_db4', () => {
  /**
   * THE GATE, AND IT IS A NULL COLUMN RATHER THAN A CONDITION SOMEBODY HAS TO
   * REMEMBER. Most agreements in this platform never came from a printed form
   * — the waiting-room kiosk, an enduring agreement, a telehealth
   * pre-agreement — and for every one of them there is simply nothing to
   * reproduce.
   */
  it('produces nothing when the agreement has no source print job', async () => {
    const { service, tx, stage, envelopeFor } = serviceWith({
      agreement: signedFromDb4({ sourcePrintJobId: null }),
    });

    const outcome = await service.produce(PRACTICE, AGREEMENT);

    expect(outcome).toEqual({ produced: false, reason: 'not_from_a_db4' });
    // It did not read the form, did not render, did not store, did not write.
    expect(envelopeFor).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
    expect(tx.agreement.update).not.toHaveBeenCalled();
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
    expect(enqueueVaultEvent).not.toHaveBeenCalled();
  });

  it('produces one when it did come from a DB4, and records what made it', async () => {
    const { service, tx, stage, recordStaged, get } = serviceWith({});

    const outcome = await service.produce(PRACTICE, AGREEMENT);

    expect(outcome).toEqual({
      produced: true,
      artefactId: ARTEFACT_ID,
      sha256: RENDER_SHA,
      rendererVersion: SignedDb4Renderer.VERSION,
      contentVersion: SIGNED_DB4_CONTENT_VERSION,
    });

    // Resolved by NAME through the registry, never `current()` — which is and
    // stays the renderer every ordinary agreement locks under (rules 13/14).
    expect(get).toHaveBeenCalledWith(SignedDb4Renderer.VERSION);
    expect(stage).toHaveBeenCalledWith(
      PRACTICE,
      expect.objectContaining({ purpose: 'signed_db4', subjectType: 'Agreement', subjectId: AGREEMENT }),
    );
    expect(recordStaged).toHaveBeenCalled();

    /*
     * THE CLAIM IS FILTERED ON THE ROW STILL BEING UNCLAIMED. That filter is
     * what makes two concurrent asks produce one document rather than two.
     */
    const claim = tx.agreement.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: AGREEMENT, signedDb4Sha256: null });
    const written = { ...claim.data, ...tx.agreement.update.mock.calls[0][0].data };
    expect(written.signedDb4ArtefactId).toBe(ARTEFACT_ID);
    expect(written.signedDb4Sha256).toBe(RENDER_SHA);
    expect(written.signedDb4RendererVersion).toBe(SignedDb4Renderer.VERSION);
    // HARD RULE 14: which wording produced this page, recorded on the row.
    expect(written.signedDb4ContentVersion).toBe(SIGNED_DB4_CONTENT_VERSION);
    // And the whole render input, so a re-render never depends on the current
    // content file (hard rule 13).
    expect(written.signedDb4RenderPayload.kind).toBe('signed_db4');
    expect(written.signedDb4RenderPayload.content.version).toBe(SIGNED_DB4_CONTENT_VERSION);

    // The signed agreement itself is not touched — no status, no particulars,
    // no rendered hash, no signature event.
    for (const key of ['status', 'particulars', 'renderedArtefactHash', 'signatureEventId']) {
      expect(written).not.toHaveProperty(key);
    }
  });

  /**
   * THE LINK REACHES THE VAULT AT THE MOMENT IT BECOMES EVIDENCE — which is
   * here, when the reproduction is made, and not when the column was written.
   * Ids, hashes and versions only: no name, no chart number, and emphatically
   * not the Medicare card number that is on the page itself (hard rules 1
   * and 9).
   */
  it('records the reproduction in the vault, with the form it came from and no PII', async () => {
    const { service } = serviceWith({});
    await service.produce(PRACTICE, AGREEMENT);

    expect(enqueueVaultEvent).toHaveBeenCalledTimes(1);
    const event = (enqueueVaultEvent as jest.Mock).mock.calls[0][1];
    expect(event.type).toBe('agreement.rendered');
    expect(event.subject).toEqual({ type: 'Agreement', id: AGREEMENT });
    expect(event.payload).toEqual({
      kind: 'signed_db4',
      artefactId: ARTEFACT_ID,
      artefactSha256: RENDER_SHA,
      rendererVersion: SignedDb4Renderer.VERSION,
      contentVersion: SIGNED_DB4_CONTENT_VERSION,
      sourcePrintJobId: PRINT_JOB,
    });
    const serialised = JSON.stringify(event);
    for (const leak of ['Testpatient', 'Alex', '45.05', '00001']) {
      expect(serialised).not.toContain(leak);
    }
  });

  it.each([
    ['there is no such agreement', { agreement: null }, 'agreement_not_found'],
    ['it has not been signed', { agreement: signedFromDb4({ signatureEventId: null }) }, 'not_signed'],
    ['the signature was a tap, with no mark to draw', { signatureRasterSha256: null }, 'no_drawn_signature'],
    ['the print record has gone', { printRecord: null }, 'print_record_missing'],
    [
      'one has already been produced',
      { agreement: signedFromDb4({ signedDb4Sha256: RENDER_SHA }) },
      'already_produced',
    ],
  ])('says why it produced nothing when %s', async (_why, options, reason) => {
    const { service, tx, stage } = serviceWith(options as Parameters<typeof serviceWith>[0]);
    const outcome = await service.produce(PRACTICE, AGREEMENT);
    expect(outcome).toEqual({ produced: false, reason });
    expect(stage).not.toHaveBeenCalled();
    expect(tx.agreement.update).not.toHaveBeenCalled();
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
  });

  /**
   * ASKING TWICE IS HOW A RETRY BEHAVES. A second Signed-DB4 would be a second
   * document in the chart folder, which is the one thing the practice asked us
   * not to produce.
   */
  it('is idempotent — a second ask renders nothing', async () => {
    const { service, render } = serviceWith({ agreement: signedFromDb4({ signedDb4Sha256: RENDER_SHA }) });
    await service.produce(PRACTICE, AGREEMENT);
    expect(render).not.toHaveBeenCalled();
  });

  /**
   * AND THE ROW IS THE ARBITER, NOT THE READ AT THE TOP.
   *
   * The check for an existing Signed-DB4 happens in one transaction and the
   * write in another, with a render — as slow as a render is — between them.
   * Two callers can both see null and both arrive at the write. If the loser
   * wrote anyway there would be two artefact rows, two `agreement.rendered`
   * events and two documents for one chart folder, which is the one thing the
   * practice asked us not to produce. The claim is filtered on
   * `signedDb4Sha256: null`, so the loser updates nothing and rolls its own
   * transaction back before an artefact row exists.
   */
  it('produces one document when two callers race, and the loser says already_produced', async () => {
    const { service, recordStaged } = serviceWith({ claimedCount: 0 });

    const outcome = await service.produce(PRACTICE, AGREEMENT);

    expect(outcome).toEqual({ produced: false, reason: 'already_produced' });
    // The loser rendered — it could not have known — but nothing it did
    // survives: `recordStaged` runs only after the claim succeeds.
    expect(recordStaged).not.toHaveBeenCalled();
    expect(enqueueVaultEvent).not.toHaveBeenCalled();
  });
});

describe('a_failed_signed_db4_render_never_unsigns_the_agreement', () => {
  /**
   * HARD RULE 8, REQ-REC-04 — the platform never blocks care, and a platform
   * failure slows evidence rather than service.
   *
   * By the time this service runs, the signature event, the three status
   * transitions and all of their vault events have COMMITTED in their own
   * transaction. There is nothing here that can reach back into it, and the
   * test says so by asserting that a failed render writes NOTHING: no
   * artefact, no columns, no event. Six null columns on a signed agreement is
   * exactly the retry state.
   */
  it('writes nothing at all when the renderer refuses', async () => {
    const render = jest.fn().mockRejectedValue(
      Object.assign(new Error('[HARD-03] a practitioner signature field'), {
        name: 'SignedDb4RenderRefusal',
        rule: 'HARD-03',
      }),
    );
    const { service, tx, stage, recordStaged } = serviceWith({ render });

    const outcome = await service.produceAfterSignature(PRACTICE, AGREEMENT);

    expect(outcome).toEqual({ produced: false, reason: 'render_failed' });
    expect(stage).not.toHaveBeenCalled();
    expect(recordStaged).not.toHaveBeenCalled();
    expect(tx.agreement.update).not.toHaveBeenCalled();
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
    expect(enqueueVaultEvent).not.toHaveBeenCalled();
  });

  it('never throws out of the signature path, whatever went wrong', async () => {
    const render = jest.fn().mockRejectedValue(new Error('the object store fell over'));
    const { service } = serviceWith({ render });
    await expect(service.produceAfterSignature(PRACTICE, AGREEMENT)).resolves.toEqual({
      produced: false,
      reason: 'render_failed',
    });
  });

  /**
   * AND A NON-DETERMINISTIC RENDER IS A FAILURE, NOT A CHOICE OF BYTES.
   * This path has no second moment to catch it in — the agreement path
   * re-renders at the signature and compares — so it renders twice itself and
   * stores nothing if the two disagree (hard rule 13).
   */
  it('stores nothing when two renders of one form disagree', async () => {
    const render = jest
      .fn()
      .mockResolvedValueOnce({
        bytes: Buffer.from('one'),
        sha256: RENDER_SHA,
        rendererVersion: SignedDb4Renderer.VERSION,
        mediaType: 'application/pdf',
      })
      .mockResolvedValueOnce({
        bytes: Buffer.from('two'),
        sha256: 'c'.repeat(64),
        rendererVersion: SignedDb4Renderer.VERSION,
        mediaType: 'application/pdf',
      });
    const { service, tx, stage } = serviceWith({ render });

    const outcome = await service.produceAfterSignature(PRACTICE, AGREEMENT);

    expect(outcome).toEqual({ produced: false, reason: 'render_failed' });
    expect(stage).not.toHaveBeenCalled();
    expect(tx.agreement.update).not.toHaveBeenCalled();
    expect(tx.agreement.updateMany).not.toHaveBeenCalled();
  });
});

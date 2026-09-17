import { PRACTICE_SURFACES_VERSION } from '@aobplatform/domain';
import { enqueueVaultEvent } from '@aobplatform/vault-client';
import { PracticesService } from './practices.service';
import type { PracticeSurfacesService } from './practice-surfaces.service';
import type { PrismaService } from '../prisma/prisma.service';

jest.mock('@aobplatform/vault-client', () => ({ enqueueVaultEvent: jest.fn().mockResolvedValue(undefined) }));

/**
 * SETTING WHICH PARTS OF AoB A PRACTICE USES IS EVIDENCE, NOT A PREFERENCE
 * (D-2026-09-14-04).
 *
 * The two settings beside it on this endpoint say in their own comments that
 * they are not permissions and gate nothing. This one gates — it decides what
 * a practice's staff can reach and what the server answers for them — so who
 * changed it, when, and from which version of the surface list is the thing
 * somebody will be asked about afterwards.
 */

const PRACTICE = '22222222-2222-4222-8222-222222222222';

function serviceWith(current: { surfaceProfile: string } & Record<string, unknown>) {
  const tx = {
    practice: {
      findFirst: jest.fn().mockResolvedValue({ id: PRACTICE, kioskIdleTimeoutSeconds: 300, enduringByDefault: true, ...current }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: PRACTICE, ...current, ...data })),
    },
  };
  const prisma = {
    withPractice: jest.fn().mockImplementation((_id: string, run: (t: typeof tx) => unknown) => run(tx)),
  } as unknown as PrismaService;
  const surfaces = { profileOf: jest.fn(), forget: jest.fn() } as unknown as PracticeSurfacesService;
  return { service: new PracticesService(prisma, surfaces), tx, surfaces };
}

describe('changing which parts of AoB a practice uses', () => {
  beforeEach(() => (enqueueVaultEvent as jest.Mock).mockClear());

  it('the_profile_change_is_recorded_as_a_vault_event', async () => {
    const { service, tx, surfaces } = serviceWith({ surfaceProfile: 'full' });

    await service.updateConfig(PRACTICE, { surfaceProfile: 'db4' }, {
      principalType: 'user',
      id: 'staff-1',
      name: 'A. Person',
    } as never);

    expect(tx.practice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ surfaceProfile: 'db4' }) }),
    );

    expect(enqueueVaultEvent).toHaveBeenCalledTimes(1);
    const event = (enqueueVaultEvent as jest.Mock).mock.calls[0][1];
    expect(event.type).toBe('practice.surface_profile_set');
    expect(event.subject).toEqual({ type: 'Practice', id: PRACTICE });
    expect(event.payload.surfaceProfile).toBe('db4');
    expect(event.payload.previous).toBe('full');
    // THE CONTENT VERSION TRAVELS WITH IT (hard rule 14): "set to db4" cannot
    // be read back a year later without saying which list db4 came from.
    expect(event.payload.surfacesVersion).toBe(PRACTICE_SURFACES_VERSION);
    expect(event.payload.surfaces).toBe('db4');

    // The guard's cache is dropped in the same breath, so the change is
    // visible immediately rather than in fifteen seconds.
    expect(surfaces.forget).toHaveBeenCalledWith(PRACTICE);
  });

  it('writes nothing when the save did not move it', async () => {
    /*
     * This endpoint is a whole-form save and the console posts every field on
     * every press. An event per save would make the trail say somebody changed
     * the practice's surfaces on the morning they ticked the sender-ID box.
     */
    const { service } = serviceWith({ surfaceProfile: 'full' });
    await service.updateConfig(PRACTICE, { surfaceProfile: 'full' });
    expect(enqueueVaultEvent).not.toHaveBeenCalled();
  });

  it('leaves the column alone when the save does not mention it', async () => {
    const { service, tx, surfaces } = serviceWith({ surfaceProfile: 'db4' });
    await service.updateConfig(PRACTICE, { senderIdRegistered: true });
    expect(tx.practice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ surfaceProfile: undefined }) }),
    );
    expect(enqueueVaultEvent).not.toHaveBeenCalled();
    expect(surfaces.forget).not.toHaveBeenCalled();
  });
});

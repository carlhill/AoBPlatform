import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DevSeedController } from './dev-seed.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { DevicesService } from '../devices/devices.service';
import type { ServiceDescriptionsService } from '../service-descriptions/service-descriptions.service';

/**
 * The dev-only D6a twin. What matters is that it never exists in production,
 * and that it goes through the SAME service as the staff endpoint, attributed
 * to a seed rather than to nobody.
 */
describe('POST /dev/agreements/:id/service-description', () => {
  const PRACTICE = '11111111-1111-4111-8111-111111111111';
  const AGREEMENT = '22222222-2222-4222-8222-222222222222';
  const original = process.env.NODE_ENV;

  function controller() {
    const setFor = jest.fn().mockResolvedValue({ agreementId: AGREEMENT });
    const descriptions = { setFor } as unknown as ServiceDescriptionsService;
    const c = new DevSeedController({} as PrismaService, {} as DevicesService, descriptions);
    return { c, setFor };
  }

  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('dev_service_description_does_not_exist_in_production', async () => {
    process.env.NODE_ENV = 'production';
    const { c, setFor } = controller();
    await expect(
      c.devSetServiceDescription(PRACTICE, AGREEMENT, { description: 'General practitioner attendance' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setFor).not.toHaveBeenCalled();
  });

  it('refuses without a practice', async () => {
    process.env.NODE_ENV = 'test';
    const { c, setFor } = controller();
    await expect(
      c.devSetServiceDescription(undefined, AGREEMENT, { description: 'General practitioner attendance' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(setFor).not.toHaveBeenCalled();
  });

  it('calls the staff service as a named seed, never as nobody', async () => {
    process.env.NODE_ENV = 'test';
    const { c, setFor } = controller();
    await c.devSetServiceDescription(PRACTICE, AGREEMENT, { description: 'General practitioner attendance' });
    expect(setFor).toHaveBeenCalledWith(
      PRACTICE,
      AGREEMENT,
      'General practitioner attendance',
      expect.objectContaining({ id: 'dev-seed', principalType: 'system', authMethod: 'unknown' }),
    );
  });
});

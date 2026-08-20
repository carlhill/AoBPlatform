import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok with the service name', () => {
    const res = new HealthController().check();
    expect(res.status).toBe('ok');
    expect(res.service).toBe('rules');
    expect(new Date(res.timestamp).toString()).not.toBe('Invalid Date');
  });
});

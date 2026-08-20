import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RulesEngineClient, ValidationRequest, ValidationResponse } from '@aobplatform/contracts';

export const RULES_CLIENT = Symbol('RULES_CLIENT');

export class HttpRulesEngineClient implements RulesEngineClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async validate(request: ValidationRequest): Promise<ValidationResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Rules service returned ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as ValidationResponse;
  }
}

@Module({
  providers: [
    {
      provide: RULES_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new HttpRulesEngineClient(config.get<string>('RULES_SERVICE_URL', 'http://localhost:3002')),
    },
  ],
  exports: [RULES_CLIENT],
})
export class RulesClientModule {}

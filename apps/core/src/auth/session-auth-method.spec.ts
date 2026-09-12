import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { SessionActor, type Actor } from './actor.decorator';
import { FRESH_SECOND_FACTOR } from './fresh-second-factor.decorator';

/**
 * HOW A SESSION AUTHENTICATED, READ OFF THE ACTOR — AUTH-TIERS.md §5.1,
 * D-2026-09-12-11.
 *
 * The realm end of this is proved against a live Keycloak by
 * `infra/keycloak/tier2-verify.mjs`. This is the other end: that the claim
 * survives the journey into the object every endpoint in core actually reads.
 */

/**
 * Reach the factory inside a param decorator.
 *
 * `SessionActor` is a `createParamDecorator`, so there is no function to call
 * directly — Nest stores the factory in route metadata. Declaring a throwaway
 * controller and reading that metadata back is the only way to test the thing
 * itself rather than a copy of its logic.
 */
function actorFactory(): (data: unknown, context: ExecutionContext) => Actor | undefined {
  class Probe {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler(@SessionActor() actor: Actor | undefined): void {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<string, { factory: never }>;
  return args[Object.keys(args)[0]].factory as never;
}

const contextWith = (principal: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ principal, method: 'POST', url: '/devices/x/revoke', headers: {} }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

describe('a_session_records_how_it_authenticated', () => {
  const factory = actorFactory();

  it('a_session_records_how_it_authenticated', () => {
    const passwordAndCode = factory(undefined, contextWith({ sub: 's1', principalType: 'staff', roles: [], amr: ['pwd', 'otp'], authTime: 1_789_200_000, raw: {} }));
    const passkey = factory(undefined, contextWith({ sub: 's2', principalType: 'staff', roles: [], amr: ['hwk'], authTime: 1_789_200_000, raw: {} }));

    expect(passwordAndCode?.authMethod).toBe('password+otp');
    expect(passkey?.authMethod).toBe('passkey');
    // An audit must be able to tell them apart — AUTH-TIERS.md §5.1.
    expect(passwordAndCode?.authMethod).not.toBe(passkey?.authMethod);
  });

  it('carries when the person authenticated, so freshness is not guesswork', () => {
    const actor = factory(undefined, contextWith({ sub: 's3', principalType: 'staff', roles: [], amr: ['pwd', 'otp'], authTime: 1_789_199_000, raw: {} }));
    expect(actor?.authTimeSeconds).toBe(1_789_199_000);
  });

  it('says unknown rather than guessing when there is no token to read', () => {
    // The staged dev-header path: a principal set server-side with no realm
    // behind it. Assuming the weakest method would put a fiction in an audit.
    const actor = factory(undefined, contextWith({ sub: 's4', principalType: 'staff', roles: [], raw: {} }));
    expect(actor?.authMethod).toBe('unknown');
    expect(actor?.authTimeSeconds).toBeUndefined();
  });
});

describe('a_password_never_appears_in_a_log_an_event_or_an_error', () => {
  /**
   * WHAT THIS ACTUALLY CHECKS, because the name could be read as a promise
   * nothing can keep.
   *
   * Core never handles a password: tier 2 passwords are typed into Keycloak's
   * own login form and are verified there (AUTH-TIERS.md §4). The risk is
   * therefore not that core prints one it holds — it holds none — but that the
   * NEW refusal path added for tier 2 starts echoing the session back into a
   * log line or an error body, the way a hastily written guard tends to
   * (`Refused for ${JSON.stringify(principal)}`). That is what is pinned here,
   * along with the wider rule that no PII goes into either.
   */
  const secret = 'brindabella-ridgeline-2026';

  function guardRefusing(principal: Record<string, unknown>): { guard: AuthGuard; context: ExecutionContext } {
    const reflector = {
      getAllAndOverride: (key: string) => (key === FRESH_SECOND_FACTOR ? { maxAgeSeconds: null } : undefined),
    } as unknown as Reflector;
    const config = { get: () => undefined } as unknown as ConfigService;
    return { guard: new AuthGuard(config, reflector), context: contextWith(principal) };
  }

  it('a_password_never_appears_in_a_log_an_event_or_an_error', async () => {
    const written: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      written.push(String(message));
    });

    /*
     * A principal shaped as badly as a real one could be if somebody later
     * put the wrong thing on it: the raw claims carry a password-looking
     * value and the username is an email address. Neither may reach the log
     * or the response.
     */
    const { guard, context } = guardRefusing({
      sub: '00000000-0000-4000-8000-00000000stal',
      principalType: 'staff',
      roles: [],
      preferredUsername: 'audrey@hillsempire.com.xlevelup',
      amr: ['pwd', 'otp'],
      authTime: Math.floor(Date.now() / 1000) - 4 * 60 * 60,
      raw: { password: secret },
    });

    let thrown: unknown;
    try {
      await guard.canActivate(context);
    } catch (err) {
      thrown = err;
    } finally {
      spy.mockRestore();
    }

    expect(thrown).toBeInstanceOf(ForbiddenException);
    const body = JSON.stringify((thrown as ForbiddenException).getResponse());
    const log = written.join('\n');

    for (const forbidden of [secret, 'audrey@hillsempire.com.xlevelup', 'audrey', 'password']) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    for (const forbidden of [secret, 'audrey@hillsempire.com.xlevelup', 'audrey']) {
      expect(log.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }

    // It still says enough to find the session and act on it.
    expect(log).toContain('00000000-0000-4000-8000-00000000stal');
    expect(log).toContain('reauthentication_required');
  });

  it('the refusal names a code the surface can map, not only a sentence', async () => {
    const { guard, context } = guardRefusing({
      sub: 's9',
      principalType: 'staff',
      roles: [],
      amr: ['pwd'],
      authTime: Math.floor(Date.now() / 1000),
      raw: {},
    });
    const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { reasonCode: 'second_factor_required' },
    });
    spy.mockRestore();
  });
});

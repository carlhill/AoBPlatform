import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { SURFACE_REFUSED_CODE } from '@aobplatform/domain';
import { SurfaceGuard } from './surface.guard';
import type { PracticeSurfacesService } from './practice-surfaces.service';

/**
 * THE SERVER HALF OF D-2026-09-14-04, which is the half that matters: a hidden
 * page whose endpoint still answers is the real gap.
 */

const PRACTICE = '11111111-1111-4111-8111-111111111111';

function contextFor(method: string, path: string, headers: Record<string, string> = {}): ExecutionContext {
  const request = { method, path, url: path, route: { path }, headers };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardFor(profile: string): SurfaceGuard {
  const surfaces = {
    profileOf: jest.fn().mockResolvedValue(profile),
    forget: jest.fn(),
  } as unknown as PracticeSurfacesService;
  return new SurfaceGuard(surfaces);
}

describe('does this practice use this part of AoB', () => {
  const asPractice = { 'x-practice-id': PRACTICE };

  it('an_existing_practice_sees_everything_by_default', () => {
    /*
     * The release-safety claim. Every practice that exists carries `full`, so
     * this build must change nothing for any of them — including the surfaces
     * that the first customer will not have.
     */
    const guard = guardFor('full');
    return Promise.all(
      [
        ['POST', '/kiosk/claim'],
        ['GET', '/arrivals/expected'],
        ['POST', '/enduring'],
        ['GET', '/portal/agreements'],
        ['GET', '/practitioner-queue/waiting'],
        ['POST', '/inbound/print-jobs'],
        ['GET', '/health'],
      ].map(async ([method, path]) => {
        await expect(guard.canActivate(contextFor(method, path, asPractice))).resolves.toBe(true);
      }),
    );
  });

  it('a_surface_that_is_off_is_refused_by_the_server_not_only_hidden', async () => {
    /*
     * The front desk's rails are hidden in the console for a practice on the
     * DB4 profile. Hiding is a courtesy; this is the control. The refusal
     * carries a code and names the surface — never a bare 403 (CLAUDE.md §7).
     */
    const guard = guardFor('db4');
    const attempt = guard.canActivate(contextFor('GET', '/arrivals/expected', asPractice));
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);

    const refusal = await attempt.catch((err: ForbiddenException) => err);
    const body = (refusal as ForbiddenException).getResponse() as {
      code: string;
      surface: string;
      message: string;
    };
    expect(body.code).toBe(SURFACE_REFUSED_CODE);
    expect(body.surface).toBe('queue_rails');
    // It says what is true — the practice does not use it — and not "that page
    // is not for this account", which would be a lie about the account.
    expect(body.message).toContain('does not use');
    expect(body.message).toContain('Nothing has been deleted');
    // NO IDENTIFIER IN THE REFUSAL (REQ-LOG-08, hard rule 9).
    expect(JSON.stringify(body)).not.toContain(PRACTICE);
  });

  it('a_db4_print_job_is_refused_when_the_practice_does_not_use_db4', async () => {
    /*
     * The gate on AOBPRINTER being installable at a practice that has not
     * bought it (TODO.md, AOBPRINTER item 5). Until this existed, nothing in
     * code stopped the print channel being pointed at a live practice.
     *
     * `standard` is the small practice with no PMS (D-2026-09-27-02): every
     * surface except this one. It replaces `kiosk_only`, which this test used
     * while no shipped profile could refuse a print job — a profile that
     * existed nowhere but here, and so proved the unrecognised-profile
     * fallback rather than a setting anybody could give a practice
     * (PRACTICE-SURFACES.md §6b, §6c).
     */
    const guard = guardFor('standard');
    const attempt = guard.canActivate(contextFor('POST', '/inbound/print-jobs', asPractice));
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    const body = (await attempt.catch((err: ForbiddenException) => err.getResponse())) as { surface: string };
    expect(body.surface).toBe('db4');

    // And it IS open for the practice that has bought it.
    await expect(
      guardFor('db4').canActivate(contextFor('POST', '/inbound/print-jobs', asPractice)),
    ).resolves.toBe(true);
  });

  it('a_db4_practice_keeps_the_tablet_desk_and_the_day_register', async () => {
    /*
     * The other half, at the endpoints the two screens actually call. Shutting
     * the walk-up door must not shut the tablet, and switching the front
     * desk's rails off must not take away the day register.
     */
    const guard = guardFor('db4');
    for (const [method, path] of [
      ['POST', '/devices/:deviceId/push'],
      ['GET', '/tablet-sessions/pushable'],
      ['GET', '/kiosk/me'],
      ['POST', '/kiosk/heartbeat'],
      ['GET', '/kiosk/waiting-list'],
      ['GET', '/arrivals/day'],
      ['GET', '/patients'],
      ['PATCH', '/practices/:id/config'],
    ]) {
      await expect(guard.canActivate(contextFor(method, path, asPractice))).resolves.toBe(true);
    }
    // But the walk-up front door is shut.
    await expect(
      guard.canActivate(contextFor('POST', '/kiosk/claim', asPractice)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never refuses a route nobody classified, because the platform never blocks care', async () => {
    /*
     * Hard rule 8 / REQ-REC-04, and the opposite of this codebase's usual
     * fail-closed instinct — so it is asserted rather than left to be read as
     * an oversight. `every_core_route_belongs_to_a_surface` is what catches
     * the omission instead, at the bench.
     */
    await expect(
      guardFor('db4').canActivate(contextFor('POST', '/something-nobody-classified', asPractice)),
    ).resolves.toBe(true);
  });

  it('asks nothing when there is no practice to ask about', async () => {
    // A patient holding a link, a platform-only route, an unscoped call: there
    // is no practice whose profile could answer, and inventing one from the
    // request would be worse than not asking.
    const surfaces = { profileOf: jest.fn(), forget: jest.fn() } as unknown as PracticeSurfacesService;
    const guard = new SurfaceGuard(surfaces);
    await expect(guard.canActivate(contextFor('POST', '/kiosk/claim'))).resolves.toBe(true);
    expect((surfaces.profileOf as jest.Mock)).not.toHaveBeenCalled();
  });

  it('prefers the verified token’s claim over the header', async () => {
    /*
     * The same precedence every other practice-scoped read here uses. A header
     * that disagreed with a claim would otherwise let a caller choose which
     * practice's profile answered for them.
     */
    const surfaces = {
      profileOf: jest.fn().mockResolvedValue('db4'),
      forget: jest.fn(),
    } as unknown as PracticeSurfacesService;
    const guard = new SurfaceGuard(surfaces);
    const request = {
      method: 'GET',
      path: '/arrivals/expected',
      url: '/arrivals/expected',
      route: { path: '/arrivals/expected' },
      headers: { 'x-practice-id': 'a-different-practice' },
      principal: { practiceId: PRACTICE },
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(surfaces.profileOf).toHaveBeenCalledWith(PRACTICE);
  });
});

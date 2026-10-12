/**
 * THE CALLBACK RETURNS YOU TO THE PAGE YOU WERE ON — ONCE (Carl, 12 Sep 2026:
 * "if I press ctrl+F5 on this page it goes to practice/today", on
 * /practice/setup).
 *
 * THE MECHANISM IT GUARDS. React runs every effect twice in development, and
 * `completeLogin` de-duplicates to the SAME in-flight promise, so both runs'
 * `.then`s fire. `returnPath()` deletes the stored path on read. The first run
 * got `/practice/setup`; the second got nothing, fell to the audience default,
 * and its `router.replace` ran last and won.
 *
 * WHY IT WAS INVISIBLE UNTIL TODAY. The practice default WAS `/practice/setup`,
 * so the wrong answer and the right one were the same page. Moving the default
 * to `/practice/today` exposed a bug that had always been there.
 *
 * SO THIS TEST MOUNTS UNDER STRICT MODE ON PURPOSE — that is the condition that
 * produced the fault — and asserts exactly one navigation, to the stored page.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/callback',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

/** A practice administrator's session — the audience whose default moved. */
const PRACTICE_SESSION = {
  accessToken: 'test-token',
  expiresAt: Date.now() + 60_000,
  username: 'admin.821709fb',
  practiceId: '821709fb-7f89-4fcf-95c0-27c5eb55cec8',
  roles: [] as string[],
};

/*
 * ONE PROMISE, HANDED BACK TO EVERY CALLER — this is what the real
 * `completeLogin` does, and it is the half of the fault that is not React's.
 */
const exchange = Promise.resolve(PRACTICE_SESSION);
vi.mock('../auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('../auth')>();
  return {
    ...real,
    completeLogin: vi.fn(() => exchange),
    currentSession: vi.fn(() => PRACTICE_SESSION),
  };
});

import CallbackPage from './page';

const RETURN_KEY = 'aob.pkce.return';

function arrivingWithACode(): void {
  vi.stubGlobal('location', {
    href: 'http://localhost:3100/callback?code=abc&state=xyz',
    origin: 'http://localhost:3100',
    pathname: '/callback',
    search: '?code=abc&state=xyz',
    assign: vi.fn(),
  });
}

beforeEach(() => {
  replace.mockClear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  cleanup();
});

describe('a_double_invoked_callback_returns_to_the_page_the_person_was_on', () => {
  it('lands on the stored page exactly once, even under strict mode', async () => {
    sessionStorage.setItem(RETURN_KEY, '/practice/setup');
    arrivingWithACode();

    render(
      <StrictMode>
        <CallbackPage />
      </StrictMode>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    // Give a second, wrong navigation every chance to happen before asserting.
    await new Promise((r) => setTimeout(r, 50));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/practice/setup');
  });

  it('falls to the audience default only when nothing was stored, and still once', async () => {
    arrivingWithACode();

    render(
      <StrictMode>
        <CallbackPage />
      </StrictMode>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/practice/today');
  });

  /** The silent-restore refusal path goes through the same guard. */
  it('a refused silent restore returns to the stored page once', async () => {
    sessionStorage.setItem(RETURN_KEY, '/practice/setup');
    vi.stubGlobal('location', {
      href: 'http://localhost:3100/callback?error=login_required',
      origin: 'http://localhost:3100',
      pathname: '/callback',
      search: '?error=login_required',
      assign: vi.fn(),
    });

    render(
      <StrictMode>
        <CallbackPage />
      </StrictMode>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/practice/setup');
  });
});

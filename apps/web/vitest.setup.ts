/**
 * Two things every kiosk test needs, in one place.
 *
 * 1. CLEANUP BETWEEN RENDERS. React Testing Library auto-registers its own
 *    `afterEach(cleanup)` only when a global `afterEach` exists — which it does
 *    not here, because these tests import `describe`/`it`/`expect` explicitly
 *    rather than running with `globals: true`. Without it every render is left
 *    in `document.body` and the next `getByTestId` finds two of everything.
 *    The failure reads as a duplicate test id, which sends you looking in the
 *    component; it is neither.
 *
 * 2. A CANVAS THAT ANSWERS. jsdom has no 2D context and logs "Not implemented:
 *    HTMLCanvasElement.prototype.getContext" for every render of the signature
 *    pad. `SignaturePad` already treats a missing context as "draw nothing",
 *    which is the correct behaviour on a server render as well — so this
 *    returns null quietly rather than filling the run with noise nobody should
 *    learn to ignore. The pad's real behaviour is exercised in a real browser
 *    by the Playwright ceremony spec.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null;
}

/**
 * A RESIZE NEVER REINTERPRETS A SIGNATURE (10 Oct 2026, from the review of the
 * tablet-fit change, REQ-SIG-02).
 *
 * The pad used to re-measure on every resize: the backing store took the new
 * size, the old points were redrawn into it unscaled, and `capture()` then sent
 * the NEW pad size beside points measured on the OLD one. Turning the tablet,
 * Edge's toolbar sliding away, or the kiosk going full screen just after K-4
 * mounts are all resizes — and the last can land in the middle of a stroke.
 *
 * WHAT THESE PIN. From the first pointerdown until `clear()` the pad keeps its
 * size, so the vector, the raster and the pad size in the capture agree with
 * each other and with what the patient drew. With nothing held, a resize
 * re-measures freely.
 *
 * AND THE PATIENT SEES ALL OF THEIR INK (review, 10 Oct 2026). A pad pinned at
 * its signing size inside a frame that has since shrunk — the tablet turned
 * after signing — is SCALED DOWN to fit, never clipped, and a touch on the
 * scaled pad is mapped back into the pad's own space.
 *
 * THE BROWSER IS STOOD IN FOR, NOT THE PAD. jsdom has no canvas and no layout,
 * so the test supplies both: a 2D context that records its calls, a PNG whose
 * bytes name the backing store's size, and a layout whose box is whatever the
 * test says — the canvas fills its frame unless it is pinned in pixels, as a
 * browser would honour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

/** The box the layout would give the pad's frame right now. */
let layout = { width: 800, height: 440 };

const box = (width: number, height: number) =>
  ({ x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;

function rectFor(canvas: HTMLCanvasElement): DOMRect {
  const pinnedWidth = parseFloat(canvas.style.width);
  const pinnedHeight = parseFloat(canvas.style.height);
  const width = Number.isFinite(pinnedWidth) ? pinnedWidth : layout.width;
  const height = Number.isFinite(pinnedHeight) ? pinnedHeight : layout.height;
  return box(width, height);
}

/** Every call the pad made on its 2D context, in order. */
let calls: Array<[string, ...number[]]> = [];

const originals = {
  getContext: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
  getBoundingClientRect: HTMLCanvasElement.prototype.getBoundingClientRect,
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  ratio: window.devicePixelRatio,
  setPointerCapture: HTMLCanvasElement.prototype.setPointerCapture,
  PointerEvent: (window as { PointerEvent?: unknown }).PointerEvent,
};

beforeEach(() => {
  layout = { width: 800, height: 440 };
  calls = [];
  const record =
    (name: string) =>
    (...args: number[]) => {
      calls.push([name, ...args]);
    };
  const context = {
    clearRect: record('clearRect'),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: record('setTransform'),
    save: record('save'),
    restore: record('restore'),
  };
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return context;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  // The raster's bytes name the backing store it was taken from.
  HTMLCanvasElement.prototype.toDataURL = function toDataURL(this: HTMLCanvasElement) {
    return `data:image/png;base64,${btoa(`png ${this.width}x${this.height}`)}`;
  };
  HTMLCanvasElement.prototype.getBoundingClientRect = function getBoundingClientRect(this: HTMLCanvasElement) {
    return rectFor(this);
  };
  // The pad's frame is the box the layout gives it.
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { configurable: true, get: () => layout.width });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true, get: () => layout.height });
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  if (!originals.PointerEvent) {
    // jsdom has MouseEvent (clientX/clientY) but not PointerEvent.
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      pressure: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pressure = init.pressure ?? 0;
      }
    }
    (window as { PointerEvent?: unknown }).PointerEvent = TestPointerEvent;
  }
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originals.getContext;
  HTMLCanvasElement.prototype.toDataURL = originals.toDataURL;
  HTMLCanvasElement.prototype.getBoundingClientRect = originals.getBoundingClientRect;
  delete (HTMLDivElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLDivElement.prototype as { clientHeight?: number }).clientHeight;
  Object.defineProperty(window, 'devicePixelRatio', { value: originals.ratio, configurable: true });
  HTMLCanvasElement.prototype.setPointerCapture = originals.setPointerCapture;
  (window as { PointerEvent?: unknown }).PointerEvent = originals.PointerEvent;
});

function mountPad() {
  const handle: { current: SignaturePadHandle | null } = { current: null };
  const view = render(<SignaturePad handleRef={handle} onInkChange={() => undefined} />);
  const canvas = view.getByTestId('signature-pad') as HTMLCanvasElement;
  return { handle, canvas };
}

/** The window changes size and the layout gives the pad a different box. */
function resizeTo(width: number, height: number): void {
  layout = { width, height };
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

const at = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1 });

function drawStroke(canvas: HTMLCanvasElement, points: Array<[number, number]>): void {
  fireEvent.pointerDown(canvas, at(...points[0]));
  for (const point of points.slice(1)) fireEvent.pointerMove(canvas, at(...point));
  fireEvent.pointerUp(canvas, at(...points[points.length - 1]));
}

const raster = (width: number, height: number) => btoa(`png ${width}x${height}`);

describe('a resize never reinterprets a signature', () => {
  it('a_resize_after_ink_leaves_the_captured_vector_raster_and_size_unchanged', () => {
    const { handle, canvas } = mountPad();
    drawStroke(canvas, [
      [100, 300],
      [400, 200],
      [700, 320],
    ]);
    const before = handle.current?.capture();
    expect(before).not.toBeNull();
    expect(before?.padWidth).toBe(800);
    expect(before?.padHeight).toBe(440);
    expect(before?.rasterPngBase64).toBe(raster(800, 440));

    // The tablet is turned: the frame becomes narrower and shorter.
    resizeTo(600, 300);
    const after = handle.current?.capture();
    expect(after).toEqual(before);
    // The backing store is the one the points were drawn into.
    expect(canvas.width).toBe(800);
  });

  it('a_pad_frozen_in_a_smaller_frame_is_scaled_to_fit_and_never_clipped', () => {
    // The review's case: signed upright, then the tablet turned on its side.
    layout = { width: 860, height: 443 };
    const { handle, canvas } = mountPad();
    drawStroke(canvas, [
      [20, 20],
      [430, 220],
      [850, 430],
    ]);
    resizeTo(830, 370);

    // ALL of the ink is on screen: the pad fits its frame, at its own shape.
    const shown = canvas.getBoundingClientRect();
    expect(shown.width).toBeLessThanOrEqual(830);
    expect(shown.height).toBeLessThanOrEqual(370);
    expect(shown.width / shown.height).toBeCloseTo(860 / 443, 2);

    // A touch on the scaled pad lands in the pad's own space, where the ink is.
    drawStroke(canvas, [
      [shown.width / 2, shown.height / 2],
      [shown.width, shown.height],
    ]);
    const capture = handle.current?.capture();
    expect(capture?.padWidth).toBe(860);
    expect(capture?.padHeight).toBe(443);
    const last = capture?.vector[1].points ?? [];
    expect(last[0].x).toBeCloseTo(430, 0);
    expect(last[0].y).toBeCloseTo(221.5, 0);
    expect(last[1].x).toBeCloseTo(860, 0);
    expect(last[1].y).toBeCloseTo(443, 0);
  });

  it('a_touch_in_the_same_frame_as_a_layout_change_is_measured_in_the_pad_it_lands_on', () => {
    const { handle, canvas } = mountPad();
    // Full screen arrives as the patient touches: the layout has changed and
    // no resize event has been delivered yet.
    layout = { width: 1000, height: 560 };
    fireEvent.pointerDown(canvas, at(100, 300));
    fireEvent.pointerMove(canvas, at(900, 500));
    fireEvent.pointerUp(canvas, at(900, 500));

    const capture = handle.current?.capture();
    expect(capture).not.toBeNull();
    expect(capture?.padWidth).toBe(1000);
    expect(capture?.padHeight).toBe(560);
    expect(capture?.rasterPngBase64).toBe(raster(1000, 560));
    for (const point of capture?.vector.flatMap((stroke) => stroke.points) ?? []) {
      expect(point.x).toBeLessThanOrEqual(1000);
      expect(point.y).toBeLessThanOrEqual(560);
    }
  });

  it('a_layout_change_mid_stroke_before_any_resize_event_cannot_stretch_the_stroke', () => {
    const { handle, canvas } = mountPad();
    fireEvent.pointerDown(canvas, at(100, 300));
    // The frame grows under the finger; the event that would say so is late.
    layout = { width: 1000, height: 560 };
    fireEvent.pointerMove(canvas, at(700, 400));
    fireEvent.pointerUp(canvas, at(700, 400));

    const capture = handle.current?.capture();
    expect(capture?.padWidth).toBe(800);
    expect(capture?.padHeight).toBe(440);
    expect(capture?.vector[0].points.map((point) => [point.x, point.y])).toEqual([
      [100, 300],
      [700, 400],
    ]);
  });

  it('clearing_wipes_the_whole_backing_store_whatever_the_device_ratio_is_now', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    const { handle, canvas } = mountPad();
    drawStroke(canvas, [
      [100, 300],
      [400, 200],
    ]);
    // The pad is hidden (no box) and the ratio changes before Clear.
    layout = { width: 0, height: 0 };
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    calls = [];
    act(() => handle.current?.clear());

    const wipe = calls.findIndex(
      ([name, ...args]) => name === 'clearRect' && args[2] === canvas.width && args[3] === canvas.height,
    );
    expect(wipe).toBeGreaterThanOrEqual(0);
    // Under an identity transform, so it covers every device pixel.
    const transform = calls
      .slice(0, wipe)
      .reverse()
      .find(([name]) => name === 'setTransform');
    expect(transform).toEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
  });

  it('a_resize_mid_stroke_keeps_the_whole_stroke_in_one_space', () => {
    const { handle, canvas } = mountPad();
    fireEvent.pointerDown(canvas, at(100, 300));
    fireEvent.pointerMove(canvas, at(300, 250));
    // Full screen arrives under the finger.
    resizeTo(1000, 560);
    fireEvent.pointerMove(canvas, at(700, 400));
    fireEvent.pointerUp(canvas, at(700, 400));

    const capture = handle.current?.capture();
    expect(capture).not.toBeNull();
    expect(capture?.padWidth).toBe(800);
    expect(capture?.padHeight).toBe(440);
    expect(capture?.rasterPngBase64).toBe(raster(800, 440));
    const points = capture?.vector.flatMap((stroke) => stroke.points) ?? [];
    expect(points.map((point) => [point.x, point.y])).toEqual([
      [100, 300],
      [300, 250],
      [700, 400],
    ]);
    for (const point of points) {
      expect(point.x).toBeLessThanOrEqual(capture?.padWidth ?? 0);
      expect(point.y).toBeLessThanOrEqual(capture?.padHeight ?? 0);
    }
  });

  it('with_nothing_held_a_resize_re_measures_freely', () => {
    const { handle, canvas } = mountPad();
    resizeTo(600, 300);
    drawStroke(canvas, [
      [50, 100],
      [500, 200],
    ]);
    const capture = handle.current?.capture();
    expect(capture?.padWidth).toBe(600);
    expect(capture?.padHeight).toBe(300);
    expect(capture?.rasterPngBase64).toBe(raster(600, 300));
  });

  it('clearing_a_frozen_pad_lets_it_take_its_frame_again', () => {
    const { handle, canvas } = mountPad();
    drawStroke(canvas, [
      [100, 300],
      [400, 200],
    ]);
    resizeTo(600, 300);
    expect(canvas.width).toBe(800);

    act(() => handle.current?.clear());
    expect(canvas.style.width).toBe('');
    drawStroke(canvas, [
      [50, 100],
      [500, 200],
    ]);
    const capture = handle.current?.capture();
    expect(capture?.padWidth).toBe(600);
    expect(capture?.padHeight).toBe(300);
    expect(capture?.rasterPngBase64).toBe(raster(600, 300));
  });
});

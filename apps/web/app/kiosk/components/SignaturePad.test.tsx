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
 * THE BROWSER IS STOOD IN FOR, NOT THE PAD. jsdom has no canvas and no layout,
 * so the test supplies both: a 2D context that records nothing, a PNG whose
 * bytes name the backing store's size, and a layout whose box is whatever the
 * test says — unless the element is pinned in pixels, as a browser would honour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

/** The box the layout would give the pad right now. */
let layout = { width: 800, height: 440 };

function rectFor(canvas: HTMLCanvasElement): DOMRect {
  const pinnedWidth = parseFloat(canvas.style.width);
  const pinnedHeight = parseFloat(canvas.style.height);
  const width = Number.isFinite(pinnedWidth) ? pinnedWidth : layout.width;
  const height = Number.isFinite(pinnedHeight) ? pinnedHeight : layout.height;
  return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON: () => ({}) } as DOMRect;
}

const originals = {
  getContext: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
  getBoundingClientRect: HTMLCanvasElement.prototype.getBoundingClientRect,
  setPointerCapture: HTMLCanvasElement.prototype.setPointerCapture,
  PointerEvent: (window as { PointerEvent?: unknown }).PointerEvent,
};

beforeEach(() => {
  layout = { width: 800, height: 440 };
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
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
    // And the element stays the size the points were measured on.
    expect(canvas.getBoundingClientRect().width).toBe(800);
    expect(canvas.width).toBe(800);
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

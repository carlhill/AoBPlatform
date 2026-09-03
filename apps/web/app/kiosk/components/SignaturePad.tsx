'use client';

/**
 * Signing on glass — a `<canvas>` and pointer events, no drawing library and
 * no new runtime dependency.
 *
 * BOTH REPRESENTATIONS ARE CAPTURED (REQ-SIG-02). The VECTOR is the stroke
 * points with the gaps between strokes preserved; the RASTER is the same
 * canvas as a PNG. The Expo build captured only the vector, because a
 * react-native View cannot rasterise itself; a canvas can, so this closes half
 * of that gap.
 *
 * WHAT IS STILL OPEN, SAID PLAINLY RATHER THAN IMPLIED BY SILENCE. The server's
 * `POST /agreements/:id/sign` takes a method, a channel and a capture request
 * — no signature payload — and binds the artefact hash itself. So both
 * representations are captured here and neither is uploaded. Wiring them
 * through is a change to `SignDto` in `apps/core`, which this work was scoped
 * out of; until then the binding REQ-SIG-02 asks for is the server's
 * hash-to-event binding, and the image exists only for the length of the
 * ceremony.
 *
 * NOTHING SURVIVES THE PATIENT. The strokes live in a ref and the pixels live
 * in the canvas; `clear()` drops both, and the ceremony's reset drops the
 * component. No data URL is written to storage, a form, or a log
 * (zero-footprint, CLAUDE.md §7).
 *
 * POINTER EVENTS, NOT MOUSE-PLUS-TOUCH. One code path for a finger, a stylus
 * and a mouse; `touch-action: none` on the canvas is what stops a drag
 * scrolling the page out from under the signature instead of drawing.
 */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Stroke {
  readonly points: readonly Point[];
}

export interface SignaturePadHandle {
  /** Drops both representations. */
  clear(): void;
  /** The vector. Empty until somebody has drawn something. */
  strokes(): readonly Stroke[];
  /** The raster, or null where no canvas context exists (a server render, a test). */
  toPngDataUrl(): string | null;
}

const LINE_WIDTH = 3;

export function SignaturePad({
  handleRef,
  onInkChange,
}: {
  handleRef: { current: SignaturePadHandle | null };
  onInkChange: (hasInk: boolean) => void;
}): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Point[]>([]);
  const drawingRef = useRef(false);

  const context = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    return canvas.getContext('2d');
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    const ratio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1);
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    for (const stroke of [...strokesRef.current, { points: currentRef.current }]) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i += 1) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }, [context]);

  /**
   * THE BACKING STORE IS SIZED IN DEVICE PIXELS, the element in CSS pixels.
   * Without this the ink is drawn at one third of the resolution of the screen
   * it is on and a signature looks like a fax of itself — and, worse, the
   * points and the pixels disagree about where the finger was.
   */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    const ratio = typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1);
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The token, read from the live document, so the ink follows the theme
    // rather than being a second copy of it.
    ctx.strokeStyle =
      typeof window === 'undefined'
        ? '#16181a'
        : (getComputedStyle(canvas).color || '#16181a');
    redraw();
  }, [context, redraw]);

  useEffect(() => {
    resize();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  useEffect(() => {
    handleRef.current = {
      clear() {
        strokesRef.current = [];
        currentRef.current = [];
        redraw();
        onInkChange(false);
      },
      strokes() {
        return strokesRef.current;
      },
      toPngDataUrl() {
        const canvas = canvasRef.current;
        if (!canvas || typeof canvas.toDataURL !== 'function') return null;
        if (strokesRef.current.length === 0) return null;
        try {
          return canvas.toDataURL('image/png');
        } catch {
          // A tainted or unsupported canvas. The vector is still captured and
          // the ceremony must not stop for a missing thumbnail.
          return null;
        }
      },
    };
    const ref = handleRef;
    return () => {
      ref.current = null;
    };
  }, [handleRef, onInkChange, redraw]);

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  return (
    <div className={styles.pad}>
      <canvas
        ref={canvasRef}
        className={styles.padCanvas}
        // Announced as an image the patient draws into. A canvas with no name
        // is an unlabelled control, which is the commonest AA failure there is.
        role="img"
        aria-label={strings.signature.padLabel}
        data-testid="signature-pad"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drawingRef.current = true;
          currentRef.current = [pointFrom(event)];
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return;
          currentRef.current = [...currentRef.current, pointFrom(event)];
          redraw();
        }}
        onPointerUp={() => {
          if (!drawingRef.current) return;
          drawingRef.current = false;
          if (currentRef.current.length > 1) {
            strokesRef.current = [...strokesRef.current, { points: currentRef.current }];
            onInkChange(true);
          }
          currentRef.current = [];
          redraw();
        }}
        onPointerLeave={() => {
          if (!drawingRef.current) return;
          drawingRef.current = false;
          if (currentRef.current.length > 1) {
            strokesRef.current = [...strokesRef.current, { points: currentRef.current }];
            onInkChange(true);
          }
          currentRef.current = [];
          redraw();
        }}
      />
      <span className={styles.padRule} aria-hidden="true" />
      <p className={styles.padHint}>{strings.signature.padHint}</p>
    </div>
  );
}

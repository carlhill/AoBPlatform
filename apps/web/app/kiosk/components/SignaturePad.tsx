'use client';

/**
 * Signing on glass — a `<canvas>` and pointer events, no drawing library and
 * no new runtime dependency.
 *
 * BOTH REPRESENTATIONS ARE CAPTURED AND BOTH ARE NOW SENT (REQ-SIG-01/-02).
 * The VECTOR is the stroke points with the gaps between strokes preserved; the
 * RASTER is the same canvas as a PNG. The Expo build captured only the vector,
 * because a react-native View cannot rasterise itself; a canvas can.
 *
 * WHAT USED TO BE OPEN HERE IS CLOSED. `POST /agreements/:id/sign` took a
 * method, a channel and a capture request and no payload, so both
 * representations were captured and neither was uploaded — a drawn signature
 * whose drawing was discarded, which is a tap-to-approve in disguise. `SignDto`
 * now carries a `signature`, and `capture()` below is what the ceremony sends.
 *
 * THE POINTS CARRY THEIR TIMING, AND ARE KEPT EXACTLY AS CAPTURED. Each point
 * records milliseconds since the first point of the first stroke, and the
 * pressure the device reported where it reported one. Nothing is smoothed,
 * resampled or thinned — a tidied stroke can no longer answer a question about
 * how it was made, and those are the questions a dispute asks. The platform
 * STORES these signals; it does not judge them, and no biometric template is
 * derived from them here or anywhere downstream.
 *
 * THE PAD'S LOGICAL SIZE TRAVELS WITH THE POINTS. Coordinates are CSS pixels
 * relative to this pad; without its width and height they cannot be redrawn at
 * any other size, and a larger tablet next year would silently reinterpret
 * every stroke ever stored.
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
import type { DrawnSignatureCapture, SignaturePoint, SignatureStroke } from '@aobplatform/domain';
import { strings } from '../strings';
import styles from '../kiosk.module.css';

/** The wire shapes, imported rather than restated — one definition (REQ-SIG-01). */
export type Point = SignaturePoint;
export type Stroke = SignatureStroke;

export interface SignaturePadHandle {
  /** Drops both representations. */
  clear(): void;
  /** The vector. Empty until somebody has drawn something. */
  strokes(): readonly Stroke[];
  /** The raster, or null where no canvas context exists (a server render, a test). */
  toPngDataUrl(): string | null;
  /**
   * EVERYTHING THE SIGN CALL NEEDS, or null when there is nothing to send —
   * no ink, or a canvas that cannot rasterise itself. Null is a refusal to
   * compose half a signature: a vector with no image stores one half of what
   * REQ-SIG-01 asks for and reads as though the other half was lost.
   */
  capture(): DrawnSignatureCapture | null;
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
  /**
   * THE CLOCK STARTS AT THE FIRST POINT, not at page load and not at the
   * epoch. What is evidential is the SHAPE of the timing — how long the pen
   * paused between strokes, how fast the hand moved — and an absolute clock on
   * the patient's own device is a fact about the device instead.
   */
  const timeOriginRef = useRef<number | null>(null);
  /** The pad's logical size in CSS pixels, kept current by `resize`. */
  const padSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

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
    // The LOGICAL size — CSS pixels, the space the points are measured in.
    padSizeRef.current = { width: rect.width, height: rect.height };
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
    // Named rather than reached through `this`, so `capture()` still works if
    // a caller ever destructures the handle.
    const toPngDataUrl = (): string | null => {
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
    };

    handleRef.current = {
      clear() {
        strokesRef.current = [];
        currentRef.current = [];
        // The clock restarts with the ink. A second attempt that carried the
        // first one's origin would show a pause nobody made.
        timeOriginRef.current = null;
        redraw();
        onInkChange(false);
      },
      strokes() {
        return strokesRef.current;
      },
      toPngDataUrl,
      capture() {
        if (strokesRef.current.length === 0) return null;
        const dataUrl = toPngDataUrl();
        if (!dataUrl) return null;
        const { width, height } = padSizeRef.current;
        if (!(width > 0) || !(height > 0)) return null;
        return {
          // AS CAPTURED. Nothing on this path rounds, thins or reorders a
          // point; the server hashes what the hand produced.
          vector: strokesRef.current,
          // The prefix is stripped here so the wire carries base64 and nothing
          // else; the server tolerates either.
          rasterPngBase64: dataUrl.replace(/^data:[^;]*;base64,/, ''),
          padWidth: width,
          padHeight: height,
        };
      },
    };
    const ref = handleRef;
    return () => {
      ref.current = null;
    };
  }, [handleRef, onInkChange, redraw]);

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    const now = typeof event.timeStamp === 'number' ? event.timeStamp : 0;
    if (timeOriginRef.current === null) timeOriginRef.current = now;
    /*
     * PRESSURE IS OMITTED WHERE IT WAS NOT MEASURED. A mouse reports a
     * constant 0.5 and a device with no sensor reports 0; both would read as a
     * measurement in the record. Only a real positive reading is carried, and
     * its absence is an honest "this device did not say".
     */
    const pressure = typeof event.pressure === 'number' && event.pressure > 0 ? event.pressure : undefined;
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      t: now - timeOriginRef.current,
      ...(pressure === undefined ? {} : { p: pressure }),
    };
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

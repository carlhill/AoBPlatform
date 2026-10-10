'use client';

/**
 * Signing on glass — a `<canvas>` and pointer events, no drawing library and
 * no new runtime dependency.
 *
 * BOTH REPRESENTATIONS ARE CAPTURED AND BOTH ARE NOW SENT (REQ-SIG-01/-02).
 * The VECTOR is the stroke points with the gaps between strokes preserved; the
 * RASTER is the same drawing as a PNG. The Expo build captured only the vector,
 * because a react-native View cannot rasterise itself; a canvas can.
 *
 * THE RASTER IS ONE PIXEL PER PAD PIXEL, WHATEVER THE SCREEN (review, 10 Oct
 * 2026). It used to be the on-screen canvas itself, which is sized in DEVICE
 * pixels: on a 14" tablet at three device pixels per CSS pixel, with the
 * larger pad, a dense signature came to ~1.6 MB against the server's 512 KB
 * (`MAX_SIGNATURE_RASTER_BYTES`) — a refusal the patient could not fix. So the
 * strokes are drawn again, exactly as captured, into an off-screen canvas of
 * `padWidth` x `padHeight` and that is what is sent. The screen keeps its
 * full resolution; the record gets an image whose size is the pad's, like
 * the vector beside it, and no longer depends on which tablet took it.
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
 * THE PAD'S SIZE FREEZES FROM THE FIRST TOUCH (10 Oct 2026, from the review of
 * the tablet-fit change). The points are CSS pixels of the pad AS IT WAS when
 * they were drawn, and `padWidth`/`padHeight` say what that was. A resize used
 * to re-measure regardless: the backing store took the NEW size, the old
 * points were redrawn into it unscaled, and the capture then sent the new size
 * beside the old points — a raster cropped or padded, and a vector that no
 * longer agreed with either. A tablet turned on its side, Edge's toolbar
 * sliding away, or the kiosk going full screen just after K-4 mounts are all
 * resizes, and the last can land mid-stroke.
 *
 * So from the first pointerdown of a stroke until `clear()`, the pad keeps the
 * size it had: the backing store is not touched and the logical size is not
 * rewritten, so vector, raster and pad size are measured in one space. The
 * pad is measured AT the pointerdown and pinned there and then, so a layout
 * change in the same frame as the touch (full screen arriving as the patient
 * reaches for the glass) cannot stretch the box the first points are read
 * against. Clearing unpins it and re-measures. With no ink and no stroke in
 * progress a resize re-measures freely, exactly as before.
 *
 * THE PATIENT SEES ALL OF THEIR INK (review, 10 Oct 2026). Pinned inside a
 * frame that has since shrunk — signed upright, then turned on its side — the
 * pad is SCALED DOWN to fit at its own shape, never clipped: ink that is in
 * the stored raster and vector must be on the screen when they press Sign.
 * A touch on a scaled pad is mapped back into the pad's own space, so a
 * stroke added afterwards lands under the finger and in the same coordinates
 * as the rest. A point is never rescaled after it is captured (REQ-SIG-02).
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

/** Draw strokes, as captured, onto a context already set up to draw them. */
function drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly { points: readonly Point[] }[]): void {
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
}

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
    // EVERY DEVICE PIXEL, under an identity transform. Dividing by today's
    // ratio would miss part of a bitmap sized at another one, and a raster
    // must never carry ink the vector does not (review, 10 Oct 2026).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    drawStrokes(ctx, [...strokesRef.current, { points: currentRef.current }]);
  }, [context]);

  /**
   * PIN THE CANVAS AT THE PAD'S SIZE, SCALED DOWN IF ITS FRAME IS SMALLER.
   * The ratio is kept, so the ink is shown at its own shape; it is never
   * enlarged, so a pad pinned in a larger frame simply leaves room round it.
   */
  const pin = useCallback((canvas: HTMLCanvasElement) => {
    const { width, height } = padSizeRef.current;
    // The frame's INNER box: its 1px border is not room the pad can use.
    const frame = canvas.parentElement;
    const room = frame ? { width: frame.clientWidth, height: frame.clientHeight } : null;
    const scale =
      room && room.width > 0 && room.height > 0 ? Math.min(1, room.width / width, room.height / height) : 1;
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
  }, []);

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
    const held = strokesRef.current.length > 0 || drawingRef.current || currentRef.current.length > 0;
    const frozen = padSizeRef.current;
    if (held && frozen.width > 0 && frozen.height > 0) {
      // INK, OR A STROKE IN PROGRESS: keep the size it was drawn at, fitted
      // to the frame. Backing store and logical size untouched, so nothing
      // already captured is reinterpreted. See the module note.
      pin(canvas);
      return;
    }
    canvas.style.width = '';
    canvas.style.height = '';
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
  }, [context, pin, redraw]);

  useEffect(() => {
    resize();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', resize);
    /*
     * AND WHEN ITS FRAME CHANGES WITHOUT THE WINDOW DOING SO — a column
     * reflowing, a font arriving. The FRAME is observed, not the canvas:
     * pinning resizes the canvas, and an observer that resized the element it
     * watches would loop ("ResizeObserver loop completed with undelivered
     * notifications"). The frame's size is set by CSS and never by the canvas.
     */
    const frame = canvasRef.current?.parentElement ?? null;
    const observer = typeof ResizeObserver === 'undefined' || !frame ? null : new ResizeObserver(() => resize());
    if (observer && frame) observer.observe(frame);
    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, [resize]);

  useEffect(() => {
    // Named rather than reached through `this`, so `capture()` still works if
    // a caller ever destructures the handle.
    const toPngDataUrl = (): string | null => {
      const canvas = canvasRef.current;
      if (!canvas || typeof document === 'undefined') return null;
      if (strokesRef.current.length === 0) return null;
      const { width, height } = padSizeRef.current;
      if (!(width > 0) || !(height > 0)) return null;
      try {
        // At the pad's own size, one pixel per pad pixel (see the module note).
        const out = document.createElement('canvas');
        out.width = Math.round(width);
        out.height = Math.round(height);
        const ctx = typeof out.getContext === 'function' ? out.getContext('2d') : null;
        if (!ctx || typeof out.toDataURL !== 'function') return null;
        ctx.lineWidth = LINE_WIDTH;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = context()?.strokeStyle ?? '#16181a';
        drawStrokes(ctx, strokesRef.current);
        return out.toDataURL('image/png');
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
        drawingRef.current = false;
        // Nothing is held now, so the pad takes whatever size its frame has.
        resize();
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
  }, [context, handleRef, onInkChange, redraw, resize]);

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    /*
     * IN THE PAD'S OWN SPACE. Unscaled this is 1 and the point is the CSS
     * pixel it always was; on a pad scaled down to fit a smaller frame it maps
     * the touch back to where it falls on the pad as signed.
     */
    const pad = padSizeRef.current;
    const scaleX = rect.width > 0 && pad.width > 0 ? pad.width / rect.width : 1;
    const scaleY = rect.height > 0 && pad.height > 0 ? pad.height / rect.height : 1;
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
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
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
          // THE FIRST TOUCH MEASURES AND PINS. With nothing held, the pad is
          // re-measured now — whatever the layout did this frame — and pinned
          // before a single point is read (see the module note).
          const canvas = event.currentTarget;
          const held = strokesRef.current.length > 0 || currentRef.current.length > 0;
          if (!held) resize();
          pin(canvas);
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

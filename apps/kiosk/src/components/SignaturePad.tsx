/**
 * Signing on glass. A `PanResponder` over a plain View collects the stroke
 * points and draws them as short segments — no drawing library, no new
 * runtime dependency.
 *
 * WHAT THIS IS NOT, YET. REQ-SIG-02 asks for vector AND raster capture, bound
 * to the artefact. This pad captures the VECTOR (the stroke points, with the
 * gaps between strokes preserved) and reports whether ink exists; it does not
 * rasterise, and the MVP does not upload either representation — the server's
 * `POST /agreements/:id/sign` takes a method, a channel and a capture request
 * and binds the artefact hash itself. Wiring the stroke payload through is a
 * change to the sign DTO and belongs with the person who owns that contract.
 * Said plainly here rather than implied by silence.
 *
 * TAP TO APPROVE IS EQUALLY VALID (Carl, Part 6 decision 4: BOTH). It is not a
 * lesser path or a fallback for failure — it is offered beside the pad, and
 * `SignatureEvent.method` already carries which was used.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, layout, space, type } from '../theme';
import { strings } from '../strings';

export interface Stroke {
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export function SignaturePad({
  onInkChange,
  strokesRef,
}: {
  onInkChange: (hasInk: boolean) => void;
  strokesRef: { current: Stroke[] };
}): ReactNode {
  const [, forceRender] = useState(0);
  const currentRef = useRef<Array<{ x: number; y: number }>>([]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          currentRef.current = [{ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }];
        },
        onPanResponderMove: (event) => {
          currentRef.current.push({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY });
          forceRender((n) => n + 1);
        },
        onPanResponderRelease: () => {
          if (currentRef.current.length > 1) {
            strokesRef.current.push({ points: [...currentRef.current] });
            onInkChange(true);
          }
          currentRef.current = [];
          forceRender((n) => n + 1);
        },
      }),
    [onInkChange, strokesRef],
  );

  const segments: ReactNode[] = [];
  const allStrokes = [...strokesRef.current, { points: currentRef.current }];
  allStrokes.forEach((stroke, strokeIndex) => {
    for (let i = 1; i < stroke.points.length; i += 1) {
      const a = stroke.points[i - 1];
      const b = stroke.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      segments.push(
        <View
          key={`${strokeIndex}-${i}`}
          pointerEvents="none"
          style={[
            styles.segment,
            { left: a.x, top: a.y, width: length, transform: [{ rotateZ: `${angle}deg` }] },
          ]}
        />,
      );
    }
  });

  return (
    <View style={styles.pad} testID="signature-pad" {...responder.panHandlers}>
      {segments}
      <View pointerEvents="none" style={styles.rule} />
      <Text pointerEvents="none" style={styles.hint}>
        {strings.signature.padHint}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: {
    flex: 1,
    minHeight: 220,
    backgroundColor: colors.white,
    borderWidth: layout.borderWidth,
    borderColor: colors.divider,
    borderRadius: layout.radius,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: space.lg,
    overflow: 'hidden',
  },
  segment: {
    position: 'absolute',
    height: 3,
    backgroundColor: colors.ink,
    transformOrigin: 'left center',
  },
  rule: {
    position: 'absolute',
    left: 60,
    right: 60,
    bottom: 64,
    borderBottomWidth: layout.borderWidth,
    borderBottomColor: colors.divider,
  },
  hint: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.neutral700 },
});

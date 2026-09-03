/**
 * The chrome every kiosk screen wears, and the blueprint treatment the
 * handoff's hi-fi frames are built from: a 1px divider border, square corners,
 * and four `+` registration marks.
 *
 * ORIENTATION IS A LAYOUT DECISION, NEVER A CONTENT ONE. `useOrientation`
 * reports landscape or portrait and screens use it to STACK, never to drop a
 * field: portrait shows the same field set as landscape, always (build brief;
 * handoff §6). A component that renders fewer inputs in portrait would be a
 * different consent form on a turned tablet.
 */
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, fonts, layout, space, type } from '../theme';
import { strings } from '../strings';

export function useOrientation(): 'landscape' | 'portrait' {
  const { width, height } = useWindowDimensions();
  return width >= height ? 'landscape' : 'portrait';
}

/**
 * WIDTH DECIDES THE COLUMNS, ORIENTATION DECIDES NOTHING ON ITS OWN.
 *
 * The first version branched on orientation alone, and it was wrong in a way
 * that only showed up off-target: a 670px-wide window is "landscape" by
 * orientation, so it got the two-column layout — a form column squeezed to
 * ~330px beside a 300px annotation panel — and the fields stacked into bands
 * of nothing. The tablet targets are 1024 and 820; anything under
 * `TWO_COLUMN_MIN` gets one column, whichever way round it is.
 *
 * `contentMax` stops the other failure: on a very wide window a single column
 * of 64px inputs stretched to 1600px reads as a form somebody abandoned.
 */
const TWO_COLUMN_MIN = 900;

export interface KioskLayout {
  readonly orientation: 'landscape' | 'portrait';
  readonly width: number;
  readonly height: number;
  /** Two columns fit: form beside its annotation rail. */
  readonly isWide: boolean;
  /** Screen padding, tightened on narrow windows so content is not squeezed twice. */
  readonly pad: number;
  /** Comfortable measure for a column of fields. */
  readonly contentMax: number;
}

export function useLayout(): KioskLayout {
  const { width, height } = useWindowDimensions();
  const isWide = width >= TWO_COLUMN_MIN;
  return {
    orientation: width >= height ? 'landscape' : 'portrait',
    width,
    height,
    isWide,
    pad: width >= 768 ? layout.screenPadding : space.lg,
    contentMax: isWide ? 620 : 760,
  };
}

export function Registration(): ReactNode {
  return (
    <>
      <View style={[styles.corner, styles.cornerTl]} />
      <View style={[styles.corner, styles.cornerTr]} />
      <View style={[styles.corner, styles.cornerBl]} />
      <View style={[styles.corner, styles.cornerBr]} />
    </>
  );
}

export function Blueprint({
  children,
  style,
  accented = false,
}: {
  children: ReactNode;
  style?: object;
  accented?: boolean;
}): ReactNode {
  return (
    <View style={[styles.blueprint, accented ? styles.blueprintAccented : null, style]}>
      <Registration />
      {children}
    </View>
  );
}

export function Tag({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' }): ReactNode {
  return (
    <View style={[styles.tag, tone === 'accent' ? styles.tagAccent : styles.tagNeutral]}>
      <Text style={[styles.tagText, tone === 'accent' ? styles.tagTextAccent : null]}>{label}</Text>
    </View>
  );
}

export function Kicker({ label }: { label: string }): ReactNode {
  return <Text style={styles.kicker}>{label}</Text>;
}

/**
 * Header, content and footer. `stepTag` is the "Step 2 of 4" chip; `context`
 * is the one line of footer context the handoff puts bottom-right.
 */
export function Screen({
  practiceName,
  locationLine,
  stepTag,
  context,
  onLeave,
  children,
}: {
  practiceName: string;
  locationLine?: string | null;
  stepTag?: string;
  context?: string;
  /**
   * THE WAY OUT (Carl, 3 Sep 2026; REQ-REC-04, hard rule 8).
   *
   * Every screen of the ceremony passes this, and the control it draws sits in
   * the header — above the content, never inside a scroller, so it is reachable
   * without scrolling on any window this app can be opened at.
   *
   * IT IS AN EXIT, NOT A SKIP. The handler behind it changes local screen state
   * and nothing else: it calls no endpoint, advances no agreement, completes no
   * capture request and bypasses neither verification nor signing. A patient
   * who walks away leaves the record exactly as they found it. If a walk-away
   * is ever worth recording it belongs in the vault as an ordinary event —
   * never as a decline or a refusal, which are different things with different
   * consequences for the practice.
   *
   * AND IT DOES NOT COMPETE. 44px, quiet, outline only, beside the step tag —
   * the ceremony's own actions are 56 and 72px and filled. It is the calm
   * option, not a second call to action.
   */
  onLeave?: () => void;
  children: ReactNode;
}): ReactNode {
  const { pad } = useLayout();
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingHorizontal: pad }]}>
        <View style={styles.headerText}>
          <Text style={styles.practiceName}>{practiceName}</Text>
          {locationLine ? <Text style={styles.locationLine}>{locationLine}</Text> : null}
        </View>
        <View style={styles.headerActions}>
          {onLeave ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chrome.leaveAction}
              testID="leave-for-reception"
              onPress={onLeave}
              style={({ pressed }) => [styles.leave, pressed ? styles.leavePressed : null]}
            >
              <Text style={styles.leaveLabel}>{strings.chrome.leaveAction}</Text>
            </Pressable>
          ) : null}
          {stepTag ? <Tag label={stepTag} tone="accent" /> : null}
        </View>
      </View>
      <View style={[styles.content, { padding: pad }]}>{children}</View>
      <View style={[styles.footer, { paddingHorizontal: pad }]}>
        <Text style={styles.platformMark}>{strings.appName}</Text>
        {context ? <Text style={styles.footerContext}>{context}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    borderBottomWidth: layout.borderWidth,
    borderBottomColor: colors.divider,
  },
  headerText: { flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 0 },
  /*
   * 44px exactly — the WCAG floor, deliberately the smallest target on the
   * device. The ceremony's own controls are 56 and 72 and filled with accent;
   * this one is an outline. A patient must be able to find it; they must not be
   * drawn to it instead of to signing.
   */
  leave: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: layout.borderWidth,
    borderColor: colors.neutral400,
    borderRadius: layout.radius,
    backgroundColor: 'transparent',
  },
  leavePressed: { backgroundColor: colors.neutral200 },
  leaveLabel: { fontFamily: fonts.bodyMedium, fontSize: type.label, color: colors.neutral700 },
  practiceName: { fontFamily: fonts.heading, fontSize: 26, color: colors.ink },
  locationLine: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
  content: { flex: 1 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: layout.borderWidth,
    borderTopColor: colors.divider,
  },
  platformMark: {
    fontFamily: fonts.heading,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.neutral700,
  },
  footerContext: { fontFamily: fonts.body, fontSize: type.footnote, color: colors.neutral700, flexShrink: 1 },

  blueprint: {
    borderWidth: layout.borderWidth,
    borderColor: colors.divider,
    borderRadius: layout.radius,
    padding: space.lg,
    backgroundColor: colors.ground,
  },
  blueprintAccented: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  corner: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderColor: colors.accent,
  },
  cornerTl: { top: -1, left: -1, borderTopWidth: 1, borderLeftWidth: 1 },
  cornerTr: { top: -1, right: -1, borderTopWidth: 1, borderRightWidth: 1 },
  cornerBl: { bottom: -1, left: -1, borderBottomWidth: 1, borderLeftWidth: 1 },
  cornerBr: { bottom: -1, right: -1, borderBottomWidth: 1, borderRightWidth: 1 },

  tag: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: layout.radius,
    borderWidth: layout.borderWidth,
    alignSelf: 'flex-start',
  },
  tagNeutral: { backgroundColor: colors.neutral200, borderColor: colors.divider },
  tagAccent: { backgroundColor: colors.accent100, borderColor: colors.accent400 },
  tagText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.neutral800 },
  tagTextAccent: { color: colors.accent800 },

  kicker: {
    fontFamily: fonts.heading,
    fontSize: type.kicker,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.accent700,
    marginBottom: space.sm,
  },
});

export const chromeStyles = styles;

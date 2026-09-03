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
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, fonts, layout, space, type } from '../theme';
import { strings } from '../strings';

export function useOrientation(): 'landscape' | 'portrait' {
  const { width, height } = useWindowDimensions();
  return width >= height ? 'landscape' : 'portrait';
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
  children,
}: {
  practiceName: string;
  locationLine?: string | null;
  stepTag?: string;
  context?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.practiceName}>{practiceName}</Text>
          {locationLine ? <Text style={styles.locationLine}>{locationLine}</Text> : null}
        </View>
        {stepTag ? <Tag label={stepTag} tone="accent" /> : null}
      </View>
      <View style={styles.content}>{children}</View>
      <View style={styles.footer}>
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
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.xl,
    borderBottomWidth: layout.borderWidth,
    borderBottomColor: colors.divider,
  },
  headerText: { flexShrink: 1 },
  practiceName: { fontFamily: fonts.heading, fontSize: 26, color: colors.ink },
  locationLine: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
  content: { flex: 1, padding: layout.screenPadding },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: space.lg,
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

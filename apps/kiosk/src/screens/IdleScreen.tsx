/**
 * K-1 — idle, and the waiting list behind it.
 *
 * WHY THE LIST IS NOT ON THE IDLE SCREEN. The plan's step 1 is "today's list,
 * staff taps the arriving patient" and the handoff's K-1 is a centred
 * invitation with one button. Both are right, and they resolve the same way:
 * the idle state shows the invitation and a COUNT, and the list of names
 * appears only after somebody taps. A tablet sitting on a counter all morning
 * displaying who is in the waiting room is a screen anyone in the room can
 * read — the same exposure the confidentiality flag exists to prevent, made
 * ambient. The count is not identifying; the names are.
 *
 * A FAILED LOAD ENDS AT THE DESK, NOT AT A DEAD END (REQ-REC-04). The error
 * says the appointment is unaffected, offers a retry, and the last good list
 * stays on screen.
 */
import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Blueprint, Screen, Tag } from '../components/Chrome';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { strings } from '../strings';
import { colors, fonts, layout, space, type } from '../theme';
import type { KioskWaitingRow } from '../api/types';

export function IdleScreen({
  practiceName,
  locationLine,
  mode,
  rows,
  error,
  online,
  queueDepth,
  onStart,
  onBack,
  onPick,
  onRetry,
}: {
  practiceName: string;
  locationLine: string | null;
  mode: 'idle' | 'list';
  rows: readonly KioskWaitingRow[];
  error: string | null;
  online: boolean;
  queueDepth: number;
  onStart: () => void;
  onBack: () => void;
  onPick: (row: KioskWaitingRow) => void;
  onRetry: () => void;
}): ReactNode {
  const context = !online
    ? strings.chrome.offline
    : queueDepth > 0
      ? strings.chrome.offlineQueued(queueDepth)
      : strings.chrome.allSynced;

  if (mode === 'idle') {
    return (
      <Screen practiceName={practiceName} locationLine={locationLine} context={context}>
        <View style={styles.centred}>
          <Text style={styles.h1}>{strings.idle.heading}</Text>
          <Text style={styles.lede}>{strings.idle.lede}</Text>
          <PrimaryButton label={strings.idle.start} onPress={onStart} testID="start-check-in" />
          <Text style={styles.count} testID="waiting-count">
            {rows.length > 0 ? strings.idle.waitingCount(rows.length) : strings.idle.nobodyWaiting}
          </Text>
          {error ? <Text style={styles.error}>{strings.idle.loadFailed}</Text> : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.idle.listHeading}
      context={context}
    >
      <View style={styles.listHeader}>
        <Text style={styles.h2}>{strings.idle.listHeading}</Text>
        <Text style={styles.hint}>{strings.idle.listHint}</Text>
      </View>
      {error ? (
        <Blueprint style={styles.errorPanel}>
          <Text style={styles.errorText}>{strings.idle.loadFailed}</Text>
          <SecondaryButton label={strings.idle.retry} onPress={onRetry} />
        </Blueprint>
      ) : null}
      <ScrollView contentContainerStyle={styles.list}>
        {rows.length === 0 ? (
          <Text style={styles.hint}>{strings.idle.nobodyWaiting}</Text>
        ) : (
          rows.map((row) => (
            <View key={row.captureRequestId} style={styles.rowWrap} testID={`waiting-row-${row.captureRequestId}`}>
              <SecondaryButton
                label={row.patientName}
                align="left"
                onPress={() => onPick(row)}
                testID={`pick-${row.captureRequestId}`}
              />
              <View style={styles.rowMeta}>
                <Tag label={row.appointmentTime ?? strings.idle.walkIn} />
                {row.providerName ? <Tag label={row.providerName} /> : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <View style={styles.listFooter}>
        <SecondaryButton label={strings.idle.backToIdle} onPress={onBack} testID="back-to-idle" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: 80 },
  h1: { fontFamily: fonts.heading, fontSize: type.h1, color: colors.ink, textAlign: 'center' },
  h2: { fontFamily: fonts.heading, fontSize: type.h2, color: colors.ink },
  lede: {
    fontFamily: fonts.body,
    fontSize: type.bodyLarge,
    color: colors.neutral700,
    textAlign: 'center',
    maxWidth: 560,
  },
  count: { fontFamily: fonts.bodyMedium, fontSize: type.bodySmall, color: colors.neutral700 },
  error: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink, textAlign: 'center' },
  listHeader: { gap: space.xs, marginBottom: space.lg },
  hint: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.neutral700 },
  list: { gap: space.md, paddingBottom: space.lg },
  rowWrap: { gap: space.xs },
  rowMeta: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  listFooter: { marginTop: space.md, alignItems: 'flex-start' },
  errorPanel: { marginBottom: space.md, gap: space.sm },
  errorText: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink },
  divider: { height: layout.borderWidth, backgroundColor: colors.divider },
});

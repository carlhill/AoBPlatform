/**
 * K-6 — done, and back to idle.
 *
 * IT REPORTS THE EVENT, NOT SUCCESS ON ITS OWN AUTHORITY (handoff §6). The
 * heading appears because the server returned a stored agreement and a
 * completed capture request; the write-back line says "being written back",
 * because that is a queued sweep and claiming it landed would be a claim the
 * kiosk cannot support.
 *
 * NO PORTAL ACTIVATION HERE. The handoff offers it and the MVP scope
 * explicitly excludes it — an optional account is a whole flow (identity,
 * delivery, revocation) and building half of it would be worse than not
 * offering it.
 *
 * NOTHING PATIENT-IDENTIFYING SURVIVES THIS SCREEN. The countdown returns to
 * idle and the caller drops the session state; the kiosk keeps no record of
 * who was just here (C2: no residual patient data on device).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/Chrome';
import { PrimaryButton } from '../components/Buttons';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';

const RETURN_SECONDS = 20;

export function CompleteScreen({
  practiceName,
  locationLine,
  givenName,
  queued,
  onDone,
}: {
  practiceName: string;
  locationLine: string | null;
  givenName: string;
  queued: boolean;
  onDone: () => void;
}): ReactNode {
  const [remaining, setRemaining] = useState(RETURN_SECONDS);

  useEffect(() => {
    if (remaining <= 0) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onDone]);

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.complete}
      context={strings.complete.writeBackQueued}
    >
      <View style={styles.centred}>
        <Text style={styles.h1} testID="complete-heading">
          {strings.complete.heading(givenName)}
        </Text>
        <Text style={styles.body}>{queued ? strings.complete.queuedBody : strings.complete.body}</Text>
        <PrimaryButton label={strings.complete.done} onPress={onDone} testID="complete-done" />
        <Text style={styles.muted}>{strings.complete.returning(remaining)}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: 120 },
  h1: { fontFamily: fonts.heading, fontSize: type.h1Small, color: colors.ink, textAlign: 'center' },
  body: {
    fontFamily: fonts.body,
    fontSize: type.bodyLarge,
    color: colors.neutral700,
    textAlign: 'center',
    maxWidth: 560,
  },
  muted: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
});

/**
 * The one screen every failure on this device ends at: "please see reception".
 *
 * IT EXISTS BECAUSE NOTHING MAY BLOCK CARE (REQ-REC-04). A verification
 * lockout, a rules-engine refusal, an assignor the kiosk cannot record, a core
 * that stopped answering — each of them stops the EVIDENCE, and none of them
 * may stop the patient. So every dead end on this tablet has a door, the door
 * says the appointment is unaffected, and it resets the device for the next
 * person rather than stranding this one on an error.
 */
import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Blueprint, Screen } from '../components/Chrome';
import { PrimaryButton } from '../components/Buttons';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';

export function HandoverScreen({
  practiceName,
  locationLine,
  heading,
  body,
  onDone,
}: {
  practiceName: string;
  locationLine: string | null;
  heading: string;
  body: string;
  onDone: () => void;
}): ReactNode {
  return (
    <Screen practiceName={practiceName} locationLine={locationLine} context={strings.chrome.staffHelp}>
      <View style={styles.centred}>
        <Blueprint style={styles.panel}>
          <Text style={styles.h2} testID="handover-heading">
            {heading}
          </Text>
          <Text style={styles.body} testID="handover-body">
            {body}
          </Text>
          <Text style={styles.muted}>{strings.verify.lockedReassurance}</Text>
        </Blueprint>
        <PrimaryButton label={strings.errors.startOver} onPress={onDone} testID="handover-done" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centred: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
  panel: { gap: space.sm, maxWidth: 640 },
  h2: { fontFamily: fonts.heading, fontSize: type.h2, color: colors.ink },
  body: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
});

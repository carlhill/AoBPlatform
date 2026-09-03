/**
 * K-4 — signing.
 *
 * THE CONTROL IS THE SAME COMPONENT AS ON K-3. `SignatureControl` takes
 * `validation` as a required prop with no default here as everywhere; this
 * screen cannot reach an enabled control except through the one union member
 * `evaluateSignatureGate` produces from a locked, validated, rendered payload
 * (REQ-REG-06).
 *
 * BOTH METHODS ARE REAL SIGNATURES (Carl, Part 6 decision 4: BOTH). Drawing on
 * glass and tapping to approve are offered side by side, and
 * `SignatureEvent.method` records which was used. Tap-to-approve is not a
 * degraded path for a failing pad — it is there because signing on glass is
 * genuinely hard for some hands.
 *
 * NO PRACTITIONER SIGNATURE FIELD (rule 3, abolished 1 July 2026) and no
 * amount (rule 4). There is one signature on this screen and it belongs to the
 * assignor.
 */
import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Blueprint, Screen } from '../components/Chrome';
import { SecondaryButton } from '../components/Buttons';
import { SignaturePad, type Stroke } from '../components/SignaturePad';
import { SignatureControl } from '../components/SignatureControl';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';
import type { SignatureValidation } from '../rules/signature-gate';

export function SignatureScreen({
  practiceName,
  locationLine,
  validation,
  strokesRef,
  inkPresent,
  submitting,
  error,
  onInkChange,
  onClear,
  onSignDrawn,
  onSignTap,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  validation: SignatureValidation;
  strokesRef: { current: Stroke[] };
  inkPresent: boolean;
  submitting: boolean;
  error: string | null;
  onInkChange: (hasInk: boolean) => void;
  onClear: () => void;
  onSignDrawn: () => void;
  onSignTap: () => void;
  onSeeReception: () => void;
}): ReactNode {
  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.stepOf(4, 4)}
      context={strings.signature.footer}
      onLeave={onSeeReception}
    >
      <View style={styles.stack}>
        {validation.state === 'valid' ? (
          <Blueprint accented style={styles.banner}>
            <Text style={styles.bannerText} testID="validated-banner">
              {strings.signature.validatedBanner}
            </Text>
          </Blueprint>
        ) : null}

        <SignaturePad strokesRef={strokesRef} onInkChange={onInkChange} />

        {error ? <Text style={styles.error}>{strings.signature.failed}</Text> : null}

        <View style={styles.actions}>
          <SecondaryButton label={strings.signature.clear} onPress={onClear} testID="signature-clear" />
          <View style={styles.grow}>
            <SignatureControl
              validation={validation}
              inkPresent={inkPresent}
              submitting={submitting}
              onSign={onSignDrawn}
            />
          </View>
        </View>

        <View style={styles.tapRow}>
          <Text style={styles.muted}>{strings.signature.tapToApprove}</Text>
          <View style={styles.grow}>
            {/*
              The same required-prop control, with ink treated as present
              because a tap IS the mark. It still cannot enable from an invalid
              payload — the gate is the same one.
            */}
            <SignatureControl
              validation={validation}
              inkPresent
              submitting={submitting}
              onSign={onSignTap}
              label={strings.signature.tapToApproveAction}
            />
          </View>
        </View>
        <Text style={styles.muted}>{strings.signature.tapToApproveHint}</Text>
        <Text style={styles.muted}>{strings.signature.binding}</Text>


      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { flex: 1, gap: space.md },
  banner: { paddingVertical: space.md },
  bannerText: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink },
  actions: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  tapRow: { flexDirection: 'row', gap: space.md, alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 240 },
  muted: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
  error: { fontFamily: fonts.bodyMedium, fontSize: type.label, color: colors.ink },
});

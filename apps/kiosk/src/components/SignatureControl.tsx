/**
 * THE REQ-REG-06 CONTROL. This is the component the hard rule is about.
 *
 * `validation` is a REQUIRED prop with NO DEFAULT. There is no `= undefined`,
 * no `?`, no `??` fallback, and no other prop that could stand in for it. The
 * enabled branch below is reached only inside `if (isSignable(validation))`,
 * and `isSignable` narrows to the single union member that
 * `evaluateSignatureGate` returns when — and only when — the domain's
 * `canEnableSignature` agrees that the particulars are present, locked and
 * validated. So the enabled control is not merely guarded at runtime: there
 * is no expression a caller can write that produces one from an invalid
 * payload.
 *
 * Signing a draft is the criminal offence in this regime. That is why the gate
 * is a type rather than an `if`.
 *
 * The disabled state NAMES THE COUNT ("Sign — 2 details still needed") and
 * lists the reasons, so the staff member the patient turns to can act.
 *
 * `inkPresent` is a second, independent condition: a drawn signature needs
 * ink before it can be submitted. It can only ever make the control MORE
 * restrictive — it is checked inside the `isSignable` branch, never instead
 * of it.
 */
import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GuardedButton } from './Buttons';
import { blockingCount, isSignable, type SignatureValidation } from '../rules/signature-gate';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';

export function SignatureControl({
  validation,
  inkPresent,
  submitting,
  onSign,
  label = strings.signature.signAction,
}: {
  /** REQUIRED. No default, anywhere, ever. */
  validation: SignatureValidation;
  inkPresent: boolean;
  submitting: boolean;
  onSign: () => void;
  /**
   * The ENABLED label only — the two ways to sign say different things ("I
   * agree and sign" on the pad, "I agree — approve by tapping" beside it), and
   * two identical buttons on one screen is a person tapping the wrong one.
   * Note what is NOT defaulted: `validation`. A default here changes wording;
   * a default there would change whether the control can enable.
   */
  label?: string;
}): ReactNode {
  if (isSignable(validation)) {
    if (submitting) {
      return (
        <GuardedButton
          label={label}
          state={{ disabled: true, disabledLabel: strings.signature.submitting }}
          onPress={onSign}
          testID="sign-control"
        />
      );
    }
    if (!inkPresent) {
      return (
        <GuardedButton
          label={label}
          state={{ disabled: true, disabledLabel: strings.signature.needsInk }}
          onPress={onSign}
          testID="sign-control"
        />
      );
    }
    return (
      <View>
        <GuardedButton
          label={label}
          state={{ disabled: false }}
          onPress={onSign}
          testID="sign-control"
        />
        <Text style={styles.hashLine}>{strings.particulars.hashLine(shortHash(validation.artefactHash))}</Text>
      </View>
    );
  }

  const count = blockingCount(validation);
  return (
    <GuardedButton
      label={label}
      state={{
        disabled: true,
        disabledLabel:
          validation.state === 'blocked' ? strings.signature.signBlocked(count) : strings.signature.signBlockedGeneric,
        reasons: validation.state === 'blocked' ? validation.reasons : undefined,
      }}
      onPress={onSign}
      testID="sign-control"
    />
  );
}

/** Grouped for reading aloud at a desk, exactly as the handoff draws it. */
export function shortHash(hash: string): string {
  return (hash.match(/.{1,4}/g) ?? []).slice(0, 4).join('·');
}

const styles = StyleSheet.create({
  hashLine: {
    marginTop: space.xs,
    fontFamily: fonts.body,
    fontSize: type.kicker,
    color: colors.neutral700,
  },
});

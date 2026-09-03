/**
 * K-3 — the locked particulars, and the screen the REQ-REG-06 rule is really
 * about.
 *
 * THE ARTEFACT IS THE SERVER'S. Nothing here composes a document: the kiosk
 * asks `POST /agreements/:id/particulars` to assemble the payload from the
 * platform's own records, validate it against the s 65C rule set, render it
 * and hash it — one deterministic render path (rule 13) — and then displays
 * what came back. A field the server did not send is not drawn.
 *
 * THREE STATES, AND ONLY ONE OF THEM CAN SIGN.
 *   validating — the lock round trip is in flight. Control disabled.
 *   blocked    — the rules engine refused, and its failures are listed by
 *                name. Control disabled, labelled with the count.
 *   valid      — particulars locked, rule-set and mapping versions recorded,
 *                artefact hashed. The only state that can sign.
 * The state is produced by `evaluateSignatureGate` from the agreement the
 * server returned; the screen cannot promote itself.
 *
 * D6a IS THE HONEST GAP. A pre-agreement needs a Basic Service Description
 * from the current mapping version, and no mapping exists yet — the plan
 * (§2.4) says an interim practice-maintained versioned list, and that table
 * has not been built. So this screen does NOT carry a list of descriptions:
 * hardcoding one would be exactly the mapping rule 14 forbids. It shows the
 * rules engine's refusal, and the handoff's own "ask a staff member" action
 * opens a single staff-entered field. The value is typed by a person at the
 * practice, recorded against whatever `mappingVersion` the rules service
 * reports, and is not a mapping in this codebase.
 *
 * NO DOLLAR AMOUNT AND NO PRACTITIONER SIGNATURE FIELD appear anywhere on this
 * screen (rules 3 and 4); the three tags along the bottom say so out loud,
 * because a reviewer standing at the tablet should be able to see the rule
 * being kept rather than take it on trust.
 */
import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Blueprint, Kicker, Screen, Tag, useOrientation } from '../components/Chrome';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { SignatureControl, shortHash } from '../components/SignatureControl';
import { strings } from '../strings';
import { colors, fonts, space, type } from '../theme';
import type { SignatureValidation } from '../rules/signature-gate';

export interface ParticularsView {
  readonly patientName: string;
  readonly providerName: string | null;
  readonly providerAddress: string | null;
  readonly serviceDate: string | null;
  readonly agreementDate: string | null;
  readonly basicServiceDescription: string | null;
  readonly assignorIsPatient: boolean;
  readonly assignorName: string | null;
  readonly assignorRelationship: string | null;
  readonly ruleSetVersion: string | null;
  readonly mappingVersion: string | null;
  readonly artefactHash: string | null;
}

export function ParticularsScreen({
  practiceName,
  locationLine,
  view,
  validation,
  serverFailures,
  staffEntryOpen,
  staffDescription,
  busy,
  onOpenStaffEntry,
  onChangeStaffDescription,
  onRetryLock,
  onContinue,
  onSeeReception,
}: {
  practiceName: string;
  locationLine: string | null;
  view: ParticularsView;
  validation: SignatureValidation;
  /** The rules engine's own failure lines, when it refused the lock. */
  serverFailures: readonly string[];
  staffEntryOpen: boolean;
  staffDescription: string;
  busy: boolean;
  onOpenStaffEntry: () => void;
  onChangeStaffDescription: (next: string) => void;
  onRetryLock: () => void;
  onContinue: () => void;
  onSeeReception: () => void;
}): ReactNode {
  const orientation = useOrientation();
  // Presentation only. The reasons a person reads may be the server's; whether
  // the control can enable is decided by `validation` and nothing else.
  const shown: SignatureValidation =
    validation.state === 'blocked' && serverFailures.length > 0
      ? { state: 'blocked', reasons: serverFailures }
      : validation;

  return (
    <Screen
      practiceName={practiceName}
      locationLine={locationLine}
      stepTag={strings.chrome.stepOf(3, 4)}
      context={strings.particulars.footer}
    >
      <View style={orientation === 'landscape' ? styles.twoColumn : styles.oneColumn}>
        <Blueprint style={styles.document}>
          <View style={styles.documentHeader}>
            <Text style={styles.documentTitle}>{strings.particulars.documentTitle}</Text>
            {view.ruleSetVersion && view.mappingVersion ? (
              <Text style={styles.versions}>
                {strings.particulars.versions(view.ruleSetVersion, view.mappingVersion)}
              </Text>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            <Row label={strings.particulars.patient} value={view.patientName} />
            <Row label={strings.particulars.provider} value={view.providerName} />
            <Row label={strings.particulars.placeOfPractice} value={view.providerAddress} />
            <Row label={strings.particulars.serviceDate} value={view.serviceDate} />
            <Row label={strings.particulars.agreementDate} value={view.agreementDate} />
            <Row label={strings.particulars.service} value={view.basicServiceDescription} />
            <Row
              label={strings.particulars.assignor}
              value={
                view.assignorIsPatient
                  ? strings.particulars.assignorIsPatient
                  : strings.particulars.assignorIsOther(view.assignorName ?? '', view.assignorRelationship ?? '')
              }
            />
            <Text style={styles.consent}>{strings.particulars.consentText}</Text>
          </ScrollView>
          <View style={styles.tags}>
            <Tag label={strings.particulars.tagNoAmount} />
            <Tag label={strings.particulars.tagNoProviderSignature} />
            <Tag label={strings.particulars.tagHashBeforeSigning} />
          </View>
        </Blueprint>

        <View style={styles.rail}>
          {shown.state === 'valid' ? (
            <Blueprint>
              <Kicker label={strings.particulars.validatedHeading} />
              <Text style={styles.railText}>{strings.particulars.validatedBody}</Text>
              <Text style={styles.hash} testID="artefact-hash">
                {strings.particulars.hashLine(shortHash(shown.artefactHash))}
              </Text>
            </Blueprint>
          ) : (
            <Blueprint>
              <Kicker
                label={
                  shown.state === 'validating'
                    ? strings.particulars.validating
                    : strings.particulars.blockedHeading(shown.reasons.length)
                }
              />
              {shown.state === 'blocked'
                ? shown.reasons.map((reason, index) => (
                    <View key={reason} style={styles.reasonRow}>
                      <Text style={styles.reasonOrdinal}>{String(index + 1).padStart(2, '0')}</Text>
                      <Text style={styles.reasonText} testID={`lock-failure-${index}`}>
                        {reason}
                      </Text>
                    </View>
                  ))
                : null}
              {!staffEntryOpen ? (
                <SecondaryButton
                  label={strings.particulars.askStaff}
                  onPress={onOpenStaffEntry}
                  testID="ask-staff"
                />
              ) : (
                <View style={styles.staffEntry}>
                  <Field
                    label={strings.particulars.staffDescriptionLabel}
                    hint={strings.particulars.staffDescriptionHint}
                    value={staffDescription}
                    onChangeText={onChangeStaffDescription}
                    testID="staff-service-description"
                  />
                  <PrimaryButton
                    label={busy ? strings.particulars.validating : strings.particulars.staffDescriptionAction}
                    onPress={onRetryLock}
                    size="standard"
                    testID="staff-retry-lock"
                  />
                </View>
              )}
            </Blueprint>
          )}

          {/*
            The sign control lives on this screen too, disabled, so the patient
            can see what is between them and signing — the handoff draws it
            exactly here. Its enabled twin is on K-4; both are the SAME
            component and both take `validation` as a required prop.
          */}
          <SignatureControl validation={shown} inkPresent submitting={false} onSign={onContinue} />
          {shown.state === 'valid' ? (
            <PrimaryButton
              label={strings.particulars.continueToSign}
              onPress={onContinue}
              testID="continue-to-sign"
            />
          ) : (
            <SecondaryButton label={strings.errors.seeReception} onPress={onSeeReception} />
          )}
        </View>
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string | null }): ReactNode {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  twoColumn: { flex: 1, flexDirection: 'row', gap: space.xl },
  oneColumn: { flex: 1, flexDirection: 'column', gap: space.lg },
  document: { flex: 1, gap: space.md },
  documentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' },
  documentTitle: { fontFamily: fonts.heading, fontSize: 24, color: colors.ink },
  versions: { fontFamily: fonts.body, fontSize: 13, color: colors.neutral700 },
  grid: { gap: space.md, paddingVertical: space.sm },
  row: { gap: 2 },
  rowLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.neutral700 },
  rowValue: { fontFamily: fonts.body, fontSize: type.bodySmall, color: colors.ink },
  consent: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: space.md,
    fontFamily: fonts.body,
    fontSize: type.bodySmall,
    lineHeight: 26,
    color: colors.ink,
  },
  tags: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  rail: { width: 330, gap: space.md },
  railText: { fontFamily: fonts.body, fontSize: type.footnote, color: colors.ink },
  hash: { marginTop: space.xs, fontFamily: fonts.body, fontSize: type.kicker, color: colors.neutral700 },
  reasonRow: { flexDirection: 'row', gap: space.xs, marginBottom: space.xs },
  reasonOrdinal: { fontFamily: fonts.body, fontSize: type.label, color: colors.neutral700 },
  reasonText: { fontFamily: fonts.body, fontSize: type.label, color: colors.ink, flexShrink: 1 },
  staffEntry: { gap: space.sm, marginTop: space.sm },
});

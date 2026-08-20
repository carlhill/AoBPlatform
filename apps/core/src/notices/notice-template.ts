import type { NoticeContent } from '@aobplatform/domain';

/**
 * Reg 89AA notice copy.
 *
 * LANGUAGE RULES, all load-bearing:
 *  - NO APPROVAL SEMANTICS (FR-6.3, design decisions §1). The notice is
 *    one-way; nothing is being approved, confirmed or accepted. No "please
 *    confirm", no "click to approve", no call to action of any kind.
 *  - It must be identifiable AS the statutory notice (experience-feedback
 *    §1): no surveys, no marketing, nothing bolted on.
 *  - It cannot be opted out of, and the copy says so honestly — the only way
 *    to stop these is to terminate the agreement (REQ-CHAT-09).
 *  - Never "certified/approved/accredited" (rule 12).
 *  - UK/AU spelling. All strings move to the string table with M14
 *    (REQ-LANG-01); this module is the single place they live meanwhile.
 */
export function formatBenefit(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function noticeBody(content: NoticeContent, practiceName: string): string {
  return [
    `A Medicare claim has been made in your name by ${practiceName}.`,
    '',
    `Practitioner: ${content.practitionerName}`,
    `Patient: ${content.patientName}`,
    `Date of service: ${content.serviceDate}`,
    `Medicare benefit claimed: ${formatBenefit(content.benefitAmountCents)}`,
    '',
    'This notice is required by law and is for your information only.',
    'You do not need to do anything, and no reply is needed.',
    '',
    'These notices are sent while your enduring bulk-billing agreement with this',
    'practitioner is active. They cannot be switched off separately — if you want',
    'them to stop, you can end the agreement.',
  ].join('\n');
}

export function noticeSubject(content: NoticeContent): string {
  return `Medicare claim notice — ${content.serviceDate}`;
}

/** Correction notices supersede rather than replace (REQ-DEL-06). */
export function correctionBody(content: NoticeContent, practiceName: string, reason: string): string {
  return [
    `Correction to an earlier Medicare claim notice from ${practiceName}.`,
    '',
    `What changed: ${reason}`,
    '',
    'The corrected details are:',
    `Practitioner: ${content.practitionerName}`,
    `Patient: ${content.patientName}`,
    `Date of service: ${content.serviceDate}`,
    `Medicare benefit claimed: ${formatBenefit(content.benefitAmountCents)}`,
    '',
    'This notice is required by law and is for your information only.',
    'You do not need to do anything, and no reply is needed.',
  ].join('\n');
}

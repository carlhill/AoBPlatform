import type { Prisma } from '@prisma/client';

/**
 * HOW THE PROVIDER IS NAMED TO THE PATIENT IN TELEHEALTH (Carl, 12 Oct 2026,
 * D-2026-10-12-03 item 10): in the link message and on the patient's page.
 *
 * "DR" ONLY FOR A MEDICAL PRACTITIONER, from the registration's own
 * profession: telehealth is also run by nurse practitioners, psychologists and
 * allied health, and a title the register does not support would mislead.
 * A title someone typed into the name ("Ms Yu-Feng Judy") is dropped, so the
 * name never reads "Dr Ms ...".
 *
 * THE AHPRA NUMBER ONLY WHEN IT MEANS SOMETHING: sighted on the register and
 * the status Registered. An unchecked number is left out rather than shown.
 *
 * TELEHEALTH ONLY. The agreement anchor (`agreement-anchor.ts`) names the
 * provider on the DB4 particulars and is deliberately untouched.
 */
export interface TelehealthProvider {
  readonly name: string;
  readonly ahpraNumber: string | null;
}

const MEDICAL_PRACTITIONER = 'medical practitioner';
const LEADING_TITLE = /^(?:(?:dr|mr|mrs|ms|miss|mx|prof|professor|assoc\.?\s+prof)\.?\s+)+/i;

export function telehealthProviderName(p: { givenNames: string; familyName: string; profession: string | null }): string {
  const given = p.givenNames.trim().replace(LEADING_TITLE, '').trim();
  const name = [given, p.familyName.trim()].filter(Boolean).join(' ');
  return p.profession?.trim().toLowerCase() === MEDICAL_PRACTITIONER ? `Dr ${name}` : name;
}

export function shownAhpraNumber(p: {
  ahpraNumber: string | null;
  registrationStatus: string | null;
  registrationSightedAt: Date | null;
}): string | null {
  if (!p.ahpraNumber || !p.registrationSightedAt) return null;
  return p.registrationStatus?.trim().toLowerCase() === 'registered' ? p.ahpraNumber.trim() : null;
}

export async function telehealthProvider(
  tx: Prisma.TransactionClient,
  practitionerId: string,
): Promise<TelehealthProvider | null> {
  const p = await tx.practitioner.findFirst({
    where: { id: practitionerId },
    select: {
      givenNames: true,
      familyName: true,
      profession: true,
      ahpraNumber: true,
      registrationStatus: true,
      registrationSightedAt: true,
    },
  });
  if (!p) return null;
  return { name: telehealthProviderName(p), ahpraNumber: shownAhpraNumber(p) };
}

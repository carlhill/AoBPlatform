'use client';

/**
 * A practice, as the BUSINESS publishes itself, shown to somebody who works
 * there.
 *
 * WHAT IS DELIBERATELY ABSENT: the administrator, the manager, the other
 * practitioners, the application, the verification state. Working somewhere
 * does not make somebody a reader of that practice's record — and the guarantee
 * is that the server does not select those columns, not that this screen
 * remembers not to render them.
 *
 * THE CONTACT DETAILS ARE THE BUSINESS'S OWN. Not `adminEmail`, which
 * identifies a person and holds their sign-in credential, and not `groupEmail`,
 * which is an internal notices mailbox. Showing either would publish somebody's
 * personal address to answer a question about a business.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Globe, Mail, MapPin, Phone } from 'lucide-react';
import { Notice, Shell, ui } from '../../../ui';
import { SessionControl } from '../../../SessionControl';
import { apiHeaders, currentSession } from '../../../auth';
import { strings } from '../../../strings';
import styles from '../../../practice/manage.module.css';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

type Department = { id: string; name: string };

type Location = {
  id: string;
  code: string | null;
  address: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  departments: Department[];
};

type Practice = {
  id: string;
  name: string;
  legalName: string | null;
  tradingNames: string[] | null;
  abn: string | null;
  website: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  headOfficeLine1: string | null;
  headOfficeLine2: string | null;
  headOfficeSuburb: string | null;
  headOfficeState: string | null;
  headOfficePostcode: string | null;
  headOfficeCountry: string | null;
  locations?: Location[];
};

function locationLines(l: Location): string[] {
  // Prefer the structured parts; fall back to the single `address` line, which
  // is what older locations have and is better than showing nothing.
  const structured = [
    l.addressLine1,
    l.addressLine2,
    [l.suburb, l.state, l.postcode].filter(Boolean).join(' '),
  ]
    .map((line) => (line ?? '').trim())
    .filter(Boolean);

  return structured.length > 0 ? structured : [(l.address ?? '').trim()].filter(Boolean);
}

function addressLines(p: Practice): string[] {
  return [
    p.headOfficeLine1,
    p.headOfficeLine2,
    [p.headOfficeSuburb, p.headOfficeState, p.headOfficePostcode].filter(Boolean).join(' '),
    p.headOfficeCountry,
  ]
    .map((line) => (line ?? '').trim())
    .filter(Boolean);
}

export function PracticeView({ practiceId }: { practiceId: string }) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${CORE_URL}/practitioner/me/practices/${practiceId}`, { headers: apiHeaders() });
      const body = (await res.json().catch(() => ({}))) as Practice & { message?: string };
      if (!res.ok) throw new Error(body.message ?? `That could not be read (${res.status}).`);
      setPractice(body);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!currentSession()) {
    return (
      <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
        <h1 className={ui.pageTitle}>{strings.practicePublic.title}</h1>
        <Notice tone="warn" title={strings.practitioner.signedOutTitle}>
          {strings.practitioner.signedOutBody}
        </Notice>
      </Shell>
    );
  }

  const address = practice ? addressLines(practice) : [];
  const haveContact = Boolean(practice?.businessPhone || practice?.businessEmail || practice?.website);

  return (
    <Shell right={<SessionControl audience={strings.practitioner.audience} />}>
      <Link href="/practitioner" className={ui.pageBackLink} data-testid="practice-back">
        <ArrowLeft size={15} aria-hidden="true" />
        {strings.myAffiliations.back}
      </Link>

      <h1 className={ui.pageTitle}>{practice?.name ?? strings.practicePublic.title}</h1>
      <p className={ui.pageLead}>{strings.practicePublic.lead}</p>

      {error && (
        <Notice tone="stop" title={strings.practicePublic.failed}>
          {error}
        </Notice>
      )}

      {practice && (
        <>
          <section className={styles.applicationSection}>
            <h2 className={styles.applicationHeading}>
              <Building2 size={16} aria-hidden="true" /> {strings.practicePublic.entityTitle}
            </h2>
            {practice.legalName && practice.legalName !== practice.name && (
              <p className={styles.cardNote}>
                {strings.practicePublic.legalName}: <strong>{practice.legalName}</strong>
              </p>
            )}
            {(practice.tradingNames ?? []).length > 0 && (
              <p className={styles.cardNote}>
                {strings.practicePublic.tradingAs}: {(practice.tradingNames ?? []).join(', ')}
              </p>
            )}
            {practice.abn && (
              <p className={styles.cardNote}>
                {strings.practicePublic.abn}: <strong>{practice.abn}</strong>
              </p>
            )}
          </section>

          <section className={styles.applicationSection}>
            <h2 className={styles.applicationHeading}>
              <MapPin size={16} aria-hidden="true" /> {strings.practicePublic.headOfficeTitle}
            </h2>
            {address.length > 0 ? (
              address.map((line, i) => (
                <p key={i} className={styles.cardNote}>
                  {line}
                </p>
              ))
            ) : (
              <p className={ui.hint}>{strings.practicePublic.noAddress}</p>
            )}
            <p className={ui.hint}>{strings.practicePublic.headOfficeNote}</p>
          </section>

          {/*
            THE PLACES, under the head office. All of the practice's active
            locations, not only the ones this practitioner works at: an address
            is already printed on patient-facing notices, and somebody needing
            to ring another site of their own practice is an ordinary need.

            WHAT IS NOT HERE is who works at each. "Locations, and who is at
            each" is the practitioner directory the hard rules forbid — so this
            carries departments, which are structure, and no people.
          */}
          <section className={styles.applicationSection}>
            <h2 className={styles.applicationHeading}>
              <MapPin size={16} aria-hidden="true" /> {strings.practicePublic.locationsTitle}
            </h2>
            <p className={ui.hint}>{strings.practicePublic.locationsNote}</p>

            {(practice.locations ?? []).length === 0 && (
              <p className={ui.hint}>{strings.practicePublic.noLocations}</p>
            )}

            {(practice.locations ?? []).map((l) => (
              <div key={l.id} className={styles.reviewCard}>
                <div className={styles.reviewHead}>
                  <span className={styles.reviewKind}>{l.code ?? strings.practicePublic.unnamedSite}</span>
                </div>
                {locationLines(l).map((line, i) => (
                  <p key={i} className={styles.cardNote}>
                    {line}
                  </p>
                ))}

                {/*
                  Departments under their own site, because a department only
                  means anything inside one — two practices can both have a
                  "Reception" and they are not the same place.
                */}
                {l.departments.length > 0 ? (
                  <p className={ui.hint}>
                    {strings.practicePublic.departments}: {l.departments.map((d) => d.name).join(', ')}
                  </p>
                ) : (
                  <p className={ui.hint}>{strings.practicePublic.noDepartments}</p>
                )}
              </div>
            ))}
          </section>

          <section className={styles.applicationSection}>
            <h2 className={styles.applicationHeading}>{strings.practicePublic.contactTitle}</h2>
            {haveContact ? (
              <ul className={ui.list}>
                {practice.businessPhone && (
                  <li>
                    <Phone size={14} aria-hidden="true" />{' '}
                    <a href={`tel:${practice.businessPhone}`}>{practice.businessPhone}</a>
                  </li>
                )}
                {practice.businessEmail && (
                  <li>
                    <Mail size={14} aria-hidden="true" />{' '}
                    <a href={`mailto:${practice.businessEmail}`}>{practice.businessEmail}</a>
                  </li>
                )}
                {practice.website && (
                  <li>
                    <Globe size={14} aria-hidden="true" />{' '}
                    <a href={practice.website} target="_blank" rel="noreferrer">
                      {practice.website}
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              /*
               * Nothing published, said plainly. The tempting fallback is the
               * administrator's address, which is the one thing that must not
               * appear here: it identifies a person and holds their credential.
               */
              <Notice title={strings.practicePublic.noContactTitle}>{strings.practicePublic.noContactBody}</Notice>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

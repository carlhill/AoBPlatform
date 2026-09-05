'use client';

/**
 * WHAT THE AGREEMENT LOOKS LIKE, AND WHAT IT SAYS (Carl, 5 Sep 2026;
 * PMS_to_AoB_Workflow.md W1, Q3/Q4).
 *
 * WHY A PAGE OF ITS OWN RATHER THAN A CARD ON `/practice/channels`. Channels
 * is about how a request REACHES a patient — the sender ID, how long a link
 * lives, what a patient is asked to confirm. This is about the DOCUMENT: the
 * letterhead at the top of it and the words in it. They are read at different
 * times by different people, and the wording half has a review queue behind it
 * that has nothing to do with a channel. `/practice/channels` links here.
 *
 * ALMOST NOTHING ON THE LETTERHEAD IS EDITABLE HERE, and that is deliberate.
 * The legal name, the trading name, the address and the ABN come from the
 * practice record — most of them checked against the ABR — and this page
 * SHOWS them so a practice can see what will print. A field that could be
 * edited here would be a letterhead free to disagree with the register. The
 * logo is the one thing this page owns.
 *
 * THE WORDING IS PROPOSED HERE AND ACTIVATED ELSEWHERE. A practice may write
 * its own version of the agreement's words; it may not put them in front of a
 * patient on its own say-so. The page says so plainly rather than presenting
 * an Activate button that would fail.
 *
 * NOTHING ON THIS PAGE CLAIMS ANY OF IT IS CERTIFIED, APPROVED OR ACCREDITED
 * (hard rule 12) and no copy here carries an amount (hard rule 4).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileText, Image as ImageIcon, ScrollText } from 'lucide-react';
import { MAX_LOGO_BYTES } from '@aobplatform/domain';
import { Button, Chip, Notice, Shell, ui } from '../../ui';
import { strings } from '../../strings';
import styles from '../manage.module.css';
import { SessionControl } from '../../SessionControl';
import { apiHeaders } from '../../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

interface Letterhead {
  legalName: string;
  tradingName?: string;
  address?: string;
  phone?: string;
  email?: string;
  abn?: string;
  logoSha256?: string;
}

interface LetterheadSettings {
  letterhead: Letterhead;
  letterheadHash: string;
  logo: {
    sha256: string;
    contentType: string | null;
    widthPx: number | null;
    heightPx: number | null;
    updatedAt: string | null;
    updatedBy: string | null;
  } | null;
}

interface TemplateStatement {
  key: string;
  text: string;
}

interface TemplateBody {
  title: string;
  sections: { key: string; heading: string; paragraphs: string[] }[];
  statements: TemplateStatement[];
  footer: string[];
}

interface GenericTemplate extends TemplateBody {
  id: string;
  version: string;
  agreementType: 'episodic' | 'enduring';
  status: string;
}

interface Variant {
  id: string;
  agreementType: 'episodic' | 'enduring';
  version: string;
  status: 'draft' | 'in_review' | 'active' | 'retired';
  body: TemplateBody;
  notes: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
  activatedAt: string | null;
}

interface TemplatesResponse {
  contentVersion: string;
  generic: GenericTemplate[];
  placeholders: string[];
  conditions: string[];
  variants: Variant[];
}

async function refusalMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
  if (Array.isArray(body.message)) return body.message.join(' ');
  return body.message ?? String(res.status);
}

export function TemplatesView({
  practiceId,
  /** Read-only, as the platform. See `SetupHub` for the full reasoning. */
  viewOnly = false,
}: {
  practiceId: string;
  viewOnly?: boolean;
}) {
  const [letterhead, setLetterhead] = useState<LetterheadSettings | null>(null);
  const [templates, setTemplates] = useState<TemplatesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [editing, setEditing] = useState<'episodic' | 'enduring' | null>(null);
  const [draftJson, setDraftJson] = useState('');
  const [draftVersion, setDraftVersion] = useState('');
  const [proposeBusy, setProposeBusy] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposeSaved, setProposeSaved] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [l, t] = await Promise.all([
        fetch(`${CORE_URL}/practices/letterhead`, { headers: apiHeaders(practiceId) }),
        fetch(`${CORE_URL}/agreement-templates`, { headers: apiHeaders(practiceId) }),
      ]);
      if (!l.ok) throw new Error(await refusalMessage(l));
      if (!t.ok) throw new Error(await refusalMessage(t));
      setLetterhead((await l.json()) as LetterheadSettings);
      setTemplates((await t.json()) as TemplatesResponse);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [practiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * THE FILE IS READ IN THE BROWSER AND SENT AS BASE64, the same shape every
   * other artefact upload uses. The SIZE IS CHECKED HERE TOO — not instead of
   * the server, which refuses it again against the decoded bytes, but so that
   * a practice picking a 4 MB photograph is told at the moment they pick it
   * rather than after the upload.
   */
  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setLogoError(null);
    try {
      if (file.size > MAX_LOGO_BYTES) {
        throw new Error(strings.templates.logoTooLarge(Math.ceil(file.size / 1024)));
      }
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(strings.templates.logoUnreadable));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${CORE_URL}/practices/letterhead/logo`, {
        method: 'POST',
        headers: { ...apiHeaders(practiceId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentBase64, filename: file.name }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      await load();
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function clearLogo() {
    setLogoBusy(true);
    setLogoError(null);
    try {
      const res = await fetch(`${CORE_URL}/practices/letterhead/logo`, {
        method: 'DELETE',
        headers: apiHeaders(practiceId),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      await load();
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setLogoBusy(false);
    }
  }

  function startEditing(type: 'episodic' | 'enduring') {
    const generic = templates?.generic.find((g) => g.agreementType === type);
    const existingDraft = templates?.variants.find((v) => v.agreementType === type && v.status === 'draft');
    const body: TemplateBody | undefined = existingDraft?.body ?? generic;
    setEditing(type);
    setProposeError(null);
    setProposeSaved(false);
    setDraftVersion(existingDraft?.version ?? '');
    setDraftJson(
      JSON.stringify(
        {
          title: body?.title ?? '',
          sections: body?.sections ?? [],
          statements: body?.statements ?? [],
          footer: body?.footer ?? [],
        },
        null,
        2,
      ),
    );
  }

  /**
   * THE SERVER'S REFUSAL IS THE MESSAGE, verbatim. It names the line and the
   * rule — "…never renders {{serviceDate}}", "…carries a benefit or dollar
   * amount (hard rule 4)" — and a paraphrase would take away the only part a
   * person editing wording can act on (CLAUDE.md §7).
   */
  async function propose(submit: boolean) {
    if (!editing) return;
    setProposeBusy(true);
    setProposeError(null);
    setProposeSaved(false);
    try {
      let body: unknown;
      try {
        body = JSON.parse(draftJson);
      } catch {
        throw new Error(strings.templates.notJson);
      }
      const res = await fetch(`${CORE_URL}/agreement-templates`, {
        method: 'POST',
        headers: { ...apiHeaders(practiceId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreementType: editing, version: draftVersion.trim(), body }),
      });
      if (!res.ok) throw new Error(await refusalMessage(res));
      const saved = (await res.json()) as Variant;
      if (submit) {
        const sent = await fetch(`${CORE_URL}/agreement-templates/${saved.id}/submit`, {
          method: 'POST',
          headers: apiHeaders(practiceId),
        });
        if (!sent.ok) throw new Error(await refusalMessage(sent));
      }
      setProposeSaved(true);
      setEditing(null);
      await load();
    } catch (e) {
      setProposeError((e as Error).message);
    } finally {
      setProposeBusy(false);
    }
  }

  async function retire(id: string) {
    const res = await fetch(`${CORE_URL}/agreement-templates/${id}/retire`, {
      method: 'POST',
      headers: apiHeaders(practiceId),
    });
    if (res.ok) await load();
  }

  const s = strings.templates;

  return (
    <Shell title={s.title} lead={s.lead} right={<SessionControl audience={s.audience} />}>
      <Link href="/practice/channels" className={styles.crumb}>
        {s.backToChannels}
      </Link>

      {loadError && <Notice tone="warn">{loadError}</Notice>}
      {letterhead === null && templates === null && !loadError && <p className={ui.hint}>{s.loading}</p>}

      {/* --- The letterhead ------------------------------------------------ */}
      {letterhead && (
        <div className={styles.card} style={{ marginTop: 'var(--s3)' }}>
          <div className={styles.cardHead}>
            <FileText size={18} aria-hidden="true" className={styles.cardIcon} />
            <div className={styles.cardMain}>
              <p className={styles.cardTitle}>{s.letterheadTitle}</p>
              <p className={styles.cardNote}>{s.letterheadLead}</p>
            </div>
          </div>
          <div className={styles.cardBody}>
            <dl className={styles.subList} data-testid="letterhead-fields">
              <LetterheadRow label={s.fieldLegalName} value={letterhead.letterhead.legalName} />
              <LetterheadRow label={s.fieldTradingName} value={letterhead.letterhead.tradingName} />
              <LetterheadRow label={s.fieldAddress} value={letterhead.letterhead.address} />
              <LetterheadRow label={s.fieldPhone} value={letterhead.letterhead.phone} />
              <LetterheadRow label={s.fieldEmail} value={letterhead.letterhead.email} />
              <LetterheadRow
                label={s.fieldAbn}
                value={letterhead.letterhead.abn ? `ABN ${letterhead.letterhead.abn}` : undefined}
              />
            </dl>
            <p className={styles.cardNote}>{s.letterheadWhereFrom}</p>
          </div>
        </div>
      )}

      {/* --- The logo ------------------------------------------------------ */}
      {letterhead && (
        <div className={styles.card} style={{ marginTop: 'var(--s3)' }}>
          <div className={styles.cardHead}>
            <ImageIcon size={18} aria-hidden="true" className={styles.cardIcon} />
            <div className={styles.cardMain}>
              <p className={styles.cardTitle}>{s.logoTitle}</p>
              <p className={styles.cardNote}>{s.logoLead}</p>
            </div>
            <div className={styles.cardAside}>
              <Chip tone={letterhead.logo ? 'ok' : 'neutral'}>
                {letterhead.logo && <CheckCircle2 size={13} aria-hidden="true" />}
                {letterhead.logo ? s.logoPresent : s.logoAbsent}
              </Chip>
            </div>
          </div>
          <div className={styles.cardBody}>
            {letterhead.logo && (
              <p className={styles.cardNote} data-testid="logo-detail">
                {s.logoDetail(
                  letterhead.logo.widthPx ?? 0,
                  letterhead.logo.heightPx ?? 0,
                  letterhead.logo.sha256.slice(0, 12),
                )}
              </p>
            )}
            {logoError && <Notice tone="warn">{logoError}</Notice>}
            {!viewOnly && (
              <div className={styles.cardActions}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label={s.logoChoose}
                  data-testid="logo-input"
                  disabled={logoBusy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogo(file);
                  }}
                />
                {letterhead.logo && (
                  <Button onClick={() => void clearLogo()} disabled={logoBusy} data-testid="logo-clear">
                    {s.logoRemove}
                  </Button>
                )}
              </div>
            )}
            <p className={styles.cardNote}>{s.logoKeepsWorking}</p>
          </div>
        </div>
      )}

      {/* --- The wording ---------------------------------------------------- */}
      {templates && (
        <div className={styles.card} style={{ marginTop: 'var(--s3)' }}>
          <div className={styles.cardHead}>
            <ScrollText size={18} aria-hidden="true" className={styles.cardIcon} />
            <div className={styles.cardMain}>
              <p className={styles.cardTitle}>{s.wordingTitle}</p>
              <p className={styles.cardNote}>{s.wordingLead}</p>
              <p className={styles.cardNote}>{s.wordingReviewed}</p>
            </div>
          </div>
          <div className={styles.cardBody}>
            {templates.generic.map((generic) => {
              const variants = templates.variants.filter((v) => v.agreementType === generic.agreementType);
              const active = variants.find((v) => v.status === 'active');
              return (
                <div key={generic.id} className={styles.subItem} data-testid={`wording-${generic.agreementType}`}>
                  <p className={styles.subHeading}>{s.typeName[generic.agreementType]}</p>
                  <p className={styles.cardNote}>
                    {active
                      ? s.usingPracticeWording(active.version, active.reviewedByName ?? '')
                      : s.usingGenericWording(generic.version)}
                  </p>
                  <details>
                    <summary className={ui.hint}>{s.showGeneric(generic.version)}</summary>
                    <TemplatePreview body={generic} />
                  </details>

                  {variants
                    .filter((v) => v.status !== 'retired')
                    .map((variant) => (
                      <div key={variant.id} className={styles.methodDetail} data-testid={`variant-${variant.version}`}>
                        <p className={styles.cardTitle}>
                          {variant.version} · {s.statusName[variant.status]}
                        </p>
                        {variant.reviewNotes && (
                          <p className={styles.cardNote} data-testid="review-notes">
                            {s.reviewerSaid(variant.reviewedByName ?? '', variant.reviewNotes)}
                          </p>
                        )}
                        <details>
                          <summary className={ui.hint}>{s.showVariant}</summary>
                          <TemplatePreview body={variant.body} />
                        </details>
                        {!viewOnly && variant.status !== 'in_review' && (
                          <Button onClick={() => void retire(variant.id)} data-testid={`retire-${variant.version}`}>
                            {s.retire}
                          </Button>
                        )}
                      </div>
                    ))}

                  {!viewOnly && editing !== generic.agreementType && (
                    <Button
                      variant="subtle"
                      onClick={() => startEditing(generic.agreementType)}
                      data-testid={`propose-${generic.agreementType}`}
                    >
                      {s.propose}
                    </Button>
                  )}

                  {editing === generic.agreementType && (
                    <div className={styles.addPanel}>
                      <p className={styles.cardNote}>{s.editorLead}</p>
                      <p className={styles.cardNote}>{s.editorPlaceholders(templates.placeholders.join(', '))}</p>
                      <label className={ui.hint} htmlFor="variant-version">
                        {s.versionLabel}
                      </label>
                      <input
                        id="variant-version"
                        className={ui.input}
                        value={draftVersion}
                        placeholder={s.versionPlaceholder}
                        onChange={(e) => setDraftVersion(e.target.value)}
                        data-testid="variant-version"
                      />
                      <textarea
                        className={ui.input}
                        rows={18}
                        value={draftJson}
                        onChange={(e) => setDraftJson(e.target.value)}
                        aria-label={s.editorLabel}
                        data-testid="variant-body"
                      />
                      {proposeError && <Notice tone="warn">{proposeError}</Notice>}
                      <div className={styles.formActions}>
                        <Button onClick={() => void propose(false)} disabled={proposeBusy} data-testid="save-draft">
                          {s.saveDraft}
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => void propose(true)}
                          disabled={proposeBusy}
                          data-testid="submit-for-review"
                        >
                          {s.submitForReview}
                        </Button>
                        <Button variant="subtle" onClick={() => setEditing(null)}>
                          {s.cancel}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {proposeSaved && <Notice tone="ok">{s.proposeSaved}</Notice>}
          </div>
        </div>
      )}
    </Shell>
  );
}

function LetterheadRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className={styles.subItem}>
      <dt className={ui.hint}>{label}</dt>
      <dd>{value ?? strings.templates.notSet}</dd>
    </div>
  );
}

/**
 * The words, read-only, exactly as they are stored — placeholders and all.
 * NOT a rendered agreement: substituting sample values here would be a second
 * render path, and there is one (hard rule 13). What this shows is the
 * TEMPLATE, which is what is being proposed and reviewed.
 */
export function TemplatePreview({ body }: { body: TemplateBody }) {
  return (
    <div className={styles.methodDetail}>
      <p className={styles.cardTitle}>{body.title}</p>
      {body.sections.map((section) => (
        <div key={section.key}>
          <p className={styles.subHeading}>{section.heading}</p>
          {section.paragraphs.map((paragraph, i) => (
            <p key={`${section.key}-${i}`} className={styles.cardNote}>
              {paragraph}
            </p>
          ))}
        </div>
      ))}
      <p className={styles.subHeading}>{strings.templates.statementsHeading}</p>
      <ul>
        {body.statements.map((statement) => (
          <li key={statement.key} className={styles.cardNote}>
            {statement.text}
          </li>
        ))}
      </ul>
      {body.footer.map((line, i) => (
        <p key={`footer-${i}`} className={ui.hint}>
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * HTML email, built for mail clients rather than for browsers.
 *
 * Email rendering is roughly two decades behind the web and the constraints are
 * not negotiable, so they are stated here once rather than rediscovered:
 *
 *   - TABLES FOR LAYOUT. Outlook on Windows renders through Word, which has no
 *     flexbox, no grid, and unreliable float. A table is the only construct
 *     that lays out consistently across Outlook, Gmail, Apple Mail and the
 *     webmail clients.
 *   - INLINE STYLES. Gmail strips <style> blocks in several contexts,
 *     including forwarded mail and the mobile apps. Anything that must survive
 *     goes in a style attribute.
 *   - NO WEB FONTS. They fail in Outlook and Gmail and fall back unpredictably,
 *     so the stack is system fonts that exist everywhere.
 *   - A PLAIN-TEXT ALTERNATIVE, ALWAYS. Sent as multipart/alternative, not
 *     because many people read plain text but because a message with no text
 *     part scores as spam, and because screen readers and terminal clients
 *     deserve better than tag soup.
 *   - 600px MAXIMUM. Wider than that and Outlook's reading pane clips it.
 *
 * The one place this design does real work is the CODE. It is the reason the
 * message exists, so it is large, monospaced, letter-spaced, and sits alone in
 * a bordered block — legible read aloud down a phone, and easy to select.
 */

const INK = '#16181a';
const MUTED = '#5c6166';
const LINE = '#d8dcdf';
const WASH = '#f5f7f8';
const ACCENT = '#1f4d7a';

/** Web-safe, in the order clients actually resolve them. */
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/**
 * Escape before interpolation. Every value here originates from an applicant —
 * a practice name, a person's name — and an apostrophe in "O'Brien Medical" is
 * the least of what could arrive.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailFooter {
  readonly organisation: string;
  readonly tagline: string;
  readonly whyReceived: string;
  readonly neverAsk: string;
  readonly supportEmail?: string;
  readonly supportPhone?: string;
  readonly website?: string;
}

export interface EmailBlock {
  /** A paragraph of body text. */
  readonly text?: string;
  /** A heading above a section. */
  readonly heading?: string;
  /** The six-digit code, rendered as the centrepiece. */
  readonly code?: string;
  /** A primary action. */
  readonly button?: { readonly label: string; readonly url: string };
  /** A bare URL, shown in full because people paste them. */
  readonly url?: string;
  /** Quieter than body text — caveats, expiry notes. */
  readonly small?: string;
  /** A visual break. */
  readonly rule?: boolean;
}

/** The plain-text alternative, derived from the same blocks so they cannot drift. */
export function renderText(blocks: readonly EmailBlock[], footer: EmailFooter): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.heading) lines.push(block.heading.toUpperCase(), '');
    if (block.text) lines.push(block.text, '');
    if (block.code) lines.push(`    ${block.code}`, '');
    if (block.button) lines.push(`${block.button.label}:`, `  ${block.button.url}`, '');
    if (block.url) lines.push(`  ${block.url}`, '');
    if (block.small) lines.push(block.small, '');
    if (block.rule) lines.push('---', '');
  }

  lines.push('—', footer.organisation, footer.tagline, '', footer.whyReceived, footer.neverAsk);
  if (footer.supportEmail) lines.push(`Reply to this message, or write to ${footer.supportEmail}.`);
  if (footer.supportPhone) lines.push(`Telephone ${footer.supportPhone}.`);
  if (footer.website) lines.push(footer.website);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function renderHtml(subject: string, blocks: readonly EmailBlock[], footer: EmailFooter): string {
  const body = blocks
    .map((block) => {
      if (block.heading) {
        return `<tr><td style="padding:24px 32px 4px;font-family:${SANS};font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${esc(
          block.heading,
        )}</td></tr>`;
      }
      if (block.code) {
        // The centrepiece. Large, spaced, and selectable — somebody may be
        // reading it aloud to a colleague or typing it on a phone.
        return `<tr><td style="padding:8px 32px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td align="center" style="background:${WASH};border:1px solid ${LINE};border-radius:6px;padding:20px 12px;">
              <div style="font-family:${MONO};font-size:34px;font-weight:700;letter-spacing:.22em;color:${INK};text-indent:.22em;">${esc(
                block.code,
              )}</div>
            </td></tr>
          </table>
        </td></tr>`;
      }
      if (block.button) {
        return `<tr><td style="padding:4px 32px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td align="center" style="background:${ACCENT};border-radius:6px;">
              <a href="${esc(block.button.url)}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(
                block.button.label,
              )}</a>
            </td>
          </tr></table>
        </td></tr>`;
      }
      if (block.url) {
        // Shown in full as well as linked: people forward, paste, and print,
        // and a bare "click here" is exactly the shape of a phishing message.
        return `<tr><td style="padding:0 32px 20px;font-family:${MONO};font-size:12px;line-height:1.6;color:${MUTED};word-break:break-all;"><a href="${esc(
          block.url,
        )}" style="color:${ACCENT};">${esc(block.url)}</a></td></tr>`;
      }
      if (block.rule) {
        return `<tr><td style="padding:4px 32px;"><div style="height:1px;background:${LINE};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
      }
      if (block.small) {
        return `<tr><td style="padding:0 32px 16px;font-family:${SANS};font-size:13px;line-height:1.65;color:${MUTED};">${esc(
          block.small,
        )}</td></tr>`;
      }
      return `<tr><td style="padding:0 32px 16px;font-family:${SANS};font-size:15px;line-height:1.65;color:${INK};">${esc(
        block.text ?? '',
      )}</td></tr>`;
    })
    .join('\n');

  const contact: string[] = [];
  if (footer.supportEmail) {
    contact.push(
      `<a href="mailto:${esc(footer.supportEmail)}" style="color:${MUTED};">${esc(footer.supportEmail)}</a>`,
    );
  }
  if (footer.supportPhone) contact.push(esc(footer.supportPhone));
  if (footer.website) contact.push(`<a href="${esc(footer.website)}" style="color:${MUTED};">${esc(footer.website)}</a>`);

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${WASH};">
<!-- Preheader: what the inbox list shows next to the subject. Hidden in the
     message itself, because repeating the subject there wastes the one line a
     reader sees before deciding whether to open. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(
    blocks.find((b) => b.text)?.text ?? '',
  )}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${WASH};">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:8px;">
      <tr><td style="padding:24px 32px 8px;border-bottom:1px solid ${LINE};">
        <span style="font-family:${SANS};font-size:17px;font-weight:600;letter-spacing:-.01em;color:${INK};">${esc(
          footer.organisation,
        )}</span>
      </td></tr>
      <tr><td style="height:20px;font-size:0;line-height:0;">&nbsp;</td></tr>
      ${body}
      <tr><td style="padding:8px 32px 26px;">
        <div style="height:1px;background:${LINE};font-size:0;line-height:0;">&nbsp;</div>
        <p style="margin:18px 0 6px;font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">
          <strong style="color:${INK};">${esc(footer.organisation)}</strong><br>${esc(footer.tagline)}
        </p>
        <p style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">${esc(
          footer.whyReceived,
        )}</p>
        <p style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};"><strong>${esc(
          footer.neverAsk,
        )}</strong></p>
        ${
          contact.length > 0
            ? `<p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${MUTED};">${contact.join(
                ' &nbsp;·&nbsp; ',
              )}</p>`
            : ''
        }
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

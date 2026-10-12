import type { Metadata } from 'next';
import { ActivateView } from './ActivateView';
import { strings } from '../../../../strings';

export const metadata: Metadata = {
  title: `${strings.portal.activate.title} — ${strings.appName}`,
};

/**
 * `/patient/portal/activate/<token>` — what the invitation actually opens
 * (FR-1.14, REQ-PORT-08).
 *
 * THE LINK EXISTED BEFORE THE PAGE DID. `portal_invitation_v1` has been sending
 * patients here since 4 September 2026 and nothing served it; this is that
 * page.
 *
 * THE TOKEN IS IN THE PATH, matching the message, because a query string is the
 * part of a URL that leaks into referrers, server logs and analytics. It is
 * read here and handed to one client view — it is never put anywhere else, and
 * this page renders nothing that could carry it into a bookmarkable state.
 */
export default async function PortalActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ActivateView token={token} />;
}

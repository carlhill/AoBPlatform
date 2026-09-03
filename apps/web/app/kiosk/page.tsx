import type { Metadata } from 'next';
import { Ceremony } from './Ceremony';
import { strings } from '../strings';

/**
 * `/kiosk` — the waiting-room tablet, as a page of the web app.
 *
 * ONE ROUTE, NO SUB-ROUTES. Every step of the ceremony is component state
 * inside `Ceremony`, so there is exactly one history entry: no back button
 * can walk the next patient into the previous one's verification screen, and
 * a reload starts at "Checking in?" rather than restoring somebody's details.
 *
 * NO SIGN-IN, DELIBERATELY. The page is classified `public` in the domain's
 * page-access map, which is the same sense in which `/patient/...` is public:
 * no Keycloak session exists or could, and scope arrives as `x-practice-id`
 * with RLS re-checking it on the server. This reproduces exactly how the Expo
 * kiosk authenticated; adding a login here would be a new auth surface, and
 * auth flows are ask-Carl-first (CLAUDE.md §7).
 */
export const metadata: Metadata = {
  title: `${strings.kiosk.idle.heading} — ${strings.appName}`,
};

export default function KioskPage() {
  return <Ceremony />;
}

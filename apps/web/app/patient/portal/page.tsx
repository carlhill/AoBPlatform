import type { Metadata } from 'next';
import { PortalView } from './PortalView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.portal.title} — ${strings.appName}`,
};

/**
 * `/patient/portal` — the patient's own page (C8, M8).
 *
 * A server component that renders one client view, like the other patient
 * surfaces. There is no token in the path: this page is opened by the patient
 * from their own account, and a token alone must never open it — the
 * family-phone problem, where a parent and a 14-year-old share one handset,
 * is exactly what a link-scoped portal would get wrong (REQ-VUL, addendum v4).
 */
export default function PatientPortalPage() {
  return <PortalView />;
}

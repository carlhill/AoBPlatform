import type { Metadata } from 'next';
import { PlatformTemplatesView } from './PlatformTemplatesView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.platformTemplates.title} — ${strings.appName}`,
};

/**
 * UNDER `/platform/`, for the reason `/platform/acting-as` gives: the three
 * platform screens that live under `/practice/` are misleading paths and the
 * access table has had to say so each time. A new one does not join them.
 */
export default function PlatformTemplatesPage() {
  return <PlatformTemplatesView />;
}

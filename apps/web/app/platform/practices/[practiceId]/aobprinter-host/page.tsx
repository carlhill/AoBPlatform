'use client';

/**
 * `/platform/practices/<id>/aobprinter-host` — the practice's AOBPRINTER host
 * seen as the platform: the practice's own page read-only, and Re-baseline,
 * the platform's act, outside the read-only region (`AobPrinterHostTwin`).
 * Back goes up to the practice's platform hub (`platformPracticeParent`).
 */

import { use } from 'react';
import { AobPrinterHostTwin } from './AobPrinterHostTwin';

export default function ViewAobPrinterHostPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return <AobPrinterHostTwin practiceId={practiceId} />;
}

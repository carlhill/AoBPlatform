'use client';

import { useEffect, useState } from 'react';
import { PracticeGate } from '../PracticeGate';
import { PmsView } from './PmsView';
import { apiHeaders } from '../../auth';

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? 'http://localhost:21001';

export default function PmsPage() {
  return (
    <PracticeGate>
      {(practiceId) => <PmsLoader practiceId={practiceId} />}
    </PracticeGate>
  );
}

function PmsLoader({ practiceId }: { practiceId: string }) {
  const [pms, setPms] = useState('—');
  useEffect(() => {
    fetch(`${CORE_URL}/practices/${practiceId}`, { headers: apiHeaders(practiceId) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pms?: string } | null) => d?.pms && setPms(d.pms))
      .catch(() => undefined);
  }, [practiceId]);
  return <PmsView pms={pms} />;
}

'use client';

import { useEffect, useState } from 'react';
import { ConsoleCorrectView } from './ConsoleCorrectView';
import { Shell, ui } from '../../../ui';
import { strings } from '../../../strings';
import { currentSession } from '../../../auth';

const SELECTION_KEY = 'aob.practiceId';

export default function ConsoleCorrectPage() {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setPracticeId(currentSession()?.practiceId ?? window.localStorage.getItem(SELECTION_KEY));
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!practiceId) {
    return (
      <Shell right={strings.setup.audience}>
        <h1 className={ui.pageTitle}>{strings.setup.noPracticeTitle}</h1>
        <p className={ui.pageLead}>{strings.setup.noPracticeBody}</p>
      </Shell>
    );
  }

  return <ConsoleCorrectView practiceId={practiceId} />;
}

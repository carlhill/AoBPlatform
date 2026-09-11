'use client';

/**
 * The refresh control in the top bar. See `refresh.ts` for why it exists and
 * why it hides itself when there is nothing registered to refresh.
 */

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { refreshAll, useHasRefresh } from './refresh';
import { strings } from './strings';
import styles from './ui/ui.module.css';

export function RefreshButton() {
  const has = useHasRefresh();
  const [busy, setBusy] = useState(false);

  if (!has) return null;

  return (
    <button
      type="button"
      className={styles.menuButton}
      aria-label={strings.nav.refresh}
      title={strings.nav.refresh}
      disabled={busy}
      data-testid="shell-refresh"
      onClick={() => {
        setBusy(true);
        void refreshAll().finally(() => setBusy(false));
      }}
    >
      {/* Spinning while it works, because a refresh that returns the same
          numbers is indistinguishable from one that did not happen. */}
      <RefreshCw size={16} aria-hidden="true" className={busy ? styles.spinning : undefined} />
    </button>
  );
}

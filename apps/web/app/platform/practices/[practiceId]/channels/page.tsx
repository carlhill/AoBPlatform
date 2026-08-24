'use client';

/**
 * ChannelsView, seen as the platform rather than as the practice.
 *
 * The view is the practice's own -- one component, so what an operator reads is
 * exactly what the practice reads, and the two cannot drift into telling
 * different stories about the same records.
 *
 * The band above it says which mode this is. The server needs no telling: an
 * operator carries no practice claim, so every write behind this page already
 * refuses them.
 */

import { use } from 'react';
import { ChannelsView } from '../../../../practice/channels/ChannelsView';
import { ViewOnly } from '../ViewOnly';

export default function ViewChannelsViewPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = use(params);
  return (
    <>
      <ViewOnly practiceId={practiceId} />
      <ChannelsView practiceId={practiceId} />
    </>
  );
}

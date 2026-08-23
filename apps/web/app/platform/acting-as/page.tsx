import type { Metadata } from 'next';
import { ActingAsRegister } from './ActingAsRegister';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.actingAsRegister.title} — ${strings.appName}`,
};

/**
 * UNDER `/platform/`, unlike the three platform screens that live under
 * `/practice/`. Those paths are misleading and the access table has had to say
 * so in a comment each time; a new one should not join them.
 */
export default function ActingAsRegisterPage() {
  return <ActingAsRegister />;
}

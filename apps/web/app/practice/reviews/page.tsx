import type { Metadata } from 'next';
import { ReviewsView } from './ReviewsView';
import { strings } from '../../strings';

export const metadata: Metadata = {
  title: `${strings.reviews.title} — ${strings.appName}`,
};

export default function ReviewsPage() {
  return <ReviewsView />;
}

import { NotFoundView } from './NotFoundView';

/**
 * Next's 404. Handed to the same component that handles a refused page, so
 * "there is no such page" and "that page is not yours" look and behave alike —
 * both say which it is, and both take somebody back to a page they can use.
 */
export default function NotFound() {
  return <NotFoundView />;
}

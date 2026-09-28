/**
 * `/aobprinter` — THE BENCH INSTRUMENT'S ROUTE.
 *
 * NOT LINKED FROM ANYWHERE. There is no entry in `MainMenu`, no card on the
 * dashboard and no breadcrumb back into the console: it is reached by typing
 * the path, which is the right amount of friction for a screen that
 * fabricates print jobs.
 *
 * DEV ONLY, AND THE GUARD IS A BUILD-TIME ONE. `NODE_ENV === 'production'`
 * renders nothing at all, so the page cannot be reached on a deployed
 * environment even by somebody who knows the path. That is a floor, not the
 * whole story — the endpoint it posts to is the practice-scoped inbound door
 * and is protected on its own terms.
 */
import { AobPrinterTool } from './AobPrinterTool';
import { NotFoundView } from '../NotFoundView';

export const metadata = { title: 'AOBPrinter test tool' };

export default function Page() {
  if (process.env.NODE_ENV === 'production') return <NotFoundView />;
  return <AobPrinterTool />;
}

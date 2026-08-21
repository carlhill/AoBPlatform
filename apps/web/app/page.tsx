import { ConsoleDashboard } from './ConsoleDashboard';
import { OrgConsole } from './OrgConsole';
import { AuthGate } from './AuthGate';
import { strings } from './strings';

export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 1000 }}>
      <h1>{strings.appName}</h1>
      <p>{strings.console.subtitle}</p>
      <AuthGate>
        <OrgConsole />
      </AuthGate>
      <hr style={{ margin: '2rem 0', border: 0, borderTop: '1px solid #d0d7de' }} />
      <ConsoleDashboard />
    </main>
  );
}

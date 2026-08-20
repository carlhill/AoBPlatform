import { ConsoleDashboard } from './ConsoleDashboard';
import { strings } from './strings';

export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: 900 }}>
      <h1>{strings.appName}</h1>
      <p>{strings.console.subtitle}</p>
      <ConsoleDashboard />
    </main>
  );
}

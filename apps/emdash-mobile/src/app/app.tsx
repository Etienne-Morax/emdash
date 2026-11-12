import { useEffect, useState } from 'react';
import { checkSession, type DeviceSession } from '../session';
import { EmptyState } from './components';
import { HomeScreen } from './home-screen';
import { PairScreen } from './pair-screen';
import { useRoute } from './router';
import { TaskScreen } from './task-screen';

type Boot =
  | { kind: 'checking' }
  | { kind: 'unpaired' }
  | { kind: 'unreachable' }
  | { kind: 'paired'; session: DeviceSession };

/** Retries the session check while the gateway is out of reach. */
const RETRY_MS = 5_000;

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'checking' });

  useEffect(() => {
    if (boot.kind !== 'checking' && boot.kind !== 'unreachable') return;
    let cancelled = false;
    const run = async () => {
      const result = await checkSession();
      if (cancelled) return;
      setBoot(result);
    };
    const timer = boot.kind === 'unreachable' ? setTimeout(() => void run(), RETRY_MS) : undefined;
    if (boot.kind === 'checking') void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [boot]);

  switch (boot.kind) {
    case 'checking':
      return <main className="screen" aria-busy="true" />;
    case 'unreachable':
      return (
        <main className="screen">
          <EmptyState title="Emdash is out of reach">
            Is the Mac awake with Emdash open, Mobile access on, and Tailscale connected?
          </EmptyState>
        </main>
      );
    case 'unpaired':
      return <PairScreen onPaired={(session) => setBoot({ kind: 'paired', session })} />;
    case 'paired':
      return <PairedApp />;
  }
}

function PairedApp() {
  const route = useRoute();
  switch (route.name) {
    case 'task':
      return <TaskScreen projectId={route.projectId} taskId={route.taskId} />;
    case 'new':
    case 'home':
      return <HomeScreen />;
  }
}

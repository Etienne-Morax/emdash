import { useEffect, useState } from 'react';
import { enablePush, readPushState, syncPushSubscription, type PushState } from '../push';

const COPY: Record<Exclude<PushState, 'enabled' | 'unsupported'>, string> = {
  'needs-install':
    'To be notified when an agent waits for you, add Emdash to the Home Screen (Share → Add to Home Screen) and open it from there.',
  prompt: 'Get a notification when an agent waits for you or finishes.',
  denied: 'Notifications are off for Emdash. Turn them on in iOS Settings → Notifications.',
};

/** Offers notifications once; hidden when they are on or impossible here. */
export function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readPushState().then((current) => {
      setState(current);
      if (current === 'enabled') void syncPushSubscription().catch(() => undefined);
    });
  }, []);

  if (!state || state === 'enabled' || state === 'unsupported') return null;
  return (
    <div className="push-card morax-glass">
      <p className="morax-caption">{COPY[state]}</p>
      {state === 'prompt' && (
        <button
          type="button"
          className="button-glass small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void enablePush()
              .then(setState)
              .catch(() => setState('prompt'))
              .finally(() => setBusy(false));
          }}
        >
          Turn on notifications
        </button>
      )}
    </div>
  );
}

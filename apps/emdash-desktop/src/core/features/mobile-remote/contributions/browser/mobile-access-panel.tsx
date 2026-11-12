import { Button } from '@emdash/ui/react/primitives';
import { useEffect, useState } from 'react';
import { getMobileRemoteClient, useMobileRemoteStatus } from '../../api/browser/client';
import type { MobileDevice, MobileRemoteStatus } from '../../api/schemas';

/** `tailscale serve` HTTPS port the docs and the command below use. */
const SERVE_HTTPS_PORT = 8443;
const SECOND_MS = 1_000;

/**
 * Status, pairing and paired devices of Mobile access. Rendered under the setting while it
 * is on. Codes and devices come from the main process; tokens never reach the renderer.
 */
export function MobileAccessPanel() {
  const { value: status } = useMobileRemoteStatus();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4 text-sm">
      <GatewayStatusLine status={status} />
      <ServeCommand port={status.port} />
      <PairingBlock
        status={status}
        busy={busy}
        onStart={() =>
          void run(
            async () => (await getMobileRemoteClient()).startPairing(),
            'Could not issue a pairing code. Is Mobile access running?'
          )
        }
        onCancel={() =>
          void run(async () => (await getMobileRemoteClient()).cancelPairing(), 'Try again.')
        }
      />
      <DeviceList
        devices={status.devices}
        busy={busy}
        onRevoke={(device) =>
          void run(
            async () => (await getMobileRemoteClient()).revokeDevice({ deviceId: device.id }),
            `Could not revoke ${device.label}.`
          )
        }
      />
      {error && (
        <p role="alert" className="text-foreground-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function GatewayStatusLine({ status }: { status: MobileRemoteStatus }) {
  const label: Record<MobileRemoteStatus['state'], string> = {
    disabled: 'Off',
    starting: 'Starting…',
    listening: `Listening on 127.0.0.1:${status.port}`,
    error: status.error ?? 'Error',
  };
  return (
    <div className="flex flex-col gap-1">
      <p className={status.state === 'error' ? 'text-foreground-destructive' : 'text-foreground'}>
        {label[status.state]}
      </p>
      <p className="text-foreground-muted">
        {status.tailscaleLogin
          ? `Only ${status.tailscaleLogin} on your tailnet can reach it.`
          : 'No Tailscale login found: every request is refused. Sign in to Tailscale or set the login.'}
      </p>
    </div>
  );
}

function ServeCommand({ port }: { port: number }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-foreground-muted">
        Publish it on your tailnet only (never <code className="font-mono text-xs">funnel</code>):
      </p>
      <code className="rounded bg-background-secondary px-2 py-1 font-mono text-xs select-all">
        tailscale serve --bg --https={SERVE_HTTPS_PORT} http://127.0.0.1:{port}
      </code>
    </div>
  );
}

function PairingBlock(props: {
  status: MobileRemoteStatus;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const pairing = props.status.pairing;
  const remaining = useSecondsUntil(pairing?.expiresAt ?? null);
  const canPair = props.status.state === 'listening';
  if (!pairing) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!canPair || props.busy} onClick={props.onStart}>
          Pair a phone
        </Button>
        <span className="text-foreground-muted">
          Open the Emdash app on the phone, then enter the code.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span
        className="font-mono text-2xl tracking-[0.3em] text-foreground"
        aria-label={`Pairing code ${pairing.code.split('').join(' ')}`}
      >
        {pairing.code.slice(0, 4)} {pairing.code.slice(4)}
      </span>
      <span className="text-foreground-muted">
        Single use, expires in {Math.floor(remaining / 60)}:
        {String(remaining % 60).padStart(2, '0')}
      </span>
      <Button variant="text" disabled={props.busy} onClick={props.onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function DeviceList(props: {
  devices: MobileDevice[];
  busy: boolean;
  onRevoke: (device: MobileDevice) => void;
}) {
  if (props.devices.length === 0) {
    return <p className="text-foreground-muted">No paired phone.</p>;
  }
  return (
    <ul className="flex flex-col gap-1" aria-label="Paired phones">
      {props.devices.map((device) => (
        <li key={device.id} className="flex items-center gap-2">
          <span className="text-foreground">{device.label}</span>
          <span className="text-foreground-muted">
            paired {new Date(device.createdAt).toLocaleDateString()}
            {device.lastSeenAt
              ? `, last seen ${new Date(device.lastSeenAt).toLocaleString()}`
              : ', never connected'}
          </span>
          <Button
            variant="text"
            className="ml-auto"
            disabled={props.busy}
            onClick={() => props.onRevoke(device)}
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}

function useSecondsUntil(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? 0 : Math.max(0, Math.floor((deadline - now) / SECOND_MS));
}

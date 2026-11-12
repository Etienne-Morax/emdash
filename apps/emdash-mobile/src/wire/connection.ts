import { mobileWireContract } from '@core/features/mobile-remote/api/mobile-contract';
import {
  client,
  connect,
  openWebSocketTransport,
  reconnectingTransport,
  type Connection,
  type ContractClient,
} from '@emdash/wire/rpc';

export type MobileClient = ContractClient<typeof mobileWireContract>;

export type LinkState = 'connecting' | 'online' | 'offline' | 'unauthorized';

/** Waits between reconnect attempts; the last value repeats. */
const RECONNECT_BACKOFF_MS = [250, 1_000, 2_000, 5_000, 10_000];

type Link = {
  client: MobileClient;
  connection: Connection;
  state(): LinkState;
  onState(listener: (state: LinkState) => void): () => void;
};

let link: Link | undefined;

export function wireUrl(location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/wire`;
}

/**
 * The single Wire connection to the desktop. It reconnects on its own (phones sleep, change
 * networks, suspend the app); `connect()` holds calls while offline and live replicas resync
 * after each reconnect. The device token rides in the HttpOnly cookie of the upgrade.
 */
export function getLink(): Link {
  if (link) return link;
  let state: LinkState = 'connecting';
  const listeners = new Set<(state: LinkState) => void>();
  const setState = (next: LinkState) => {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener(next);
  };

  const transport = reconnectingTransport(
    async () => {
      setState('connecting');
      const opened = await openWebSocketTransport(wireUrl());
      opened.onDisconnect(() => setState('offline'));
      return opened;
    },
    { backoffMs: RECONNECT_BACKOFF_MS }
  );
  transport.onReconnect?.(() => setState('online'));
  transport.onTerminalFailure?.(() => setState('offline'));

  const connection = connect(transport);
  link = {
    client: client(mobileWireContract, connection),
    connection,
    state: () => state,
    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return link;
}

import { err, ok, type Result, type Secret } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { cell, family, peek, type Readable } from '@emdash/wire/state';
import type { SecretStore } from '@core/primitives/secrets/api/secret-store';
import type { AppSettingsService } from '@core/services/settings/node';
import type { FleetError, FleetOverview } from '../api/schemas';
import type { FleetSettings } from '../contributions/settings';
import { fetchFleetSnapshot } from './fleet-snapshot-client';

/** The contract asks for a read every 15–30 s; executors heartbeat every 30 s. */
export const FLEET_POLL_INTERVAL_MS = 20_000;
/** Encrypted secret-store key holding the fleet API key. */
export const FLEET_API_KEY_SECRET = 'fleet.api-key';

export const INITIAL_FLEET_OVERVIEW: FleetOverview = {
  status: 'loading',
  endpoint: '',
  hasApiKey: false,
  snapshot: null,
  fetchedAt: null,
  error: null,
};

/** The two settings operations the fleet needs, decoupled from the settings service. */
export type FleetSettingsPort = {
  read(): Promise<FleetSettings>;
  /** Calls `listener` when the `fleet` settings change; returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
};

export function createFleetSettingsPort(
  settings: Pick<AppSettingsService, 'get' | 'on' | 'off'>
): FleetSettingsPort {
  return {
    read: () => settings.get('fleet'),
    onChange(listener) {
      const handler = (key: string) => {
        if (key === 'fleet') listener();
      };
      settings.on('app-settings:changed', handler);
      return () => settings.off('app-settings:changed', handler);
    },
  };
}

export type FleetOverviewSource = {
  observe(owner: Scope): Readable<FleetOverview>;
  refresh(): Promise<void>;
  setApiKey(apiKey: Secret<string>): Promise<void>;
  clearApiKey(): Promise<void>;
};

type Options = {
  scope: Scope;
  settings: FleetSettingsPort;
  secrets: SecretStore;
  logger?: Logger;
  clock?: Clock;
  fetchSnapshot?: typeof fetchFleetSnapshot;
};

const sameError = (a: FleetError | null, b: FleetError) =>
  a?.kind === b.kind && a.message === b.message;

/** Reads `fleet_snapshot()` only while an observer owns demand; keeps the last good snapshot. */
export function createFleetOverview(options: Options): FleetOverviewSource {
  const scope = options.scope.child('fleet-overview');
  const clock = options.clock ?? systemClock;
  const fetchSnapshot = options.fetchSnapshot ?? fetchFleetSnapshot;
  const value = cell<FleetOverview>(INITIAL_FLEET_OVERVIEW);
  /** `undefined` until read once; `null` when no key is saved. */
  let cachedKey: Secret<string> | null | undefined;
  let demand: Scope | undefined;
  let revision = 0;

  async function readApiKey(): Promise<Result<Secret<string> | null, FleetError>> {
    if (cachedKey !== undefined) return ok(cachedKey);
    try {
      cachedKey = await options.secrets.getSecret(FLEET_API_KEY_SECRET);
      return ok(cachedKey);
    } catch (error) {
      options.logger?.warn('fleet: could not read the API key', { error: String(error) });
      return err({ kind: 'storage', message: 'Could not read the saved key from secure storage.' });
    }
  }

  async function load(signal?: AbortSignal): Promise<void> {
    const version = ++revision;
    const isCurrent = () => version === revision && !scope.disposed;
    const settings = await options.settings.read();
    const endpoint = settings.endpoint.trim();
    const key = await readApiKey();
    if (!isCurrent()) return;
    if (!key.success) {
      value.set({ ...peek(value), status: 'error', endpoint, error: key.error });
      return;
    }
    const apiKey = key.data;
    if (!endpoint || !apiKey) {
      value.set({
        ...INITIAL_FLEET_OVERVIEW,
        status: 'unconfigured',
        endpoint,
        hasApiKey: apiKey !== null,
      });
      return;
    }
    const previous = peek(value);
    // A snapshot read from another endpoint is not this fleet's.
    const base = previous.endpoint === endpoint ? previous : INITIAL_FLEET_OVERVIEW;
    if (!base.snapshot) {
      value.set({ ...base, status: 'loading', endpoint, hasApiKey: true, error: null });
    }
    const result = await fetchSnapshot({ endpoint, apiKey, signal });
    if (!isCurrent()) return;
    if (result.success) {
      value.set({
        status: 'ready',
        endpoint,
        hasApiKey: true,
        snapshot: result.data,
        fetchedAt: clock.now(),
        error: null,
      });
      return;
    }
    if (!sameError(peek(value).error, result.error)) {
      options.logger?.warn('fleet: snapshot read failed', { kind: result.error.kind });
    }
    value.set({ ...base, status: 'error', endpoint, hasApiKey: true, error: result.error });
  }

  /** Never throws: the poll loop must survive any single failure. */
  async function safeLoad(signal?: AbortSignal): Promise<void> {
    try {
      await load(signal);
    } catch (error) {
      if (signal?.aborted || scope.disposed) return;
      options.logger?.warn('fleet: could not read the fleet settings', { error: String(error) });
      value.set({
        ...peek(value),
        status: 'error',
        error: { kind: 'storage', message: 'Could not read the fleet settings.' },
      });
    }
  }

  const reloadIfObserved = async () => {
    if (demand && !demand.disposed) await safeLoad(demand.signal);
  };

  scope.add(options.settings.onChange(() => void reloadIfObserved()));

  const collection = family(
    (_key: void, owner) => {
      demand = owner;
      owner.add(() => {
        if (demand === owner) demand = undefined;
      });
      owner.run('fleet-poll', async (signal) => {
        while (!signal.aborted) {
          await safeLoad(signal);
          await clock.sleep(FLEET_POLL_INTERVAL_MS, { signal, unref: true });
        }
      });
      return value;
    },
    { scope, name: 'fleet-collection', lingerMs: 0 }
  );

  return {
    observe(owner) {
      owner.add(collection.retain(undefined));
      return collection(undefined);
    },
    refresh: reloadIfObserved,
    async setApiKey(apiKey) {
      await options.secrets.setSecret(FLEET_API_KEY_SECRET, apiKey);
      cachedKey = apiKey;
      value.set({ ...peek(value), hasApiKey: true });
      await reloadIfObserved();
    },
    async clearApiKey() {
      await options.secrets.deleteSecret(FLEET_API_KEY_SECRET);
      cachedKey = null;
      // Results of reads still in flight were made with the removed key.
      revision++;
      value.set({
        ...INITIAL_FLEET_OVERVIEW,
        status: 'unconfigured',
        endpoint: peek(value).endpoint,
      });
    },
  };
}

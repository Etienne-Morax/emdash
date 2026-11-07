import { err, ok, type Result, type Secret } from '@emdash/shared';
import { z } from 'zod';
import { fleetSnapshotUrl } from '../api/fleet-endpoint';
import type { FleetError, FleetJob, FleetMachine, FleetSnapshot } from '../api/schemas';

export const FLEET_REQUEST_TIMEOUT_MS = 10_000;
/** A snapshot holds at most 200 jobs; a body near this size is not a fleet snapshot. */
export const FLEET_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Server messages are shown to the user; keep them short. */
const MAX_SERVER_MESSAGE_LENGTH = 200;

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_REDIRECT_MIN = 300;
const HTTP_REDIRECT_MAX = 399;

// Raw rows as `to_jsonb` renders them. Lenient on purpose: the contract allows new columns
// without notice (unknown keys are stripped) and most columns are nullable.
const rawMachineSchema = z.object({
  name: z.string(),
  capabilities: z.array(z.string()).nullish(),
  mode: z.string().nullish(),
  available: z.boolean().nullish(),
  availability: z
    .object({
      reasons: z.array(z.string()).nullish(),
      idle_s: z.number().nullish(),
      on_ac: z.boolean().nullish(),
    })
    .nullish(),
  executor_version: z.string().nullish(),
  last_heartbeat_at: z.string().nullish(),
  alive: z.boolean().nullish(),
  active_jobs: z.number().nullish(),
});

const rawJobSchema = z.object({
  id: z.number(),
  repo: z.string(),
  branch: z.string().nullish(),
  wip_branch: z.string().nullish(),
  queue: z.string(),
  state: z.string(),
  priority: z.number().nullish(),
  preferred_provider: z.string().nullish(),
  provider: z.string().nullish(),
  pinned_machine: z.string().nullish(),
  machine: z.string().nullish(),
  session_id: z.string().nullish(),
  attempt: z.number().nullish(),
  max_attempts: z.number().nullish(),
  not_before: z.string().nullish(),
  lease_until: z.string().nullish(),
  last_progress_at: z.string().nullish(),
  objective_slug: z.string().nullish(),
  approval_action_id: z.number().nullish(),
  created_by: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string(),
  spec_excerpt: z.string().nullish(),
});

const rawSnapshotSchema = z.object({
  machines: z.array(rawMachineSchema).nullish(),
  jobs: z.array(rawJobSchema).nullish(),
  kill_switch: z.boolean().nullish(),
  generated_at: z.string(),
});

type RawMachine = z.infer<typeof rawMachineSchema>;
type RawJob = z.infer<typeof rawJobSchema>;

function toFleetMachine(raw: RawMachine): FleetMachine {
  return {
    name: raw.name,
    capabilities: raw.capabilities ?? [],
    mode: raw.mode ?? 'off',
    isAvailable: raw.available ?? null,
    unavailableReasons: raw.availability?.reasons ?? [],
    idleSeconds: raw.availability?.idle_s ?? null,
    isOnAcPower: raw.availability?.on_ac ?? null,
    executorVersion: raw.executor_version ?? null,
    lastHeartbeatAt: raw.last_heartbeat_at ?? null,
    isAlive: raw.alive ?? false,
    activeJobs: raw.active_jobs ?? 0,
  };
}

function toFleetJob(raw: RawJob): FleetJob {
  return {
    id: raw.id,
    repo: raw.repo,
    branch: raw.branch ?? null,
    wipBranch: raw.wip_branch ?? null,
    queue: raw.queue,
    state: raw.state,
    priority: raw.priority ?? null,
    preferredProvider: raw.preferred_provider ?? null,
    provider: raw.provider ?? null,
    pinnedMachine: raw.pinned_machine ?? null,
    machine: raw.machine ?? null,
    sessionId: raw.session_id ?? null,
    attempt: raw.attempt ?? 0,
    maxAttempts: raw.max_attempts ?? 0,
    notBefore: raw.not_before ?? null,
    leaseUntil: raw.lease_until ?? null,
    lastProgressAt: raw.last_progress_at ?? null,
    objectiveSlug: raw.objective_slug ?? null,
    approvalActionId: raw.approval_action_id ?? null,
    createdBy: raw.created_by ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    specExcerpt: raw.spec_excerpt ?? null,
  };
}

/** Validates an RPC payload and maps it to the camelCase read model. */
export function parseFleetSnapshot(payload: unknown): FleetSnapshot | undefined {
  const parsed = rawSnapshotSchema.safeParse(payload);
  if (!parsed.success) return undefined;
  return {
    machines: (parsed.data.machines ?? []).map(toFleetMachine),
    jobs: (parsed.data.jobs ?? []).map(toFleetJob),
    isKillSwitchEngaged: parsed.data.kill_switch ?? null,
    generatedAt: parsed.data.generated_at,
  };
}

async function readBodyWithLimit(response: Response, limit: number): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function serverMessage(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    return typeof message === 'string' ? message.slice(0, MAX_SERVER_MESSAGE_LENGTH) : undefined;
  } catch {
    return undefined;
  }
}

function errorForStatus(status: number, body: string | undefined): FleetError {
  const detail = serverMessage(body);
  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return {
      kind: 'unauthorized',
      message: `The fleet refused this key${detail ? ` (${detail})` : ''}. Use a key allowed to call fleet_snapshot().`,
    };
  }
  if (status >= HTTP_REDIRECT_MIN && status <= HTTP_REDIRECT_MAX) {
    return {
      kind: 'http',
      message: `The endpoint answered with a redirect (HTTP ${status}). Enter the gateway's direct URL.`,
    };
  }
  return {
    kind: 'http',
    message: `The fleet answered HTTP ${status}${detail ? `: ${detail}` : ''}.`,
  };
}

export type FetchFleetSnapshotInput = {
  endpoint: string;
  apiKey: Secret<string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/** One read of `fleet_snapshot()`. Expected failures come back as typed errors, never throws. */
export async function fetchFleetSnapshot(
  input: FetchFleetSnapshotInput
): Promise<Result<FleetSnapshot, FleetError>> {
  const url = fleetSnapshotUrl(input.endpoint);
  if (!url) {
    return err({
      kind: 'invalid-endpoint',
      message: 'Enter an http(s) URL such as http://host:3001.',
    });
  }
  const timeout = AbortSignal.timeout(FLEET_REQUEST_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  // Boundary disclosure: the key leaves its Secret only for these request headers.
  const apiKey = input.apiKey.expose();
  let response: Response;
  let body: string | undefined;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: '{}',
      // Never replay the key against another URL.
      redirect: 'manual',
      signal,
    });
    body = await readBodyWithLimit(response, FLEET_MAX_RESPONSE_BYTES);
  } catch {
    return err({
      kind: 'unreachable',
      message: timeout.aborted
        ? `The fleet did not answer within ${FLEET_REQUEST_TIMEOUT_MS / 1000} s.`
        : 'Could not reach the fleet endpoint. Check the URL and the network (LAN or tailnet).',
    });
  }
  if (!response.ok) return err(errorForStatus(response.status, body));
  if (body === undefined) {
    return err({ kind: 'invalid-response', message: 'The fleet answer is too large.' });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return err({ kind: 'invalid-response', message: 'The fleet did not answer with JSON.' });
  }
  const snapshot = parseFleetSnapshot(payload);
  if (!snapshot) {
    return err({
      kind: 'invalid-response',
      message: 'The answer does not match the fleet_snapshot() contract.',
    });
  }
  return ok(snapshot);
}

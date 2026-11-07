import { z } from 'zod';

/**
 * Fork-only: read model of the Morax fleet (machines, heartbeats and leased jobs), as published
 * by the `fleet_snapshot()` RPC. Source contract: `docs/fleet-jobs-contract.md` in morax-os.
 * Field names are camelCase here; the node edge maps the RPC's snake_case rows.
 */

/** Job states that never change again. */
export const FLEET_TERMINAL_JOB_STATES = [
  'done',
  'failed',
  'cancelled',
  'dead',
  'expired',
] as const;

export const fleetMachineSchema = z.object({
  name: z.string(),
  /** Queues the machine serves (`q_linux`, `q_mac`, `q_xcode`). */
  capabilities: z.array(z.string()),
  /** `observe`, `claim` or `off`; only a human changes it. */
  mode: z.string(),
  /** Local availability verdict at the last heartbeat. */
  isAvailable: z.boolean().nullable(),
  /** Why the machine is unavailable, as reported by its executor. */
  unavailableReasons: z.array(z.string()),
  idleSeconds: z.number().nullable(),
  isOnAcPower: z.boolean().nullable(),
  executorVersion: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  /** Heartbeat younger than 3 minutes: the only proof that the machine works. */
  isAlive: z.boolean(),
  activeJobs: z.number(),
});

export const fleetJobSchema = z.object({
  id: z.number(),
  repo: z.string(),
  branch: z.string().nullable(),
  wipBranch: z.string().nullable(),
  queue: z.string(),
  /** `queued`, `leased`, `running`, `blocked` or a terminal state. */
  state: z.string(),
  /** 1 (urgent) … 5. */
  priority: z.number().nullable(),
  preferredProvider: z.string().nullable(),
  provider: z.string().nullable(),
  pinnedMachine: z.string().nullable(),
  machine: z.string().nullable(),
  sessionId: z.string().nullable(),
  attempt: z.number(),
  maxAttempts: z.number(),
  notBefore: z.string().nullable(),
  leaseUntil: z.string().nullable(),
  lastProgressAt: z.string().nullable(),
  objectiveSlug: z.string().nullable(),
  /** Gate card to approve before any machine may claim the job. */
  approvalActionId: z.number().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  specExcerpt: z.string().nullable(),
});

export const fleetSnapshotSchema = z.object({
  machines: z.array(fleetMachineSchema),
  /** Open jobs plus jobs that ended in the last 24 hours, newest first. */
  jobs: z.array(fleetJobSchema),
  /** Global `/stop`: no new work starts while engaged. Null when the switch row is missing. */
  isKillSwitchEngaged: z.boolean().nullable(),
  generatedAt: z.string(),
});

export const fleetErrorKindSchema = z.enum([
  'invalid-endpoint',
  'unauthorized',
  'unreachable',
  'http',
  'invalid-response',
  /** Settings or secure storage could not be read. */
  'storage',
]);

export const fleetOverviewSchema = z.object({
  /**
   * `unconfigured`: no endpoint or no key yet. `loading`: first read in flight. `ready`: the
   * last read succeeded. `error`: the last read failed; `snapshot` keeps the last good one.
   */
  status: z.enum(['unconfigured', 'loading', 'ready', 'error']),
  endpoint: z.string(),
  hasApiKey: z.boolean(),
  snapshot: fleetSnapshotSchema.nullable(),
  /** When `snapshot` was read (ms since epoch). */
  fetchedAt: z.number().nullable(),
  error: z.object({ kind: fleetErrorKindSchema, message: z.string() }).nullable(),
});

export type FleetMachine = z.infer<typeof fleetMachineSchema>;
export type FleetJob = z.infer<typeof fleetJobSchema>;
export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>;
export type FleetErrorKind = z.infer<typeof fleetErrorKindSchema>;
export type FleetError = NonNullable<FleetOverview['error']>;
export type FleetOverview = z.infer<typeof fleetOverviewSchema>;

/** Longest API key accepted (a PostgREST JWT is a few hundred characters). */
export const FLEET_API_KEY_MAX_LENGTH = 8_192;

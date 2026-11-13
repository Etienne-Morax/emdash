import { describe, expect, it } from 'vitest';
import type { FleetJob, FleetMachine } from '../api/schemas';
import {
  describeFleetJob,
  describeMachineAvailability,
  fleetMachineIcon,
  jobStateLabel,
  jobStateTone,
  splitFleetJobs,
  summarizeFleet,
} from './fleet-model';

const NOW = Date.parse('2026-11-07T20:00:00Z');

function job(overrides: Partial<FleetJob>): FleetJob {
  return {
    id: 1,
    repo: 'morax-os',
    branch: null,
    wipBranch: null,
    queue: 'q_mac',
    state: 'queued',
    priority: 3,
    preferredProvider: 'any',
    provider: null,
    pinnedMachine: null,
    machine: null,
    sessionId: null,
    attempt: 0,
    maxAttempts: 3,
    notBefore: null,
    leaseUntil: null,
    lastProgressAt: null,
    objectiveSlug: null,
    approvalActionId: null,
    createdBy: 'conductor',
    createdAt: '2026-11-07T19:00:00Z',
    updatedAt: '2026-11-07T19:00:00Z',
    specExcerpt: null,
    ...overrides,
  };
}

function machine(overrides: Partial<FleetMachine>): FleetMachine {
  return {
    name: 'mbp-m5',
    capabilities: ['q_mac'],
    mode: 'claim',
    isAvailable: true,
    unavailableReasons: [],
    idleSeconds: null,
    isOnAcPower: true,
    executorVersion: 'fleet-executor/1',
    lastHeartbeatAt: '2026-11-07T19:59:40Z',
    isAlive: true,
    activeJobs: 0,
    ...overrides,
  };
}

describe('splitFleetJobs', () => {
  it('puts blocked jobs first, then running, then queued by priority and age', () => {
    const jobs = [
      job({ id: 1, state: 'queued', priority: 3, createdAt: '2026-11-07T18:00:00Z' }),
      job({ id: 2, state: 'running' }),
      job({ id: 3, state: 'queued', priority: 1, createdAt: '2026-11-07T19:30:00Z' }),
      job({ id: 4, state: 'blocked' }),
      job({ id: 5, state: 'queued', priority: 3, createdAt: '2026-11-07T17:00:00Z' }),
      job({ id: 6, state: 'done', updatedAt: '2026-11-07T19:00:00Z' }),
      job({ id: 7, state: 'dead', updatedAt: '2026-11-07T19:30:00Z' }),
    ];

    const { open, ended } = splitFleetJobs(jobs);

    expect(open.map(({ id }) => id)).toEqual([4, 2, 3, 5, 1]);
    expect(ended.map(({ id }) => id)).toEqual([7, 6]);
    expect(jobs.map(({ id }) => id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('describeFleetJob', () => {
  it('says where a job runs and when its machine went silent', () => {
    const running = job({
      state: 'running',
      machine: 'imac',
      attempt: 2,
      leaseUntil: '2026-11-07T20:01:00Z',
    });
    expect(describeFleetJob(running, NOW)).toBe('On imac · attempt 2/3');
    expect(describeFleetJob({ ...running, leaseUntil: '2026-11-07T19:58:00Z' }, NOW)).toBe(
      'imac went silent; the job goes back to the queue'
    );
  });

  it('explains what a queued job waits for', () => {
    expect(describeFleetJob(job({ notBefore: '2026-11-07T21:00:00Z' }), NOW)).toBe(
      'Held until the quota resets'
    );
    expect(describeFleetJob(job({ pinnedMachine: 'mbp-m1' }), NOW)).toBe('Waiting for mbp-m1');
    expect(describeFleetJob(job({ queue: 'q_xcode' }), NOW)).toBe(
      'Waiting for a free machine on q_xcode'
    );
  });

  it('labels and colours known and unknown states', () => {
    expect([jobStateLabel('dead'), jobStateTone('dead')]).toEqual(['Dead letter', 'error']);
    expect([jobStateLabel('blocked'), jobStateTone('blocked')]).toEqual(['Blocked', 'warning']);
    expect([jobStateLabel('paused'), jobStateTone('paused')]).toEqual(['paused', 'neutral']);
  });
});

describe('machines', () => {
  it('maps Morax machine names to chip icons', () => {
    expect(fleetMachineIcon('mbp-m1')).toBe('laptop-1');
    expect(fleetMachineIcon('mbp-m5-test')).toBe('laptop-5');
    expect(fleetMachineIcon('imac')).toBe('imac');
    expect(fleetMachineIcon('vm')).toBe('server');
    expect(fleetMachineIcon('m15-air')).toBe('laptop');
  });

  it('explains availability in plain words', () => {
    expect(describeMachineAvailability(machine({}))).toBe('Available');
    expect(
      describeMachineAvailability(
        machine({ isAvailable: false, unavailableReasons: ['user present', 'on battery'] })
      )
    ).toBe('user present, on battery');
    expect(describeMachineAvailability(machine({ isAvailable: null }))).toBe(
      'Availability unknown'
    );
  });

  it('summarizes the fleet', () => {
    expect(
      summarizeFleet(
        [machine({}), machine({ name: 'imac', isAlive: false })],
        [job({ state: 'running' }), job({ state: 'blocked' }), job({ state: 'queued' })]
      )
    ).toEqual({ aliveMachines: 1, machines: 2, runningJobs: 1, blockedJobs: 1, queuedJobs: 1 });
  });
});

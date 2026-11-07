import { defineContract, liveModel, liveState, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { FLEET_API_KEY_MAX_LENGTH, fleetOverviewSchema } from './schemas';

export const fleetDomain = 'fleet' as const;

export const fleetContract = defineContract({
  /** Polled while observed; the key never leaves the main process (`hasApiKey` only). */
  overview: liveModel({
    key: z.void().optional(),
    states: { current: liveState({ data: fleetOverviewSchema }) },
  }),
  refresh: procedure({ input: z.void().optional(), output: z.void() }),
  setApiKey: procedure({
    input: z.object({ apiKey: z.string().trim().min(1).max(FLEET_API_KEY_MAX_LENGTH) }),
    output: z.void(),
  }),
  clearApiKey: procedure({ input: z.void().optional(), output: z.void() }),
});

import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';

/** Longest endpoint URL accepted in settings. */
const FLEET_ENDPOINT_MAX_LENGTH = 2_048;

export type FleetSettings = {
  /** Shows the Fleet entry in the sidebar. */
  showInSidebar: boolean;
  /**
   * Base URL of the gateway that serves `/rest/v1/rpc/fleet_snapshot` (the `SUPABASE_URL` of
   * the self-hosted PostgREST). Empty until configured. The API key lives in the encrypted
   * secret store, never in settings.
   */
  endpoint: string;
};

export const fleetSettingsContribution = defineSettingsContribution<'fleet', FleetSettings>({
  key: 'fleet',
  schema: z.object({
    showInSidebar: z.boolean(),
    endpoint: z.string().trim().max(FLEET_ENDPOINT_MAX_LENGTH),
  }),
  // Fork-only feature: shown by default in this fork.
  defaults: { showInSidebar: true, endpoint: '' },
});

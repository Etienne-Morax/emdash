import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

/**
 * Fork-only: machines, heartbeats and jobs of the Morax fleet, read from `fleet_snapshot()`.
 * Shown in the sidebar through the `fleet.showInSidebar` setting.
 */
export const fleetViewDef = defineView({
  id: 'fleet',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'fleet_viewed',
});

import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const homeViewDef = defineView({
  id: 'home',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'home_viewed',
});

/**
 * Cross-task grid: one live agent pane per Task, across Projects and Hosts.
 * Opt-in through the `interface.enableTaskGrid` setting.
 */
export const taskGridViewDef = defineView({
  id: 'task-grid',
  params: z.object({}),
  layout: workbenchLayout,
  telemetryEvent: 'task_grid_viewed',
});

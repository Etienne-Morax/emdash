import { automationsViewDef } from '@core/features/automations/contributions/views';
import { fleetViewDef } from '@core/features/fleet/contributions/views';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { homeViewDef, taskGridViewDef } from '@core/features/workbench/contributions/views';
import { defineViewCatalog } from '@core/primitives/views/api';

export const viewCatalog = defineViewCatalog([
  homeViewDef,
  automationsViewDef,
  projectViewDef,
  taskViewDef,
  settingsViewDef,
  taskGridViewDef,
  fleetViewDef,
] as const);

export type ViewId = (typeof viewCatalog.defs)[number]['id'];

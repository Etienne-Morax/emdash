import { Fragment } from 'react';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';
import { fleetViewDef } from '../contributions/views';
import { FleetPage } from './fleet-page';

function FleetTitlebar() {
  return (
    <Titlebar
      leftSlot={
        <nav aria-label="Breadcrumb" className="flex items-center px-2">
          <span className="rounded-sm px-1 py-0.5 text-sm text-foreground">Fleet</span>
        </nav>
      }
    />
  );
}

export const fleetViewRuntime = defineViewRuntime(fleetViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: FleetTitlebar,
    main: FleetPage,
  },
});

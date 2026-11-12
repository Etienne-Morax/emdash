import {
  COLOR_CODE_VALUES,
  isColorCodeKey,
  resolveMachineColor,
  resolveProjectColor,
  type ColorCodeKey,
} from '@core/primitives/color-coding/api/color-coding';
import type { MobileColors, MobileColorsInput } from '../api/schemas';

/** The local machine's chip colour (the desktop's default for this computer). */
const LOCAL_MACHINE_COLOR: ColorCodeKey = 'slate';

const dark = (key: ColorCodeKey) => COLOR_CODE_VALUES[key].dark;

/**
 * Project and machine colours exactly as the desktop shows them: Settings overrides first,
 * then the desktop's rules. The phone renders the returned values as-is.
 */
export function resolveMobileColors(input: {
  request: MobileColorsInput;
  machineIds: readonly string[];
  overrides: { projectColors: Record<string, string>; machineColors: Record<string, string> };
}): MobileColors {
  const projects: Record<string, string> = {};
  for (const project of input.request.projects) {
    const override = input.overrides.projectColors[project.id];
    projects[project.id] = dark(
      resolveProjectColor({
        projectId: project.id,
        path: project.path,
        override: isColorCodeKey(override) ? override : undefined,
      })
    );
  }
  const machines: Record<string, string> = {};
  for (const id of input.machineIds) {
    machines[id] = dark(
      resolveMachineColor({ connectionId: id, override: input.overrides.machineColors[id] })
    );
  }
  return { projects, machines, localMachine: dark(LOCAL_MACHINE_COLOR) };
}

import { useQuery } from '@tanstack/react-query';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import {
  getProjectSshConnectionId,
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  COLOR_CODE_VALUES,
  describeMachine,
  resolveProjectColor,
  type ColorCodeKey,
  type MachineMarker,
} from '@core/primitives/color-coding/api/color-coding';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { useTheme } from '@core/primitives/theme/browser/use-theme';

const COMPUTER_INFO_STALE_MS = 60 * 60 * 1000;

/** Colour-coding settings; `enabled` is false until the user turns the feature on. */
export function useColorCodingSettings() {
  const { value } = useAppSettingsKey('interface');
  return {
    enabled: value?.colorCodeProjects ?? false,
    projectColors: value?.projectColors ?? {},
    machineColors: value?.machineColors ?? {},
    machineIcons: value?.machineIcons ?? {},
  };
}

/** Resolves a colour key to the value for the current light/dark theme. */
export function useColorValue(): (key: ColorCodeKey) => string {
  const { effectiveTheme } = useTheme();
  const scheme = effectiveTheme === 'emdark' ? 'dark' : 'light';
  return (key) => COLOR_CODE_VALUES[key][scheme];
}

export type ComputerInfo = { name: string; model: string };

export function useComputerInfo(): ComputerInfo | undefined {
  const { data } = useQuery({
    queryKey: ['host', 'computer-info'],
    queryFn: async () => (await getHostClient()).getComputerInfo(),
    staleTime: COMPUTER_INFO_STALE_MS,
  });
  return data;
}

/** Call only inside `observer` components. */
export function projectColorFor(
  projectId: string,
  projectColors: Record<string, string>
): ColorCodeKey {
  return resolveProjectColor({
    projectId,
    path: projectData(getProjectStore(projectId))?.path,
    override: projectColors[projectId],
  });
}

/** Call only inside `observer` components. */
export function machineMarkerFor(
  projectId: string,
  computer: ComputerInfo | undefined,
  machineColors: Record<string, string>,
  machineIcons: Record<string, string>
): MachineMarker {
  const connectionId = getProjectSshConnectionId(projectId);
  const connectionName = connectionId
    ? getMachinesStore().connections.find((connection) => connection.id === connectionId)?.name
    : undefined;
  return describeMachine({
    connectionId,
    connectionName,
    computerName: computer?.name,
    computerModel: computer?.model,
    machineColors,
    machineIcons,
  });
}

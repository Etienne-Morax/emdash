import { SettingsCard } from '@emdash/ui/react/patterns';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import {
  defaultLocalMachineIcon,
  LOCAL_MACHINE_ICON_ID,
  resolveMachineColor,
  resolveProjectColor,
} from '@core/primitives/color-coding/api/color-coding';
import { ColorCodeSelect, MachineIconSelect, withColor } from './color-code-select';
import { useComputerInfo } from './use-color-coding';

function SettingLine({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-sm text-foreground-muted">{description}</span>
      </div>
      {control}
    </div>
  );
}

/** Project settings: the colour used for this project's stripe and dot. */
export const ProjectColorSettingCard = observer(function ProjectColorSettingCard({
  projectId,
}: {
  projectId: string;
}) {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('interface');
  const projectColors = value?.projectColors ?? {};
  const resolved = resolveProjectColor({
    projectId,
    path: projectData(getProjectStore(projectId))?.path,
  });
  return (
    <SettingsCard>
      <SettingLine
        title="Project colour"
        description={
          value?.colorCodeProjects
            ? 'Shown as a stripe and dot on this project’s tasks.'
            : 'Turn on colour coding in Settings → Interface to show it.'
        }
        control={
          <ColorCodeSelect
            ariaLabel="Project colour"
            value={projectColors[projectId]}
            resolved={resolved}
            disabled={isLoading || isSaving}
            onChange={(next) =>
              update({ projectColors: withColor(projectColors, projectId, next) })
            }
          />
        }
      />
    </SettingsCard>
  );
});

/** Machine details: the colour and icon of this SSH machine's chip. */
export function MachineColorSettingCard({ connectionId }: { connectionId: string }) {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('interface');
  const machineColors = value?.machineColors ?? {};
  const machineIcons = value?.machineIcons ?? {};
  const busy = isLoading || isSaving;
  const hint = value?.colorCodeProjects
    ? 'Shown on the machine chip of tasks that run here.'
    : 'Turn on colour coding in Settings → Interface to show it.';
  return (
    <SettingsCard>
      <SettingLine
        title="Machine colour"
        description={hint}
        control={
          <ColorCodeSelect
            ariaLabel="Machine colour"
            value={machineColors[connectionId]}
            resolved={resolveMachineColor({ connectionId })}
            disabled={busy}
            onChange={(next) =>
              update({ machineColors: withColor(machineColors, connectionId, next) })
            }
          />
        }
      />
      <SettingLine
        title="Machine icon"
        description={hint}
        control={
          <MachineIconSelect
            ariaLabel="Machine icon"
            value={machineIcons[connectionId]}
            resolved="server"
            disabled={busy}
            onChange={(next) =>
              update({ machineIcons: withColor(machineIcons, connectionId, next) })
            }
          />
        }
      />
    </SettingsCard>
  );
}

/** Interface settings: the icon shown on this computer's machine chip. */
export function LocalMachineIconSetting() {
  const { value, update, isLoading, isSaving } = useAppSettingsKey('interface');
  const machineIcons = value?.machineIcons ?? {};
  const computer = useComputerInfo();
  return (
    <SettingLine
      title="This computer's icon"
      description={`Shown on the chip of tasks that run on ${computer?.name || 'this computer'}.`}
      control={
        <MachineIconSelect
          ariaLabel="This computer's icon"
          value={machineIcons[LOCAL_MACHINE_ICON_ID]}
          resolved={defaultLocalMachineIcon(computer?.model)}
          disabled={isLoading || isSaving}
          onChange={(next) =>
            update({ machineIcons: withColor(machineIcons, LOCAL_MACHINE_ICON_ID, next) })
          }
        />
      }
    />
  );
}

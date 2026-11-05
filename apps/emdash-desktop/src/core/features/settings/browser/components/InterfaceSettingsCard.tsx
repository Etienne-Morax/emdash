import { SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList, Switch } from '@emdash/ui/react/primitives';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const InterfaceSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');

  const hideContextBar = interfaceSettings?.hideContextBar ?? false;
  const enableTaskGrid = interfaceSettings?.enableTaskGrid ?? false;
  const colorCodeProjects = interfaceSettings?.colorCodeProjects ?? false;

  return (
    <SettingsCard>
      <SeparatedList gap="1rem" direction="column">
        <SettingRow
          title="Context bar"
          description="Hide the on-screen context trigger. The keyboard shortcut still works."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('hideContextBar')}
                defaultLabel="shown"
                onReset={() => resetField('hideContextBar')}
                disabled={loading || saving}
              />
              <Switch
                checked={hideContextBar}
                disabled={loading || saving}
                onCheckedChange={(checked) => update({ hideContextBar: checked })}
              />
            </>
          }
        />
        <SettingRow
          title="Agent grid"
          description="Show a sidebar entry that tiles the live agents of every task, across projects."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('enableTaskGrid')}
                defaultLabel="off"
                onReset={() => resetField('enableTaskGrid')}
                disabled={loading || saving}
              />
              <Switch
                checked={enableTaskGrid}
                disabled={loading || saving}
                onCheckedChange={(checked) => update({ enableTaskGrid: checked })}
              />
            </>
          }
        />
        <SettingRow
          title="Project and machine colours"
          description="Mark each task with its project colour and the machine it runs on. Pick colours in project settings and in Settings → Machines."
          control={
            <>
              <ResetToDefaultButton
                visible={isFieldOverridden('colorCodeProjects')}
                defaultLabel="off"
                onReset={() => resetField('colorCodeProjects')}
                disabled={loading || saving}
              />
              <Switch
                checked={colorCodeProjects}
                disabled={loading || saving}
                onCheckedChange={(checked) => update({ colorCodeProjects: checked })}
              />
            </>
          }
        />
      </SeparatedList>
    </SettingsCard>
  );
};

export default InterfaceSettingsCard;

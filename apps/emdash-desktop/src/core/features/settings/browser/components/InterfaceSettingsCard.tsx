import { SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList, Switch } from '@emdash/ui/react/primitives';
import React from 'react';
import { MobileAccessPanel } from '@core/features/mobile-remote/contributions/browser/mobile-access-panel';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { LocalMachineIconSetting } from '@core/features/workbench/contributions/browser/color-coding/color-code-settings';
import { PRODUCT_NAME } from '@core/primitives/app-identity/api/app-identity';
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
  const fleet = useAppSettingsKey('fleet');
  const showFleet = fleet.value?.showInSidebar ?? false;
  const isFleetBusy = fleet.isLoading || fleet.isSaving;
  const mobileRemote = useAppSettingsKey('mobileRemote');
  const isMobileEnabled = mobileRemote.value?.enabled ?? false;
  const isMobileBusy = mobileRemote.isLoading || mobileRemote.isSaving;

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
          title="Fleet"
          description="Show a sidebar entry with the Morax fleet: machines, heartbeats and leased jobs."
          control={
            <>
              <ResetToDefaultButton
                visible={fleet.isFieldOverridden('showInSidebar')}
                defaultLabel="shown"
                onReset={() => fleet.resetField('showInSidebar')}
                disabled={isFleetBusy}
              />
              <Switch
                checked={showFleet}
                disabled={isFleetBusy}
                onCheckedChange={(checked) => fleet.update({ showInSidebar: checked })}
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
        {colorCodeProjects && <LocalMachineIconSetting />}
        <SettingRow
          title="Mobile access"
          description={`Control ${PRODUCT_NAME} and every machine it manages from your phone, over your tailnet only.`}
          control={
            <>
              <ResetToDefaultButton
                visible={mobileRemote.isFieldOverridden('enabled')}
                defaultLabel="off"
                onReset={() => mobileRemote.resetField('enabled')}
                disabled={isMobileBusy}
              />
              <Switch
                checked={isMobileEnabled}
                disabled={isMobileBusy}
                onCheckedChange={(checked) => mobileRemote.update({ enabled: checked })}
              />
            </>
          }
        />
        {isMobileEnabled && <MobileAccessPanel />}
      </SeparatedList>
    </SettingsCard>
  );
};

export default InterfaceSettingsCard;

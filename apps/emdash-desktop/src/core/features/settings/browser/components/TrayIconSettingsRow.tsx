import { Switch } from '@emdash/ui/react/primitives';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { PRODUCT_NAME } from '@core/primitives/app-identity/api/app-identity';
import { detectPlatformContext } from '@core/primitives/keybindings/api';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

export function TrayIconSettingsRow() {
  const { value, update, isLoading, isSaving, isFieldOverridden, resetField } =
    useAppSettingsKey('interface');
  const location = detectPlatformContext().os === 'mac' ? 'menu bar' : 'system tray';
  const title = `Show ${PRODUCT_NAME} in the ${location}`;
  const disabled = isLoading || isSaving;

  return (
    <SettingRow
      title={title}
      description={`Quick access to ${PRODUCT_NAME} from the ${location}.`}
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('showTrayIcon')}
            defaultLabel="shown"
            onReset={() => resetField('showTrayIcon')}
            disabled={disabled}
          />
          <Switch
            aria-label={title}
            checked={value?.showTrayIcon ?? true}
            disabled={disabled}
            onCheckedChange={(checked) => update({ showTrayIcon: checked })}
          />
        </>
      }
    />
  );
}

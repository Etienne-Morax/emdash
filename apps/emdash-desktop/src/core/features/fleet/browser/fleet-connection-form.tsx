import { Button, Field, Input, Label } from '@emdash/ui/react/primitives';
import { useId, useState, type FormEvent } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { getFleetClient } from '../api/browser/client';
import { fleetSnapshotUrl } from '../api/fleet-endpoint';

type Props = {
  endpoint: string;
  hasApiKey: boolean;
  /** Shown when a connection already exists. */
  onCancel?: () => void;
  onSaved?: () => void;
};

/**
 * Endpoint + API key of the fleet gateway. The endpoint is a regular setting; the key goes
 * straight to the encrypted secret store in the main process and is never read back.
 */
export function FleetConnectionForm({ endpoint, hasApiKey, onCancel, onSaved }: Props) {
  const settings = useAppSettingsKey('fleet');
  const endpointId = useId();
  const keyId = useId();
  const [endpointDraft, setEndpointDraft] = useState(endpoint);
  const [keyDraft, setKeyDraft] = useState('');
  const [error, setError] = useState<string>();
  const [isSaving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextEndpoint = endpointDraft.trim();
    const nextKey = keyDraft.trim();
    if (!fleetSnapshotUrl(nextEndpoint)) {
      setError('Enter an http(s) URL such as http://host:3001.');
      return;
    }
    if (!hasApiKey && !nextKey) {
      setError('Paste the API key.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      if (nextEndpoint !== endpoint) await settings.updateAsync({ endpoint: nextEndpoint });
      if (nextKey) await (await getFleetClient()).setApiKey({ apiKey: nextKey });
      setKeyDraft('');
      onSaved?.();
    } catch {
      setError('Could not save the connection. Check that secure storage is available.');
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    setSaving(true);
    setError(undefined);
    try {
      await (await getFleetClient()).clearApiKey();
    } catch {
      setError('Could not remove the key. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      aria-label="Fleet connection"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">Connect to the fleet</h2>
        <p className="text-sm text-foreground-muted">
          Emdash reads <code className="font-mono text-xs">fleet_snapshot()</code> through the
          PostgREST gateway, every 20 s while this view is open. Nothing is written.
        </p>
      </div>
      <Field.Root>
        <Label htmlFor={endpointId}>Gateway URL</Label>
        <Input
          id={endpointId}
          value={endpointDraft}
          onChange={(event) => setEndpointDraft(event.target.value)}
          placeholder="http://host:3001"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-sm"
        />
        <Field.Description>
          The base URL (SUPABASE_URL) on the LAN or the tailnet.
        </Field.Description>
      </Field.Root>
      <Field.Root>
        <Label htmlFor={keyId}>API key</Label>
        <Input
          id={keyId}
          type="password"
          value={keyDraft}
          onChange={(event) => setKeyDraft(event.target.value)}
          placeholder={hasApiKey ? 'Saved. Paste a new key to replace it.' : 'Paste the key'}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-sm"
        />
        <Field.Description>
          Stored encrypted on this computer. Prefer a key limited to reading the fleet.
        </Field.Description>
      </Field.Root>
      {error && (
        <p role="alert" className="text-sm text-foreground-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={isSaving || settings.isLoading}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        {onCancel && (
          <Button type="button" variant="text" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
        )}
        {hasApiKey && (
          <Button
            type="button"
            variant="text"
            className="ml-auto"
            onClick={() => void removeKey()}
            disabled={isSaving}
          >
            Remove key
          </Button>
        )}
      </div>
    </form>
  );
}

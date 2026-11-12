import { useState, type FormEvent } from 'react';
import { isNativeShell } from '../push';
import { defaultDeviceLabel, pairDevice, type DeviceSession } from '../session';

const CODE_LENGTH = 8;

/**
 * First run: the phone holds no device token yet. The code comes from the desktop
 * (Settings → Interface → Mobile access → Pair a phone).
 */
export function PairScreen({ onPaired }: { onPaired: (session: DeviceSession) => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState(defaultDeviceLabel);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (normalized.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(undefined);
    const result = await pairDevice(normalized, label.trim() || defaultDeviceLabel());
    setBusy(false);
    switch (result.kind) {
      case 'paired':
        onPaired(result.session);
        return;
      case 'refused':
        setError('That code did not work. Ask the desktop for a new one.');
        return;
      case 'rate-limited':
        setError('Too many attempts. Wait a minute, then try again.');
        return;
      case 'unreachable':
        setError('Emdash is out of reach. Check that Tailscale is on.');
    }
  }

  return (
    <main className="screen pair-screen">
      <header className="screen-header">
        <span className="morax-eyebrow">Emdash Mobile</span>
        <h1 className="morax-hero screen-title">Pair this phone</h1>
      </header>
      <form className="morax-glass pair-card" onSubmit={(event) => void submit(event)}>
        <p className="morax-caption">
          On the Mac: Settings → Interface → Mobile access → <strong>Pair a phone</strong>. Enter
          the 8-character code it shows.
        </p>
        <label className="field">
          <span className="morax-eyebrow">Code</span>
          <input
            className="code-input"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="one-time-code"
            spellCheck={false}
            maxLength={CODE_LENGTH + 1}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABCD 2345"
            aria-label="Pairing code"
          />
        </label>
        <label className="field">
          <span className="morax-eyebrow">Name of this phone</span>
          <input
            className="text-input"
            value={label}
            maxLength={64}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="button-accent"
          disabled={normalized.length !== CODE_LENGTH || busy}
        >
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </form>
      {!isNativeShell() && (
        <p className="morax-caption footnote">
          Installed from Safari with Share → Add to Home Screen? Pair inside the installed app: it
          keeps its own storage.
        </p>
      )}
    </main>
  );
}

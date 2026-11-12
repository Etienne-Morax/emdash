import { computeGridDimensions } from '@core/features/terminals/api/browser/pty/pty-dimensions';
import { getCellMetrics } from '@core/features/terminals/api/browser/pty/xterm-cell-metrics';
import '@xterm/xterm/css/xterm.css';
import { createXtermLogSink } from '@core/features/terminals/api/browser/pty/xterm-log-sink';
import { ReplicaLog } from '@emdash/wire/live';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../model/errors';
import { composerWrites, SPECIAL_KEYS } from '../model/terminal-keys';
import { getLink } from '../wire/connection';
import { provisionTask } from '../wire/provision';

const FONT_SIZE = 11;
const TERMINAL_PADDING_PX = 6;
const SUBMIT_DELAY_MS = 60;

type Location = {
  projectId: string;
  taskId: string;
  conversationId: string;
  /** The task's workspace; activated first, as the desktop does when a task opens. */
  workspaceId: string | undefined;
};

/**
 * Live agent terminal. Output streams through the same retained Wire log the desktop uses;
 * keystrokes never come from xterm itself (iOS dictation duplicates words in it) but from the
 * key bar and the separate composer below.
 */
export function TerminalView({ location }: { location: Location }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [state, setState] = useState<'starting' | 'live' | 'error'>('starting');
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState('');
  const { projectId, taskId, conversationId, workspaceId } = location;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const client = getLink().client;
    const terminal = new Terminal({
      fontSize: FONT_SIZE,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      disableStdin: true,
      cursorBlink: false,
      convertEol: false,
      scrollback: 5_000,
      theme: { background: '#0e0b24', foreground: '#ece9ff', cursor: '#ffb04a' },
    });
    terminal.open(host);
    terminalRef.current = terminal;
    let log: ReplicaLog | null = null;
    let disposed = false;

    const fit = () => {
      const metrics = getCellMetrics(terminal);
      if (!metrics) return null;
      const size = computeGridDimensions({
        widthPx: host.clientWidth,
        heightPx: host.clientHeight,
        cellWidth: metrics.width,
        cellHeight: metrics.height,
        paddingPx: TERMINAL_PADDING_PX,
      });
      if (!size) return null;
      if (size.cols !== terminal.cols || size.rows !== terminal.rows) {
        terminal.resize(size.cols, size.rows);
      }
      return size;
    };

    void (async () => {
      const size = fit() ?? { cols: terminal.cols, rows: terminal.rows };
      if (workspaceId) {
        const provisioned = await provisionTask(workspaceId, taskId);
        if (disposed) return;
        if (!provisioned.ok) {
          setState('error');
          setError(provisioned.message);
          return;
        }
      }
      const hydrated = await client.conversations
        .hydrateConversation({ projectId, taskId, conversationId, initialSize: size })
        .catch(() => null);
      if (disposed) return;
      if (!hydrated || !hydrated.success) {
        setState('error');
        setError(
          hydrated
            ? errorMessage(hydrated.error, 'Could not start the agent.')
            : 'Emdash is out of reach.'
        );
        return;
      }
      // The phone takes the PTY's size while it watches: agent TUIs redraw for it.
      await client.conversations.tui.resize({ conversationId, ...size }).catch(() => undefined);
      log = new ReplicaLog(client.conversations.tui.output.handle({ conversationId }), {
        store: createXtermLogSink(terminal),
      });
      await log.ready.catch(() => undefined);
      if (!disposed) setState('live');
    })();

    const observer = new ResizeObserver(() => {
      const size = fit();
      if (size) void client.conversations.tui.resize({ conversationId, ...size }).catch(() => {});
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      void log?.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [projectId, taskId, conversationId, workspaceId]);

  const send = async (data: string) => {
    await getLink()
      .client.conversations.tui.sendInput({ conversationId, data })
      .catch(() => undefined);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const writes = composerWrites(draft, true);
    setDraft('');
    for (const [index, data] of writes.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, SUBMIT_DELAY_MS));
      await send(data);
    }
    terminalRef.current?.scrollToBottom();
  };

  return (
    <section className="terminal-panel" aria-label="Agent terminal">
      <div className="terminal-host" ref={hostRef} />
      {state === 'starting' && <p className="terminal-overlay morax-caption">Connecting…</p>}
      {state === 'error' && (
        <p className="terminal-overlay form-error" role="alert">
          {error}
        </p>
      )}
      <div className="key-bar" role="toolbar" aria-label="Special keys">
        {SPECIAL_KEYS.map((key) => (
          <button
            key={key.id}
            type="button"
            className="key-button"
            onClick={() => void send(key.data)}
            aria-label={key.id}
          >
            {key.label}
          </button>
        ))}
      </div>
      <form className="composer" onSubmit={(event) => void submit(event)}>
        <textarea
          className="composer-input"
          rows={1}
          value={draft}
          placeholder="Reply to the agent…"
          enterKeyHint="send"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit(event);
            }
          }}
          aria-label="Message to the agent"
        />
        <button type="submit" className="button-accent" aria-label="Send">
          Send
        </button>
      </form>
    </section>
  );
}

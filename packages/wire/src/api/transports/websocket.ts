import type { Unsubscribe } from '@emdash/shared';
import type { WireMessage, WireTransport } from '../protocol';
import { createWireFrameDecoder, encodeWireFrame } from './frame-codec';

type WebSocketEventType = 'open' | 'close' | 'error' | 'message';
type WebSocketEventLike = { readonly type?: string; readonly data?: unknown };

/**
 * The subset of the WHATWG `WebSocket` API the transport needs. Browser and Node 22+ global
 * `WebSocket`s satisfy it, and so do server-side `ws` sockets (they implement
 * `addEventListener`).
 */
export type WebSocketLike = {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  binaryType: string;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  // Method syntax keeps listener parameters bivariant, so DOM and `ws` sockets both fit.
  addEventListener(type: WebSocketEventType, cb: (event: WebSocketEventLike) => void): void;
  removeEventListener(type: WebSocketEventType, cb: (event: WebSocketEventLike) => void): void;
};

export type WebSocketTransportOptions = {
  /**
   * Closes the socket when more than this many bytes are queued for a slow peer. The peer's
   * `connect()` then reconnects and live replicas resync from a fresh snapshot instead of the
   * process buffering unbounded output. Defaults to 32 MiB.
   */
  maxBufferedBytes?: number;
};

const WS_OPEN = 1;
const WS_CLOSED = 3;
const DEFAULT_MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
/** Normal closure. */
const CLOSE_NORMAL = 1000;
/** Policy violation: corrupt frames from the peer. */
const CLOSE_PROTOCOL_ERROR = 1002;
/** The peer cannot keep up with outgoing data. */
const CLOSE_TOO_SLOW = 1013;

/**
 * Adapts one open WebSocket to a {@link WireTransport}. Each WebSocket message carries exactly
 * one frame in the binary format shared with {@link streamTransport}; text messages are a
 * protocol violation and close the socket. The transport owns the socket: `close()` closes it.
 */
export function webSocketTransport(
  socket: WebSocketLike,
  options: WebSocketTransportOptions = {}
): WireTransport {
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const messageListeners = new Set<(message: WireMessage) => void>();
  const disconnectListeners = new Set<() => void>();
  const decoder = createWireFrameDecoder();
  let disconnected = socket.readyState === WS_CLOSED;

  socket.binaryType = 'arraybuffer';

  const notifyDisconnect = (): void => {
    if (disconnected) return;
    disconnected = true;
    detach();
    for (const listener of disconnectListeners) listener();
  };

  const closeSocket = (code: number, reason: string): void => {
    try {
      socket.close(code, reason);
    } catch {
      // Already closing; the close event (or notifyDisconnect below) settles the state.
    }
    notifyDisconnect();
  };

  const onMessage = (event: WebSocketEventLike): void => {
    if (disconnected) return;
    const bytes = toBytes(event.data);
    if (!bytes) {
      closeSocket(CLOSE_PROTOCOL_ERROR, 'binary frames only');
      return;
    }
    let messages: WireMessage[];
    try {
      messages = decoder.push(bytes);
    } catch {
      closeSocket(CLOSE_PROTOCOL_ERROR, 'corrupt frame');
      return;
    }
    for (const message of messages) {
      for (const listener of messageListeners) listener(message);
    }
  };
  const onClose = (): void => notifyDisconnect();

  socket.addEventListener('message', onMessage);
  socket.addEventListener('close', onClose);
  socket.addEventListener('error', onClose);

  function detach(): void {
    socket.removeEventListener('message', onMessage);
    socket.removeEventListener('close', onClose);
    // The 'error' listener stays: some sockets (Node `ws`) treat an unhandled 'error' as an
    // uncaught exception, and errors can still arrive after the transport disconnected.
  }

  return {
    post(message) {
      if (disconnected || socket.readyState !== WS_OPEN) {
        throw new Error('WebSocket transport disconnected');
      }
      if ((socket.bufferedAmount ?? 0) > maxBufferedBytes) {
        closeSocket(CLOSE_TOO_SLOW, 'peer too slow');
        throw new Error('WebSocket transport disconnected: peer too slow');
      }
      socket.send(encodeWireFrame(message));
    },
    onMessage(cb): Unsubscribe {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onDisconnect(cb): Unsubscribe {
      disconnectListeners.add(cb);
      return () => disconnectListeners.delete(cb);
    },
    close() {
      closeSocket(CLOSE_NORMAL, 'closed');
      messageListeners.clear();
      disconnectListeners.clear();
      decoder.reset();
    },
  };
}

export type OpenWebSocketOptions = WebSocketTransportOptions & {
  /** Sub-protocols forwarded to the WebSocket constructor. */
  protocols?: string | string[];
  /** Rejects when the socket is not open after this many milliseconds. Defaults to 10 s. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Constructor to use; defaults to the global `WebSocket`. */
  WebSocket?: new (url: string, protocols?: string | string[]) => WebSocketLike;
};

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

/**
 * Opens a WebSocket and resolves with its transport once the socket is open. Suits
 * `reconnectingTransport(() => openWebSocketTransport(url))`: a failed or timed-out open
 * rejects, and the reconnecting wrapper schedules the next attempt.
 */
export function openWebSocketTransport(
  url: string,
  options: OpenWebSocketOptions = {}
): Promise<WireTransport> {
  const Ctor = options.WebSocket ?? resolveGlobalWebSocket();
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason ?? new Error('aborted'));
      return;
    }
    const socket = new Ctor(url, options.protocols);
    socket.binaryType = 'arraybuffer';
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('close', onFail);
      socket.removeEventListener('error', onFail);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        socket.close();
      } catch {
        // Never opened.
      }
      reject(error);
    };
    const onOpen = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(webSocketTransport(socket, options));
    };
    const onFail = (): void => fail(new Error(`WebSocket to ${url} failed to open`));
    const onAbort = (): void => fail(options.signal?.reason ?? new Error('aborted'));
    const timer = setTimeout(
      () => fail(new Error(`WebSocket to ${url} timed out after ${timeoutMs} ms`)),
      timeoutMs
    );

    socket.addEventListener('open', onOpen);
    socket.addEventListener('close', onFail);
    socket.addEventListener('error', onFail);
    options.signal?.addEventListener('abort', onAbort);
  });
}

function resolveGlobalWebSocket(): new (
  url: string,
  protocols?: string | string[]
) => WebSocketLike {
  const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof ctor !== 'function') {
    throw new Error('No global WebSocket; pass options.WebSocket');
  }
  return ctor as new (url: string, protocols?: string | string[]) => WebSocketLike;
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  // `ws` delivers fragmented binary messages as Buffer[] when binaryType is 'fragments'.
  if (Array.isArray(data) && data.every((part) => ArrayBuffer.isView(part))) {
    const parts = data as ArrayBufferView[];
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), offset);
      offset += part.byteLength;
    }
    return out;
  }
  return undefined;
}

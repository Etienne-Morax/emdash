import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { serve, webSocketTransport, type Controller } from '@emdash/wire/rpc';
import { WebSocketServer, type WebSocket } from 'ws';
import { z } from 'zod';
import type { MobileDevice } from '../api/schemas';
import type { MobileAuditLog } from './audit-log';
import type { MobileDeviceRegistry } from './device-registry';
import type { PairingManager } from './pairing';
import {
  checkOrigin,
  checkTailnetLogin,
  clearedDeviceTokenCookie,
  deviceTokenCookie,
  readDeviceToken,
  type DenyReason,
  type GatewayIdentity,
  type RequestHeaders,
} from './request-auth';

export const MOBILE_WIRE_PATH = '/wire';
const MAX_JSON_BODY_BYTES = 4 * 1024;
/** One Wire frame is at most 16 MiB; leave room for the frame header. */
const MAX_WS_PAYLOAD_BYTES = 17 * 1024 * 1024;
/** Phones vanish without closing their socket (iOS suspends backgrounded apps); ping to notice. */
const WS_PING_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

/** The gateway serves no page: nothing may load, frame or run from it. */
const CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

const pairBodySchema = z.object({
  code: z.string().min(1).max(32),
  label: z.string().max(128).optional(),
});

export type MobileHttpServerOptions = {
  host: string;
  port: number;
  identity: () => GatewayIdentity;
  devices: MobileDeviceRegistry;
  pairing: PairingManager;
  audit: MobileAuditLog;
  createSessionController(device: MobileDevice): Controller;
  onError?: (error: unknown) => void;
};

export type MobileHttpServer = {
  readonly port: number;
  /** Closes every socket of a revoked device at once. */
  disconnectDevice(deviceId: string): void;
  close(): Promise<void>;
};

type Session = { socket: WebSocket; device: MobileDevice; stop: () => void };

/**
 * The phone-facing HTTP + WebSocket server. Binds loopback only; `tailscale serve` is the
 * only way in. Every request needs the configured `Tailscale-User-Login`; API calls and the
 * Wire upgrade also need the expected `Origin` and a paired device token. Refusals are a
 * bare 401 with no detail; the reason goes to the audit log.
 */
export async function startMobileHttpServer(
  options: MobileHttpServerOptions
): Promise<MobileHttpServer> {
  const sessions = new Map<string, Session>();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });

  const deny = (reason: DenyReason, action: string, device: MobileDevice | null = null) => {
    options.audit.record({
      deviceId: device?.id ?? null,
      deviceLabel: device?.label ?? null,
      action,
      outcome: 'denied',
      detail: reason,
    });
  };

  async function authenticate(
    headers: RequestHeaders,
    action: string
  ): Promise<MobileDevice | null> {
    const identity = options.identity();
    const login = checkTailnetLogin(headers, identity);
    if (!login.success) return (deny(login.error, action), null);
    const origin = checkOrigin(headers, identity);
    if (!origin.success) return (deny(origin.error, action), null);
    const token = readDeviceToken(headers);
    if (!token) return (deny('no-token', action), null);
    const device = await options.devices.authenticate(token);
    if (!device) return (deny('invalid-token', action), null);
    return device;
  }

  const server: Server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      options.onError?.(error);
      if (!response.headersSent) sendStatus(response, 500);
      else response.destroy();
    });
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    applySecurityHeaders(response);
    const url = new URL(request.url ?? '/', 'http://localhost');
    const headers = request.headers as RequestHeaders;

    // Every request is tailnet-user only.
    const login = checkTailnetLogin(headers, options.identity());
    if (!login.success) {
      deny(login.error, 'http');
      return sendStatus(response, 401);
    }

    if (url.pathname.startsWith('/api/')) {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'POST') return sendStatus(response, 405);
      switch (url.pathname) {
        case '/api/pair':
          return await handlePair(request, response, headers);
        case '/api/session': {
          const device = await authenticate(headers, 'session');
          if (!device) return sendStatus(response, 401);
          return sendJson(response, 200, { deviceId: device.id, label: device.label });
        }
        case '/api/logout': {
          const device = await authenticate(headers, 'logout');
          if (!device) return sendStatus(response, 401);
          await options.devices.revoke(device.id);
          options.audit.record({
            deviceId: device.id,
            deviceLabel: device.label,
            action: 'logout',
            outcome: 'ok',
          });
          response.setHeader('Set-Cookie', clearedDeviceTokenCookie());
          sendJson(response, 200, {});
          disconnectDevice(device.id);
          return;
        }
        default:
          return sendStatus(response, 404);
      }
    }

    // The phone app is native (Morax Code): there is no web app to serve.
    return sendStatus(response, 404);
  }

  async function handlePair(
    request: IncomingMessage,
    response: ServerResponse,
    headers: RequestHeaders
  ) {
    const origin = checkOrigin(headers, options.identity());
    if (!origin.success) {
      deny(origin.error, 'pair');
      return sendStatus(response, 401);
    }
    const body = pairBodySchema.safeParse(await readJsonBody(request));
    if (!body.success) return sendStatus(response, 400);
    const claim = options.pairing.claim(body.data.code);
    if (!claim.success) {
      options.audit.record({
        deviceId: null,
        deviceLabel: null,
        action: 'pair',
        outcome: 'denied',
        detail: claim.error,
      });
      if (claim.error === 'rate-limited') {
        response.setHeader('Retry-After', '60');
        return sendStatus(response, 429);
      }
      return sendStatus(response, 401);
    }
    const { device, token } = await options.devices.issue(body.data.label ?? 'iPhone');
    options.audit.record({
      deviceId: device.id,
      deviceLabel: device.label,
      action: 'pair',
      outcome: 'ok',
    });
    response.setHeader('Set-Cookie', deviceTokenCookie(token));
    return sendJson(response, 200, { deviceId: device.id, label: device.label });
  }

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Node detaches its own error listener before 'upgrade'; without one, a peer resetting
    // the connection while we answer would surface as an uncaught exception in main.
    socket.on('error', () => socket.destroy());
    void handleUpgrade(request, socket, head).catch((error: unknown) => {
      options.onError?.(error);
      socket.destroy();
    });
  });

  async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== MOBILE_WIRE_PATH) return rejectUpgrade(socket, 404);
    const device = await authenticate(request.headers as RequestHeaders, 'wire connect');
    if (!device) return rejectUpgrade(socket, 401);
    wss.handleUpgrade(request, socket, head, (ws) => openSession(ws, device));
  }

  function openSession(ws: WebSocket, device: MobileDevice) {
    const id = randomUUID();
    // Keep a listener for the socket's whole life: `ws` emits 'error' (oversized or corrupt
    // frames, resets) even after the transport has detached its own.
    ws.on('error', () => ws.terminate());
    const transport = webSocketTransport(ws);
    const controller = options.createSessionController(device);
    const stopServing = serve(transport, controller);
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, WS_PING_INTERVAL_MS);
    const stop = () => {
      if (!sessions.delete(id)) return;
      clearInterval(ping);
      stopServing();
      transport.close?.();
      void controller.dispose?.();
    };
    transport.onDisconnect(stop);
    sessions.set(id, { socket: ws, device, stop });
    options.audit.record({
      deviceId: device.id,
      deviceLabel: device.label,
      action: 'wire connect',
      outcome: 'ok',
    });
  }

  function disconnectDevice(deviceId: string) {
    for (const session of [...sessions.values()]) {
      if (session.device.id !== deviceId) continue;
      session.socket.close(4401, 'revoked');
      session.stop();
    }
  }

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
  server.on('error', (error) => options.onError?.(error));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    port,
    disconnectDevice,
    async close() {
      for (const session of [...sessions.values()]) {
        session.socket.close(1001, 'gateway stopped');
        session.stop();
      }
      wss.close();
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
        server.closeAllConnections();
      });
    },
  };
}

function applySecurityHeaders(response: ServerResponse) {
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendStatus(response: ServerResponse, status: number) {
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.writeHead(status);
  response.end(status === 401 ? 'Unauthorized\n' : `${status}\n`);
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

function rejectUpgrade(socket: Duplex, status: 401 | 404) {
  const text = status === 401 ? 'Unauthorized' : 'Not Found';
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

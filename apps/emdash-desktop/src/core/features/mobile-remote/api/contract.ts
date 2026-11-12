import { defineContract, liveModel, liveState, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { mobileAuditEntrySchema, mobilePairingSchema, mobileRemoteStatusSchema } from './schemas';

export const mobileRemoteDomain = 'mobileRemote' as const;

/** Desktop-only management surface for Mobile access. Never part of the phone's contract. */
export const mobileRemoteContract = defineContract({
  status: liveModel({
    key: z.void().optional(),
    states: { current: liveState({ data: mobileRemoteStatusSchema }) },
  }),
  /** Issues a fresh one-time pairing code (replacing any pending one). */
  startPairing: procedure({ input: z.void().optional(), output: mobilePairingSchema }),
  cancelPairing: procedure({ input: z.void().optional(), output: z.void() }),
  revokeDevice: procedure({ input: z.object({ deviceId: z.string().min(1) }), output: z.void() }),
  /** Most recent audit entries, newest first. */
  auditLog: procedure({
    input: z.object({ limit: z.number().int().min(1).max(500) }),
    output: z.array(mobileAuditEntrySchema),
  }),
  /** Reads the Tailscale login and MagicDNS name of this machine (`tailscale status`). */
  detectTailscale: procedure({
    input: z.void().optional(),
    output: z.object({ login: z.string().nullable(), dnsName: z.string().nullable() }),
  }),
});

export type MobileRemoteContract = typeof mobileRemoteContract;

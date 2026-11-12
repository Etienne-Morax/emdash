import { z } from 'zod';

/** One paired phone as the desktop lists it. Never carries the token or its hash. */
export const mobileDeviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int().nullable(),
});

export type MobileDevice = z.infer<typeof mobileDeviceSchema>;

export const mobileGatewayStateSchema = z.enum(['disabled', 'starting', 'listening', 'error']);

export type MobileGatewayState = z.infer<typeof mobileGatewayStateSchema>;

export const mobilePairingSchema = z.object({
  code: z.string(),
  expiresAt: z.number().int(),
});

export type MobilePairing = z.infer<typeof mobilePairingSchema>;

export const mobileRemoteStatusSchema = z.object({
  state: mobileGatewayStateSchema,
  port: z.number().int(),
  /** Tailscale login the gateway accepts (setting, else detected); null when unknown. */
  tailscaleLogin: z.string().nullable(),
  /** `https://host[:port]` origins the gateway accepts, derived from settings or Tailscale. */
  allowedOrigins: z.array(z.string()),
  error: z.string().nullable(),
  pairing: mobilePairingSchema.nullable(),
  devices: z.array(mobileDeviceSchema),
  pushConfigured: z.boolean(),
});

export type MobileRemoteStatus = z.infer<typeof mobileRemoteStatusSchema>;

export const mobileAuditEntrySchema = z.object({
  ts: z.number().int(),
  deviceId: z.string().nullable(),
  deviceLabel: z.string().nullable(),
  action: z.string(),
  outcome: z.enum(['ok', 'error', 'denied']),
  detail: z.string().optional(),
});

export type MobileAuditEntry = z.infer<typeof mobileAuditEntrySchema>;

/** What the phone learns about its own session. */
export const mobileDeviceSessionSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
  desktopName: z.string(),
});

export type MobileDeviceSession = z.infer<typeof mobileDeviceSessionSchema>;

/** A machine the desktop manages, stripped of connection details. */
export const mobileMachineSchema = z.object({
  /** `local` for this computer, else the SSH connection id. */
  id: z.string(),
  kind: z.enum(['local', 'remote']),
  name: z.string(),
});

export type MobileMachine = z.infer<typeof mobileMachineSchema>;

/** Colour overrides from Settings → Interface; the phone resolves defaults itself. */
export const mobileAppearanceSchema = z.object({
  projectColors: z.record(z.string(), z.string()),
  machineColors: z.record(z.string(), z.string()),
  /** Short name of the desktop computer, for the local machine chip. */
  localMachineName: z.string(),
});

export type MobileAppearance = z.infer<typeof mobileAppearanceSchema>;

/** Desktop defaults the phone needs to fill the New task form like the desktop does. */
export const mobileTaskDefaultsSchema = z.object({
  defaultAgent: z.string(),
  branchPrefix: z.string(),
  appendRandomBranchSuffix: z.boolean(),
});

export type MobileTaskDefaults = z.infer<typeof mobileTaskDefaultsSchema>;

/** Standard `PushSubscription.toJSON()` shape. */
export const mobilePushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2_048)
    .refine((url) => url.startsWith('https://'), 'push endpoint must be https'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

export type MobilePushSubscription = z.infer<typeof mobilePushSubscriptionSchema>;

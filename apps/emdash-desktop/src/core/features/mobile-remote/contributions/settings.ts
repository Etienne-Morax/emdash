import { z } from 'zod';
import { defineSettingsContribution } from '@core/primitives/settings/api';

/** Loopback port the gateway listens on; `tailscale serve` forwards to it. */
export const MOBILE_REMOTE_DEFAULT_PORT = 7781;
const LOGIN_MAX_LENGTH = 320;
const ORIGIN_MAX_LENGTH = 512;
const MAX_ALLOWED_ORIGINS = 8;

export type MobileRemoteSettings = {
  /** Serves the phone app and its Wire endpoint on 127.0.0.1. Off by default. */
  enabled: boolean;
  port: number;
  /**
   * Tailscale login (`Tailscale-User-Login`) allowed in. Empty uses the login this Mac is
   * signed in to Tailscale with.
   */
  tailscaleLogin: string;
  /** Extra exact `https://…` origins; this Mac's MagicDNS name is always accepted. */
  allowedOrigins: string[];
};

export const mobileRemoteSettingsContribution = defineSettingsContribution<
  'mobileRemote',
  MobileRemoteSettings
>({
  key: 'mobileRemote',
  schema: z.object({
    enabled: z.boolean(),
    port: z.number().int().min(1024).max(65_535),
    tailscaleLogin: z.string().trim().max(LOGIN_MAX_LENGTH),
    allowedOrigins: z
      .array(
        z
          .string()
          .trim()
          .max(ORIGIN_MAX_LENGTH)
          .regex(/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/)
      )
      .max(MAX_ALLOWED_ORIGINS),
  }),
  // Fork-only feature, remote control of this machine: off until explicitly enabled.
  defaults: {
    enabled: false,
    port: MOBILE_REMOTE_DEFAULT_PORT,
    tailscaleLogin: '',
    allowedOrigins: [],
  },
});

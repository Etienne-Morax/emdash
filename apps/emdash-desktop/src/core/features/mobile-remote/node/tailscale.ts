import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const STATUS_TIMEOUT_MS = 5_000;
const MAX_STATUS_BYTES = 8 * 1024 * 1024;

/** Where the Tailscale CLI lives on macOS, then whatever PATH resolves. */
const CANDIDATE_BINARIES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
  'tailscale',
];

const statusSchema = z.object({
  Self: z
    .object({
      DNSName: z.string().optional(),
      UserID: z.number().optional(),
    })
    .optional(),
  User: z.record(z.string(), z.object({ LoginName: z.string().optional() })).optional(),
});

export type TailscaleIdentity = { login: string | null; dnsName: string | null };

/** Extracts the logged-in user and MagicDNS name from `tailscale status --json`. */
export function parseTailscaleStatus(json: unknown): TailscaleIdentity {
  const parsed = statusSchema.safeParse(json);
  if (!parsed.success) return { login: null, dnsName: null };
  const self = parsed.data.Self;
  const dnsName = self?.DNSName?.replace(/\.$/, '') || null;
  const userId = self?.UserID;
  const login =
    userId === undefined ? null : (parsed.data.User?.[String(userId)]?.LoginName ?? null);
  return { login, dnsName };
}

export async function detectTailscaleIdentity(): Promise<TailscaleIdentity> {
  for (const binary of CANDIDATE_BINARIES) {
    if (binary.startsWith('/')) {
      try {
        await access(binary);
      } catch {
        continue;
      }
    }
    try {
      const { stdout } = await execFileAsync(binary, ['status', '--json'], {
        timeout: STATUS_TIMEOUT_MS,
        maxBuffer: MAX_STATUS_BYTES,
      });
      return parseTailscaleStatus(JSON.parse(stdout));
    } catch {
      // Try the next candidate.
    }
  }
  return { login: null, dnsName: null };
}

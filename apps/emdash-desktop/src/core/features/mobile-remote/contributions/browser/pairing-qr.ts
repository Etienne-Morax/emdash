import { QrCode } from './qrcodegen';

/** `tailscale serve` HTTPS port the docs and the Settings command use. */
export const SERVE_HTTPS_PORT = 8443;

/**
 * The address the phone should use: the Mac's tailnet origin (`https://<MagicDNS>`), on the
 * `tailscale serve` port unless the origin already names one. Null when Tailscale is unknown.
 */
export function gatewayAddress(allowedOrigins: readonly string[]): string | null {
  const origin = allowedOrigins.find((entry) => entry.startsWith('https://'));
  if (!origin) return null;
  const url = new URL(origin);
  if (!url.port) url.port = String(SERVE_HTTPS_PORT);
  return url.origin;
}

/** What the Morax Code app reads from the QR code (see `PairingLink` in the iOS app). */
export function pairingLink(gateway: string, code: string): string {
  const query = new URLSearchParams({ gateway, code });
  return `moraxcode://pair?${query.toString()}`;
}

/** The QR code of `text` as an SVG path over a `size`×`size` grid (dark modules). */
export function qrSvg(text: string): { size: number; path: string } {
  const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return { size: qr.size, path: parts.join('') };
}

import { describe, expect, it } from 'vitest';
import { gatewayAddress, pairingLink, qrSvg } from './pairing-qr';
import { QrCode } from './qrcodegen';

describe('pairing QR code', () => {
  it('points the phone at the tailnet origin on the serve port', () => {
    expect(gatewayAddress(['https://mac.tail1.ts.net'])).toBe('https://mac.tail1.ts.net:8443');
    expect(gatewayAddress(['https://mac.tail1.ts.net:9443'])).toBe('https://mac.tail1.ts.net:9443');
    expect(gatewayAddress([])).toBeNull();
  });

  it('encodes the gateway and the code in the app link', () => {
    expect(pairingLink('https://mac.tail1.ts.net:8443', 'ABCD2345')).toBe(
      'moraxcode://pair?gateway=https%3A%2F%2Fmac.tail1.ts.net%3A8443&code=ABCD2345'
    );
  });

  it('draws one square per dark module', () => {
    const text = pairingLink('https://mac.tail1.ts.net:8443', 'ABCD2345');
    const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
    let dark = 0;
    for (let y = 0; y < qr.size; y++)
      for (let x = 0; x < qr.size; x++) dark += Number(qr.getModule(x, y));
    const svg = qrSvg(text);
    expect(svg.size).toBe(qr.size);
    expect(svg.path.match(/M/g)?.length).toBe(dark);
  });
});

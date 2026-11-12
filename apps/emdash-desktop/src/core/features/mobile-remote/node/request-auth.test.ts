import { describe, expect, it } from 'vitest';
import {
  checkOrigin,
  checkTailnetLogin,
  deviceTokenCookie,
  readDeviceToken,
  type GatewayIdentity,
} from './request-auth';

const identity: GatewayIdentity = {
  tailscaleLogin: 'me@example.com',
  allowedOrigins: ['https://phone-gateway.example.ts.net:9443'],
  magicDnsName: 'desk.tail1234.ts.net',
};

describe('request auth', () => {
  it('requires the configured Tailscale login', () => {
    expect(checkTailnetLogin({ 'tailscale-user-login': 'Me@Example.com' }, identity).success).toBe(
      true
    );
    expect(checkTailnetLogin({ 'tailscale-user-login': 'other@example.com' }, identity)).toEqual({
      success: false,
      error: 'login-mismatch',
    });
    expect(checkTailnetLogin({}, identity)).toEqual({ success: false, error: 'login-mismatch' });
    expect(
      checkTailnetLogin(
        { 'tailscale-user-login': 'me@example.com' },
        { ...identity, tailscaleLogin: null }
      )
    ).toEqual({ success: false, error: 'no-login-configured' });
  });

  it('accepts only https origins on this machine or explicitly allowed ones', () => {
    const accepted = [
      'https://desk.tail1234.ts.net',
      'https://desk.tail1234.ts.net:8443',
      'https://phone-gateway.example.ts.net:9443',
    ];
    for (const origin of accepted) expect(checkOrigin({ origin }, identity).success).toBe(true);

    const refused = [
      undefined,
      'null',
      'http://desk.tail1234.ts.net:8443',
      'https://evil.example.com',
      'https://desk.tail1234.ts.net.evil.com',
      'https://desk.tail1234.ts.net:8443/path',
      'http://127.0.0.1:7781',
    ];
    for (const origin of refused) {
      expect(checkOrigin(origin ? { origin } : {}, identity)).toEqual({
        success: false,
        error: 'origin-mismatch',
      });
    }
  });

  it('reads the token from the cookie or a bearer header', () => {
    expect(readDeviceToken({ cookie: 'a=b; emdash_mobile_token=tok123; c=d' })).toBe('tok123');
    expect(readDeviceToken({ authorization: 'Bearer tok456' })).toBe('tok456');
    expect(readDeviceToken({ cookie: 'emdash_mobile_token=' })).toBeNull();
    expect(readDeviceToken({})).toBeNull();
  });

  it('sets a host-only HttpOnly Secure SameSite=Strict cookie', () => {
    const cookie = deviceTokenCookie('tok');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Domain=');
  });
});

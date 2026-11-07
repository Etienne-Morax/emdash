import { describe, expect, it } from 'vitest';
import { fleetSnapshotUrl } from './fleet-endpoint';

describe('fleetSnapshotUrl', () => {
  it('appends the gateway RPC path to a base URL', () => {
    expect(fleetSnapshotUrl('http://192.0.2.10:3001')?.toString()).toBe(
      'http://192.0.2.10:3001/rest/v1/rpc/fleet_snapshot'
    );
    expect(fleetSnapshotUrl(' https://fleet.example.test/ ')?.toString()).toBe(
      'https://fleet.example.test/rest/v1/rpc/fleet_snapshot'
    );
  });

  it('keeps a base path and does not double a pasted /rest/v1 suffix', () => {
    expect(fleetSnapshotUrl('https://example.test/supabase/')?.toString()).toBe(
      'https://example.test/supabase/rest/v1/rpc/fleet_snapshot'
    );
    expect(fleetSnapshotUrl('http://host.test:3001/rest/v1/')?.toString()).toBe(
      'http://host.test:3001/rest/v1/rpc/fleet_snapshot'
    );
  });

  it('drops query strings and fragments', () => {
    expect(fleetSnapshotUrl('http://host.test:3001/?a=1#x')?.toString()).toBe(
      'http://host.test:3001/rest/v1/rpc/fleet_snapshot'
    );
  });

  it('rejects non-http schemes, embedded credentials and garbage', () => {
    expect(fleetSnapshotUrl('')).toBeUndefined();
    expect(fleetSnapshotUrl('host.test:3001')).toBeUndefined();
    expect(fleetSnapshotUrl('file:///etc/passwd')).toBeUndefined();
    expect(fleetSnapshotUrl('ftp://host.test')).toBeUndefined();
    expect(fleetSnapshotUrl('http://user:pass@host.test:3001')).toBeUndefined();
  });
});

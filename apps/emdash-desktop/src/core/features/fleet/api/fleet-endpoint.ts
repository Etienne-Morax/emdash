/** Supabase-style gateway prefix + PostgREST RPC path. */
export const FLEET_SNAPSHOT_PATH = '/rest/v1/rpc/fleet_snapshot';

/**
 * RPC URL for a gateway base URL (`http://host:3001`, optionally ending in `/rest/v1`).
 * Only http(s) without embedded credentials is accepted; anything else returns `undefined`.
 */
export function fleetSnapshotUrl(endpoint: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  const basePath = url.pathname.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  url.pathname = `${basePath}${FLEET_SNAPSHOT_PATH}`;
  url.search = '';
  url.hash = '';
  return url;
}

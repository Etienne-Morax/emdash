import { useSyncExternalStore } from 'react';
import { getLink, type LinkState } from '../wire/connection';

export function useLinkState(): LinkState {
  const link = getLink();
  return useSyncExternalStore(link.onState, link.state);
}

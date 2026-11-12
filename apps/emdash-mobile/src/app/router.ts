import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'task'; projectId: string; taskId: string }
  | { name: 'review'; projectId: string; taskId: string }
  | { name: 'new' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'task' && parts[1] && parts[2]) {
    return { name: 'task', projectId: parts[1], taskId: parts[2] };
  }
  if (parts[0] === 'review' && parts[1] && parts[2]) {
    return { name: 'review', projectId: parts[1], taskId: parts[2] };
  }
  if (parts[0] === 'new') return { name: 'new' };
  return { name: 'home' };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'new':
      return '#/new';
    case 'task':
    case 'review':
      return `#/${route.name}/${encodeURIComponent(route.projectId)}/${encodeURIComponent(route.taskId)}`;
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeHref(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

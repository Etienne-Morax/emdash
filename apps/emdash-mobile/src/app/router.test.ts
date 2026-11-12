import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref } from './router';

describe('router', () => {
  it('round-trips the review route with encoded ids', () => {
    const route = { name: 'review' as const, projectId: 'p/1', taskId: 't 2' };

    expect(routeHref(route)).toBe('#/review/p%2F1/t%202');
    expect(parseRoute(routeHref(route))).toEqual(route);
  });

  it('falls back to home for an incomplete review route', () => {
    expect(parseRoute('#/review/p1')).toEqual({ name: 'home' });
  });
});

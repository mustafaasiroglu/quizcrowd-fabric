import { describe, expect, it } from 'vitest';
import { parseRoute, routeUrl, type AppRoute } from '../packages/frontend/src/lib/routes';

const id = '11111111-2222-4333-8444-555555555555';
const parse = (path: string) => parseRoute(new URL(path, 'https://quiz.example'));

describe('static-host compatible screen URLs', () => {
  const routes: AppRoute[] = [
    { page: 'home' }, { page: 'admin' }, { page: 'join', invitation: '' },
    { page: 'join', invitation: '000123' }, { page: 'join', invitation: id },
    { page: 'author', mode: 'survey', id: '' }, { page: 'author', mode: 'quiz', id: '' },
    { page: 'author', mode: 'quiz', id },
    { page: 'game', id, host: true, lobby: true },
    { page: 'game', id, host: true, lobby: false },
    { page: 'game', id, host: false, lobby: false },
  ];
  it.each(routes)('round trips $page without private credentials', route => {
    const url = routeUrl(route);
    expect(parse(url)).toEqual(route);
    expect(url).not.toMatch(/token|credential|subject/i);
  });
  it('canonicalizes root invitations and legacy library URLs', () => {
    for (const link of ['/?code=000123', '/?quiz=000123', '/join?code=000123']) {
      expect(routeUrl(parse(link))).toBe('/join/?code=000123');
    }
    expect(routeUrl(parse(`/?quiz=${id}`))).toBe(`/join/?gameId=${id}`);
    expect(routeUrl(parse('/?quiz=A1B2C3D4E5'))).toBe('/join/?gameId=A1B2C3D4E5');
    expect(parse('/library')).toEqual({ page: 'home' });
    expect(parse('/quizzes/')).toEqual({ page: 'home' });
  });
  it.each(['/unknown', '/host/create?type=invalid', '/join?code=123', '/join?gameId=bad',
    '/host/item?gameId=bad', '/play?gameId=undefined', '/host/game', '/host/lobby?gameId=x',
    '/join?code=000123&code=111111', `/join?gameId=${id}&code=000123`, '/host/create?type=quiz&type=survey',
    '/%2e%2e/unknown'])('rejects invalid or ambiguous route %s', path => {
    expect(parse(path).page).toBe('not-found');
  });
  it('ignores external return targets rather than redirecting to them', () => {
    expect(routeUrl(parse('/admin?returnTo=https://evil.example'))).toBe('/admin/');
  });
});

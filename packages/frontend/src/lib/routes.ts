export const screenPaths = ['admin', 'join', 'host/create', 'host/item', 'host/lobby', 'host/game', 'play'] as const;
export type AppRoute =
  | { page: 'home' }
  | { page: 'join'; invitation: string; pin?: string }
  | { page: 'admin' }
  | { page: 'author'; id: string; mode: 'quiz' | 'survey' }
  | { page: 'game'; id: string; host: boolean; lobby: boolean }
  | { page: 'not-found' };

export const isGameId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isInvitation = (value: string) => /^\d{6}$/.test(value) || /^[0-9a-f]{10}$/i.test(value) || isGameId(value);

export function routeUrl(route: AppRoute): string {
  switch (route.page) {
    case 'home': return '/';
    case 'admin': return '/admin/';
    case 'join': return route.invitation
      ? `/join/?${/^\d{6}$/.test(route.invitation) ? 'code' : 'gameId'}=${encodeURIComponent(route.invitation)}${route.pin ? `#pin=${encodeURIComponent(route.pin)}` : ''}`
      : '/join/';
    case 'author': return route.id ? `/host/item/?gameId=${route.id}` : `/host/create/?type=${route.mode}`;
    case 'game': return `/${route.host ? `host/${route.lobby ? 'lobby' : 'game'}` : 'play'}/?gameId=${route.id}`;
    case 'not-found': return '/404/';
  }
}

export function parseRoute(url: URL): AppRoute {
  const query = url.searchParams;
  const invalid: AppRoute = { page: 'not-found' };
  for (const key of ['gameId', 'code', 'quiz', 'type']) if (query.getAll(key).length > 1) return invalid;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const invitation = query.get('code') ?? query.get('quiz') ?? query.get('gameId') ?? '';
  const fragment = new URLSearchParams(url.hash.slice(1));
  const pin = fragment.get('pin') ?? undefined;
  if (fragment.getAll('pin').length > 1 || (pin !== undefined && !/^\d{4}$/.test(pin))) return invalid;
  if ([query.has('code'), query.has('quiz'), query.has('gameId')].filter(Boolean).length > 1) return invalid;
  if ((path === '/' && invitation) || path === '/join') {
    return !invitation || isInvitation(invitation) ? { page: 'join', invitation, ...(pin ? { pin } : {}) } : invalid;
  }
  if (path === '/' || path === '/library' || path === '/quizzes') return { page: 'home' };
  if (path === '/admin') return { page: 'admin' };
  if (path === '/host/create') {
    const mode = query.get('type') ?? 'quiz';
    return mode === 'quiz' || mode === 'survey' ? { page: 'author', id: '', mode } : invalid;
  }
  const id = query.get('gameId') ?? '';
  if (!isGameId(id)) return invalid;
  if (path === '/host/item') return { page: 'author', id, mode: 'quiz' };
  if (path === '/host/lobby' || path === '/host/game' || path === '/play') {
    return { page: 'game', id, host: path !== '/play', lobby: path === '/host/lobby' };
  }
  return invalid;
}

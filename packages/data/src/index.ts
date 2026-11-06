import { authenticated, entity, text, uuid } from '@microsoft/rayfin-core';
export type { UniversalAppSchema } from '@rayfin-app/shared';

// This table verifies caller identity through DAB, not through a client-supplied ID.
// It contains no roles, settings, game data, or SQL credentials.
@entity()
@authenticated(['create', 'read'], {
  policy: (claims, item) => claims.sub.eq(item.subject),
})
export class CallerIdentity {
  @uuid() id!: string;
  @text({ max: 255 }) subject!: string;
}

export const schema = [CallerIdentity];

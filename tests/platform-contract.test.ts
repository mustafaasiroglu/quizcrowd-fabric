import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CallerIdentity, schema } from '../packages/data/dist/index.js';
import { claims, createItemProxy, getEntityMetadata } from '@microsoft/rayfin-core';

describe('actual SDK metadata and release defaults', () => {
  it('exposes only the identity entity, with no guest permissions or game fields', () => {
    expect(schema).toEqual([CallerIdentity]);
    const entity = getEntityMetadata(CallerIdentity);
    const metadata = JSON.stringify(entity);
    expect(metadata).toContain('authenticated');
    expect(entity.roles?.[0].policy?.check(claims, createItemProxy()).toString())
      .toBe('@claims.sub eq @item.subject');
    expect(metadata).not.toContain('"anonymous"');
    for (const field of ['correctIndex', 'AnonymousEnabled', 'tokenHash', 'owner', 'admin']) {
      expect(metadata).not.toContain(field);
    }
  });
  it('uses protected assets, enabled Entra auth and disabled password auth', () => {
    const config = readFileSync('rayfin/rayfin.yml', 'utf8');
    expect(config).toContain('assetAccess: protected');
    expect(config).toContain('password:\n      enabled: false');
    expect(config).toContain('fabric:\n      enabled: true');
    expect(config).toContain('type: application');
  });
  it('seeds anonymous off and uses SQL locks/parameter bindings for persistence', () => {
    const ddl = readFileSync('database/001-schema.sql', 'utf8');
    expect(ddl).toContain('VALUES (1, 0, 0)');
    const code = readFileSync('rayfin/functions/src/sql-store.ts', 'utf8');
    expect(code).toContain('sql.ISOLATION_LEVEL.SERIALIZABLE');
    expect(code).toContain('UPDLOCK,HOLDLOCK');
    expect(code).toContain('WITH (HOLDLOCK)');
    expect(code).toContain("sql.NVarChar(sql.MAX), JSON.stringify(game)");
    expect(code).not.toContain('sql.connect(');
  });
});

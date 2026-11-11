import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { completeSqlCreation, connectSql, fabricRequest, fabricUrl, listAll, parseOptions, selectedDeployment } from '../scripts/deploy.mjs';

const workspace = '10000000-0000-0000-0000-000000000001';
const app = '20000000-0000-0000-0000-000000000002';
const database = '30000000-0000-0000-0000-000000000003';
const operation = `https://api.fabric.microsoft.com/v1/operations/${database}`;
const args = ['--workspace-id', workspace, '--item-name', 'Test App'];
const json = (body: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers });

describe('explicit non-destructive template installation', () => {
  it('only retries connection establishment, never SQL statements or authorization failures', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const interruption = Object.assign(new Error('interrupted'), { code: 'ESOCKET' });
      const pool = Object.assign(new EventEmitter(), { connect: vi.fn().mockImplementationOnce(() => {
        queueMicrotask(() => pool.emit('error', interruption));
        return Promise.reject(interruption);
      }).mockResolvedValueOnce(undefined) });
      const wait = vi.fn(async () => {});
      await connectSql(pool, wait);
      expect(pool.connect).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledWith(5000);
      const denied = { connect: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'ELOGIN' })) };
      await expect(connectSql(denied, wait)).rejects.toThrow('denied');
      expect(denied.connect).toHaveBeenCalledTimes(1);
    } finally { warn.mockRestore(); }
  });
  it('requires an exact selected workspace/app, rejects destructive or unknown options', () => {
    expect(parseOptions([...args, '--create-database', '--bootstrap-admin-self'])['--create-database']).toBe(true);
    expect(parseOptions([...args, '--database-id', database])['--database-id']).toBe(database);
    for (const invalid of [[], ['--workspace-id', 'bad', '--item-name', 'App'], [...args, '--force'],
      [...args, '--database-id', database, '--create-database'], [...args, '--item-name', 'Again'],
      [...args, '--database-id', 'bad'], [...args, '--capacity-id', workspace]]) {
      expect(() => parseOptions(invalid)).toThrow();
    }
  });
  it('never sends tokens to arbitrary hosts, insecure URLs or redirected endpoints', async () => {
    for (const url of ['https://evil.example/v1/workspaces', 'http://api.fabric.microsoft.com/v1/items',
      'https://api.fabric.microsoft.com.evil.example/v1/items', 'https://user@api.fabric.microsoft.com/v1/items',
      'https://api.fabric.microsoft.com/other']) expect(() => fabricUrl(url)).toThrow();
    const transport = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('x-ms-fabric-skill')).toBe('sqldb-cli');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer unit-test');
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return json({ value: [] });
    });
    await fabricRequest('/v1/workspaces', 'unit-test', {}, transport);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(fabricRequest('https://evil.example/v1/items', 'unit-test', {}, transport)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('fails writes explicitly rather than retrying an ambiguous creation', async () => {
    const transport = vi.fn(async () => json({ error: 'failed' }, 503));
    await expect(fabricRequest('/v1/workspaces', 'unit-test', { method: 'POST', body: '{}' }, transport)).rejects.toThrow('No automatic write retry');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('resolves paginated items and rejects unsafe or cyclic continuation URLs', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ value: [{ id: app }], continuationUri: '/v1/items?next=1' }))
      .mockResolvedValueOnce(json({ value: [{ id: database }] }));
    expect(await listAll(request, '/v1/items')).toEqual([{ id: app }, { id: database }]);
    await expect(listAll(async () => json({ value: [], continuationUri: 'https://evil.example/v1/items' }), '/v1/items')).rejects.toThrow();
    await expect(listAll(async () => json({ value: [], continuationUri: '/v1/items' }), '/v1/items')).rejects.toThrow('pagination');
  });
  it('resumes SQL creation by GET, honors retry delay and retrieves the actual result ID', async () => {
    const request = vi.fn().mockResolvedValueOnce(json({ status: 'Running' }, 200, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json({ status: 'Succeeded' })).mockResolvedValueOnce(json({ id: database }));
    const wait = vi.fn(async () => {});
    expect(await completeSqlCreation(request, operation, wait)).toBe(database);
    expect(wait).toHaveBeenCalledWith(2000);
    expect(request.mock.calls.map(call => call[0])).toEqual([operation, operation, `${operation}/result`]);
  });
  it('does not convert failed, unknown or incomplete operations into successful installs', async () => {
    for (const status of ['Failed', 'Cancelled', 'Unknown', undefined]) {
      await expect(completeSqlCreation(async () => json({ status }), operation)).rejects.toThrow();
    }
    await expect(completeSqlCreation(async () => json({ status: 'Running' }), 'https://evil.example/v1/operations/id')).rejects.toThrow();
    const request = vi.fn().mockResolvedValueOnce(json({ status: 'Succeeded' })).mockResolvedValueOnce(json({}));
    await expect(completeSqlCreation(request, operation)).rejects.toThrow('database ID');
  });
  it('requires registry readback to match the explicit target before secrets/bootstrap', () => {
    const deployment = { fabricWorkspaceId: workspace, fabricItemId: app, publishableKey: 'public-unit-key',
      fabricApiUrl: `https://example.pbidedicated.windows.net/v1/workspaces/${workspace}/appbackends/${app}/` };
    const registry = { active: 'test', deployments: { test: deployment } };
    expect(selectedDeployment(registry, workspace, app)).toBe(deployment);
    for (const patch of [{ fabricWorkspaceId: database }, { fabricItemId: database },
      { fabricApiUrl: `https://evil.example/workspaces/${workspace}/appbackends/${app}` },
      { fabricApiUrl: 'https://example.pbidedicated.windows.net/another-app' }, { publishableKey: '' }]) {
      expect(() => selectedDeployment({ active: 'test', deployments: { test: { ...deployment, ...patch } } }, workspace, app)).toThrow();
    }
  });
});

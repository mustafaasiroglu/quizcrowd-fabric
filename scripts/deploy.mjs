import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const help = `Usage: npm run deploy -- --workspace-id <GUID> --item-name "<existing Fabric App>"
  --create-database       Approve automatic private SQL Database creation on this workspace's capacity.
  --database-id <GUID>    Bind an existing private database instead; never recreate it.
  --bootstrap-admin-self  Explicitly bootstrap the verified deploying user, only for an empty admin table.
Repeat deployments reuse the ignored local binding. No capacity, tenant policy or SQL grants are created.
Requires Node 24, Azure CLI signed in as the same user as Rayfin, and an existing capacity-backed App.`;

export function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (['--help', '--create-database', '--bootstrap-admin-self'].includes(key)) {
      if (options[key]) throw new Error(`Duplicate option ${key}`);
      options[key] = true;
    } else if (['--workspace-id', '--item-name', '--database-id'].includes(key)) {
      const value = args[++index];
      if (!value || value.startsWith('--') || options[key]) throw new Error(`Missing or duplicate value for ${key}`);
      options[key] = value;
    } else throw new Error(`Unknown deployment option: ${key}`);
  }
  if (options['--help']) return options;
  assert.ok(guid.test(options['--workspace-id'] ?? ''), 'Provide an explicit --workspace-id GUID.');
  assert.ok(typeof options['--item-name'] === 'string' && options['--item-name'].trim()
    && options['--item-name'].length <= 120 && !/[\u0000-\u001f]/.test(options['--item-name']), 'Provide the exact existing Fabric App name (1-120 characters).');
  if (options['--database-id']) assert.ok(guid.test(options['--database-id']), 'Invalid --database-id GUID.');
  assert.ok(!(options['--create-database'] && options['--database-id']), 'Choose --create-database or --database-id, not both.');
  for (const key of ['--workspace-id', '--database-id']) if (options[key]) options[key] = options[key].toLowerCase();
  return options;
}

export function fabricUrl(value) {
  const url = new URL(value, 'https://api.fabric.microsoft.com');
  assert.ok(url.origin === 'https://api.fabric.microsoft.com' && url.pathname.startsWith('/v1/')
    && !url.username && !url.password, 'Refusing a non-Fabric control-plane URL.');
  return url.href;
}

export async function fabricRequest(path, token, init = {}, transport = fetch) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('x-ms-fabric-skill', 'sqldb-cli');
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await transport(fabricUrl(path), { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Fabric ${init.method ?? 'GET'} ${new URL(fabricUrl(path)).pathname}: HTTP ${response.status}. No automatic write retry was attempted.`);
  return response;
}

export async function listAll(request, path) {
  const values = [], visited = new Set();
  while (path) {
    const url = fabricUrl(path);
    assert.ok(!visited.has(url) && visited.size < 1000, 'Invalid Fabric pagination.');
    visited.add(url);
    const page = await (await request(url)).json();
    assert.ok(Array.isArray(page.value), 'Invalid Fabric list response.');
    values.push(...page.value);
    assert.ok(!page.continuationToken || page.continuationUri, 'Fabric returned a continuation token without a safe continuation URL.');
    path = page.continuationUri;
  }
  return values;
}

export async function completeSqlCreation(request, operationUrl, wait = sleep) {
  const url = fabricUrl(operationUrl);
  assert.match(new URL(url).pathname, /^\/v1\/operations\/[0-9a-f-]+$/i);
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await request(url);
    const operation = await response.json();
    if (operation.status === 'Succeeded') {
      const resultUrl = new URL(url);
      resultUrl.pathname += '/result';
      const item = await (await request(resultUrl.href)).json();
      assert.ok(guid.test(item.id ?? ''), 'Completed SQL operation did not return a database ID; retain the binding and investigate.');
      return item.id;
    }
    assert.ok(['NotStarted', 'Running'].includes(operation.status), `SQL creation did not succeed: ${operation.status ?? 'missing status'}.`);
    const delay = Number(response.headers.get('Retry-After') ?? 5);
    await wait((Number.isFinite(delay) ? Math.min(60, Math.max(1, delay)) : 5) * 1000);
  }
  throw new Error('SQL creation is still pending. Rerun to resume the recorded operation; do not create another database.');
}

export function selectedDeployment(registry, workspaceId, appId) {
  const deployment = registry.deployments?.[registry.active];
  assert.ok(deployment?.fabricWorkspaceId === workspaceId && deployment.fabricItemId === appId, 'Rayfin active deployment does not match the explicitly selected app/workspace.');
  const endpoint = new URL(deployment.fabricApiUrl);
  assert.ok(endpoint.protocol === 'https:' && (endpoint.hostname === 'api.fabric.microsoft.com'
    || endpoint.hostname.endsWith('.pbidedicated.windows.net'))
    && endpoint.pathname.toLowerCase().endsWith(`/v1/workspaces/${workspaceId}/appbackends/${appId}/`)
    && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, 'Unrecognized or mismatched Fabric runtime endpoint.');
  assert.ok(typeof deployment.publishableKey === 'string' && deployment.publishableKey, 'Missing app publishable key.');
  return deployment;
}

export async function connectSql(pool, wait = sleep) {
  pool.on?.('error', error => console.error(`SQL connection pool reported ${error.code ?? 'an error'}; active operations may fail.`));
  for (let attempt = 0; ; attempt++) {
    try { await pool.connect(); return; }
    catch (error) {
      if (attempt === 2 || !['ESOCKET', 'ETIMEOUT'].includes(error.code)) throw error;
      console.error(`SQL connection interrupted; retrying connection (${attempt + 2}/3). No SQL statements have run.`);
      await wait(5000 * (attempt + 1));
    }
  }
}

export async function withVerifiedPublisher(deployment, entraToken, action) {
  const { RayfinClient } = await import('@microsoft/rayfin-client');
  const { signInWithEntraToken } = await import('@microsoft/rayfin-auth-provider-fabric');
  const client = new RayfinClient({ baseUrl: deployment.fabricApiUrl, publishableKey: deployment.publishableKey,
    authStorage: false, autoRefreshToken: false, multiTabSync: false });
  try {
    const session = await signInWithEntraToken(client.auth, { entraToken });
    assert.ok(session.isAuthenticated && !session.isAnonymous && session.user?.id, 'Publisher app authentication failed.');
    const subject = session.user.id;
    assert.ok(subject.length <= 255, 'Verified app subject exceeds the private schema limit.');
    if (!(await client.data.CallerIdentity.select(['subject']).where({ subject: { eq: subject } }).first(1).execute()).length) await client.data.CallerIdentity.create({ subject });
    const verified = await client.data.CallerIdentity.select(['subject']).where({ subject: { eq: subject } }).first(1).execute();
    assert.equal(verified[0]?.subject, subject, 'Publisher caller-scoped identity verification failed.');
    return await action(client, subject);
  } finally { client.auth.destroy(); }
}

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function azureJson(command) {
  const options = { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 };
  const { stdout } = process.platform === 'win32'
    ? await promisify(execFile)(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `az ${command}`], options)
    : await promisify(execFile)('az', command.split(' '), options);
  return JSON.parse(stdout);
}

async function runCli(args, input) {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.resolve('@microsoft/rayfin-cli'))), '..');
  const metadata = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'));
  const entry = resolve(packageDir, typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.rayfin);
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    child.once('error', reject);
    child.once('close', code => code === 0 ? done() : reject(new Error(`Rayfin ${args.slice(0, 2).join(' ')} failed (exit ${code}).`)));
    child.stdin.on('error', reject);
    child.stdin.end(input);
  });
}

async function main(options) {
  process.chdir(root);
  assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Use Node.js 24 and the committed lockfile.');
  assert.ok(!process.env.RAYFIN_TOKEN, 'Use the signed-in publisher account, not an ambient RAYFIN_TOKEN override.');
  const lockPath = resolve(root, 'rayfin', '.quizcrowd-deploy.lock');
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const { ensureAuthenticated, getRayfinAuth } = await import('@microsoft/rayfin-cli/auth');
    const account = await (await getRayfinAuth()).getAccount();
    assert.ok(account?.username && account.tenantId, 'Run npx rayfin login first.');
    const azure = await azureJson('account show --output json');
    assert.ok(azure.tenantId === account.tenantId && azure.user?.type === 'user'
      && azure.user.name.toLowerCase() === account.username.toLowerCase(), 'Azure CLI and Rayfin must be signed in as the same publisher user/tenant.');
    const workspaceId = options['--workspace-id'];
    const request = async (path, init) => {
      const auth = await ensureAuthenticated(undefined, { silent: true, tenantId: account.tenantId });
      return fabricRequest(path, auth.token, init);
    };
    const workspace = await (await request(`/v1/workspaces/${workspaceId}`)).json();
    assert.ok(guid.test(workspace.capacityId ?? ''), 'Choose a workspace already assigned to an approved supported capacity.');
    const apps = (await listAll(request, `/v1/workspaces/${workspaceId}/items?type=AppBackend`))
      .filter(item => item.type === 'AppBackend' && item.displayName === options['--item-name']);
    assert.equal(apps.length, 1, 'Create exactly one Fabric App with this exact name in the selected workspace first.');
    const app = apps[0];
    assert.ok(guid.test(app.id), 'Invalid Fabric App ID.');
    const bindingPath = resolve(root, 'rayfin', '.quizcrowd-bindings.json');
    const bindings = await optionalJson(bindingPath);
    assert.ok(bindings && typeof bindings === 'object' && !Array.isArray(bindings), 'Invalid local SQL binding registry.');
    const key = `${workspaceId}/${app.id}`;
    let binding = bindings[key];
    const persist = async value => {
      binding = value; bindings[key] = value;
      await writeFile(`${bindingPath}.tmp`, JSON.stringify(bindings, null, 2));
      await rename(`${bindingPath}.tmp`, bindingPath);
    };
    const explicitId = options['--database-id'];
    assert.ok(!explicitId || !binding?.databaseId || explicitId === binding.databaseId, 'Refusing to replace an existing SQL binding. Review its backup and deployment history first.');
    assert.ok(binding?.databaseId || binding?.operationUrl || explicitId || options['--create-database'], 'First install requires --create-database approval, or --database-id for an existing database.');
    let databaseId = explicitId ?? binding?.databaseId;
    if (!databaseId && binding?.operationUrl) databaseId = await completeSqlCreation(request, binding.operationUrl);
    if (!databaseId) {
      assert.ok(!binding?.creationRequested, 'A prior SQL creation has an unknown outcome. Inspect the workspace and bind its ID explicitly; automatic retry could create a second database.');
      const displayName = `${app.displayName} Data`;
      const existing = await listAll(request, `/v1/workspaces/${workspaceId}/sqlDatabases`);
      assert.ok(!existing.some(item => item.displayName === displayName), 'A same-name SQL database already exists. Bind its reviewed ID explicitly instead of creating/adopting another.');
      await persist({ creationRequested: true, displayName });
      const response = await request(`/v1/workspaces/${workspaceId}/sqlDatabases`, { method: 'POST',
        body: JSON.stringify({ displayName, description: `Private QuizCrowd data for Fabric App ${app.id}`,
          creationPayload: { creationMode: 'New', collation: 'Latin1_General_100_BIN2_UTF8' } }) });
      if (response.status === 202) {
        const operationUrl = response.headers.get('Location');
        assert.ok(operationUrl, 'SQL creation accepted without an operation URL; inspect the workspace before rerunning.');
        await persist({ operationUrl: fabricUrl(operationUrl) });
        databaseId = await completeSqlCreation(request, operationUrl);
      } else {
        assert.equal(response.status, 201, 'Unexpected SQL creation response.');
        databaseId = (await response.json()).id;
      }
    }
    assert.ok(guid.test(databaseId ?? ''), 'Missing SQL database ID.');
    await persist({ databaseId });
    const database = await (await request(`/v1/workspaces/${workspaceId}/sqlDatabases/${databaseId}`)).json();
    assert.equal(database.id, databaseId);
    const server = database.properties?.serverFqdn?.replace(/,1433$/, '');
    const databaseName = database.properties?.databaseName;
    assert.ok(typeof server === 'string' && /^[a-z0-9.-]+$/i.test(server) && databaseName, 'SQL item did not return valid writable connection metadata.');
    console.log(`Selected existing workspace/App. Private SQL binding: ${databaseId}. No capacity, tenant or SQL grants will be changed.`);
    const cliTarget = ['--workspace-id', workspaceId, '--item-name', app.displayName, '--tenant', account.tenantId, '--yes'];
    await runCli(['up', ...cliTarget, '--exclude-services', 'staticHosting,functions']);
    const deployment = selectedDeployment(await optionalJson(resolve(root, 'rayfin', '.deployments.json')), workspaceId, app.id);
    const currentAccount = await (await getRayfinAuth()).getAccount();
    assert.equal(currentAccount?.homeAccountId, account.homeAccountId, 'Publisher identity changed during deployment.');
    const sqlAuth = await azureJson('account get-access-token --resource https://database.windows.net --output json');
    assert.equal(sqlAuth.tenant, account.tenantId, 'SQL token tenant changed.');
    const { default: sql } = await import('mssql');
    const pool = new sql.ConnectionPool({ server, database: databaseName,
      authentication: { type: 'azure-active-directory-access-token', options: { token: sqlAuth.accessToken } },
      options: { encrypt: true, trustServerCertificate: false, abortTransactionOnError: true }, requestTimeout: 120000 });
    try {
      await connectSql(pool);
      const legacy = await pool.request().query("IF OBJECT_ID(N'quizcrowd.Games',N'U') IS NOT NULL SELECT COUNT(*) AS Count FROM quizcrowd.Games WHERE LEN(Code)<>6 OR Code LIKE '%[^0-9]%'");
      assert.ok(!legacy.recordset?.[0]?.Count, 'Existing legacy codes require the documented staged upgrade; automatic deployment will not rewrite games.');
      for (const name of ['001-schema.sql', '002-six-digit-codes.sql']) {
        const source = await readFile(resolve(root, 'database', name), 'utf8');
        for (const batch of source.split(/^\s*GO\s*$/gmi)) if (batch.trim()) await pool.request().batch(batch);
      }
      if (options['--bootstrap-admin-self']) {
        const auth = await ensureAuthenticated(undefined, { silent: true, tenantId: account.tenantId });
        await withVerifiedPublisher(deployment, auth.token, async (_client, subject) => {
          await pool.request().input('subject', sql.NVarChar(255), subject).batch(`
SET XACT_ABORT ON; SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; BEGIN TRANSACTION;
SELECT Id FROM quizcrowd.Settings WITH (XLOCK,HOLDLOCK) WHERE Id=1;
IF NOT EXISTS(SELECT 1 FROM quizcrowd.Administrators WHERE Subject=@subject)
BEGIN
  IF EXISTS(SELECT 1 FROM quizcrowd.Administrators) THROW 51000,'Administrator bootstrap is closed; existing administrators are preserved.',1;
  INSERT quizcrowd.Administrators(Subject) VALUES(@subject);
END; COMMIT;`);
        });
      }
      const state = await pool.request().query("SELECT AnonymousEnabled,GuestEpoch,(SELECT COUNT(*) FROM quizcrowd.Administrators) AS AdminCount FROM quizcrowd.Settings WHERE Id=1");
      assert.equal(state.recordset.length, 1, 'Private schema initialization failed.');
      assert.ok(state.recordset[0].AdminCount, 'No application administrator exists. Rerun with explicit --bootstrap-admin-self or use the trusted manual bootstrap.');
      console.log(`Private SQL initialized. Guest switch preserved (${state.recordset[0].AnonymousEnabled ? 'enabled' : 'disabled'}). Administrators: ${state.recordset[0].AdminCount}.`);
    } finally { await pool.close(); }
    await runCli(['secret', 'set', 'QUIZCROWD_SQL_SERVER', '--stdin'], server);
    await runCli(['secret', 'set', 'QUIZCROWD_SQL_DATABASE', '--stdin'], databaseName);
    await runCli(['up', ...cliTarget]);
    const published = selectedDeployment(await optionalJson(resolve(root, 'rayfin', '.deployments.json')), workspaceId, app.id);
    const auth = await ensureAuthenticated(undefined, { silent: true, tenantId: account.tenantId });
    await withVerifiedPublisher(published, auth.token, async (client, subject) => {
      const result = await client.functions.quizcrowd.invoke({ request: JSON.stringify({ command: 'settings' }), subject, attendeeToken: '' });
      assert.ok(result.ok && result.value, `Published Function/SQL verification failed: ${result.error ?? 'missing settings result'}`);
      const settings = JSON.parse(result.value);
      assert.ok(typeof settings.anonymousEnabled === 'boolean' && Number.isInteger(settings.guestEpoch), 'Published Function returned invalid settings.');
      if (options['--bootstrap-admin-self']) assert.equal(settings.isAdmin, true, 'Published runtime did not recognize the explicitly bootstrapped administrator.');
    });
    console.log('Full Rayfin publication and authenticated Function/SQL readback passed for the selected App. Test it inside the Fabric portal; anonymous attendance remains a separate release gate.');
  } finally { await lock.close(); await unlink(lockPath); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options['--help']) console.log(help);
    else await main(options);
  } catch (error) {
    console.error(`Deployment stopped: ${error.message}`);
    process.exitCode = 1;
  }
}

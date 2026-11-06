# Deployment and administration

## Prerequisites

Use a dedicated **test** workspace first. Deployment commands create real
resources; local checks and CI do not deploy anything automatically.

| Requirement | Publisher responsibility |
| --- | --- |
| Fabric Apps preview | Tenant admin enables the workload for your publisher group |
| Region | Confirm both Fabric Apps and user data Functions availability in the chosen region; consult the live region matrix rather than assuming all Fabric regions work |
| Capacity | Assign a supported Fabric capacity to the workspace; budget capacity consumption and SQL storage explicitly |
| Deployment identity | Workspace/item permissions sufficient to create and update the app; only the Functions item owner can modify/publish its Functions |
| Runtime owner | The Fabric App item owner's identity is currently used for external SQL tokens; grant that identity access to the application SQL database |
| Signed-in users | Entra users in the app's tenant with **Run and interact / Read and execute** permission on the Fabric App item |
| Local tooling | Node.js 24 LTS, npm, Git, and Azure Functions Core Tools v4 for local Functions debugging |
| Application storage | A writable **SQL Database in Microsoft Fabric**, not its read-only analytics endpoint, Warehouse or Lakehouse |

Documentation checked against Rayfin **1.36.2** and Microsoft Learn in November
2026. Fabric Apps is preview; verify current constraints before distribution:

- [Fabric Apps overview and capacity requirements](https://learn.microsoft.com/en-us/fabric/apps/overview)
- [Fabric region availability](https://learn.microsoft.com/en-us/fabric/admin/region-availability)
- [Functions service limitations](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-service-limits)
- [Functions and invocation identity](https://learn.microsoft.com/en-us/fabric/apps/functions)
- [External SQL connections](https://learn.microsoft.com/en-us/fabric/apps/functions-connect-external-resources)

No Azure subscription resource, public endpoint, or capacity should be created
merely to run the local unit tests.

## 1. Create your template copy

Use GitHub's **Use this template**, clone the resulting repository, and keep the
lockfile. Review `LICENSING.md`: being public or marked as a template does not
grant a reusable software license.

```powershell
npm ci --ignore-scripts --no-audit
npm run check
```

This install mode avoids executing dependency lifecycle scripts and is sufficient
for the tested compile/build/test path. If your platform requires a native
credential helper for CLI sign-in, review the exact dependency's lifecycle script
before approving/rebuilding it. Do not blanket-enable unknown scripts.

The lockfile pins versions and integrity hashes without environment-specific
registry download URLs. The committed `.npmrc` preserves that portable format;
`npm ci` resolves packages through your configured trusted npm registry.

## 2. Create and initialize private application storage

In the selected workspace, explicitly create a **SQL Database** item. This is a
separate writable application database, not the Rayfin-managed identity database.
Keeping custom tables separate avoids manual changes to a Rayfin-managed schema.

As a trusted database administrator:

1. Open that SQL Database's writable query editor or connect with an approved SQL
   client. Run `database/001-schema.sql`.
2. Obtain its actual `serverFqdn` and `databaseName` from the Fabric item's
   connection information. Do not copy a Warehouse/Lakehouse connection or use
   a database password.
3. Keep those two **non-secret deployment coordinates** for the encrypted
   server-side app configuration in step 3. Do not edit source constants or
   put the coordinates in frontend environment variables. The SQL server
   configuration accepts Fabric's optional `,1433` metadata suffix.
   Never accept a SQL server, database, query text or resource token from a
   browser request.
4. Provision the app owner's trusted Entra identity as a contained SQL user using
   your organization's approved Entra/Fabric administration procedure.
5. Grant only the private application schema access it needs. Do not grant the
   app owner `db_owner` just for runtime operations, and never grant SQL access
   to attendees.

Example grant, after replacing the principal name with the actual provisioned
database principal:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE
ON SCHEMA::quizcrowd TO [app-owner-principal];
```

The Function currently needs SELECT on Settings/Administrators/Games,
INSERT/UPDATE/DELETE on Games, UPDATE on Settings, and INSERT on Audit. For
tighter table-level runtime grants use:

```sql
GRANT SELECT, UPDATE ON OBJECT::quizcrowd.Settings TO [app-owner-principal];
GRANT SELECT ON OBJECT::quizcrowd.Administrators TO [app-owner-principal];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::quizcrowd.Games TO [app-owner-principal];
GRANT INSERT ON OBJECT::quizcrowd.Audit TO [app-owner-principal];
```

Prefer the table-level grants in production. Bootstrap Administrators with a
separate trusted database administrator, not through the app. A schema-wide grant
is broader and includes modifying administrator records; the app owner is
necessarily a trusted publisher, but its runtime SQL user need not have that power.

The SQL script is rerunnable for initial object creation and **does not reset**
an existing guest switch. It is not a general migration engine. Back up data and
review all subsequent schema changes.

## 3. Deploy the Entra-only baseline

Keep the committed defaults in `rayfin/rayfin.yml`:

```yaml
services:
  auth:
    enabled: true
    fabric:
      enabled: true
      externalEntraExchange: true
    password:
      enabled: false
  data:
    enabled: true
    dialect: mssql
    path: packages/data
  staticHosting:
    enabled: true
    path: packages/frontend
    assetAccess: protected
  functions:
    enabled: true
    path: rayfin/functions
    auth:
      type: application
```

The repository contains the complete build and hosting configuration; the above
is an explanatory excerpt, not a replacement file. The data service contains
only `CallerIdentity`. Do not add a generic quiz/config data entity or an
`@anonymous` decorator to make authorization failures disappear.

After confirming the intended workspace/capacity:

```powershell
npx rayfin login
npx rayfin up --workspace "<workspace-name>"
npx rayfin up status
```

The first deployment creates the target for the supported secrets commands.
Before sharing the app, set its server-only SQL configuration using the actual
connection information from step 2:

```powershell
'<actual-server-fqdn>' | npx rayfin secret set QUIZCROWD_SQL_SERVER --stdin
'<actual-database-name>' | npx rayfin secret set QUIZCROWD_SQL_DATABASE --stdin
npx rayfin up functions deploy
```

Replace the placeholders before running these commands. The CLI stores the
values encrypted in the target app. Only the names/descriptions in `rayfin.yml`
and the generated `secrets.generated.ts` types belong in source control; never
hand-edit the generated file. Missing configuration fails closed. SQL access
still uses the app owner's Entra token, not a password or a stored access token.
For local Functions only, supply the same named environment variables through
your approved local configuration mechanism.

This is a real deployment and can create/update Fabric items and consume
capacity. Preserve the CLI-generated local deployment registry, but do not
commit it. The CLI emits runtime `rayfin.config.json` and hosting coordinates;
the application resolves those rather than hardcoding one environment's IDs.

Signed-in creators and attendees need app item Execute permission. They do
**not** need direct access to either SQL database or workspace contributor
permissions. First Entra sign-in provisions a session automatically. Interactive
sign-in runs directly from the sign-in button; embedded authentication is
initialized before trusting a stored standalone session.

For the first test, open the deployed App item through the Fabric portal and
sign in to its owning tenant. This embedded path was live-verified. A standalone
protected-hosting launch also needs its platform sign-in popup; a browser panel
that blocks popups cannot establish that session.

Run all applicable [release gates](#release-gates) for the Entra-only baseline.

## 4. Bootstrap a publisher/admin explicitly

There is no "first user becomes admin" rule. Admin/publisher authority comes
only from `quizcrowd.Administrators`, provisioned by a trusted SQL administrator.
Any signed-in creator may manage their own quizzes, not global config.

1. Sign in with the intended administrator account.
2. Copy the caller subject displayed in **Host your next session**. It is the
   app's verified opaque session subject, not necessarily an Entra object UUID.
3. Independently confirm the account through the app's user administration and
   your organization's identity process. Do not trust an unsolicited subject
   supplied by a user seeking admin access.
4. With a trusted SQL administrator connection, replace the placeholder below
   and insert exactly that subject:

```sql
INSERT INTO quizcrowd.Administrators (Subject)
VALUES (N'<verified-app-caller-subject>');
```

Refresh the library. **Publisher controls** now appears. Revoking the row removes
admin authority on the next request. There is no user-editable profile role,
password, URL parameter, email-domain check or client flag that grants admin.

```sql
DELETE FROM quizcrowd.Administrators
WHERE Subject = N'<verified-app-caller-subject>';
```

Retain at least one independently authorized database administrator for recovery.

## 5. Public attendance is an explicit additional deployment

### Release gate: verify the Function path first

Microsoft documents anonymous **data CRUD**, but the documentation inspected for
Functions does not establish that signed-out Function invocation can mint the
app-identity SQL token in every Fabric tenant. The SDK permits sending an
invocation without a signed-in session; that is **not** proof the deployed
platform accepts it.

Before advertising anonymous attendance, verify a signed-out request through the
real deployed `client.functions.quizcrowd.invoke(...)` path, including an actual
SQL-backed operation. If the platform returns 401/403 or does not bind
`ctx.Tokens.Sql`, public attendance is **blocked in that deployment**. Keep the
database flag off. Do not add public CRUD grants, decode an unverified JWT,
use a shared creator token in the browser, or expose a direct Functions host
URL as a workaround.

Read the tenant setting rather than assuming it is disabled: a Fabric
administrator can use the supported
[List Tenant Settings API](https://learn.microsoft.com/en-us/rest/api/fabric/admin/tenants/list-tenant-settings).
An enabled tenant setting and publicly served static assets do not prove that
the Function gateway permits unsigned invocation. Read the setting's scope in
the Admin portal if the API response does not establish it. Rayfin 1.36.2
validates `functions.auth.type: application`; do not invent an `anonymous` or
`none` auth mode to bypass this gate.

The bounded alternative is Entra-only attendance with the existing template.
An external authenticated/anonymous API gateway or hosting backend would be a
separate architecture and infrastructure decision, not a hidden fallback in
this repository.

### Tenant, assets, APIs, database, quiz

Public mode has independent layers:

| Layer | Action |
| --- | --- |
| Tenant | Fabric administrator approves public access and enables **Anonymous data access** for the approved app-owner/publisher group; this setting alone does not establish Function support |
| Static assets | Change `services.staticHosting.assetAccess` to `public` and perform a **full** `npx rayfin up` |
| Function gateway | Confirm signed-out invocation and SQL token binding in the tenant, without any extra public game entities |
| Database | An authorized app admin enables `AnonymousEnabled`; start off |
| Quiz | Creator chooses **Anyone (Public)** and acknowledges the all-questions warning |
| Guest credential | Joining mints a random 256-bit capability; subsequent operations require it, the correct quiz and an unrevoked guest generation |

See [anonymous data controls](https://learn.microsoft.com/en-us/fabric/apps/anonymous-data-access)
and [static asset access](https://learn.microsoft.com/en-us/fabric/apps/hosting).
The tenant setting can take minutes to propagate. It is not the application
kill switch. Public static files contain executable code and public configuration
only, never quiz content or secrets.

`npx rayfin up staticapp deploy` changes content only; it does **not** apply a
changed `assetAccess` value. Use full `npx rayfin up`.

Do not grant anonymous access to `CallerIdentity`, application SQL tables, SQL
analytics endpoints, connectors, generic query functions, or any other direct
API. Public question preview is the narrow Function projection.

After passing the public release gates, enable the switch in **Publisher
controls**. Only then can creators select Public. Create a test public quiz
and verify its warning and all-question preview while signed out.

## 6. Exact anonymous switch operations

Preferred: sign in as a bootstrapped admin, open **Publisher controls**, and use
**Allow anonymous attendees**. The server verifies the caller through DAB and
then checks Administrators inside the SQL transaction. Changes are audited.

For emergency SQL administration, run this with a trusted database connection.
It serializes with requests that hold the settings row until their transaction
completes:

```sql
SET XACT_ABORT ON;
BEGIN TRANSACTION;
UPDATE quizcrowd.Settings
SET AnonymousEnabled = 0, GuestEpoch = GuestEpoch + 1
WHERE Id = 1;
INSERT quizcrowd.Audit (Actor, AnonymousEnabled, GuestEpoch)
SELECT N'<trusted-administrator-audit-label>', AnonymousEnabled, GuestEpoch
FROM quizcrowd.Settings WHERE Id = 1;
COMMIT;
```

To enable after the public release gates, use the same transaction with
`AnonymousEnabled = 1` instead. Increment `GuestEpoch` with every actual
enable/disable transition. Directly changing the bit without advancing the
generation can allow previously issued credentials to resume after re-enabling.

Global-off denies every subsequent anonymous preview, join, state poll and
answer, even for an already-public quiz or an existing credential. It does not
delete stored quizzes or prevent signed-in participation. Existing in-flight
transactions can finish before the switch commits; there is no settings cache.
New guests must join after re-enabling. Creators can also select **Make internal**
on a single running quiz. Already downloaded questions cannot be revoked.

For a complete return to protected hosting, also change `assetAccess` to
`protected` and fully redeploy. A tenant administrator can disable the tenant
anonymous setting as an organization-wide additional control.

## Development and updates

For a local frontend targeting your test backend, copy
`packages/frontend/.env.example` to `.env.local` in that directory and fill in the
non-secret runtime coordinates. Never put SQL tokens, passwords or private quiz
content into a `VITE_*` variable.

For Functions, install Azure Functions Core Tools v4 using your approved
installation method, sign in with `npx rayfin login` and run `npm run dev`.
Rayfin's Vite adapter routes local invocations to the selected local host.
Bind development servers to loopback; a local Function host is not a public API.

Local external SQL tokens use the signed-in developer's permissions; deployed
tokens use the app owner's permissions. A successful local SQL call does not
prove the runtime identity is authorized. Do not trust client-supplied headers
on an independently exposed local host; production identity injection belongs
to Fabric's Function gateway.

After changing the registered Function signature, regenerate its types using:

```powershell
npx rayfin functions init --path rayfin/functions
```

The CLI preserves the existing source and generates `src/types.ts`. Do not
hand-edit it. Updates to existing deployments use a reviewed pull/merge of your
template copy, `npm ci`, `npm run check`, reviewed SQL migrations if needed, and
full `npx rayfin up`. Never use schema `--force` without a separate destructive
migration review. Observe the documented Functions publishing cooldown.

### Dependency maintenance

The full online audit on the
[public CI runner](https://github.com/mustafaasiroglu/quizcrowd-fabric/actions/runs/42216044575)
reported **0 known vulnerabilities** for the validated lockfile. Local registry
proxy results initially missed advisories, so offline or stale mirror output
is not treated as a clean online scan. CI now runs
`npm audit --audit-level=high` on every push and pull request.

The pinned Rayfin 1.36.2 toolchain requires these explicit mitigations:

| Dependency | Pin / override | Reason |
| --- | --- | --- |
| Zod | Application 4.6.7 and scoped `rayfin-tools-common` override | GHSA-mrhx-c7xc-m3w5 constrained-collection memory exhaustion |
| CLI MSAL Node | Scoped `rayfin-cli` override to 7.2.0 | GHSA-xcx6-jx8p-x3h5 authorization-code parameter disclosure |
| glob | 14.0.3 override, selecting patched minimatch transitively | GHSA-3g3m-2fjr-6pw4 cancellation bypass and GHSA-g3hv-75wg-m249 minimatch denial of service |
| Vite / Vitest | 8.3.5 / 4.1.12 | Development-server/editor and mock-registration/path-traversal advisories |

After these updates, local checks exercised CLI startup, MSAL client
construction (not a live sign-in), glob/ZIP packaging, actual DAB configuration
generation and actual Function bundling. Both local and clean Ubuntu CI
typechecks/tests/build passed. Live sign-in, publishing, SQL access and guest
authorization still require the release gates below.

The frontend also sets Vite `resolve.dedupe` for `react` and `react-dom`. A
workspace peer dependency can otherwise load a different React copy for
`qrcode.react`, producing an invalid-hook failure only when the lobby QR
renders. The production-Vite QR test reproduced the live `useMemo` error before
this fix, renders the real SVG afterward, and requires no Fabric credentials.

Review these overrides when updating the SDK and remove them only after the
upstream dependencies are patched and integration checks pass. Do not follow
an `npm audit fix --force` recommendation that downgrades Rayfin to an older
API. Audit results are point-in-time evidence, not a production security promise.

## Release gates

An Entra-only test deployment on an existing F8 capacity passed **30 actual
SDK/SQL/UI checks**. These included caller-scoped identity verification,
encrypted SQL configuration and app-owner SQL token binding, trusted admin
bootstrap, quiz/survey authoring, join-code attendance, credential rotation and
quiz scoping, concurrent host actions and duplicate/competing answers, scoring,
aggregate survey results, and persistence across a real portal/client reload.
The real form, QR lobby, timed question, reveal, leaderboard and finish controls
were exercised after fixing and redeploying the duplicate-React QR failure.

Negative controls also verified absent private GraphQL entities, protected
answer keys, subject/ownership spoof rejection, and a real authenticated
nonadmin's inability to configure the app. Tests used **one real Entra account**:
foreign ownership and previously issued guest credentials used explicitly
trusted SQL fixtures, not a second account or a successful public session.
The database global-off check rejected preview/join/state/answer for an existing
public guest fixture through an authenticated gateway request carrying no
claimed actor. This proves the SQL-backed application check, not signed-out
gateway support. All temporary negative fixtures were removed, the administrator
was restored, and anonymous access remained off with generation 0.

Separately, actual signed-out probes were rejected: Function calls returned HTTP 403
(`Anonymous access is not allowed for function invocation`), and CallerIdentity
read/create returned GraphQL authorization errors. This verifies the baseline
boundary, **not public attendance**. Live off/on generation revocation, guest
isolation with enabled public execution, a second real account and load testing
remain release gates. No tenant-wide anonymous setting was changed. The
supported interactive Fabric broker resolved the initial browser authentication
gate; Azure CLI's optional direct-token path still lacks first-party
`Item.Execute.All` preauthorization in this environment.

A separately approved, temporary public-hosting experiment further isolated
the access layers. The real tenant-settings API returned
`EnableAnonymousDataAccessForFabricApps.enabled: true`, but no security-group
scope details. A separate read-only Admin portal inspection confirmed that
the setting applied to the entire organization, with no group exclusions.
The form remained pristine with its Apply button disabled; no policy was changed.
A full supported CLI deployment set the actual app's
`staticHosting.anonymousAccess` to `true`, with Function authentication still
`application`. An unsigned client retrieved the real production HTML and
JavaScript with HTTP 200. Its `settings`, `list`, and internal-quiz `preview`
Function calls nevertheless all returned the same gateway HTTP 403, and direct
CallerIdentity reads remained unauthorized. Thus protected static hosting was
not the sole blocker, and simply enabling the tenant setting again is not a
supported remedy.

The experiment was rolled back through another full deployment. Remote
settings confirmed protected hosting, and an unsigned request to the app entry
returned HTTP 401. Private SQL readback before and after the experiment retained
`AnonymousEnabled = 0`, `GuestEpoch = 0`, one administrator and the same four
internal test sessions. No public game/data grants were added. This is evidence
for this deployment, not proof that all tenants lack anonymous Functions or that
an unsigned call received an app-identity SQL token. The Function gateway and
unsigned SQL-token binding still need platform confirmation before public attendance.

Local tests use domain objects and a serialized transactional test double. The
SDK metadata test uses the real built model and real policy DSL. Wire tests use
the real SDK with mocked HTTP responses, including both encoded and object
Function reply envelopes. The build and offline bundler are real. The 34 local regression tests do not
make a request to live Fabric; the separate live results above do.

Before any event, test the following in a **non-production tenant/workspace**.
Use browser developer tools or a small SDK caller to bypass the UI deliberately.

| Test | Required outcome |
| --- | --- |
| Fresh install / host reload | Settings start off; created quiz, questions/options/keys and library survive Function restarts |
| Signed-out data endpoint | CallerIdentity rejects anonymous create/read/update/delete |
| Cross-account identity | Account B cannot create/read identity rows claiming account A's subject; no mixed-owner batch/alias request can bypass this |
| Direct game/config endpoints | No Games, Settings, Administrators, Audit, question-key or participant CRUD entity is exposed; attendees cannot query SQL directly |
| Host/author spoof | Anonymous calls and unrelated signed-in accounts cannot create as another owner, edit/delete another quiz, start/next or read host state |
| Admin spoof | A signed-in nonadmin, including a creator, cannot change the switch; unverified subject strings cannot become identities |
| Public projection | Signed-out visitor with a public quiz URL can read **all** question texts/options, but no keys, credentials, owner identity or individual responses |
| Internal quiz | Guest cannot preview/join/read state/submit; changing running public quiz to internal blocks existing guest operations |
| Guest isolation | Guest A's capability cannot read guest B's response or be replaced by a participant row ID; signed-in tickets fail for a different account |
| Kill switch | Disable globally after guest join, then attempt preview/join/state/answer without UI; all denied; re-enable and verify old capabilities stay invalid |
| Answer secrecy | During question, no correctness/points/score leak in wait_all; after_response reveals only after that caller submits; never hides the key |
| SQL races | Concurrent identical answers award once; competing different answers accept one; concurrent host next uses version check; game/config races do not violate revocation |
| Recovery | Disconnect/reload, retry a response, restart Function, resume signed-in attendee; no lost/double scores |
| Timing / complete flow | Lobby -> timed question -> reveal -> leaderboard -> next -> finish with server time and missed-answer streak reset |
| Survey | No answer key or scoring; aggregates appear after collection and contain no other attendee's individual answer |
| Public gateway | Signed-out Function reaches private SQL with app-owner token; no caller can supply resource tokens or a database connection |
| Dependency / capacity | Complete advisory review and load test at expected attendee count; verify Function ZIP under 30 MB and hosting ZIP under 100 MB |

Keep a record of actual tenant, region, SDK/CLI versions, policy output and
observed results in your private release process. Do not publish tokens or
attendee data as test evidence.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| App says "Not configured yet" | No backend has been configured; fill local runtime values or deploy to the selected test workspace |
| Entra popup blocked | Trigger sign-in from the button; do not put async work before the SDK sign-in call |
| Embedded preview cannot open the Fabric popup | Open the deployed app in a normal browser with popups permitted; do not make protected assets public as a workaround |
| Direct Entra token exchange returns `AUTH_FAILED` | Use a delegated token in the owning tenant, with the deployment's Fabric/Power BI audience and `Item.Execute.All`; a generic Fabric CLI token is not sufficient |
| Azure CLI returns `AADSTS65002` for `Item.Execute.All` | The Microsoft first-party client needs API-owner preauthorization; repeating user consent does not grant it. Use the supported interactive Fabric broker or an organization-approved client already authorized for that scope; do not change accounts or weaken app authorization |
| Signed-in user cannot execute | Owning tenant, app Execute permission and tenant workload enablement; Fabric workspace role alone is not a substitute for app item access |
| Caller identity verification fails | Deployed CallerIdentity policy/schema, same signed-in client and expected subject; do not weaken the policy |
| SQL socket hang-up | Use pinned mssql 12.6.0/tedious >=19.2.2, actual SQL Database writable endpoint, `encrypt: true` and a valid app-owner token |
| SQL permission error | Grant runtime app owner on the separate application database; developer access does not prove runtime access |
| Guest 401/403 before Function | Check effective owner-group scope and gateway support, even if the tenant setting is enabled; public assets alone did not resolve the observed Function 403. Keep the DB guest flag off, not a public CRUD workaround |
| Guest switch is on but assets ask for sign-in | Hosting remains protected; public assets require full redeploy |
| Public option disabled | Global DB switch is off or settings call failed; UI fails closed |
| Duplicate/stale host action | Another action advanced the game; refresh. SQL deadlock/timeouts surface as failures, not silent success; retry after reading current state |
| Guest cannot return after closing tab | The secret credential was scoped to tab session storage; join with a new nickname if allowed |
| CLI login native-helper failure | Use supported Node 24 and review any required native dependency lifecycle scripts; do not bypass TLS verification |

## Large-distribution checklist

Choose a license; tag a tested release; keep dependencies/lockfile pinned;
document a supported SDK/region matrix from real test results; review tenant
and database grants for each publisher; create a dedicated app/database per
publisher or event boundary; establish retention, deletion, incident response,
abuse limits and capacity ownership. Never distribute deployment registries,
local credentials, private quiz exports or a pre-enabled anonymous database.

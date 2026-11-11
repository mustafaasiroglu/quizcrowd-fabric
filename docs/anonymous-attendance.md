# Anonymous attendance: remaining platform gate

Status: **not enabled or certified for deployment**. This note describes the
checked Rayfin 1.36.2 surface, not a claim that every future Fabric release has
the same restriction. Data remains in private Fabric SQL. No external compute,
new SQL identity/grant or tenant-wide setting has been approved or deployed.

## What is actually blocked

The published authenticated Function uses the App owner's explicitly declared
SQL resource token and existing transactional game implementation. The actual
unsigned gateway returned HTTP 403:

> Anonymous access is not allowed for function invocation.

Public static hosting was previously tested independently and did not remove
that Function restriction. `authLevel: 'anonymous'` in the worker is not the
Fabric gateway's invocation permission. The installed configuration type accepts
only `FunctionsAuthType = 'application'`; its validator says
`Only application authentication is supported.` There is no documented
anonymous-function switch in this pinned configuration.

Microsoft distinguishes invocation authorization from external-resource identity:
[Functions application authentication](https://learn.microsoft.com/en-us/fabric/apps/functions#application-authentication).
The App-owner SQL token does not make an unsigned caller authorized to invoke
that Function.

## The selected-table INSERT proposal

**SQL triggers are a credible trusted processing boundary.** Fabric SQL supports
[DML triggers](https://learn.microsoft.com/en-us/sql/relational-databases/triggers/dml-triggers?view=fabric-sqldb)
and treats the trigger and triggering statement as a transaction. A narrow
command inbox in the **same private database** could validate the global switch,
epoch, Public visibility, lifecycle, capability expiry and duplicate answers
while taking Settings/game locks in the same order as the authenticated host.
It must reject host/admin commands and never trust caller-provided ownership,
roles, scoring, expiry or correctness.

A browser-generated cryptographic bearer capability is also possible; a
server-issued random value is not inherently required. SQL must register its
hash and assign the authoritative epoch/expiry. A request ID, nickname, session
code or four-digit invitation PIN alone is not attendee authentication.

The remaining problem is the **authorized response channel**, not simply the
policy DSL:

| Channel | Supported finding |
| --- | --- |
| Anonymous CREATE-only inbox | Can submit work, but does not establish a safe usable response |
| Trigger-populated response column | Upstream DAB detects triggers and selects the inserted row after trigger completion, but still requires read permission |
| GraphQL mutation response | Microsoft documents that read permission is required in addition to the mutation permission; the write can commit while response authorization fails |
| REST CREATE-only result | Checked upstream implementation returns an empty result without read permission; managed Rayfin REST exposure is not established |
| Anonymous receipt READ | Enables independently enumerable rows unless there is server-enforced requester binding |
| Client `$filter` or opaque receipt ID | Not authorization; callers can omit filters and issue collection reads |

Sources: [DAB mutation response troubleshooting](https://learn.microsoft.com/en-us/troubleshoot/azure/data-api-builder/usage),
[DAB v1.5.56 SQL mutation engine](https://github.com/Azure/data-api-builder/blob/v1.5.56/src/Core/Resolvers/SqlMutationEngine.cs),
[SQL response helpers](https://github.com/Azure/data-api-builder/blob/v1.5.56/src/Core/Resolvers/SqlResponseHelpers.cs),
and [post-trigger selection](https://github.com/Azure/data-api-builder/blob/v1.5.56/src/Core/Resolvers/MsSqlQueryBuilder.cs).
The pinned generator references that DAB configuration version; this does not
prove the hosted binary is identical.

## Narrow public reads do not finish the lifecycle

A server-filtered public projection could expose only invitation metadata,
released questions/options and public lifecycle status, joining authoritative
Settings/Public/status predicates. It must contain no answer keys, identity,
capability, individual responses or Survey results. Read grants make all
qualifying rows discoverable: a code cannot also be treated as a secret.
Previously downloaded public content cannot be recalled.

[DAB supports read-only views](https://learn.microsoft.com/en-us/azure/data-api-builder/concept/graphql/views),
but mapping a custom view and anonymous authorization through the managed SQL
connector still needs actual platform verification. This alone would not
protect **own acknowledgement, reconnect or own-result** reads.

The checked managed entity/connector APIs expose:

- `policy(claims, item)` with `sub`, `email`, `role`, not an unsigned
  capability/header/body binding.
- `read` for one **or more** rows, not a separate PK-only permission.
- Both `findByKey(...)` and `findMany(filter?)`, with no supported mandatory
  capability filter or collection-read disable setting.

[Entity authorization](https://learn.microsoft.com/en-us/azure/data-api-builder/configuration/entities)
and [claims-based SQL RLS forwarding](https://learn.microsoft.com/en-us/azure/data-api-builder/concept/security/row-level-security)
do not establish an unsigned request-bound capability channel. The managed
model also has no supported trigger/UDF migration hook; custom SQL belongs in
the separate private database, not hand-edited generated DAB configuration.

The precise missing supported contract is either **CREATE-result-only access
without independent receipt queries**, or **capability-validated parameterized
execution/request-bound row authorization for every receipt access**. No such
managed configuration was established in the bounded check. This is not a
blanket objection to SQL-triggered commands or safe public question feeds.

## Safe alternative awaiting approval

Keep all data in the existing private Fabric SQL Database. Keep Entra host/admin
operations in the existing Fabric Function. Route **only guest attendance**
through an approved public API host:

```text
Guest browser -> public attendance API -> existing private Fabric SQL
Host/admin    -> authenticated Fabric Function -> same private Fabric SQL
```

Prefer an already approved backend if available. An Azure Functions HTTP
endpoint is a concrete alternative, but **has not been approved or provisioned**.
It needs a supported region/hosting plan, managed identity, public TLS endpoint,
monitoring, rate/abuse limits and a separately approved narrow SQL grant.
The guest principal needs read access to Settings and read/update access to game
state for join/answer transitions, not administrator-table access, config/audit
writes or game creation/deletion. A SQL execution-only command boundary could
tighten that further if implemented and reviewed.

The API must use the existing capability validation and transaction rules,
accept only preview/join/state/answer commands, fix the subject to anonymous,
and return existing safe attendee projections. It must never proxy a shared
signed-in browser account, accept a caller's role/owner subject, expose SQL
credentials/tokens, or expose host-only Survey results.

Dependencies requiring a publisher decision:

| Decision | Consequence |
| --- | --- |
| Existing approved host or new Azure Functions plan | Availability/operations ownership and any incremental request, execution, networking and monitoring costs; no assumption of a free tier |
| Managed identity and approved SQL access | New persistent identity/grant must be explicitly approved; no tenant-wide anonymous SQL login |
| Public static frontend assets | Required for unsigned invitation UI; exposes app code/assets, not private app data; author/admin APIs remain protected |
| Abuse protection | Bound request sizes/rates, credential attempts, capability expiry and logging redaction before public release |

Existing Fabric capacity and SQL storage consumption remain costs even if the
API host already exists. No numerical estimate is quoted without an approved
plan, region and workload. References:
[anonymous HTTP triggers](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger)
and [managed identity with Fabric SQL](https://learn.microsoft.com/en-us/azure/service-connector/how-to-integrate-fabric-sql).

An optional per-session invitation PIN is implemented for the normal
authenticated join/QR path, **off by default and absent for legacy sessions**.
The shared guest domain path also checks it, but that is not proof of working
anonymous transport. QR fragments remove retyping, never server verification.
SQL-persisted per-game failure limits commit before denial under the same
Settings/game locks. Any future guest adapter must preserve that transaction
contract, not roll back failed-attempt accounting. See the exact
[PIN behavior and tradeoffs](ui.md#optional-invitation-pin). It does not solve
the Function gateway or replace a high-entropy attendee capability.

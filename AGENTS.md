# QuizCrowd contributor guidance

Use Node.js 24 and the lockfile. `npm run check` performs strict typechecks,
local tests and a production build. Never use `--noCheck` to disguise errors.

Read the installed `@microsoft/rayfin-guide/assets/docs/` and package API
declarations before changing Rayfin integrations. The SDK and CLI are pinned
to 1.36.2; use the actual APIs rather than guessing preview configuration.

## Required authorization boundary

- `packages/data` contains only CallerIdentity. Its authenticated create/read
  policy is `claims.sub.eq(item.subject)`; no guest, update or delete grants.
- All quiz/config/state data belongs to the separate private Fabric SQL Database,
  accessed only by the Function in `rayfin/functions`.
- A caller-supplied subject becomes trusted only after the caller-scoped DAB
  query verifies it. Never decode an unverified JWT or trust a browser role.
- External SQL tokens come from the explicitly declared `AudienceType.Sql`.
  `ctx.getDataClient()` is not a privileged application client.
- Every guest command rechecks DB config, public visibility, capability expiry
  and generation. Preserve the same-transaction Settings lock and game lock.
- Return projections only. Never return an aggregate, correctness key during
  an open wait_all question, credential hashes or another attendee's response.
- Authoring requires Entra; hosting requires ownership; config requires a
  separately bootstrapped administrator.

Keep local test doubles under tests. No production in-memory/file fallback.
Preserve expected-version host control and idempotent answer awards.

## Validation and release

Local tests do not prove Fabric authorization, anonymous invocation or SQL
concurrency. Preserve the live release gates in docs/deployment.md. Do not
provision/deploy without an explicitly selected workspace and capacity decision.

After changing Function signatures, use
`npx rayfin functions init --path rayfin/functions` to regenerate types. Never
hand-edit the generated types. No secrets or environment deployment registries
may be committed. The publisher must decide project licensing; do not silently
assign a license to the original unlicensed QuizCrowd.

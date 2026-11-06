# QuizCrowd for Microsoft Fabric

Live quizzes and manually authored surveys, with Microsoft Entra sign-in,
publisher-controlled anonymous attendance, and application data persisted in
**SQL Database in Microsoft Fabric**.

> **Preview implementation template, not a production-certified deployment.**
> Local typechecks, game/authorization tests and the real Fabric Functions
> bundler are exercised. No live Fabric workspace has been deployed or tested.
> In particular, anonymous Function invocation with app-identity SQL access
> must be confirmed in your tenant before enabling public attendance.
> See the [release gates](docs/deployment.md#release-gates).

## What you can build

| Experience | Included |
| --- | --- |
| Creator | Entra-only quiz/survey authoring, library, edit empty lobbies, duplicate, delete, change audience |
| Host | Lobby, QR invite, session code, start/next controls, timed questions, reveal and leaderboard |
| Attendee | Entra sign-in by default; optional anonymous guest for public quizzes only; per-tab secret attendee credential |
| Game | Server-calculated scores (1,000 + up to 500 speed points), streaks, late-join policy, three answer-reveal policies |
| Survey | Manually authored multiple-choice questions, timed collection and aggregate response counts; no scoring or AI generation |
| Publisher | Explicit administrator bootstrap, audited database guest-access switch, revocation of existing guest sessions |
| Persistence | Settings, quizzes, questions, options, keys, participants, submissions, scores and game phases in private Fabric SQL |

### Secure by default

Anonymous access starts **off**. Each new quiz starts **Internal Only**.
Selecting **Anyone (Public)** requires explicit acknowledgement:

> Anyone (Public) makes all questions and response options accessible to anyone
> with the quiz URL, including before the game starts. Answer keys, individual
> responses and personal data are not included.

The global database switch is enforced on every guest preview, join, state read
and response submission, not just in the UI. Turning it off revokes subsequent
guest operations after already-running transactions complete. Re-enabling does
not revive old guest credentials. Downloaded public content cannot be recalled.
Creators can make a running quiz internal independently of the global switch.

There is **no anonymous SQL login**, password-based admin account, self-assigned
admin role, or public quiz CRUD endpoint. Only a small identity entity is exposed
through Rayfin's data service; its actual generated policy restricts reads and
creates to the authenticated subject. All application data uses the private
Function/SQL boundary. Read the [architecture](docs/architecture.md).

## Use this template

1. Select **Use this template > Create a new repository** on
   [mustafaasiroglu/quizcrowd-fabric](https://github.com/mustafaasiroglu/quizcrowd-fabric).
   Review [licensing status](LICENSING.md) before redistribution.
2. Clone your new repository and install **Node.js 24 LTS**.
3. Run `npm ci --ignore-scripts --no-audit`, then `npm run check`.
4. Follow [Deployment and administration](docs/deployment.md) to choose your
   capacity/workspace, create the application SQL database, bootstrap an admin,
   configure the Function, and deploy with the real Rayfin CLI.

This is **not one-click deployment**. Tenant approval, Fabric item permissions,
SQL database creation and grants are explicit publisher decisions. No workflow
deploys cloud resources or incurs Fabric capacity charges automatically.

## Local commands

```powershell
npm ci --ignore-scripts --no-audit
npm run check
npm run dev:frontend
```

The frontend displays a clear configuration error until you supply a real
backend configuration. There is deliberately no in-memory demo backend masquerading
as persistence. Copy [the environment example](packages/frontend/.env.example)
for local frontend development against a deployed test backend.

For the full local Functions loop, install Azure Functions Core Tools v4,
configure a test Fabric environment, sign in with `npx rayfin login`, and run
`npm run dev`. The [deployment guide](docs/deployment.md) explains the identity
difference between local and deployed external connections.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict frontend, shared, model and Function typechecks |
| `npm test` | Domain/service authorization, actual SDK metadata and mocked-HTTP SDK wire tests |
| `npm run build` | Local production frontend plus server/model compilation; no cloud writes |
| `npm run check` | Typecheck, tests and build |
| `npm run dev:frontend` | Loopback-only Vite frontend |
| `npm run dev` | Rayfin frontend + local Function development (requires configured environment) |
| `npx rayfin functions init --path rayfin/functions` | Regenerate Function types; preserves existing implementation |
| `npx rayfin up --workspace "<workspace-name>"` | Explicit deployment; creates/updates Fabric services |

## Project layout

```text
packages/frontend/       React/Vite application and Entra sign-in
packages/shared/         Public contracts and warning text
packages/data/           CallerIdentity entity only, protected with claims.sub
rayfin/functions/        Authorization, game rules, SQL persistence and Function
database/001-schema.sql  Standalone Fabric SQL application tables, guest access off
docs/                   Deployment, admin operations, architecture and limitations
tests/                  Local regression and authorization tests
```

## Status and limitations

The implementation uses the actual **Rayfin 1.36.2** packages and CLI, with a
committed npm lockfile. Tests with serialized in-memory *test doubles* are not
proof of live DAB authorization or SQL locking. The offline deployment bundle
is approximately 10.3 MB, below the documented 30 MB Function ZIP ceiling.

The current UI authors four response options per question; the server supports
two to six. Limits are 40 questions, 500 attendees per game, 5–120-second questions,
and 12-hour attendee credentials. One locked SQL aggregate per game favors
correctness over high-throughput scale; load-test your capacity before an event.
Image upload, AI survey generation, automatic retention, moderator tools and
custom domains are not implemented. See the [full operational limitations](docs/architecture.md#limitations).

A completed production dependency scan identified Zod advisory
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Application validation and the SDK's transitive validator are now pinned to
patched Zod **4.6.7**, including a scoped `rayfin-tools-common` override. The
subsequent CLI install reported three moderate advisories; a complete
post-remediation online report was blocked by the registry proxy's rate limit
and public-registry TLS failure. Offline audit output is not treated as a clean
online scan. Complete advisory review before production release; never use
`npm audit fix --force` to silently change the verified SDK version.

## Attribution and distribution

Based on the original [QuizCrowd](https://github.com/mustafaasiroglu/QuizCrowd)
by Mustafa Asiroglu, reimplemented for static Fabric hosting instead of Next.js
server routes and in-memory state. Microsoft's official Universal App scaffold
provided the initial workspace structure.

**A project license still needs an owner decision.** The original QuizCrowd had
no LICENSE; this adaptation does not silently assign one. Microsoft's scaffold
notice is preserved separately. Read [LICENSING.md](LICENSING.md).

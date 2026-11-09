# QuizCrowd for Microsoft Fabric

Live quizzes and manually authored surveys, with Microsoft Entra sign-in,
publisher-controlled anonymous attendance, and application data persisted in
**SQL Database in Microsoft Fabric**.

> **Preview implementation template, not a production-certified deployment.**
> Local typechecks, game/authorization tests and the real Fabric Functions
> bundler are exercised. An Entra-only test deployment passed 30 actual
> SDK/SQL/UI checks, including administrator bootstrap, quiz/survey flows,
> concurrent submissions, QR hosting and persistence across a portal reload.
> In particular, anonymous Function invocation with app-identity SQL access
> must be confirmed in your tenant before enabling public attendance.
> A live public-hosting experiment served the frontend anonymously, but
> Function calls still returned HTTP 403; public assets alone did not unblock them.
> See the [release gates](docs/deployment.md#release-gates).

## What you can build

| Experience | Included |
| --- | --- |
| Creator | Compact clickable session cards, branded two-column editor, shared/per-question answer durations, immutable content type, server-enforced read-only view, fresh private duplicate, confirmed owner-only delete |
| Host | Lobby, QR invite, six-digit numeric game code, start/next controls, timed questions, reveal and leaderboard |
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
| `npm audit --audit-level=high` | Full online dependency audit; also enforced in CI |
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
database/002-six-digit-codes.sql  Non-destructive numeric-code migration with legacy aliases
docs/                   Deployment, admin operations, architecture and limitations
tests/                  Local regression and authorization tests
```

## QuizCrowd authoring, dark and light

Home offers **New Live Quiz**, **New Live Survey** and **Join with Code** above
recent session cards. The editor places title/questions on the left and settings
on the right, stacked on mobile. Started sessions or sessions with any submitted
answer open read-only, including through the server API. Compact cards omit
thumbnails and show sentence-case status, an accessible date icon, question count
and actual question-submission count. Home is the only session-list surface.
Purple/indigo and pink brand accents replace the previous teal interpretation.
Content type is fixed by the creation action, including on server updates.
Answer duration defaults to **Same for all**, set once in the settings panel.
**Customize per question** exposes a duration at each question. The selected mode
and remembered shared seconds persist in the existing game JSON, so custom stays
selected even when question times happen to match. Only older content without
the setting infers an initial mode from its question durations. Effective
question durations still drive game timers/scoring. A duplicate starts a new private
lobby without activity. Six-digit codes preserve leading zeros; existing UUID
invitations and old codes remain compatible through server-side resolution.
The original QR lobby, colorful answers, leaderboard and podium remain.
**Dark is the default**; the only alternative is **Light**, saved across
navigation and reloads. Entra, SQL-backed persistence, trusted publisher controls
and the Internal/Public authorization boundary remain.
See [UI behavior and screenshot review](docs/ui.md) for intentional
accessibility differences, local browser tests and exact capture paths.

## Status and limitations

The implementation uses the actual **Rayfin 1.36.2** packages and CLI, with a
committed npm lockfile. Tests with serialized in-memory *test doubles* are not
proof of live DAB authorization or SQL locking. The offline deployment bundle
is approximately 10.3 MB, below the documented 30 MB Function ZIP ceiling.

The UI authors two to four response options per question and preserves existing
five/six-option questions; the server supports two to six. Limits are 40 questions, 500 attendees per game, 5–120-second questions,
and 12-hour attendee credentials. One locked SQL aggregate per game favors
correctness over high-throughput scale; load-test your capacity before an event.
Image upload, AI survey generation, automatic retention, moderator tools and
custom domains are not implemented. See the [full operational limitations](docs/architecture.md#limitations).

The [public CI workflow](https://github.com/mustafaasiroglu/quizcrowd-fabric/actions/workflows/check.yml)
runs a clean install, the local regression tests, typechecks/build and a full
online dependency audit. The validated lockfile reported **0 known
vulnerabilities**; CI retains a
high/critical advisory gate. The lockfile uses patched Vite/Vitest plus explicit
Zod, CLI MSAL and glob overrides; see [dependency maintenance](docs/deployment.md#dependency-maintenance).
This is a point-in-time audit, not a security certification. Never use
`npm audit fix --force` to silently downgrade the verified Fabric SDK.

The production-build QR regression reproduces the duplicate-React hook failure
found during live testing. Vite explicitly deduplicates React for workspace
dependencies; the corrected QR/lobby and timed host UI were redeployed and
retested. Live tests used one real Entra account; foreign-owner and existing-guest
negative cases used trusted SQL fixtures. Public anonymous execution remains a
separate, unpassed release gate; see the [observed results](docs/deployment.md#release-gates).
Subsequent UI builds were published to the protected test app. New UI checks
use local browser fixtures, not a fresh authenticated live browser session.

## Attribution and distribution

Based on the original [QuizCrowd](https://github.com/mustafaasiroglu/QuizCrowd)
by Mustafa Asiroglu, reimplemented for static Fabric hosting instead of Next.js
server routes and in-memory state. Microsoft's official Universal App scaffold
provided the initial workspace structure.

**A project license still needs an owner decision.** The original QuizCrowd had
no LICENSE; this adaptation does not silently assign one. Microsoft's scaffold
notice is preserved separately. Read [LICENSING.md](LICENSING.md).

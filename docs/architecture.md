# Architecture and security boundaries

## Components

The React/Vite frontend is static-hosted by Fabric Apps. Fabric SSO establishes
Entra-backed Rayfin sessions. The TypeScript Function is registered with the real
`UserDataFunctions.func` API and invoked through generated
`RayfinClient.functions.quizcrowd` types.

There are deliberately two database boundaries:

| Store | Contents | Access |
| --- | --- | --- |
| Rayfin-managed SQL data service | CallerIdentity records with an opaque subject | Authenticated create/read only, claims.sub equals row subject; no anonymous, update or delete |
| Private application SQL Database in Fabric | Settings, trusted administrator subjects, audit trail and full game aggregates | App-owner SQL token inside Functions; no browser CRUD/connector/SQL access |

`services.functions.auth.type: application` does **not** make
`ctx.getDataClient()` privileged. It preserves the invocation's caller identity
and DAB permissions. The Function first queries CallerIdentity under that policy
to validate a claimed subject. No caller-supplied subject is trusted without
that query. Application SQL access is separate: the explicitly declared
`AudienceType.Sql` binds `ctx.Tokens.Sql` using the Fabric App item owner's
identity. No JWT is decoded for authorization and no external token reaches the
browser.

The frontend may create its own CallerIdentity after Entra sign-in. This grants
no role, config access or ownership. The DAB policy must reject any attempt to
create/read another subject; that behavior is a mandatory live release gate.
The actual 1.36.2 CLI-generated policy has both create/read actions constrained
to `@claims.sub eq @item.subject`.

## SQL persistence and concurrency

Settings is a singleton with `AnonymousEnabled` (initially false) and
`GuestEpoch` (initially zero). Administrators is populated only by a trusted
database administrator. Audit records global guest-access changes.

Games uses a UUID key, random 10-character code, indexed owner subject and one
JSON aggregate (`ISJSON` constrained). Each aggregate stores quiz/survey
questions, response options, answer keys, visibility and game settings,
participants, credential hashes/expiry, individual responses, scores, streaks,
question timing and current phase. JSON is a database storage format, not a
client cache or production file store. It is never returned wholesale to an
attendee.

Every command opens its own SQL connection pool and **SERIALIZABLE**
transaction. It reads Settings with a held shared lock, then loads the game with
`UPDLOCK,HOLDLOCK`. It validates caller/capability/visibility, advances server
time if appropriate, performs the mutation, and persists the aggregate before
committing. Parameterized mssql bindings are used throughout; there is no
generic query endpoint. The SQL token is not globally cached between users.

Competing submissions serialize on the same game row. The same
participant/question/option retry returns an acknowledgement without adding a
second response or award. A different option for the same question is rejected.
Host mutations carry a version; repeating next/start against a stale version
cannot advance twice. Failed transactions roll back; a deadlock or timeout is
surfaced to the caller. There is no retry that silently changes a selected
answer.

Because every guest operation holds the Settings read lock until commit, a
global-off transaction waits for already-admitted work, then commits the off bit
and a new guest generation. Later requests see the new setting. Turning the bit
back on cannot revive older-generation guest credentials.

## Guest capabilities

Guest access is app-level anonymity, never an anonymous database principal.
Joining a public quiz mints a cryptographically random 32-byte bearer token.
Only its SHA-256 digest is persisted, alongside a random participant ID, a
12-hour expiry, the guest generation, nickname and game state. A participant ID
alone is never accepted as authentication.

Signed-in attendees also receive capabilities, bound to their **verified**
subject. A returning signed-in account may rotate its capability and resume its
existing participant. Guests have no recoverable identity and no guarantee of
one-person-one-account: a person may join under multiple nicknames. Do not use
this product as an exam identity or ballot integrity system.

The browser stores only the attendee credential and game routing ID in tab
session storage; authoritative game content/progression remains in SQL. Tokens
are not placed in URLs or returned by preview/state/list/host output. Treat the
initial join response and tab storage as sensitive. React renders submitted
text as text; there is no HTML authoring or remote image embedding.

Every guest state/answer checks token digest, expiry, null subject binding,
public visibility, global permission and guest generation. Correctness keys and
personal/internal data never appear in the public preview. Public preview
includes **all** question text/options before play, exactly as the authoring
warning states. Other attendees never receive another participant's individual
response. Participant pseudonyms and leaderboard scores are intentionally
visible only after joining; public preview contains neither.

## Game rules

Phases are lobby, question, reveal, leaderboard and finished. Polling requests
advance expiry and persist the resulting phase; no background timer or server
memory is required. All-answer completion can reveal early. The reveal lasts
four seconds, then the host advances from leaderboard using the current
version. Server time controls scoring and deadlines; UI time is display-only.

Scored quiz responses award 1,000 correctness points plus up to 500 speed points.
Wrong or missed responses reset streaks. Survey responses award no points and
have no answer key. Aggregated distributions are returned after collection.
With `wait_all`, neither correctness nor the caller's points/total score is
returned during an open question. `after_response` reveals only after that
attendee submits; `never` omits the answer key. Leaderboards appear only after
the reveal phase. The initial answer acknowledgement is always just accepted,
not correctness.

Creators own their quizzes through the verified subject assigned by the server.
Quiz payloads cannot specify owner/admin fields. Content is editable only while
the lobby is empty; duplicate for another run. Audience can change independently
during a game. Global administration does not implicitly grant ownership of
other creators' private quiz content.

## Limitations

- **Platform validation pending:** Anonymous Function invocation/SQL token
  binding, live DAB enforcement and SQL race behavior have not been tested
  against a Fabric tenant. See deployment release gates. Local mocks do not
  establish those properties.
- **Not high-scale certified:** 500 attendees and 40 questions are hard caps,
  not throughput promises. Polling takes a game-row lock and rewrites JSON.
  Load-test expected capacity; a normalized SQL/procedure implementation or
  event distribution would be a separate scalability change.
- **Abuse:** No CAPTCHA, per-IP rate limiter or device identity. A quiz URL/code
  is an invitation, not a public-data confidentiality boundary. Anonymous join
  can be automated up to the per-game cap. Use pseudonyms; obtain participant
  consent. Public preview remains downloadable even after access is revoked.
- **Retention:** No automatic TTL purge or export tooling. Owner deletion
  removes the game and its responses; trusted SQL administrators must establish
  backup, legal retention, audit retention and privacy procedures.
- **Library:** Returns the first 100 owned games ordered by ID. Archive/delete
  old events; extended paging is not implemented.
- **Session recovery:** Tab session storage preserves the attendee credential
  across reloads. A lost guest token cannot be recovered; 12-hour expiry is
  fixed until a signed-in participant rejoins and rotates it.
- **Authoring scope:** Manual multiple-choice authoring only. Four options in
  the current UI, two to six validated by the server. No images, open-ended
  responses, AI generation, import/export or automatic survey generation.
- **Trusted publisher:** The app item owner can change code and has external
  SQL permissions. Protect deployment rights; application checks cannot defend
  against a malicious publisher with database access.
- **Dependency review:** Zod is pinned to patched 4.6.7 in the application and
  via a scoped SDK override for GHSA-mrhx-c7xc-m3w5. A subsequent CLI install
  reported three moderate advisories. Registry restrictions prevented obtaining
  a complete post-remediation online report; offline output is not proof of a
  clean scan. Review all dependencies before release.
- **Operational gates:** No live capacity test, no production SLA claim, and
  no open-source license grant for the adapted QuizCrowd application.

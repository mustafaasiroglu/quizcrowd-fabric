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

Games uses a UUID key, cryptographically generated six-digit numeric string code,
indexed owner subject and one
JSON aggregate (`ISJSON` constrained). Each aggregate stores quiz/survey
questions, response options, answer keys, visibility and game settings,
participants, credential hashes/expiry, individual responses, scores, streaks,
question timing and current phase. JSON is a database storage format, not a
client cache or production file store. It is never returned wholesale to an
attendee.

The code is routing information, never a credential. `UQ_QuizCrowdCode` enforces
persistent uniqueness. A real SQL code-uniqueness violation rolls back and retries
the entire creation transaction, regenerating the code (six attempts maximum);
other failures are not swallowed or retried. `002-six-digit-codes.sql` preserves
old ten-character codes in a unique `LegacyCode` alias and changes only the
canonical code and its JSON projection. Existing UUID links still resolve.
Owner session summaries contain actual question, participant and answer-ledger
counts, mode, creation time, status and edit lock, not the aggregate or answer
keys. The home cards display Questions/Responses; participant count remains
available to the owner projection but is not a card metric.

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
session storage; authoritative game content/progression remains in SQL. A separate
local-storage value, `quizcrowd-theme`, stores only the dark/light preference. Tokens
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
Quiz payloads cannot specify owner/admin fields. Content is editable only in
lobby with zero answers, even if attendees have already joined. The same held
game lock serializes edits against start and submissions. Started or answered
sessions open in an owner-only read-only view; hosting remains available.
Public access can still be revoked while locked, but not enabled. Duplicating
copies content/settings into a new owner-owned private lobby with a fresh ID/code
and no participants, responses, progression or scores. Delete remains
owner-authorized, with frontend confirmation. Global administration does not implicitly grant ownership of
other creators' private quiz content.

Content type is immutable after creation, even in an empty lobby. The server
rejects quiz/survey type mutations; duplicate preserves the source type.
Optional `answerDuration: { mode: 'same' | 'custom', seconds: number }` metadata
persists in the existing game JSON. Explicit choices survive create/save/reopen,
read-only views and duplicate; equal-valued custom questions remain custom.
Only legacy content without metadata infers an initial mode from its question
durations, without rewriting stored content during reads. New saves/duplicates
retain the normalized setting. No SQL column/table or data migration is needed.
An update that omits metadata preserves an already stored explicit choice and
still validates its shared-value consistency rather than silently reinferring it.

### Survey Other and multiple-selection responses

Only Survey questions accept optional `survey: { other, allowMultiple }`
metadata. Missing metadata means both features are off, preserving legacy
single-choice surveys. With Other enabled, zero or one normal options are valid;
otherwise at least two are required. Other-only questions reject
`allowMultiple: true`. Quiz questions reject survey metadata and retain numeric
single-choice answers, correctness and scoring.

The editor infers three types from those existing fields: Single Select
(normal options, multiple off), Multiple Select (multiple on, optional Other),
and Free Text (no normal options, Other on, multiple off). New create/edit
requests use `authoringDraftSchema`, which rejects mixed Single Select + Other.
The base stored-content validator and answer projection still support that
legacy shape: read and duplicate do not rewrite old flags or submissions.
Explicit frontend saves normalize an editable legacy Single Select question
to normal choices only, with visible guidance to select Multiple Select to
retain Other. No type column or extra persisted type discriminator is needed.
Temporarily remembered choices when switching to Free Text belong only to
the unsaved editor, never the persisted question/answer payload.

The answer request supplies exactly one of legacy numeric `option` or typed
`response: { options: number[], other?: string }`. Presence of `other` explicitly
selects Other; it is not an unrelated annotation on a normal answer. The server
rejects duplicate/out-of-range/noninteger indices, unsupported extra fields,
disabled Other, empty/whitespace text and multiple choices when disabled.
Text is trimmed, limited to 500 UTF-16 code units, and rejects non-text control
characters (tab/newline/carriage return remain valid). The request also caps
raw text at 500 code units. A participant can submit once per question; equal
retries normalize option order and text without awarding twice.

Persistence stays in **the existing `answers[].option` field** inside
`Games.Document`, which is SQL `nvarchar(max)` with `ISJSON`, not a separate
answer column. New Survey responses use a string plus additive
`format: 'survey-v1'` answer metadata. Example:

```json
{ "option": "o:0|o:2|t:Written \\| text with \\\\ backslash", "format": "survey-v1" }
```

Tokens are `o:<option index>` and optional final `t:<Other text>`, separated
by **`|`**, never semicolons. Within text, `\|` means a literal pipe and `\\`
means a literal backslash. A stateful decoder preserves escaped separators,
rejects malformed/unknown formats and never guesses a format from legacy text.
Options use stable array positions, not label strings; the existing started/
response edit lock prevents those positions changing after submission.
The complete encoded field is capped at 2048 UTF-16 code units, comfortably
within the actual SQL type and the existing 150,000-code-unit Function request
limit. Legacy unversioned numeric answers remain unchanged and can be retried
through either the numeric or new single-selection request.

Flags survive save/reopen/duplicate/read-only views and question timing changes
in the existing JSON. No SQL DDL, migration or registered Function-signature
change is required. A future authorized release must update Functions and then
static assets together; the new frontend payload is not compatible with an old
Function implementation.

Attendee state projects only that caller's `myResponse`. Hosts and other
attendees receive normal-option counts and an Other count after collection,
never individual written responses. With multiple selection, the sum of choice
counts can exceed the number of submitted responses; Other counts as one
selection. Surveys still have no correctness key, points or scored podium.

### Effective answer duration

The effective `Question.duration` values still drive runtime timeouts and speed
scoring. The server requires integer metadata and question durations from 5
through 120 seconds, and rejects shared-mode payloads whose question durations
do not match the shared seconds. Custom seconds remember the value for switching
back/new questions, not a second runtime deadline.

Changing shared to custom retains the current effective duration in each
question. Changing back applies the remembered shared seconds, initially the
first question's value for legacy content. New questions inherit that value;
removing/reordering questions preserves the mode and other real durations.
The started/response edit lock protects the mode, shared value and question times.

The organization-only audience uses the platform's tenant-bound Entra app
authentication and Execute permissions, then the existing verified caller boundary.
Authorized Entra B2B directory guests can be included; this label does not promise
employee-only membership or accept browser email domains/roles as authorization.
App-level anonymous capabilities cannot access internal sessions.

## Limitations

- **Platform validation boundaries:** An Entra-only test deployment passed the
  documented single-account SDK/SQL/UI checks. Numeric-code migration and the
  compiled service/SqlStore were also exercised against real Fabric SQL using
  trusted synthetic subjects: unique-code retry, leading zeros, legacy aliases,
  concurrent repeat answers, edit locks and ownership. These SQL integration
  checks do not invoke the deployed Function HTTP gateway or prove a fresh
  browser sign-in. Anonymous Function execution remains unpassed; see release
  gates. Local mocks do not establish platform authorization.
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
- **Library:** Returns the 100 most recently created owned games, with ID as a
  stable tie-break. Archive/delete
  old events; extended paging is not implemented.
- **Session recovery:** Tab session storage preserves the attendee credential
  across reloads. A lost guest token cannot be recovered; 12-hour expiry is
  fixed until a signed-in participant rejoins and rotates it.
- **Authoring scope:** Manual multiple-choice authoring only. Two to four options
  in the UI, preserving existing five/six-option questions; two to six validated by the server. No images, open-ended
  responses, AI generation, import/export or automatic survey generation.
- **Trusted publisher:** The app item owner can change code and has external
  SQL permissions. Protect deployment rights; application checks cannot defend
  against a malicious publisher with database access.
- **Dependency maintenance:** Public CI audits the full dependency tree and
  fails on high/critical advisories. The implementation validation reported
  zero known advisories after patching Vite/Vitest and overriding SDK Zod,
  CLI MSAL and glob dependencies. Reevaluate the overrides during SDK updates;
  an advisory scan does not establish platform authorization or future safety.
- **Operational gates:** No live capacity test, no production SLA claim, and
  no open-source license grant for the adapted QuizCrowd application.

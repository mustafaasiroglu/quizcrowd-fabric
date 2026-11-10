# QuizCrowd authoring and themes

Home and authoring use the requested compact workflow and original QuizCrowd
purple/indigo and pink brand accents, not the rejected teal/green interpretation.
There are no thumbnails or separate Your Quizzes page. The original game
screens remain. The original checkout was inspected
read-only, not built, executed or modified.

## Screens

### Protected-hosting sign-in boundary

The standalone site's initial **Sign in required** page is served by Fabric
before QuizCrowd's HTML, JavaScript or theme CSS can load. On 2026-11-10, an
unauthenticated request with `Accept: text/html` returned the platform page
headed **Microsoft Fabric**, with this description:
**This app is private. Sign in with your Microsoft Fabric account to open it.**
It did not include the QuizCrowd application bundle. A non-HTML request returned
`Authentication required.` instead.

The requested **Quiz Crowd** heading, **Creator experience requires login with
your work account.** description and animated Dark/Light background therefore
cannot be applied to that page by editing the React frontend. The pinned
Rayfin 1.36.2 `StaticHostingConfig` and auth declarations expose no supported
gate-branding, custom login template, text or stylesheet option. The installed
hosting guide and [official hosting documentation](https://learn.microsoft.com/en-us/fabric/apps/hosting)
do not document one either. `indexDocument` selects the app's index file; it
does not replace this pre-authentication platform response.

Keep `assetAccess: protected` unless the publisher explicitly approves a
different hosting posture. A supported platform branding feature would be
needed to customize this exact gate while retaining that posture. An alternative
requiring a separate security decision is public static assets with an
app-controlled branded Entra sign-in screen: API, SQL, owner/admin and guest
authorization must remain enforced, but the platform's pre-authentication asset
permission barrier would no longer apply. This is not equivalent to changing
the current gate, does not establish anonymous Function support, and has not
been implemented or enabled. Tenant prerequisites would need separate review.
Do not patch SDK/vendor files, spoof Microsoft credential collection, or inject
DOM changes into the platform page.

| Screen | Behavior |
| --- | --- |
| Home | Compact equal-width (280px desktop) icon/title/description New Live Quiz / New Live Survey / Join with Code actions, not row-stretched; 16px icon-to-label gap, 16px/20px padding, matching borders/12px radius and subtle 1.01 hover scale; Recent Items with loading placeholders and a successful-empty state; stacked on mobile |
| Join | Narrow card, six-digit numeric string code including leading zeros, separate nickname step; old links resolve; no pre-join preview action |
| Author | Wide title/questions column with white Light surfaces or dark indigo surfaces; compact question cards, correctness controls, options and reordering |
| Settings | Right sidebar on desktop, after the question/content column on narrow layouts in both visual and DOM/tab order; Who can respond? first, then answer duration, late joins and Quiz-only answer reveal; no Content Type label/control |
| Host lobby | Single responsive card up to 600px wide; session title first, QR above code and URL, attendee count and guarded Start; no separate presentation mode |
| Attendee | Waiting card, full-width timer (sticky while scrolling on mobile), colored answer choices, submitted-answer state and server-projected reveal; long answer text switches the grid to one column |
| Host question/results | Centered question card, colored options, timer/answer count, reveal, leaderboard and next/final controls |
| Finish | Quiz keeps its podium/rankings; Survey shows per-question aggregate summaries and Back to Home, never a score/podium |
| Recent cards | Compact keyboard-accessible clickable content, no thumbnail or visible Open/View hint, type/title/sentence-case status/date icon/Questions/Responses; separate native three-dot Open / Duplicate / Delete disclosure |
| Publisher | Trusted administrator-only guest setting at `/admin/`; no header shortcut or bootstrap-identity diagnostic |

Dark uses the source palette: `#1a1a2e`, `#16213e`, `#0f3460`,
`#2d1b69`, primary `#6c63ff`, secondary `#ff6584` and accent `#43e97b`.
Home and game screens use the original animated background and falling geometric shapes.
Home shapes use purple/pink accents, not green. Game screens retain the original
card geometry and mobile option stacking. Home/editor use purple and pink
accents with Segoe UI typography. Their status badges, authoring correctness
selection and controls use no green; the game correctness semantics stay unchanged.
Reduced-motion preferences disable animations and transitions.
Decorative shape travel is slowed from 14s to 28s, with peak opacity reduced
from .6 to .25; the background gradient cycle is 30s instead of 15s.
The answer colors themselves are unchanged by this animation adjustment.

The single lobby action is in the page header and is not sticky. New items use
**Create & Open Lobby**. Existing editable items use **Open Lobby** when unchanged
and **Save & Open Lobby** when persisted content differs from the saved draft.
Reverting changes returns to **Open Lobby** without resetting the draft.
Comparison includes question order, options, correctness, Survey settings,
audience and timing, normalizing legacy duration metadata and server-trimmed text.
The header submit button is explicitly associated with the form so native
validation still runs. Clean opens do not submit an edit; failed saves retain
the draft and error instead of navigating.
Questions still precede Settings in DOM/tab and visual order; only **Add Question**
remains below them. Native form validation, busy/public acknowledgement guards
and readonly locks still apply. Readonly views omit editing hints.
Question type/custom duration triggers have a subtle neutral fill and no border.
Normal and Other option delete controls both use 32px targets with 16px glyphs.

Mobile timer bars have an opaque theme surface, safe-area padding and focus
scroll clearance; scrolling choices does not hide remaining time. More than
100 characters or a newline in any answer switches that answer group to one
column, without truncating text (mobile already stacks ordinary answers).

Survey reveal says **Results coming up...**. The subsequent results phase and
finish show the most-selected response buckets for each completed question,
including ties, unanswered questions and text-only response counts. Other
responses are an explicitly grouped bucket; their text is never ranked or shown.
The server emits this projection only in the existing post-reveal results/final
phases, after the usual owner or attendee capability/audience/expiry/epoch checks.
Future-question text, raw response text, participant associations and survey
scores/rankings are not part of this new projection. Current-question reveal
distributions and all Quiz scoring/reveal rules remain unchanged.
All settings glyphs use the shared 24-unit outline SVG: a symmetric eight-tooth
gear and independently centered ring, with the same current-color stroke,
rounded joins and nonshrinking icon sizing as the other controls. It replaces
the previous asymmetric outer contour without changing menus or hit targets.

The shared header brand adds an original four-shape mark beside the
unchanged QuizCrowd wordmark: filled square, circle, triangle, square in reading
order in a balanced 2x2 grid. The final square uses the dark-pink secondary
button token; the first three use theme-aware purple. `components/Brand.tsx`
is the canonical SVG component, with a 24-unit
viewBox. The glyph is decorative; the button retains the accessible
**QuizCrowd home** name across home, join, editor, gameplay and admin.
Browser review exports the actual glyph to
`rayfin\.temp\routing-review\quizcrowd-mark.svg` and `quizcrowd-mark.png`,
and captures each theme/viewport header. These are generated review artifacts,
not new external resources or an added icon dependency.

All screens share one 1280px maximum-width shell and responsive horizontal
padding, including editor/settings, admin and gameplay. Inner join, lobby and
results cards keep their narrower readable widths within that shell. The editor
collapses its two columns on smaller screens.
Settings groups use compact shared spacing and translucent horizontal borders
between groups. Late-join and answer-reveal choices are always-visible native
radio groups, not dropdowns: their option values and behavior are unchanged.
Surveys omit the entire answer-reveal group, including its heading and help,
in create/edit/read-only views. No empty group or separator remains.
Started/answered-session settings remain disabled.
Settings headings and choices use first-word capitalization, including
**Allow late joins?**, **Don't allow late join**, **Allow join after session start**,
**Show correct answers?**, **Wait for all users**, **Show after user response**
and **Never show**. The stored enum values and server reveal rules are unchanged.
Quiz questions place **Select the circle beside the correct answer.** below
the options, on the left of the small right-aligned **Add option** action.
They share a row/baseline when space permits and wrap without overflow on
narrow screens; the helper precedes actions in DOM order.
Surveys never show this correctness helper.

## URLs, history and request lifecycle

| Screen | Canonical URL |
| --- | --- |
| Home | `/` |
| Create quiz / survey | `/host/create/?type=quiz` / `/host/create/?type=survey` |
| Owner edit / read-only view | `/host/item/?gameId=<UUID>` |
| Join code / invitation | `/join/`, `/join/?code=000123`, `/join/?gameId=<UUID-or-legacy-alias>` |
| Host lobby / active session | `/host/lobby/?gameId=<UUID>` / `/host/game/?gameId=<UUID>` |
| Attendee | `/play/?gameId=<UUID>` |
| Publisher | `/admin/` |

These are real paths with History API back/forward navigation and reload.
IDs use named query parameters rather than dynamic path segments: the pinned
Fabric hosting guide documents directory `indexDocument` handling, but not a
configurable SPA rewrite/fallback. The Vite build emits a physical `index.html`
under each screen directory, with root-absolute assets; SDK runtime configuration
continues loading from `/rayfin.config.json`. Deploy the complete output folder,
not only its root index and assets. This avoids depending on a catch-all rewrite.
Authenticated Fabric deep-route behavior still needs a future live release smoke;
the local browser suite uses built files with **no** SPA fallback.

Root `?quiz=<UUID-or-legacy-alias>` and `?code=000123` links canonicalize to
Join; resolving a legacy invitation replaces it with the six-digit code.
`/library/` and `/quizzes/` physical entries redirect in-app to home. Invalid or
ambiguous route parameters show Page not found; an unknown static path can return
the host's 404. Missing/unowned owner content shows an explicit server error.
Route IDs are not credentials. The attendee capability and nickname stay in
tab-scoped session storage, never the URL; reloading the same tab resumes it.
A shared attendee URL without that credential offers joining instead.

Private owner/admin routes preserve their intended URL during sign-in, and use
server ownership/admin checks; an arbitrary `returnTo` is never followed.
Anonymous and non-admin callers cannot use the admin form, and hiding its
header shortcut is not authorization. Sign-out clears attendee and private UI state.

Owner read-only **View Live Quiz/Survey** screens keep **Open Lobby** and, after
the session has started, offer **Attend**. A response-locked lobby stays readonly
without showing this started-session action. Attend navigates to `/join/?code=<session-code>` using the
saved canonical code; it does not join, start the session or reuse host identity
as an attendee credential. The normal nickname, Entra/guest and server audience
checks still run. A finished session, or a started session with late joining
disabled, shows a disabled action with its reason. These are snapshot-based UI
hints: the server rechecks current state when a caller actually joins.

Completed Survey owner views also offer **View Results**, navigating directly
to the existing `/host/game/?gameId=<id>` completed-results screen. No new
results route, attendee join, creation or host control is involved. Reload/back
use the existing owner-authorized host projection and aggregate-only summaries;
Quiz result behavior is unchanged. Open Lobby uses the same compact typography,
padding and hit-target height as Attend; save/create actions keep their normal size.

Lobby guidance says **Scan QR code or visit link to join...**. The optional
**Tip: Press F11 to make full screen** is hidden while Fullscreen API,
`display-mode: fullscreen` (including browser fullscreen in supporting browsers),
or Firefox's `window.fullScreen` reports fullscreen. Media/fullscreen events,
resize, focus and pageshow refresh the state; listeners are removed on unmount.
No fullscreen is entered automatically and no screen-size equality heuristic is
used. Browser/embedded hosts that expose none of these signals cannot reliably
report browser-controlled fullscreen to page code, so their F11 detection is best effort.

Recent Items starts in an explicit loading state with three noninteractive,
screen-reader-hidden placeholder cards and an accessible loading status.
It is separated from home actions by a 48px gap, reduced to 40px on mobile.
**No recent items** appears only after a successful loaded empty list.
Settings/list failures retain an error state, not an empty result. Existing
navigation/identity/request generations reject stale success and failure results;
pending list refreshes do not disable the home actions.
Each home action focuses its destination's first editable field once the
destination is ready: Quiz/Survey title or Session Code. The route-scoped focus
request is consumed once and invalidated by navigation, so later refreshes,
polls, validation and popover/dialog focus are not overridden.

The Join/back regression was reproduced with a pending list refresh: old `home()`
wrapped refresh in global `busy`, disabling every home action. Refresh now has
its own nonblocking status. Navigation and identity generations invalidate stale
results immediately, and effect cleanup stops old poll loops. Departed joins,
draft loads, invitation resolutions and mutations cannot redirect or populate a
new screen. The SDK invocation has no cancellation parameter in use here:
ignoring a departed result does not roll back an already accepted server command.
Legitimate in-screen writes remain disabled while pending, and failures on the
current screen remain visible.

The light theme uses the same geometry, hierarchy and interactions, with pale
backgrounds, dark text and readable accent variants. Muted text is more opaque
than the original. Filled answer tiles use white text and darker versions of
their red/blue/amber/green/purple/orange families, each exceeding 4.5:1 against
white. Hover/disabled shading affects only the fill, not text opacity; selected
Survey labels retain white text. Podium blocks retain their separate dark
foreground; neutral editor fields, supplemental Other and written-response
inputs are not changed to white. Filled primary actions use white text in
both themes, including hover/focus/active/disabled states. The editor's generic
outline-button hover rule explicitly excludes filled primary/secondary buttons;
it previously overrode their white foreground with dark text in Light mode.
Home uses separate `home-action` buttons with white Light surfaces and neutral
Dark surfaces, neutral borders/titles/descriptions, and color only on icons.
A subtle transparent brand tint reaches the lower-right corner (5% Light,
8% Dark); most of each surface stays neutral. Equal compact 280px geometry
and 1.01 hover scale are retained. The Survey description is
**Collect live feedback without scoring.** Quiz description is
**Multiple choice quiz with scoring.**
Game-screen purple button fills are slightly darker for text contrast.
Deletion icons are neutral normally and red on hover/focus.

Fabric-specific necessities remain: Entra sign-in/out, a SQL-backed owner
library, trusted publisher controls, Internal Only / Anyone (Public), the
all-questions public warning and explicit acknowledgement. No original
password-admin or browser quiz archive was imported. Image upload remains
outside the existing Fabric data contract; no decorative, nonworking upload
button is presented. Surveys still have no correctness key or score.

The shared footer reads **QuizCrowd for Microsoft Fabric · About**. About opens
the existing native modal pattern, with labelled heading, inert background,
focus containment/restoration and close-button/Escape/backdrop dismissal.
It links the author's [public Microsoft LinkedIn profile](https://www.linkedin.com/in/mustafaasiroglu),
the canonical repository and its enabled issue-creation page. The profile URL
was confirmed from the publicly indexed LinkedIn Microsoft profile; direct
automated LinkedIn requests return HTTP 999. About accurately says **source code
is available on GitHub**, not **fully open source**: the project still has no
application license grant (see [LICENSING.md](../LICENSING.md)). No license
is selected or added by this UI change. Removing the
join screen's question-preview action does not change the public-quiz warning
or the server's authorized question-projection API. Public questions are not
made private by hiding a button.

Starting a session or submitting its first answer locks authoring on both client
and server. Owners can still view content, open the host lobby and revoke public
visibility. Duplicate produces a new private lobby without activity; delete
requires explicit confirmation and owner authorization. An unanswered, unstarted
lobby remains editable even with attendees. Response count means individual
question submissions, not the number of people.
Duplicate commits a new record before opening that copy's editable screen:
its ID/code are different, its recent card is additional, and the original
content/activity/read-only state remain unchanged. The title starts **Copy - **,
with a single prefix when duplicating another copy. Titles remain within 120
UTF-16 code units without splitting a Unicode code point. Content type,
questions, Other/multiple flags, durations and reveal/late-join settings carry
over; visibility resets to internal without a public acknowledgement.

New Live Survey creates a Survey; New Live Quiz creates a Quiz. Content Type is
fixed by the creation action and not shown in Settings; API updates reject type changes and
duplicate preserves the source type. Show correct answers is a Quiz-only
settings group; hiding it for Surveys does not mutate their stored reveal setting.
The organization audience requires tenant-bound Entra app access and includes
authorized directory guests, not anonymous app guests. Public selection still
requires the global switch, warning acknowledgement and deployment release gate.
The shared Quiz/Survey editor lists **Only people in my organization** first
with **Requires sign-in with organization account**, then **Anyone with link**
with **Anonymous response, no sign-in required.** These shorter labels do
not change the Entra directory-guest semantics or enable anonymous access.
When the publisher disables public attendance, the option title becomes
**Anyone with link (disabled by admin)** and the separate publisher-disabled paragraph
is omitted. The anonymous-response description remains; the native radio is
still disabled and the server/global/public-acknowledgement boundaries are unchanged.

## Survey question types and Other

The upper-right question header shows a borderless neutral type trigger with a
selected label on the left and a dropdown arrow on the right; both become purple on hover/focus. Its anchored radio menu offers
three choices, keyboard arrows/Home/End/letter navigation, Enter/Space selection,
Escape/focus restoration and outside-click/Tab dismissal. The selected type
stays visible. The sidebar's Settings gear remains.
Duration, type and delete controls share a right-aligned, wrapping action group;
the shared 16px gap separates the duration and type triggers in either writing direction;
the question title and reorder controls stay on the left. This also fixes the
single-question Quiz timer previously losing its right alignment to a
last-child margin rule. Quiz questions never show a Survey type picker.
Add option and Add Other share a right-aligned action group with 12px text and
32px-or-larger hit targets; Quiz correctness guidance sits to its left when
space allows. Reorder buttons have zero padding/gap and square geometry;
their arrows align toward each other without overlapping hit targets.
Mobile hit targets remain 32px high.

Quiz and Survey editors allow up to ten normal choices. Add option stays visible
but disabled as **10 options maximum** at the limit and becomes available again
after deleting a choice. Other is an additional Survey response, not a normal
choice. Correct-answer radio buttons, stable numeric selection IDs and host
response distributions cover every choice, including the tenth.

| Choice | Existing JSON representation | Authoring |
| --- | --- | --- |
| Single Select | Normal options; `allowMultiple:false` (or absent legacy flags), optional `other:true` | One normal answer OR written Other; optional Add Other/remove Other |
| Multiple Select | Normal options; `allowMultiple:true` | Multiple answers; optional Add Other/remove Other |
| Free Text | No normal options; `other:true`, `allowMultiple:false` | Written response only, no visible Other row/action |

Quiz questions expose none of these features. With either choice type's Other
enabled, creators can remove every normal option; removing the last one
selects Free Text. The server rejects Other-only with multiple selection.
Other cannot be removed until two normal choices remain, preventing an empty
or invalid single-choice question.
Switching to Free Text removes normal choices from the submitted/persisted
question, but keeps them in the current unsaved editor draft for switching
back, including across duration/text edits. After reopening a saved Free Text
question, switching back starts with two empty required choices. No hidden
normal choices or extra type metadata are persisted. Switching back retains
Other until explicitly removed, including when returning from Free Text.

Single-choice + Other records, both existing and newly authored, remain
playable, editable and copyable without normalization or destructive saves.
The menu infers Single Select and read-only authoring displays its Other row.
Single responses reject mixed normal-plus-Other or multiple normal selections.

Attendees use radio choices by default or checkboxes when Allow multiple is on,
then **Submit response**. Selecting Other shows a required written-response
input; deselecting it clears its text and omits it from submission.
With only Other remaining, the screen shows the input directly without a
visible Other label; its accessible name is **Your response**. Whitespace-only
text cannot be submitted. Text is trimmed and limited to 500 UTF-16 code units.
The existing server-controlled live timeout still applies.

Question flags survive save/reopen/duplicate, question removal/reordering,
duration changes and the existing read-only lock. Answers remain in the existing
game JSON, using versioned reversible pipe-delimited encoding in the existing
answer field; literal pipes/backslashes are preserved. See
[architecture.md](architecture.md#survey-other-and-multiple-selection-responses)
for the exact format and validation. No SQL table/column/migration is added.
Legacy numeric single answers and Quiz scoring remain compatible.
Results show aggregate normal-choice/Other counts only; no other attendee's
individual written feedback is exposed. Multiple choices count independently,
not as extra submitted responses.

## Answer duration

New content defaults to **Same for all questions**, 20 seconds. The settings
panel uses the same compact combined control as per-question timing: a small
clock, 48px numeric input/spinner and **s**, all inside one bordered wrapper.
No seconds text or separate unit appears outside the control. Its accessible
label still specifies seconds. The row can wrap on very narrow
screens without overflowing; questions have no timer controls in this mode.
The Answer duration heading has no decorative clock icon.
**Customize each question** shows a borderless duration trigger at the top of
every question: clock icon on the left, then a compact label such as **20s**.
It matches the type trigger's neutral text, purple hover/focus and hit target.
Click or Enter/Space opens the existing clock/numeric-spinner/**s** input in an
anchored nonmodal popover, with input focus, Escape/Tab dismissal and outside
click handling. Type and duration popups do not stay open together. The input
remains mounted for native form validation; submitting an invalid value while
closed reopens/focuses it instead of sending a request. Read-only/busy triggers
are disabled. This does not change the sidebar's shared duration control.
Custom duration
removes the shared input. Values must be whole seconds from 5 through 120.
Its help text is indented to align with the option text, not the radio circle,
and is associated with that radio using `aria-describedby`. The displayed copy
is **Set seperately on each question.**
Changing to custom initializes questions with the current shared value.
Changing back uses the remembered shared value, or the first question's value
for legacy custom content, deterministically. New questions inherit that value.
Removal/reordering does not lose the setting.

The selected mode and remembered shared seconds persist in the existing game
JSON alongside effective question durations. Custom stays selected on
save/reopen/duplicate even when every question has the same time. Only legacy
content without this metadata infers an initial shared/custom choice from its
question values; opening it does not rewrite it. No SQL column/table or migration
is needed. Server validation rejects inconsistent shared-mode times and the edit
lock protects both the setting and effective times.
This does not remove live countdowns or change survey timed-collection semantics.

The live host/attendee progress bar uses a monotonic animation-frame clock
anchored to the server's question start, duration and timestamp. Only its DOM
transform changes each frame; seconds labels/accessible values update once per
second. Fresh polls synchronize without growing the same-question bar. Background
resume catches up, expiry clamps at zero, and question changes/unmount cancel
pending frames. This is display-only: server timeouts, scoring and progression
remain authoritative. The previous integer-second width plus short CSS
transition caused the visible once-per-second jumps.

The join page is **Join with Code**, its input is **Session Code**, and the
home action description is **Enter a quiz or survey.** These labels do not
change the six-digit invitation or credential/authorization semantics.

## Exactly two themes

The first visit always starts **light**, independently of operating-system
appearance. The toolbar offers only moon/sun **Dark** and **Light** icon buttons,
with accessible labels, titles and `aria-pressed`; no continuously visible text.
There is no system/auto mode or URL theme override.

The selected value is saved under `quizcrowd-theme` in browser local storage.
An inline, allowlisted bootstrap restores it before React paints, so page
transitions and reloads retain the preference. Invalid values become light.
If browser storage is blocked, the choice still works for the open page and a
visible status explains that it cannot survive reload. Theme storage contains
only the preference, never quiz content, answer keys or identity credentials.
Attendee credentials continue using the existing tab-scoped session storage.

The rightmost account avatar opens a small Sign out menu by pointer, Enter or
Space. Escape closes it and restores focus; outside pointer/focus closes it
without stealing focus. The pinned SDK's actual `User` contract supplies
id/email/role/verification, but no display name or photo URL, so this version uses
a neutral user SVG rather than inventing initials or showing a subject/token.
It does not request Graph photo permissions or decode identity tokens.

## Local verification and review images

Use Node.js 24 and the committed lockfile:

```powershell
npm run check
npm run test:ui
```

`npm run check` includes production-bundled component render tests, exact
two-theme bootstrap tests and the existing SDK/domain/authorization/QR tests.
The component tests check key secrecy during an open `wait_all` question,
no-key surveys, public acknowledgement, native answer controls and podium ranks.

`npm run test:ui` builds the frontend with a test-only connection alias, serves
its physical directory indexes on a loopback-only static server without SPA
fallback, and starts an isolated,
headless Edge browser. On Windows it uses the standard Edge installation; set
`QUIZCROWD_TEST_BROWSER` to another Chromium executable if needed. Ports 5174
and 9339 must be unused; the script refuses to attach to existing processes.
It closes its own browser/server and removes its dedicated temporary profile.
No browser automation package or additional dependency is required.

The test build replaces **only** the frontend connection module with
`tests/fixtures/rayfin-client.mjs`. It never loads `.env` files or the Fabric
development plugin. The production build does not use this fixture or provide
a mock/fallback mode. The browser test asserts that no non-loopback requests
occur. These are **local UI checks, not new live Fabric authorization results**.

For a manual, synthetic-data-only preview on `http://127.0.0.1:5174`, run
`node tests/ui-preview.mjs` with Node.js 24 and leave that process open.
No Fabric sign-in is required: the test-only connection starts as a simulated
administrator. Its quiz, answer, settings and session data are demo fixtures
stored in that browser tab, not Fabric SQL. This is not a production backend
or authentication test. Use the supported Rayfin dev flow in deployment.md for
real runtime integration; do not enable new cloud redirects/permissions merely
to review layout.

The same **test-only** preview also includes already-running synthetic Survey
examples. Open `/join/?code=000123&example=survey-multiple` for multiple choices
plus Other, `/join/?code=000123&example=survey-single` for radio choices without
Other, or `/join/?code=000123&example=survey-other-only` for direct written
feedback. Enter a demo nickname and Join Game; no real authentication, SQL
or host session is involved. These query parameters have no production feature
or authorization effect. Create your own Survey from home to inspect the editor.

Ten-choice fixtures are available at
`/join/?code=600123&example=quiz-ten` and
`/join/?code=600123&example=survey-ten`. After joining, these show an already-running
synthetic question. Create a ten-choice session from home to author and start it.
`/host/lobby/?gameId=11111111-2222-4333-8444-555555555555&example=quiz-ten`
(or `example=survey-ten`) opens that fixture's host lobby directly in a fresh tab.
Preview tabs are independent; host actions in one do not progress another tab.
The fixture
invitation is deliberately fixed and checksum-valid, not the production random
generator. Demo create/duplicate use a predictable test-only suffix counter with
the same checksum format; production uses cryptographic randomness instead.
The older `000123` fixtures exercise legacy numeric-code compatibility.

The browser matrix covers both themes at 1440px and 390px, with a 320px
overflow check. It uses actual pointer/keyboard events for navigation, theme
selection and dialogs, checks accessible names from Chromium's accessibility
tree, and evaluates text contrast against the gradient's background endpoints
and composited card surfaces. It exercises authoring, join, answering,
host progression, survey completion, public warning, publisher visibility and
reload persistence. Contrast checks are scoped text checks, not a complete
WCAG certification or a screen-reader audit.

The machine-readable report records the current scenario, screenshot and
screen-state totals. The checks include read-only authoring, leading-zero codes,
legacy invitation resolution, native menu keyboard handling, duplicate, delete
confirmation/cancellation, avatar-menu keyboard/outside dismissal, physical
deep-route reloads, native back/forward, pending/failed/abandoned joins and
admin/owner guard presentation alongside existing game flows.
Survey checks additionally exercise the settings disclosure by keyboard,
mixed choices/Other, deleting all normal choices, save/reopen/reload/duplicate,
started read-only controls, radio/checkbox semantics, unselected-text cleanup,
poll-safe selection state, typed submission, Other-only accessible naming and
aggregate-only results in both themes at desktop/mobile sizes. Unit/service
checks cover actual encoded JSON persistence, literal pipe/backslash roundtrips,
malformed requests, legacy answers, idempotency and unchanged Quiz scoring.

Real browser captures and the report are saved under the ignored directory
`rayfin\.temp\routing-review\`. They use synthetic test content:

| Image suffix | Example exact repository-relative path |
| --- | --- |
| Home | `rayfin\.temp\routing-review\dark-desktop-home.png` |
| Home with motion enabled | `rayfin\.temp\routing-review\dark-desktop-animated-home.png` |
| Light home | `rayfin\.temp\routing-review\light-desktop-home.png` |
| Account menu | `rayfin\.temp\routing-review\dark-mobile-account-menu.png` |
| Join | `rayfin\.temp\routing-review\light-mobile-join.png` |
| Editor | `rayfin\.temp\routing-review\dark-desktop-author.png` |
| Same for all | `rayfin\.temp\routing-review\dark-desktop-settings.png` |
| Custom durations | `rayfin\.temp\routing-review\light-mobile-custom-duration.png` |
| Survey settings | `rayfin\.temp\routing-review\light-desktop-survey-settings.png` |
| Multiple choices and Other | `rayfin\.temp\routing-review\dark-desktop-survey-multiple-other.png` |
| Other-only written response | `rayfin\.temp\routing-review\light-mobile-survey-only-other.png` |
| Compact settings / question-first mobile order | `rayfin\.temp\routing-review\light-mobile-settings-layout.png` |
| Shared gear detail (4x screenshot crop) | `rayfin\.temp\routing-review\dark-desktop-settings-gear-detail.png` |
| Equal custom durations reopened | `rayfin\.temp\routing-review\dark-desktop-equal-custom-reopen.png` |
| QR lobby | `rayfin\.temp\routing-review\light-mobile-host-lobby.png` |
| Host question | `rayfin\.temp\routing-review\dark-desktop-host-question.png` |
| Reveal | `rayfin\.temp\routing-review\light-desktop-host-reveal.png` |
| Leaderboard | `rayfin\.temp\routing-review\dark-mobile-host-leaderboard.png` |
| Podium | `rayfin\.temp\routing-review\dark-mobile-host-finished.png` |
| Attendee waiting | `rayfin\.temp\routing-review\light-desktop-attendee-lobby.png` |
| Attendee question | `rayfin\.temp\routing-review\dark-mobile-attendee-question.png` |
| Submitted answer | `rayfin\.temp\routing-review\light-mobile-attendee-submitted.png` |
| Recent cards | `rayfin\.temp\routing-review\dark-desktop-recent.png` |
| Read-only | `rayfin\.temp\routing-review\light-desktop-readonly.png` |
| Three-dot menu | `rayfin\.temp\routing-review\dark-mobile-menu.png` |
| Delete-question dialog | `rayfin\.temp\routing-review\light-mobile-delete-dialog.png` |
| Publisher | `rayfin\.temp\routing-review\light-mobile-publisher.png` |
| Survey completion | `rayfin\.temp\routing-review\light-mobile-survey-finished.png` |
| Public warning | `rayfin\.temp\routing-review\light-mobile-public-warning.png` |
| Full machine-readable results | `rayfin\.temp\routing-review\results.json` |

The common capture suffixes exist for every dark/light and
desktop/mobile combination. The report lists every exact path. Screenshot
review and source-derived layout assertions do not establish pixel-perfect
equivalence against a running original app: the original was not executed.

The routing/header revision changes frontend source and its build artifacts only;
it has not been published to Fabric. No Function, SQL schema, tenant policy,
hosting protection, guest switch or trusted administrator membership changed.
Deployment success and SQL readback are distinct from an authenticated live
browser smoke test; local fixture screenshots do not prove either.

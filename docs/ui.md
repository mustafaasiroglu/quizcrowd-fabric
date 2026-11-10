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
| Home | Icon-led New Live Quiz / New Live Survey / Join with Code actions, the only recent-session grid; stacked on mobile |
| Join | Narrow card, six-digit numeric string code including leading zeros, separate nickname step; old links resolve; no pre-join preview action |
| Author | Wide title/questions column with white Light surfaces or dark indigo surfaces; compact question cards, correctness controls, options and reordering |
| Settings | Right sidebar on desktop, stacked on mobile; Who can respond? first, then answer duration, late joins and answer reveal; no Content Type label/control |
| Host lobby | 448px card, prominent session code, copy code/link, white QR panel, joined-player chips and start action |
| Attendee | Waiting card, full-width timer, colored answer choices, submitted-answer state and server-projected reveal |
| Host question/results | Centered question card, colored options, timer/answer count, reveal, leaderboard and next/final controls |
| Finish | Three-step podium in second / first / third order, remaining rankings and replay/home action |
| Recent cards | Compact keyboard-accessible clickable content, no thumbnail, type/title/sentence-case status/date icon/Questions/Responses; separate native three-dot Open / Duplicate / Delete disclosure |
| Publisher | Trusted administrator-only guest setting; no bootstrap-identity diagnostic in user UI |

Dark uses the source palette: `#1a1a2e`, `#16213e`, `#0f3460`,
`#2d1b69`, primary `#6c63ff`, secondary `#ff6584` and accent `#43e97b`.
Game screens retain the original animated background, falling geometric shapes,
card geometry and mobile option stacking. Home/editor use purple and pink
accents with Segoe UI typography. Their status badges, authoring correctness
selection and controls use no green; the game correctness semantics stay unchanged.
Reduced-motion preferences disable animations and transitions.

The light theme uses the same geometry, hierarchy and interactions, with pale
backgrounds, dark text and readable accent variants. Muted text is more opaque
than the original, and colored answer/podium blocks use dark foregrounds where
white would fail text-contrast checks. Primary actions use white text in both
themes; game-screen purple button fills are slightly darker for text contrast.
Deletion icons are neutral normally and red on hover/focus.

Fabric-specific necessities remain: Entra sign-in/out, a SQL-backed owner
library, trusted publisher controls, Internal Only / Anyone (Public), the
all-questions public warning and explicit acknowledgement. No original
password-admin or browser quiz archive was imported. Image upload remains
outside the existing Fabric data contract; no decorative, nonworking upload
button is presented. Surveys still have no correctness key or score.

The shared footer reads only **QuizCrowd for Microsoft Fabric**. Removing the
join screen's question-preview action does not change the public-quiz warning
or the server's authorized question-projection API. Public questions are not
made private by hiding a button.

Starting a session or submitting its first answer locks authoring on both client
and server. Owners can still view content, open the host lobby and revoke public
visibility. Duplicate produces a new private lobby without activity; delete
requires explicit confirmation and owner authorization. An unanswered, unstarted
lobby remains editable even with attendees. Response count means individual
question submissions, not the number of people.

New Live Survey creates a Survey; New Live Quiz creates a Quiz. Content Type is
fixed by the creation action and not shown in Settings; API updates reject type changes and
duplicate preserves the source type. Show Correct Answers stays disabled for surveys.
The organization audience requires tenant-bound Entra app access and includes
authorized directory guests, not anonymous app guests. Public selection still
requires the global switch, warning acknowledgement and deployment release gate.

## Answer duration

New content defaults to **Same for all**, 20 seconds. Only the settings panel
shows the duration input in this mode; questions have no timer controls.
**Customize per question** shows a duration at the top of every question and
removes the shared input. Values must be whole seconds from 5 through 120.
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

## Exactly two themes

The first visit always starts **dark**, independently of operating-system
appearance. The toolbar offers only **Dark** and **Light**, using native buttons
with `aria-pressed`. There is no system/auto mode or URL theme override.

The selected value is saved under `quizcrowd-theme` in browser local storage.
An inline, allowlisted bootstrap restores it before React paints, so page
transitions and reloads retain the preference. Invalid values become dark.
If browser storage is blocked, the choice still works for the open page and a
visible status explains that it cannot survive reload. Theme storage contains
only the preference, never quiz content, answer keys or identity credentials.
Attendee credentials continue using the existing tab-scoped session storage.

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

`npm run test:ui` starts a loopback-only Vite test server and an isolated,
headless Edge browser. On Windows it uses the standard Edge installation; set
`QUIZCROWD_TEST_BROWSER` to another Chromium executable if needed. Ports 5174
and 9339 must be unused; the script refuses to attach to existing processes.
It closes its own browser/server and removes its dedicated temporary profile.
No browser automation package or additional dependency is required.

The test server replaces **only** the frontend connection module with
`tests/fixtures/rayfin-client.mjs`. It never loads `.env` files or the Fabric
development plugin. The production build does not use this fixture or provide
a mock/fallback mode. The browser test asserts that no non-loopback requests
occur. These are **local UI checks, not new live Fabric authorization results**.

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
confirmation/cancellation and publisher visibility, alongside existing game flows.

Real browser captures and the report are saved under the ignored directory
`rayfin\.temp\compact-review\`. They use synthetic test content:

| Image suffix | Example exact repository-relative path |
| --- | --- |
| Home | `rayfin\.temp\compact-review\dark-desktop-home.png` |
| Join | `rayfin\.temp\compact-review\light-mobile-join.png` |
| Editor | `rayfin\.temp\compact-review\dark-desktop-author.png` |
| Same for all | `rayfin\.temp\compact-review\dark-desktop-settings.png` |
| Custom durations | `rayfin\.temp\compact-review\light-mobile-custom-duration.png` |
| Equal custom durations reopened | `rayfin\.temp\compact-review\dark-desktop-equal-custom-reopen.png` |
| QR lobby | `rayfin\.temp\compact-review\light-mobile-host-lobby.png` |
| Host question | `rayfin\.temp\compact-review\dark-desktop-host-question.png` |
| Reveal | `rayfin\.temp\compact-review\light-desktop-host-reveal.png` |
| Leaderboard | `rayfin\.temp\compact-review\dark-mobile-host-leaderboard.png` |
| Podium | `rayfin\.temp\compact-review\dark-mobile-host-finished.png` |
| Attendee waiting | `rayfin\.temp\compact-review\light-desktop-attendee-lobby.png` |
| Attendee question | `rayfin\.temp\compact-review\dark-mobile-attendee-question.png` |
| Submitted answer | `rayfin\.temp\compact-review\light-mobile-attendee-submitted.png` |
| Recent cards | `rayfin\.temp\compact-review\dark-desktop-recent.png` |
| Read-only | `rayfin\.temp\compact-review\light-desktop-readonly.png` |
| Three-dot menu | `rayfin\.temp\compact-review\dark-mobile-menu.png` |
| Delete-question dialog | `rayfin\.temp\compact-review\light-mobile-delete-dialog.png` |
| Publisher | `rayfin\.temp\compact-review\light-mobile-publisher.png` |
| Survey completion | `rayfin\.temp\compact-review\light-mobile-survey-finished.png` |
| Public warning | `rayfin\.temp\compact-review\light-mobile-public-warning.png` |
| Full machine-readable results | `rayfin\.temp\compact-review\results.json` |

The common capture suffixes exist for every dark/light and
desktop/mobile combination. The report lists every exact path. Screenshot
review and source-derived layout assertions do not establish pixel-perfect
equivalence against a running original app: the original was not executed.

This revision requires updated Functions and frontend publication, but no
additional SQL schema migration. It does not change tenant policy, hosting protection,
the guest switch or trusted administrator membership. Function signatures remain
unchanged. Deployment success and SQL readback are distinct from an authenticated
live browser smoke test; local fixture screenshots do not prove the latter.

# QuizCrowd authoring and themes

Home and authoring follow the requested Forms-inspired layout, using original
QuizCrowd branding rather than Microsoft logos or reference-image personal
content. The original game screens remain. The original checkout was inspected
read-only, not built, executed or modified.

## Screens

| Screen | Behavior |
| --- | --- |
| Home | New Live Quiz / New Live Survey / Join with Code actions, recent-session card grid; stacked on mobile |
| Join | Narrow card, six-digit numeric string code including leading zeros, separate nickname step; old links resolve; no pre-join preview action |
| Author | Wide title/questions column with white Light surfaces or dark teal Dark surfaces, compact question cards, correctness controls, options, timer and reordering |
| Settings | Right sidebar on desktop, stacked on mobile; content type, audience, late joins and answer reveal |
| Host lobby | 448px card, prominent session code, copy code/link, white QR panel, joined-player chips and start action |
| Attendee | Waiting card, full-width timer, colored answer choices, submitted-answer state and server-projected reveal |
| Host question/results | Centered question card, colored options, timer/answer count, reveal, leaderboard and next/final controls |
| Finish | Three-step podium in second / first / third order, remaining rankings and replay/home action |
| Library | Type/title/status/created-on, actual participant count and submitted-answer count; native three-dot Open / Duplicate / Delete disclosure |
| Publisher | Trusted administrator-only guest setting; no bootstrap-identity diagnostic in user UI |

Dark uses the source palette: `#1a1a2e`, `#16213e`, `#0f3460`,
`#2d1b69`, primary `#6c63ff`, secondary `#ff6584` and accent `#43e97b`.
Game screens retain the original animated background, falling geometric shapes,
card geometry and mobile option stacking. Home/editor use teal accents and
Forms-inspired surfaces with Segoe UI typography.
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

New Live Survey preselects Survey. Content Type is changeable before the edit
lock; switching to Survey clears keys and disables Show Correct Answers. This
interprets the requested incomplete "Disabled for" label as "Disabled for surveys".
The organization audience requires tenant-bound Entra app access and includes
authorized directory guests, not anonymous app guests. Public selection still
requires the global switch, warning acknowledgement and deployment release gate.

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
`rayfin\.temp\ui-review\`. They use synthetic test content:

| Image suffix | Example exact repository-relative path |
| --- | --- |
| Home | `rayfin\.temp\ui-review\dark-desktop-home.png` |
| Join | `rayfin\.temp\ui-review\light-mobile-join.png` |
| Editor | `rayfin\.temp\ui-review\dark-desktop-author.png` |
| Settings | `rayfin\.temp\ui-review\light-mobile-settings.png` |
| QR lobby | `rayfin\.temp\ui-review\light-mobile-host-lobby.png` |
| Host question | `rayfin\.temp\ui-review\dark-desktop-host-question.png` |
| Reveal | `rayfin\.temp\ui-review\light-desktop-host-reveal.png` |
| Leaderboard | `rayfin\.temp\ui-review\dark-mobile-host-leaderboard.png` |
| Podium | `rayfin\.temp\ui-review\dark-mobile-host-finished.png` |
| Attendee waiting | `rayfin\.temp\ui-review\light-desktop-attendee-lobby.png` |
| Attendee question | `rayfin\.temp\ui-review\dark-mobile-attendee-question.png` |
| Submitted answer | `rayfin\.temp\ui-review\light-mobile-attendee-submitted.png` |
| Library | `rayfin\.temp\ui-review\dark-desktop-library.png` |
| Read-only | `rayfin\.temp\ui-review\light-desktop-readonly.png` |
| Three-dot menu | `rayfin\.temp\ui-review\dark-mobile-menu.png` |
| Delete-question dialog | `rayfin\.temp\ui-review\light-mobile-delete-dialog.png` |
| Publisher | `rayfin\.temp\ui-review\light-mobile-publisher.png` |
| Survey completion | `rayfin\.temp\ui-review\light-mobile-survey-finished.png` |
| Public warning | `rayfin\.temp\ui-review\light-mobile-public-warning.png` |
| Full machine-readable results | `rayfin\.temp\ui-review\results.json` |

The common capture suffixes exist for every dark/light and
desktop/mobile combination. The report lists every exact path. Screenshot
review and source-derived layout assertions do not establish pixel-perfect
equivalence against a running original app: the original was not executed.

This revision requires the additive SQL migration and updated Functions as well
as frontend publication. It does not change tenant policy, hosting protection,
the guest switch or trusted administrator membership. Function signatures remain
unchanged. Deployment success and SQL readback are distinct from an authenticated
live browser smoke test; local fixture screenshots do not prove the latter.

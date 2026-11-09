# Original QuizCrowd interface and themes

The Fabric frontend follows the original QuizCrowd source's screen structure,
not the earlier Fabric dashboard redesign. The original checkout was inspected
read-only; it was not built, executed or modified.

## Screens

| Screen | Original design carried forward |
| --- | --- |
| Home | Centered two-color wordmark, 72px desktop / 48px mobile title, stacked Join / Host actions, restrained description |
| Join | Narrow card, back navigation, separate session-code and nickname steps; quiz-URL invitations open the nickname step; no pre-join question-preview action |
| Author | 672px content area, title card, compact question cards, circular correct-answer selection, two-column options, timer, reordering and add/remove controls |
| Game settings | Compact modal for late joins and answer reveal, with keyboard focus containment, Escape and focus restoration |
| Host lobby | 448px card, prominent session code, copy code/link, white QR panel, joined-player chips and start action |
| Attendee | Waiting card, full-width timer, colored answer choices, submitted-answer state and server-projected reveal |
| Host question/results | Centered question card, colored options, timer/answer count, reveal, leaderboard and next/final controls |
| Finish | Three-step podium in second / first / third order, remaining rankings and replay/home action |
| Library / publisher | Original dashboard-style cards and status badges, restricted to the existing owner/admin projections |

Dark uses the source palette: `#1a1a2e`, `#16213e`, `#0f3460`,
`#2d1b69`, primary `#6c63ff`, secondary `#ff6584` and accent `#43e97b`.
The original animated background, falling geometric shapes, card radii,
spacing, system sans-serif typography and mobile option stacking are retained.
Reduced-motion preferences disable animations and transitions.

The light theme uses the same geometry, hierarchy and interactions, with pale
backgrounds, dark text and readable accent variants. Muted text is more opaque
than the original, and colored answer/podium blocks
use dark foregrounds where white would fail text-contrast checks. The Host a Quiz
button uses white text in both themes with a darker pink background for contrast. These
are deliberate accessibility differences rather than a new layout.

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

The completed local run passed strict typechecks, the production build and
**48 tests**, plus **29 real-browser scenarios**. It produced **58 screenshots**
and checked **69 screen states** for overflow, accessible control names and
scoped text contrast, including viewport-centered dialogs and keyboard focus.

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
| Publisher | `rayfin\.temp\ui-review\light-mobile-publisher.png` |
| Survey completion | `rayfin\.temp\ui-review\light-mobile-survey-finished.png` |
| Public warning | `rayfin\.temp\ui-review\light-mobile-public-warning.png` |
| Full machine-readable results | `rayfin\.temp\ui-review\results.json` |

The first fourteen capture suffixes exist for every dark/light and
desktop/mobile combination. The report lists every exact path. Screenshot
review and source-derived layout assertions do not establish pixel-perfect
equivalence against a running original app: the original was not executed.

This UI revision does **not** deploy cloud resources or change tenant policy,
hosting access, database settings, Function signatures or authorization. The
previous deployment's live results in the deployment guide describe that
earlier build, not a live validation of this UI revision. Publishing source to
GitHub is not publishing updated static assets to Fabric.

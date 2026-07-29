# Frontend Architecture

The Vue migration is complete. Visual behavior and the Rust command contract remain stable while application state, rendering, navigation, and playback controls are owned by typed Vue modules.

## Enforced Rules

- Business behavior is never registered on `window`.
- Application data is rendered by Vue templates, never HTML strings.
- Stores own shared state; components own template refs and presentation-only measurements.
- Application-wide DOM lookup is forbidden.
- The native playback layout may measure only its registered stage and controls refs.
- Page transitions and library refreshes are driven by reactive state.
- Every production build runs unit tests, architecture checks, the UI contract, TypeScript, and Vite.

## Current Structure

```text
src/
|-- App.vue                         Application composition and runtime lifetime
|-- main.ts                         Vue, Pinia, and root mount
|-- api/
|   `-- tauri.ts                    Typed Tauri connectivity adapter
|-- components/
|   |-- HomePage.vue                Library grid, filters, sorting, pagination
|   |-- DetailPage.vue              Metadata and episode rendering
|   |-- PlayerPage.vue              Reactive playback UI and registered refs
|   |-- UnarchivedPage.vue          Incomplete-entry list and A-Z navigation
|   |-- ArchivePage.vue             Metadata authoring workspace
|   |-- SettingsPage.vue            Library console, synchronization, backups
|   `-- GlobalOverlays.vue          Confirmation modal and context menu
|-- stores/
|   |-- app.ts                      Shared archive draft and backend data types
|   |-- navigation.ts               Pages, confirmation state, context menu
|   |-- library.ts                  Works, covers, filters, detail, pagination
|   |-- archive.ts                  Incomplete folders and authoring workflow
|   |-- settings.ts                 Binding, scans, imports, updates, backups
|   `-- player.ts                   Playback and timeline-preview state
|-- features/player/
|   |-- commands.ts                 Typed command boundary used by pages
|   |-- controller.ts               libmpv session and transport orchestration
|   |-- layout.ts                   Native child-window geometry synchronization
|   |-- thumbnails.ts               Adaptive preview extraction and memory cache
|   |-- model.ts                    Pure display and playlist rules
|   `-- mpv.ts                      libmpv plugin adapter
`-- runtime/
    |-- startApplication.ts         Runtime assembly and cleanup
    `-- applicationEvents.ts        Global keyboard and window events
```

Tests are colocated with their domain modules as `*.test.ts`.

## Dependency Direction

```text
Vue page/component
        |
        v
Pinia store or typed feature command
        |
        v
Tauri API / libmpv adapter
        |
        v
Rust command or plugin
```

Lower layers do not import page components. Stores do not locate DOM elements. Components do not build application markup dynamically.

## State Boundaries

- `navigation`: active page, confirmation modal, and context menu.
- `library`: works, filters, sorting, responsive page size, cover cache, and selected detail.
- `archive`: incomplete folders, index navigation, draft metadata, and cover edits.
- `settings`: library binding, scan progress, synchronization results, and backups.
- `player`: playback session, controls, playlist mode, fullscreen state, preview cache, and native viewport masks.
- `app`: archive draft data shared with capture mode plus common backend types. It is not a second library or player state source.

## Native Player Boundary

The libmpv child window is not a Vue DOM node. `layout.ts` receives the video stage and controls through explicit template refs, measures their rectangles, and sends normalized margins to the plugin. It does not query the page or own transport state.

`thumbnails.ts` keeps a bounded in-memory cache, progressive prefetch plan, pointer-velocity prediction, and exact-frame refinement. It updates reactive preview state and never writes to the DOM.

`controller.ts` owns mpv initialization, polling, seeking, loop transitions, fullscreen calls, and capture orchestration. `PlayerPage.vue` owns all visible text, classes, controls, playlist markup, and accessibility state.

## Verification Gates

`npm run build` enforces all frontend gates:

1. Vitest domain tests.
2. Zero global compatibility bridges.
3. Zero application DOM queries.
4. Zero HTML string injection.
5. Stable UI identifiers and no inline handlers.
6. Strict Vue TypeScript validation.
7. Vite production build.

The native verification set additionally covers Rust tests, embedded playback, timeline preview, pointer seeking, pause/resume, next-episode playback, sidebar resizing, fullscreen controls, maximized-window restoration, cross-monitor movement, and return navigation.

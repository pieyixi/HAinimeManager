# Frontend Architecture Target

This document defines the completion criteria for the Vue migration. Visual behavior and the Rust command contract remain stable while implementation ownership moves from global DOM procedures to typed Vue modules.

## Non-negotiable Completion Criteria

- Business behavior is not registered on `window`.
- Components call typed stores and composables directly.
- Application data is rendered by Vue templates, not HTML strings.
- Template refs replace application-wide DOM lookup.
- Native playback layout is the only layer allowed to measure rendered geometry.
- Page transitions and library refreshes are driven by reactive state.
- Every migration stage passes unit tests, the UI contract, TypeScript, and a production build.

## Target Ownership

```text
src/
|-- App.vue
|-- api/
|   `-- tauri.ts
|-- components/
|   |-- common/
|   |-- library/
|   |-- detail/
|   |-- archive/
|   |-- settings/
|   `-- player/
|-- composables/
|   |-- useApplicationKeyboard.ts
|   |-- useNativeVideoLayout.ts
|   |-- usePlaybackSession.ts
|   `-- useTimelinePreview.ts
|-- stores/
|   |-- navigation.ts
|   |-- library.ts
|   |-- archive.ts
|   |-- settings.ts
|   `-- player.ts
`-- domain/
    |-- library.ts
    |-- archive.ts
    `-- player.ts
```

## Dependency Direction

```text
Vue page/component
        |
        v
Pinia store or composable
        |
        v
Typed Tauri API adapter
        |
        v
Rust command
```

Lower layers must not import page components. Stores must not locate DOM elements. Components must not invoke Rust commands by string outside the API adapter.

## State Boundaries

- `navigation`: active page, return destination, overlays, and context menu state.
- `library`: works, filters, sorting, responsive page size, cover cache, and selected detail.
- `archive`: incomplete folders, index navigation, draft metadata, and cover edits.
- `settings`: library binding, scan progress, synchronization results, and backups.
- `player`: playback session, controls, playlist, loop mode, fullscreen state, and native viewport state.

## Native Player Boundary

The libmpv child window is not a Vue DOM node. `useNativeVideoLayout` may read a dedicated template ref and viewport dimensions, then send bounds to Rust. It must not query unrelated controls or own playback state. Timeline extraction remains in `useTimelinePreview`; transport commands remain in the player store/API adapter.

## Migration Gates

1. Reactive navigation and overlays.
2. Library grid, filters, pagination, and detail rendering.
3. Archive, incomplete library, and settings workflows.
4. Player components and composables.
5. Removal of the compatibility runtime.
6. Unit, production, Tauri, playback, fullscreen, and cross-monitor verification.

Run `npm run audit:architecture` to inspect remaining compatibility metrics. `scripts/architecture-contract.json` records the current ceiling and the final zero target; each completed stage must lower the ceiling.

# Vue Frontend

This directory is the active Tauri frontend. It uses Vue 3, TypeScript, and Vite.

Version 2.0 marks the completion of the migration. The previous HTML and JavaScript frontend is no longer part of the active build.

## Compatibility contract

- The existing DOM ids, class names, visible text, and shared CSS remain unchanged.
- Tauri commands and the Rust/libmpv backend are unchanged.
- Each existing page is now a Vue single-file component.
- Pinia stores own application state; feature modules own library and player behavior.
- `npm run check:parity` prevents accidental removal of the stable DOM contract and rejects inline HTML handlers.

## Commands

```powershell
npm install
npm run test
npm run build
npm run dev
```

Tauri runs these commands automatically through `src-tauri/tauri.conf.json`.

## Structure

- `src/components`: Vue page components.
- `src/stores`: Pinia state and settings/archive workflows.
- `src/features/library`: media-library navigation, filters, detail rendering, and library actions.
- `src/features/player`: typed libmpv transport, native layout, thumbnail pipeline, and playback controller.
- `src/runtime`: startup wiring and application-level events.
- `scripts/ui-contract.json`: stable DOM ids used by CSS and native integration.

## Validation

`npm run build` is the required frontend gate. It runs Vitest, validates the UI contract, performs strict TypeScript checking, and builds the production bundle. Native playback should additionally be checked in a Tauri window because the libmpv surface cannot be validated in a normal browser.

Keep visual changes separate from behavior changes so native playback regressions remain easy to isolate.

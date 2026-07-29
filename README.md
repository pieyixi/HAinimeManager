# Local Library Desktop

A portable, local-first desktop application for organizing and reviewing a privately maintained media collection.

The application is designed for offline use. It keeps its index beside the executable, reads structured metadata from local folders, and does not require a hosted service.

## Features

- Searchable and filterable library view
- Structured item and episode metadata
- Workspace for incomplete entries
- Embedded playback powered by libmpv
- Local cover and preview image management
- Library synchronization and duplicate checks
- Portable SQLite storage
- Manual backup tools

## Technology

- Tauri 2
- Rust
- SQLite
- Vue 3, TypeScript, Pinia, and Vite
- libmpv

## Version 2.0

Version 2.0 completes the frontend migration from a monolithic HTML and JavaScript implementation to Vue 3 and TypeScript. The visual contract and native backend integration remain compatible while application responsibilities are now separated into maintainable modules.

- Vue single-file components define the page structure.
- Pinia stores own shared state and long-running workflows.
- Library and player behavior live in dedicated feature modules.
- The libmpv transport, native video layout, timeline preview pipeline, and playback session are isolated from page components.
- Automated tests cover indexing, incomplete-entry summaries, size formatting, and timeline preview planning.
- A UI contract check protects stable element identifiers and rejects inline HTML event handlers.

## Project Layout

```text
frontend-vue/ Active Vue frontend
src-tauri/    Rust backend and desktop configuration
tools/        Local development utilities
```

## Development

Check the Rust backend:

```powershell
cargo check --manifest-path src-tauri\Cargo.toml
```

Check and build the frontend:

```powershell
cd frontend-vue
npm install
npm run build
```

`npm run build` runs unit tests, the UI contract check, strict TypeScript validation, and the Vite production build.

Build the Windows release:

```powershell
cargo tauri build
```

## Data Policy

Personal databases, local media, generated backups, and release archives are excluded from source control. Runtime data should be backed up separately.

## Status

This is a personal desktop project under active development. Interfaces and local data structures may change between releases.

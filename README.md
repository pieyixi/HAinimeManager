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
- HTML, CSS, and JavaScript
- libmpv

## Project Layout

```text
src/          Frontend
src-tauri/    Rust backend and desktop configuration
tools/        Local development utilities
```

## Development

Check the Rust backend:

```powershell
cargo check --manifest-path src-tauri\Cargo.toml
```

Build the Windows release:

```powershell
cargo tauri build
```

## Data Policy

Personal databases, local media, generated backups, and release archives are excluded from source control. Runtime data should be backed up separately.

## Status

This is a personal desktop project under active development. Interfaces and local data structures may change between releases.

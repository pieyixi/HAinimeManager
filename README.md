# HAinimeManager

A portable desktop media library manager for privately maintained local collections.

The project is built with Tauri 2, Rust, SQLite, plain HTML/CSS/JavaScript, and libmpv. It focuses on local-first organization: metadata files, cover images, episode lists, duplicate checks, backups, and embedded playback.

## Highlights

- Portable database stored beside the executable.
- Library view with search, filtering, sorting, and responsive pagination.
- Detail view for titles, metadata, tags, dates, characters, and episode lists.
- Workspace for folders that still need metadata or cover assets.
- Metadata assistant with JSON paste/validation support.
- Main cover and per-episode cover handling.
- Embedded local playback through libmpv.
- Frame capture workflow for episode cover preparation.
- Duplicate folder detection.
- Database and metadata-package backup utilities.

## Folder Layout

Each managed item is expected to follow this layout:

```text
Title/
  data/
    meta.json
    cover.jpg
    cover_ep1.jpg
    cover_ep2.jpg
  Title #1.mp4
  Title #2.mp4
```

Episode filenames should include a `#number` marker. Both half-width `#3` and full-width `＃3` are supported. The app uses this number to bind video files, metadata, and episode covers.

## Metadata

`data/meta.json` uses this structure:

```json
{
  "title": "Title",
  "episodes": 2,
  "characters": {
    "1": "Character A",
    "2": "Character B"
  },
  "studio": "Studio",
  "synopsis": "Description",
  "episode_list": [
    {
      "id": 1,
      "subtitle": "",
      "release_date": "2026-05",
      "tags": {
        "theme": ["Story tag"],
        "attribute": ["Attribute tag"],
        "scene": ["Scene tag"]
      }
    }
  ]
}
```

## Development

JavaScript syntax check:

```powershell
Get-Content src\js\state.js,src\js\navigation.js,src\js\filters.js,src\js\detail.js,src\js\player.js,src\js\archive.js,src\js\settings.js,src\js\events.js | node --check -
```

Rust check:

```powershell
cargo check --manifest-path src-tauri\Cargo.toml
```

Release build:

```powershell
cargo tauri build
```

## Data Safety

The repository does not include personal databases, local media, generated backups, or release archives. The portable runtime database is named `database.db` and should be backed up separately.

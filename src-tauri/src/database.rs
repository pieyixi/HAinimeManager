pub struct Database {
    pub conn: Mutex<Connection>,
}

fn portable_app_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

fn legacy_app_data_dir() -> std::path::PathBuf {
    let app_data = std::env::var("APPDATA")
        .or_else(|_| std::env::var("LOCALAPPDATA"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&app_data).join("HAnimeManager")
}

fn get_db_path() -> String {
    let dir = portable_app_dir();
    std::fs::create_dir_all(&dir).ok();
    let portable_db = dir.join("database.db");
    if !portable_db.exists() {
        let legacy_db = legacy_app_data_dir().join("database.db");
        if legacy_db.exists() {
            let _ = std::fs::copy(&legacy_db, &portable_db);
        }
    }
    portable_db.to_string_lossy().to_string()
}

fn parse_year_month(value: &str) -> Option<(i32, i32)> {
    let mut parts = value.split('-');
    let year = parts.next()?.parse().ok()?;
    let month = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1);
    Some((year, month))
}

pub fn init_db() -> Database {
    let path = get_db_path();
    let conn = Connection::open(&path).expect("Failed to open database");

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .ok();

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS Works (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            Title TEXT NOT NULL,
            Year INTEGER NOT NULL,
            Month INTEGER NOT NULL,
            Studio TEXT NOT NULL DEFAULT '',
            Description TEXT,
            CoverPath TEXT,
            FolderPath TEXT NOT NULL,
            CreatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            UpdatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS Episodes (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            WorkId INTEGER NOT NULL,
            Number INTEGER NOT NULL,
            Title TEXT NOT NULL DEFAULT '',
            VideoPath TEXT NOT NULL,
            CoverPath TEXT,
            FOREIGN KEY (WorkId) REFERENCES Works(Id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS Tags (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT NOT NULL UNIQUE,
            Category TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS WorkTags (
            WorkId INTEGER NOT NULL,
            TagId INTEGER NOT NULL,
            PRIMARY KEY (WorkId, TagId),
            FOREIGN KEY (WorkId) REFERENCES Works(Id) ON DELETE CASCADE,
            FOREIGN KEY (TagId) REFERENCES Tags(Id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS AppSettings (
            Key TEXT PRIMARY KEY,
            Value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS LibrarySnapshots (
            WorkId INTEGER PRIMARY KEY,
            MetaSignature TEXT NOT NULL DEFAULT '',
            CoverSignature TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (WorkId) REFERENCES Works(Id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS FavoriteCharacters (
            CharacterName TEXT PRIMARY KEY,
            CreatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );",
    )
    .expect("Failed to create tables");

    // Optional search-only aliases were added after the initial portable schema.
    // SQLite has no IF NOT EXISTS form for ADD COLUMN, so an existing column is harmless here.
    conn.execute(
        "ALTER TABLE Works ADD COLUMN SearchAliases TEXT NOT NULL DEFAULT '[]'",
        [],
    )
    .ok();

    Database {
        conn: Mutex::new(conn),
    }
}

// ─── Tauri Commands ───────────────────────────────────────

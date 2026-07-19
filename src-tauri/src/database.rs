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
        );",
    )
    .expect("Failed to create tables");

    seed_demo_data(&conn);

    Database {
        conn: Mutex::new(conn),
    }
}

fn seed_demo_data(conn: &Connection) {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM Works", [], |r| r.get(0))
        .unwrap_or(0);
    if count > 0 {
        return;
    }

    // Seed tags
    let tag_data = [
        ("纯爱", "剧情"),
        ("催眠", "剧情"),
        ("NTR", "剧情"),
        ("校园", "场景"),
        ("人妻", "人物"),
        ("萝莉", "人物"),
        ("妹系", "人物"),
        ("巨乳", "属性"),
        ("黑丝", "属性"),
        ("眼镜", "属性"),
        ("PoRO", "制作"),
        ("Queen Bee", "制作"),
        ("Poro", "制作"),
    ];

    let mut tag_ids = Vec::new();
    for (name, cat) in &tag_data {
        conn.execute(
            "INSERT OR IGNORE INTO Tags (Name, Category) VALUES (?1, ?2)",
            params![name, cat],
        )
        .ok();
        let id: i64 = conn
            .query_row("SELECT Id FROM Tags WHERE Name = ?1", params![name], |r| {
                r.get(0)
            })
            .unwrap();
        tag_ids.push((*name, id));
    }

    let tag_id_map: std::collections::HashMap<&str, i64> =
        tag_ids.iter().map(|(n, i)| (*n, *i)).collect();

    // Seed works
    let works = vec![
        ("催眠学园", 2024, 7, "PoRO", "主人公・藤堂隆之介は、ごく普通の高校生活を送っていた。ある日偶然手に入れた「催眠の技法」を試したことで、彼の日常は一変する。",
         vec![("第1話", "覚醒の刻"), ("第2話", "操りの代償")], vec!["校园", "催眠", "纯爱"]),
        ("妻の秘密", 2023, 12, "Queen Bee", "共働きの夫婦。最近、妻の帰りが遅い。浮気の疑念を抱きながらも、確かめる勇気が出ない主人公。",
         vec![("第1話", "疑惑の始まり")], vec!["人妻", "NTR"]),
        ("星空のメモリア", 2024, 3, "Poro", "夏休み、田舎に帰省した主人公。そこで再会した幼馴染の妹。",
         vec![("第1話", "再会"), ("第2話", "距離"), ("第3話", "告白")], vec!["纯爱", "妹系"]),
        ("甘い誘惑", 2024, 6, "PoRO", "取引先の美人担当者。打ち合わせのたびに、彼女の甘い香りに惑わされてしまう。",
         vec![("第1話", "出会い"), ("第2話", "誘惑")], vec!["巨乳", "黑丝", "人妻"]),
        ("放課後の教室", 2023, 9, "Queen Bee", "放課後の教室。窓の外には夕日。二人だけの秘密の時間。",
         vec![("第1話", ""), ("第2話", ""), ("第3話", ""), ("第4話", "")], vec!["校园", "萝莉", "眼镜"]),
        ("闇の契約", 2024, 1, "Poro", "ある日、謎の少女と契約を交わした。その代償として、大切なものを失っていく。",
         vec![("第1話", "契約")], vec!["NTR", "催眠"]),
    ];

    for (title, year, month, studio, desc, episodes, tags) in &works {
        conn.execute(
            "INSERT INTO Works (Title, Year, Month, Studio, Description, FolderPath) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![title, year, month, studio, desc, format!("D:\\HAnime\\{}", title)],
        ).ok();
        let work_id: i64 = conn.last_insert_rowid();

        for (i, (ep_title, ep_sub)) in episodes.iter().enumerate() {
            let ep_display = if ep_sub.is_empty() {
                ep_title.to_string()
            } else {
                format!("{} {}", ep_title, ep_sub)
            };
            conn.execute(
                "INSERT INTO Episodes (WorkId, Number, Title, VideoPath) VALUES (?1, ?2, ?3, ?4)",
                params![
                    work_id,
                    (i + 1) as i32,
                    ep_display,
                    format!("D:\\HAnime\\{}\\{}.mp4", title, ep_title)
                ],
            )
            .ok();
        }

        for tag_name in tags {
            if let Some(tid) = tag_id_map.get(tag_name) {
                conn.execute(
                    "INSERT OR IGNORE INTO WorkTags (WorkId, TagId) VALUES (?1, ?2)",
                    params![work_id, tid],
                )
                .ok();
            }
        }
    }
}

// ─── Tauri Commands ───────────────────────────────────────

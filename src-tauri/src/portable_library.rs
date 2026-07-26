const LIBRARY_MARKER_NAME: &str = ".hanime-library.json";
const SETTING_LIBRARY_ID: &str = "media_library_id";
const SETTING_LIBRARY_ROOT: &str = "media_library_root";
const SETTING_LIBRARY_RELATIVE: &str = "media_library_relative";

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct MediaLibraryMarker {
    version: u32,
    library_id: String,
}

#[derive(Debug, serde::Serialize)]
struct MediaLibraryStatus {
    root_path: Option<String>,
    library_id: Option<String>,
    source: String,
    rebound_paths: usize,
    needs_binding: bool,
}

fn app_directory() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

fn friendly_canonical_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("读取路径失败: {e}"))?;
    let text = canonical.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return Ok(std::path::PathBuf::from(format!(r"\\{rest}")));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return Ok(std::path::PathBuf::from(rest));
    }
    Ok(canonical)
}

fn normalize_existing_directory(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if !path.is_dir() {
        return Err(format!("媒体目录不存在: {}", path.to_string_lossy()));
    }
    friendly_canonical_path(path).map_err(|e| format!("读取媒体目录失败: {e}"))
}

fn read_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT Value FROM AppSettings WHERE Key=?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn write_setting(
    transaction: &rusqlite::Transaction<'_>,
    key: &str,
    value: &str,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO AppSettings (Key,Value) VALUES (?1,?2)
             ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn generate_library_id(root: &std::path::Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    root.to_string_lossy().to_lowercase().hash(&mut hasher);
    std::process::id().hash(&mut hasher);
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .hash(&mut hasher);
    let first = hasher.finish();
    first.hash(&mut hasher);
    let second = hasher.finish();
    format!("{first:016x}{second:016x}")
}

fn read_library_marker(root: &std::path::Path) -> Result<Option<MediaLibraryMarker>, String> {
    let marker_path = root.join(LIBRARY_MARKER_NAME);
    if !marker_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&marker_path)
        .map_err(|e| format!("读取媒体库标记失败: {e}"))?;
    let marker: MediaLibraryMarker =
        serde_json::from_str(&content).map_err(|e| format!("媒体库标记格式错误: {e}"))?;
    if marker.version != 1 || marker.library_id.trim().is_empty() {
        return Err("媒体库标记版本或 ID 无效".to_string());
    }
    Ok(Some(marker))
}

fn write_library_marker(root: &std::path::Path, library_id: &str) -> Result<(), String> {
    let marker_path = root.join(LIBRARY_MARKER_NAME);
    if marker_path.exists() {
        let marker = read_library_marker(root)?
            .ok_or_else(|| "无法读取已有媒体库标记".to_string())?;
        if marker.library_id != library_id {
            return Err("该目录属于另一个媒体库，已停止绑定以保护现有数据库".to_string());
        }
        return Ok(());
    }
    let marker = MediaLibraryMarker {
        version: 1,
        library_id: library_id.to_string(),
    };
    let content = serde_json::to_string_pretty(&marker).map_err(|e| e.to_string())?;
    std::fs::write(marker_path, format!("{content}\n"))
        .map_err(|e| format!("写入媒体库标记失败: {e}"))
}

fn component_text(component: std::path::Component<'_>) -> String {
    component.as_os_str().to_string_lossy().to_lowercase()
}

fn relative_path_between(
    from_directory: &std::path::Path,
    target: &std::path::Path,
) -> Option<std::path::PathBuf> {
    let from_components: Vec<_> = from_directory.components().collect();
    let target_components: Vec<_> = target.components().collect();
    if from_components.is_empty() || target_components.is_empty() {
        return None;
    }
    if component_text(from_components[0]) != component_text(target_components[0]) {
        return None;
    }
    let mut common = 0;
    while common < from_components.len()
        && common < target_components.len()
        && component_text(from_components[common]) == component_text(target_components[common])
    {
        common += 1;
    }
    let mut relative = std::path::PathBuf::new();
    for _ in common..from_components.len() {
        relative.push("..");
    }
    for component in &target_components[common..] {
        relative.push(component.as_os_str());
    }
    if relative.as_os_str().is_empty() {
        relative.push(".");
    }
    Some(relative)
}

fn infer_database_root(conn: &Connection) -> Option<std::path::PathBuf> {
    let mut statement = conn.prepare("SELECT FolderPath FROM Works").ok()?;
    let paths: Vec<String> = statement
        .query_map([], |row| row.get::<_, String>(0))
        .ok()?
        .filter_map(Result::ok)
        .collect();
    let mut counts = std::collections::HashMap::<String, (usize, std::path::PathBuf)>::new();
    for path in paths {
        let Some(parent) = std::path::Path::new(&path)
            .parent()
            .map(std::path::Path::to_path_buf)
        else {
            continue;
        };
        let key = parent.to_string_lossy().replace('/', "\\").to_lowercase();
        let entry = counts.entry(key).or_insert((0, parent));
        entry.0 += 1;
    }
    counts
        .into_values()
        .max_by_key(|(count, _)| *count)
        .map(|(_, path)| path)
}

fn relative_under_root(path: &str, root: &std::path::Path) -> Option<String> {
    let normalized_path = path.replace('/', "\\");
    let normalized_root = root
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_string();
    if normalized_path.eq_ignore_ascii_case(&normalized_root) {
        return Some(String::new());
    }
    let prefix = format!("{normalized_root}\\");
    if normalized_path
        .get(..prefix.len())
        .map(|value| value.eq_ignore_ascii_case(&prefix))
        .unwrap_or(false)
    {
        return Some(normalized_path[prefix.len()..].to_string());
    }
    None
}

fn rebound_path(path: &str, old_root: &std::path::Path, new_root: &std::path::Path) -> Option<String> {
    let relative = relative_under_root(path, old_root)?;
    let rebound = if relative.is_empty() {
        new_root.to_path_buf()
    } else {
        new_root.join(relative)
    };
    Some(rebound.to_string_lossy().to_string())
}

fn rebind_database_paths(
    transaction: &rusqlite::Transaction<'_>,
    old_root: &std::path::Path,
    new_root: &std::path::Path,
) -> Result<usize, String> {
    if old_root
        .to_string_lossy()
        .eq_ignore_ascii_case(&new_root.to_string_lossy())
    {
        return Ok(0);
    }

    let works: Vec<(i64, String, Option<String>)> = {
        let mut statement = transaction
            .prepare("SELECT Id,FolderPath,CoverPath FROM Works")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        rows
    };
    let episodes: Vec<(i64, String, Option<String>)> = {
        let mut statement = transaction
            .prepare("SELECT Id,VideoPath,CoverPath FROM Episodes")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        rows
    };

    let mut changed = 0;
    for (id, folder_path, cover_path) in works {
        let next_folder = rebound_path(&folder_path, old_root, new_root);
        let next_cover = cover_path
            .as_deref()
            .and_then(|path| rebound_path(path, old_root, new_root));
        if next_folder.is_some() || next_cover.is_some() {
            transaction
                .execute(
                    "UPDATE Works SET FolderPath=COALESCE(?1,FolderPath),
                     CoverPath=CASE WHEN ?2 IS NULL THEN CoverPath ELSE ?2 END,
                     UpdatedAt=datetime('now','localtime') WHERE Id=?3",
                    params![next_folder, next_cover, id],
                )
                .map_err(|e| e.to_string())?;
            changed += 1;
        }
    }
    for (id, video_path, cover_path) in episodes {
        let next_video = rebound_path(&video_path, old_root, new_root);
        let next_cover = cover_path
            .as_deref()
            .and_then(|path| rebound_path(path, old_root, new_root));
        if next_video.is_some() || next_cover.is_some() {
            transaction
                .execute(
                    "UPDATE Episodes SET VideoPath=COALESCE(?1,VideoPath),
                     CoverPath=CASE WHEN ?2 IS NULL THEN CoverPath ELSE ?2 END WHERE Id=?3",
                    params![next_video, next_cover, id],
                )
                .map_err(|e| e.to_string())?;
            changed += 1;
        }
    }
    Ok(changed)
}

fn has_database_paths_under(conn: &Connection, root: &std::path::Path) -> bool {
    conn.prepare("SELECT FolderPath FROM Works")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .map(|rows| {
                    rows.filter_map(Result::ok)
                        .any(|path| relative_under_root(&path, root).is_some())
                })
        })
        .unwrap_or(false)
}

fn marker_matches(root: &std::path::Path, library_id: &str) -> bool {
    matches!(
        read_library_marker(root),
        Ok(Some(marker)) if marker.library_id == library_id
    )
}

fn marker_matches_or_recovers(
    conn: &Connection,
    root: &std::path::Path,
    library_id: &str,
    previous_root: Option<&std::path::Path>,
) -> bool {
    if marker_matches(root, library_id) {
        return true;
    }
    let marker_is_missing = read_library_marker(root).ok().flatten().is_none()
        && !root.join(LIBRARY_MARKER_NAME).exists();
    marker_is_missing
        && previous_root
            .map(|previous| target_matches_existing_library(conn, previous, root))
            .unwrap_or(false)
        && write_library_marker(root, library_id).is_ok()
}

fn target_matches_existing_library(
    conn: &Connection,
    old_root: &std::path::Path,
    new_root: &std::path::Path,
) -> bool {
    let paths: Vec<String> = match conn.prepare("SELECT FolderPath FROM Works") {
        Ok(mut statement) => match statement.query_map([], |row| row.get::<_, String>(0)) {
            Ok(rows) => rows.filter_map(Result::ok).collect(),
            Err(_) => return false,
        },
        Err(_) => return false,
    };
    let relative_folders: Vec<String> = paths
        .iter()
        .filter_map(|path| relative_under_root(path, old_root))
        .filter(|relative| !relative.is_empty())
        .collect();
    if relative_folders.is_empty() {
        return true;
    }
    let matches = relative_folders
        .iter()
        .filter(|relative| new_root.join(relative).is_dir())
        .count();
    matches > 0 && matches * 2 >= relative_folders.len()
}

fn drive_replacement_candidates(previous_root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let text = previous_root.to_string_lossy().replace('/', "\\");
    if text.len() < 3 || text.as_bytes().get(1) != Some(&b':') {
        return Vec::new();
    }
    let suffix = &text[2..];
    ('A'..='Z')
        .map(|drive| std::path::PathBuf::from(format!("{drive}:{suffix}")))
        .collect()
}

fn locate_media_library(
    conn: &Connection,
    library_id: &str,
    previous_root: Option<&std::path::Path>,
    relative_hint: Option<&std::path::Path>,
) -> Option<(std::path::PathBuf, &'static str)> {
    if let Some(relative) = relative_hint {
        let candidate = app_directory().join(relative);
        if candidate.is_dir()
            && marker_matches_or_recovers(conn, &candidate, library_id, previous_root)
        {
            return friendly_canonical_path(&candidate)
                .ok()
                .map(|path| (path, "relative"));
        }
    }
    if let Some(previous) = previous_root {
        if previous.is_dir() && marker_matches(previous, library_id) {
            return friendly_canonical_path(previous)
                .ok()
                .map(|path| (path, "previous"));
        }
        if previous.is_dir()
            && read_library_marker(previous).ok().flatten().is_none()
            && has_database_paths_under(conn, previous)
            && write_library_marker(previous, library_id).is_ok()
        {
            return friendly_canonical_path(previous)
                .ok()
                .map(|path| (path, "repaired-marker"));
        }
        for candidate in drive_replacement_candidates(previous) {
            if candidate.is_dir()
                && marker_matches_or_recovers(conn, &candidate, library_id, Some(previous))
            {
                return friendly_canonical_path(&candidate)
                    .ok()
                    .map(|path| (path, "drive-scan"));
            }
        }
    }
    None
}

fn configure_media_library(
    conn: &mut Connection,
    root: &std::path::Path,
    expected_id: Option<&str>,
    source: &str,
) -> Result<MediaLibraryStatus, String> {
    let root = normalize_existing_directory(root)?;
    let existing_marker = read_library_marker(&root)?;
    let old_root = read_setting(conn, SETTING_LIBRARY_ROOT)
        .map(std::path::PathBuf::from)
        .or_else(|| infer_database_root(conn));
    if existing_marker.is_none() {
        if let (Some(expected), Some(old_root)) = (expected_id, old_root.as_deref()) {
            if !old_root
                .to_string_lossy()
                .eq_ignore_ascii_case(&root.to_string_lossy())
                && !target_matches_existing_library(conn, old_root, &root)
            {
                return Err(format!(
                    "所选目录缺少媒体库标记，且不足一半的现有作品目录能够匹配；未写入标记，也未修改数据库（媒体库 ID: {expected}）"
                ));
            }
        }
    }
    let library_id = match (existing_marker, expected_id) {
        (Some(marker), Some(expected)) if marker.library_id != expected => {
            return Err("所选目录属于另一个媒体库，未修改数据库".to_string())
        }
        (Some(marker), _) => marker.library_id,
        (None, Some(expected)) => {
            write_library_marker(&root, expected)?;
            expected.to_string()
        }
        (None, None) => {
            let generated = generate_library_id(&root);
            write_library_marker(&root, &generated)?;
            generated
        }
    };

    let relative = relative_path_between(&app_directory(), &root)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let rebound_paths = if let Some(old_root) = old_root.as_deref() {
        rebind_database_paths(&transaction, old_root, &root)?
    } else {
        0
    };
    write_setting(&transaction, SETTING_LIBRARY_ID, &library_id)?;
    write_setting(
        &transaction,
        SETTING_LIBRARY_ROOT,
        &root.to_string_lossy(),
    )?;
    write_setting(&transaction, SETTING_LIBRARY_RELATIVE, &relative)?;
    transaction.commit().map_err(|e| e.to_string())?;

    Ok(MediaLibraryStatus {
        root_path: Some(root.to_string_lossy().to_string()),
        library_id: Some(library_id),
        source: source.to_string(),
        rebound_paths,
        needs_binding: false,
    })
}

#[tauri::command]
fn initialize_media_library(db: State<Database>) -> Result<MediaLibraryStatus, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let configured_id = read_setting(&conn, SETTING_LIBRARY_ID);
    let configured_root = read_setting(&conn, SETTING_LIBRARY_ROOT).map(std::path::PathBuf::from);
    let relative_hint =
        read_setting(&conn, SETTING_LIBRARY_RELATIVE).map(std::path::PathBuf::from);

    if let Some(library_id) = configured_id.as_deref() {
        if let Some((root, source)) = locate_media_library(
            &conn,
            library_id,
            configured_root.as_deref(),
            relative_hint.as_deref(),
        ) {
            return configure_media_library(&mut conn, &root, Some(library_id), source);
        }
        return Ok(MediaLibraryStatus {
            root_path: configured_root.map(|path| path.to_string_lossy().to_string()),
            library_id: Some(library_id.to_string()),
            source: "missing".to_string(),
            rebound_paths: 0,
            needs_binding: true,
        });
    }

    if let Some(root) = infer_database_root(&conn).filter(|path| path.is_dir()) {
        return configure_media_library(&mut conn, &root, None, "database");
    }

    Ok(MediaLibraryStatus {
        root_path: None,
        library_id: None,
        source: "unconfigured".to_string(),
        rebound_paths: 0,
        needs_binding: true,
    })
}

#[tauri::command]
fn bind_media_library(
    root_path: String,
    db: State<Database>,
) -> Result<MediaLibraryStatus, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let configured_id = read_setting(&conn, SETTING_LIBRARY_ID);
    configure_media_library(
        &mut conn,
        std::path::Path::new(root_path.trim()),
        configured_id.as_deref(),
        "manual",
    )
}

#[cfg(test)]
mod portable_library_tests {
    use super::*;

    fn test_connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Works (
                Id INTEGER PRIMARY KEY,
                FolderPath TEXT NOT NULL,
                CoverPath TEXT,
                UpdatedAt TEXT
             );
             CREATE TABLE Episodes (
                Id INTEGER PRIMARY KEY,
                VideoPath TEXT NOT NULL,
                CoverPath TEXT
             );
             CREATE TABLE AppSettings (
                Key TEXT PRIMARY KEY,
                Value TEXT NOT NULL
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn rebinds_all_library_paths_without_touching_unrelated_paths() {
        let mut conn = test_connection();
        conn.execute(
            "INSERT INTO Works (Id,FolderPath,CoverPath) VALUES (1,?1,?2)",
            params![
                r"D:\HAnime\姉SUMMER！",
                r"D:\HAnime\姉SUMMER！\data\cover.jpg"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Episodes (Id,VideoPath,CoverPath) VALUES (1,?1,?2)",
            params![
                r"D:\HAnime\姉SUMMER！\姉SUMMER！ #1.mp4",
                r"D:\HAnime\姉SUMMER！\data\cover_ep1.jpg"
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Episodes (Id,VideoPath,CoverPath) VALUES (2,?1,NULL)",
            params![r"C:\Other\keep.mp4"],
        )
        .unwrap();

        let transaction = conn.transaction().unwrap();
        let changed = rebind_database_paths(
            &transaction,
            std::path::Path::new(r"D:\HAnime"),
            std::path::Path::new(r"E:\HAnime"),
        )
        .unwrap();
        transaction.commit().unwrap();

        assert_eq!(changed, 2);
        let work: (String, String) = conn
            .query_row(
                "SELECT FolderPath,CoverPath FROM Works WHERE Id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(work.0, r"E:\HAnime\姉SUMMER！");
        assert_eq!(work.1, r"E:\HAnime\姉SUMMER！\data\cover.jpg");
        let unrelated: String = conn
            .query_row("SELECT VideoPath FROM Episodes WHERE Id=2", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(unrelated, r"C:\Other\keep.mp4");
    }

    #[test]
    fn only_accepts_paths_below_the_exact_root_boundary() {
        assert!(relative_under_root(r"D:\HAnime2\work", std::path::Path::new(r"D:\HAnime"))
            .is_none());
        assert_eq!(
            relative_under_root(
                r"d:/hanime/作品/video.mp4",
                std::path::Path::new(r"D:\HAnime")
            ),
            Some(r"作品\video.mp4".to_string())
        );
    }

    #[test]
    fn rejects_an_unmarked_directory_that_does_not_contain_the_library() {
        let mut conn = test_connection();
        let base = std::env::temp_dir().join(format!(
            "hanime-portable-reject-{}",
            std::process::id()
        ));
        let old_root = base.join("old");
        let wrong_root = base.join("wrong");
        std::fs::create_dir_all(&wrong_root).unwrap();
        let work_path = old_root.join("known-work").to_string_lossy().to_string();
        conn.execute(
            "INSERT INTO Works (Id,FolderPath,CoverPath) VALUES (1,?1,NULL)",
            params![work_path],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO AppSettings (Key,Value) VALUES (?1,?2), (?3,?4)",
            params![
                SETTING_LIBRARY_ID,
                "existing-library",
                SETTING_LIBRARY_ROOT,
                old_root.to_string_lossy()
            ],
        )
        .unwrap();

        let result =
            configure_media_library(&mut conn, &wrong_root, Some("existing-library"), "manual");
        assert!(result.is_err());
        assert!(!wrong_root.join(LIBRARY_MARKER_NAME).exists());
        let stored: String = conn
            .query_row("SELECT FolderPath FROM Works WHERE Id=1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored, work_path);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn binds_a_copied_library_without_an_existing_marker() {
        let mut conn = test_connection();
        let base = std::env::temp_dir().join(format!(
            "hanime-portable-bind-{}",
            std::process::id()
        ));
        let old_root = base.join("old");
        let new_root = base.join("new");
        std::fs::create_dir_all(new_root.join("known-work")).unwrap();
        let work_path = old_root.join("known-work").to_string_lossy().to_string();
        conn.execute(
            "INSERT INTO Works (Id,FolderPath,CoverPath) VALUES (1,?1,NULL)",
            params![work_path],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO AppSettings (Key,Value) VALUES (?1,?2), (?3,?4)",
            params![
                SETTING_LIBRARY_ID,
                "existing-library",
                SETTING_LIBRARY_ROOT,
                old_root.to_string_lossy()
            ],
        )
        .unwrap();

        let status =
            configure_media_library(&mut conn, &new_root, Some("existing-library"), "manual")
                .unwrap();
        assert_eq!(status.rebound_paths, 1);
        assert!(new_root.join(LIBRARY_MARKER_NAME).exists());
        let stored: String = conn
            .query_row("SELECT FolderPath FROM Works WHERE Id=1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            stored,
            friendly_canonical_path(&new_root)
                .unwrap()
                .join("known-work")
                .to_string_lossy()
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}

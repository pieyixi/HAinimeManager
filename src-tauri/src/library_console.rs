use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

fn library_work_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() {
        return Err("媒体目录不存在".to_string());
    }
    let mut dirs = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() && folder_has_video(&path) {
            dirs.push(path);
        }
    }
    dirs.sort_by_key(|path| path.to_string_lossy().to_lowercase());
    Ok(dirs)
}

fn folder_has_video(path: &Path) -> bool {
    std::fs::read_dir(path)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .any(|entry| entry.path().is_file() && is_video_file(&entry.path()))
        })
        .unwrap_or(false)
}

fn directory_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    total
}

fn library_console_summary(conn: &Connection, root: &Path) -> Result<LibraryConsoleSummary, String> {
    let archived_count = conn
        .query_row("SELECT COUNT(*) FROM Works", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let episode_count = conn
        .query_row("SELECT COUNT(*) FROM Episodes", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let dirs = library_work_dirs(root)?;
    let unarchived_count = dirs
        .iter()
        .filter(|path| !archive_missing_reasons(&path.to_string_lossy()).is_empty())
        .count() as i64;
    Ok(LibraryConsoleSummary {
        archived_count,
        unarchived_count,
        episode_count,
        total_bytes: directory_size(root),
    })
}

fn fnv1a(data: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in data {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn meta_signature(folder: &Path) -> String {
    let path = folder.join("data").join("meta.json");
    std::fs::read(path)
        .map(|data| format!("{:016x}", fnv1a(&data)))
        .unwrap_or_default()
}

fn cover_signature(folder: &Path) -> String {
    let data_dir = folder.join("data");
    let mut parts = Vec::new();
    if let Ok(entries) = std::fs::read_dir(data_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !path.is_file() || !name.starts_with("cover") {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let modified = meta
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_nanos())
                .unwrap_or(0);
            parts.push(format!("{}:{}:{}", name, meta.len(), modified));
        }
    }
    parts.sort();
    format!("{:016x}", fnv1a(parts.join("|").as_bytes()))
}

fn normalized_video_path(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn changed_video_numbers(
    disk_videos: &HashMap<i32, String>,
    database_videos: &HashMap<i32, String>,
) -> Vec<i32> {
    let mut changed: Vec<i32> = disk_videos
        .iter()
        .filter_map(|(number, disk_path)| {
            database_videos
                .get(number)
                .filter(|database_path| {
                    normalized_video_path(database_path) != normalized_video_path(disk_path)
                })
                .map(|_| *number)
        })
        .collect();
    changed.sort_unstable();
    changed
}

fn save_library_snapshot(conn: &Connection, work_id: i64, folder_path: &str) -> Result<(), String> {
    let folder = Path::new(folder_path);
    conn.execute(
        "INSERT INTO LibrarySnapshots (WorkId, MetaSignature, CoverSignature)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(WorkId) DO UPDATE SET
           MetaSignature=excluded.MetaSignature,
           CoverSignature=excluded.CoverSignature",
        params![work_id, meta_signature(folder), cover_signature(folder)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn semantic_meta_matches_database(
    conn: &Connection,
    work_id: i64,
    folder: &Path,
) -> Result<bool, String> {
    let content = std::fs::read_to_string(folder.join("data").join("meta.json"))
        .map_err(|e| format!("meta.json 无法读取: {}", e))?;
    let meta: WorkMeta =
        serde_json::from_str(&content).map_err(|e| format!("meta.json 格式错误: {}", e))?;
    let WorkMeta {
        title,
        search_aliases,
        release,
        studio,
        synopsis,
        characters,
        tag,
        episode_list,
    } = meta;
    let episodes = episode_list.unwrap_or_default();
    let (expected_year, expected_month) = episodes
        .first()
        .and_then(|episode| episode.release_date.as_deref())
        .and_then(parse_year_month)
        .or_else(|| release.as_deref().and_then(parse_year_month))
        .unwrap_or((2024, 1));
    let current: (String, i32, i32, String, String, String) = conn
        .query_row(
            "SELECT Title, Year, Month, Studio, COALESCE(Description, ''), SearchAliases FROM Works WHERE Id=?1",
            params![work_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .map_err(|e| e.to_string())?;
    if current
        != (
            title,
            expected_year,
            expected_month,
            studio.unwrap_or_default(),
            synopsis.unwrap_or_default(),
            serde_json::to_string(&search_aliases).map_err(|e| e.to_string())?,
        )
    {
        return Ok(false);
    }

    let db_episodes: Vec<(i32, String)> = conn
        .prepare("SELECT Number, Title FROM Episodes WHERE WorkId=?1 ORDER BY Number")
        .map_err(|e| e.to_string())?
        .query_map(params![work_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    let expected_episodes: Vec<(i32, String)> = episodes
        .iter()
        .enumerate()
        .map(|(index, episode)| {
            let number = episode.id.unwrap_or((index + 1) as i32);
            let title = episode
                .subtitle
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_string();
            (number, if title.is_empty() { format!("第{}集", number) } else { title })
        })
        .collect();
    if db_episodes != expected_episodes {
        return Ok(false);
    }

    // Tags.Name is globally unique. Mirror import_work_dir's exact write order so
    // a name present in multiple categories resolves to the last imported category.
    let mut expected_tag_categories = HashMap::<String, String>::new();
    for episode in &episodes {
        let episode_categories = [("theme", "剧情"), ("attribute", "属性"), ("scene", "场景")];
        for (key, category) in episode_categories {
            if let Some(values) = episode.tags.as_ref().and_then(|tags| tags.get(key)) {
                for value in values {
                    let value = value.trim();
                    if !value.is_empty() {
                        expected_tag_categories.insert(value.to_string(), category.to_string());
                    }
                }
            }
        }
    }
    let work_categories = [("thm", "剧情"), ("atb", "属性"), ("scn", "场景"), ("std", "制作")];
    for (key, category) in work_categories {
        if let Some(values) = tag.as_ref().and_then(|tags| tags.get(key)) {
            for value in values {
                let value = value.trim();
                if !value.is_empty() {
                    expected_tag_categories.insert(value.to_string(), category.to_string());
                }
            }
        }
    }
    if let Some(characters) = characters {
        for value in characters.values() {
            let value = value.trim();
            if !value.is_empty() {
                expected_tag_categories.insert(value.to_string(), "人物".to_string());
            }
        }
    }
    let expected_tags: HashSet<String> = expected_tag_categories.into_keys().collect();
    let db_tags: HashSet<String> = conn
        .prepare(
            "SELECT t.Name FROM WorkTags wt
             JOIN Tags t ON t.Id=wt.TagId WHERE wt.WorkId=?1",
        )
        .map_err(|e| e.to_string())?
        .query_map(params![work_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(db_tags == expected_tags)
}

fn console_item(
    work_id: Option<i64>,
    title: String,
    folder_path: String,
    status: String,
    new_episode_numbers: Vec<i32>,
    can_update: bool,
) -> LibraryConsoleItem {
    LibraryConsoleItem {
        work_id,
        title,
        folder_path,
        status,
        new_episode_numbers,
        can_update,
    }
}

#[tauri::command]
fn get_library_console_summary(
    root_path: String,
    db: State<Database>,
) -> Result<LibraryConsoleSummary, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    library_console_summary(&conn, Path::new(&root_path))
}

#[tauri::command]
fn scan_library_changes(
    root_path: String,
    db: State<Database>,
) -> Result<LibraryConsoleScanResult, String> {
    let root = Path::new(&root_path);
    let dirs = library_work_dirs(root)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let summary = library_console_summary(&conn, root)?;
    let existing: Vec<(i64, String, String)> = conn
        .prepare("SELECT Id, Title, FolderPath FROM Works")
        .map_err(|e| e.to_string())?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();
    let existing_by_path: HashMap<String, (i64, String, String)> = existing
        .iter()
        .cloned()
        .map(|item| (item.2.to_lowercase(), item))
        .collect();
    let mut seen = HashSet::new();
    let mut result = LibraryConsoleScanResult {
        summary,
        ..Default::default()
    };

    for dir in dirs {
        let folder_path = dir.to_string_lossy().to_string();
        let key = folder_path.to_lowercase();
        let folder_title = dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();
        let Some((work_id, db_title, _)) = existing_by_path.get(&key) else {
            let missing = archive_missing_reasons(&folder_path);
            if missing.is_empty() {
                result.new_complete_works.push(console_item(
                    None,
                    folder_title,
                    folder_path,
                    "建档完整，可以导入".to_string(),
                    Vec::new(),
                    true,
                ));
            }
            continue;
        };
        seen.insert(*work_id);

        let videos = match collect_numbered_video_paths(&dir) {
            Ok(videos) => videos,
            Err(error) => {
                result.attention_works.push(console_item(
                    Some(*work_id),
                    db_title.clone(),
                    folder_path,
                    error,
                    Vec::new(),
                    false,
                ));
                continue;
            }
        };
        let disk_videos: HashMap<i32, String> = videos
            .iter()
            .filter_map(|path| {
                episode_number_from_path(path)
                    .map(|number| (number, path.to_string_lossy().to_string()))
            })
            .collect();
        let database_videos: HashMap<i32, String> = conn
            .prepare("SELECT Number, VideoPath FROM Episodes WHERE WorkId=?1")
            .map_err(|e| e.to_string())?
            .query_map(params![work_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        let disk_numbers: HashSet<i32> = disk_videos.keys().copied().collect();
        let db_numbers: HashSet<i32> = database_videos.keys().copied().collect();
        let mut new_numbers: Vec<i32> = disk_numbers.difference(&db_numbers).copied().collect();
        new_numbers.sort_unstable();
        if !new_numbers.is_empty() {
            result.new_episode_works.push(console_item(
                Some(*work_id),
                db_title.clone(),
                folder_path,
                format!("发现 {} 个新增视频", new_numbers.len()),
                new_numbers,
                false,
            ));
            continue;
        }
        let mut missing_numbers: Vec<i32> = db_numbers.difference(&disk_numbers).copied().collect();
        missing_numbers.sort_unstable();
        if !missing_numbers.is_empty() {
            result.attention_works.push(console_item(
                Some(*work_id),
                db_title.clone(),
                folder_path,
                format!(
                    "缺少已入库视频：{}",
                    missing_numbers
                        .iter()
                        .map(|number| format!("#{}", number))
                        .collect::<Vec<_>>()
                        .join("、")
                ),
                Vec::new(),
                false,
            ));
            continue;
        }
        let changed_numbers = changed_video_numbers(&disk_videos, &database_videos);
        if !changed_numbers.is_empty() {
            result.changed_works.push(console_item(
                Some(*work_id),
                db_title.clone(),
                folder_path,
                format!(
                    "视频格式或路径有变化：{}",
                    changed_numbers
                        .iter()
                        .map(|number| format!("#{}", number))
                        .collect::<Vec<_>>()
                        .join("、")
                ),
                Vec::new(),
                true,
            ));
            continue;
        }

        let current_meta = meta_signature(&dir);
        if current_meta.is_empty() {
            result.attention_works.push(console_item(
                Some(*work_id),
                db_title.clone(),
                folder_path,
                "缺少或无法读取 data/meta.json".to_string(),
                Vec::new(),
                false,
            ));
            continue;
        }
        let current_cover = cover_signature(&dir);
        let snapshot = conn
            .query_row(
                "SELECT MetaSignature, CoverSignature FROM LibrarySnapshots WHERE WorkId=?1",
                params![work_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .ok();
        if let Some((old_meta, old_cover)) = snapshot {
            let meta_changed = old_meta != current_meta;
            let cover_changed = old_cover != current_cover;
            if meta_changed || cover_changed {
                let status = match (meta_changed, cover_changed) {
                    (true, true) => "元数据和封面有变化",
                    (true, false) => "元数据有变化",
                    (false, true) => "封面有变化",
                    _ => unreachable!(),
                };
                result.changed_works.push(console_item(
                    Some(*work_id),
                    db_title.clone(),
                    folder_path,
                    status.to_string(),
                    Vec::new(),
                    true,
                ));
            }
        } else {
            match semantic_meta_matches_database(&conn, *work_id, &dir) {
                Ok(true) => save_library_snapshot(&conn, *work_id, &folder_path)?,
                Ok(false) => result.changed_works.push(console_item(
                    Some(*work_id),
                    db_title.clone(),
                    folder_path,
                    "元数据有变化".to_string(),
                    Vec::new(),
                    true,
                )),
                Err(error) => result.attention_works.push(console_item(
                    Some(*work_id),
                    db_title.clone(),
                    folder_path,
                    error,
                    Vec::new(),
                    false,
                )),
            }
        }
    }

    for (work_id, title, folder_path) in existing {
        if !seen.contains(&work_id) && !Path::new(&folder_path).exists() {
            result.attention_works.push(console_item(
                Some(work_id),
                title,
                folder_path,
                "作品目录不存在".to_string(),
                Vec::new(),
                false,
            ));
        }
    }
    Ok(result)
}

#[tauri::command]
fn apply_library_updates(folders: Vec<String>, db: State<Database>) -> Result<i32, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    for folder in &folders {
        let missing = archive_missing_reasons(folder);
        if !missing.is_empty() {
            return Err(format!("{}: {}", folder, missing.join("、")));
        }
        let work_id = import_work_dir(&transaction, folder)?;
        save_library_snapshot(&transaction, work_id, folder)?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(folders.len() as i32)
}

#[cfg(test)]
mod library_console_video_path_tests {
    use super::changed_video_numbers;
    use std::collections::HashMap;

    #[test]
    fn detects_extension_or_filename_changes_for_the_same_episode_number() {
        let disk = HashMap::from([
            (1, r"D:\Media\Work\Work #1.mp4".to_string()),
            (2, r"D:\Media\Work\Renamed #2.mp4".to_string()),
        ]);
        let database = HashMap::from([
            (1, r"D:\Media\Work\Work #1.mkv".to_string()),
            (2, r"D:\Media\Work\Work #2.mp4".to_string()),
        ]);
        assert_eq!(changed_video_numbers(&disk, &database), vec![1, 2]);
    }

    #[test]
    fn ignores_windows_case_and_separator_differences() {
        let disk = HashMap::from([(1, r"D:\Media\Work\Work #1.mp4".to_string())]);
        let database = HashMap::from([(1, "d:/media/work/work #1.mp4".to_string())]);
        assert!(changed_video_numbers(&disk, &database).is_empty());
    }
}

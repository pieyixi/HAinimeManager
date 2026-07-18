#[tauri::command]
fn get_work_detail(work_id: i64, db: State<Database>) -> Result<WorkDetail, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get work
    let work = conn.query_row(
        "SELECT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath,
                (SELECT COUNT(*) FROM Episodes WHERE WorkId = w.Id) as EpisodeCount
         FROM Works w WHERE w.Id = ?1",
        params![work_id],
        |row| Ok(Work {
            id: row.get(0)?,
            title: row.get(1)?,
            year: row.get(2)?,
            month: row.get(3)?,
            studio: row.get(4)?,
            description: row.get(5)?,
            cover_path: row.get(6)?,
            folder_path: row.get(7)?,
            episode_count: row.get(8)?,
        })
    ).map_err(|e| e.to_string())?;

    // Get episodes
    let mut ep_stmt = conn.prepare(
        "SELECT Id, WorkId, Number, Title, VideoPath, CoverPath FROM Episodes WHERE WorkId = ?1 ORDER BY Number"
    ).map_err(|e| e.to_string())?;

    let mut episodes: Vec<Episode> = ep_stmt
        .query_map(params![work_id], |row| {
            Ok(Episode {
                id: row.get(0)?,
                work_id: row.get(1)?,
                number: row.get(2)?,
                title: row.get(3)?,
                video_path: row.get(4)?,
                cover_path: row.get(5)?,
                release_date: None,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // Release dates belong to individual entries in data/meta.json. The database
    // intentionally keeps only the first date for library ordering, so hydrate
    // the detail view from the canonical metadata file.
    let meta_path = std::path::Path::new(&work.folder_path).join("data").join("meta.json");
    let mut characters: Vec<String> = Vec::new();
    if let Ok(content) = std::fs::read_to_string(meta_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            let release_dates: std::collections::HashMap<i32, String> = json
                .get("episode_list")
                .and_then(|list| list.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|item| {
                            let id = item.get("id")?.as_i64()? as i32;
                            let date = item.get("release_date")?.as_str()?.trim();
                            (!date.is_empty()).then(|| (id, date.to_string()))
                        })
                        .collect()
                })
                .unwrap_or_default();
            for episode in &mut episodes {
                episode.release_date = release_dates.get(&episode.number).cloned();
            }

            characters = json
                .get("characters")
                .and_then(|chars| chars.as_object())
                .map(|chars| {
                    let mut ordered: Vec<(i32, String)> = chars
                        .iter()
                        .filter_map(|(key, value)| {
                            let index = key.parse::<i32>().ok()?;
                            let name = value.as_str()?.trim();
                            (!name.is_empty()).then(|| (index, name.to_string()))
                        })
                        .collect();
                    ordered.sort_by_key(|(index, _)| *index);
                    ordered.into_iter().map(|(_, name)| name).collect()
                })
                .unwrap_or_default();
        }
    }

    // Get tags
    let mut tag_stmt = conn
        .prepare(
            "SELECT t.Id, t.Name, t.Category FROM Tags t
         INNER JOIN WorkTags wt ON t.Id = wt.TagId
         WHERE wt.WorkId = ?1 ORDER BY t.Category, t.Name",
        )
        .map_err(|e| e.to_string())?;

    let tags = tag_stmt
        .query_map(params![work_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(WorkDetail {
        work,
        episodes,
        tags,
        characters,
    })
}

#[tauri::command]
fn get_tags(db: State<Database>) -> Result<Vec<Tag>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT Id, Name, Category FROM Tags ORDER BY Category, Name")
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

#[tauri::command]
fn get_all_works_with_tags(db: State<Database>) -> Result<Vec<WorkWithTags>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath,
                (SELECT COUNT(*) FROM Episodes WHERE WorkId = w.Id) as EpisodeCount
         FROM Works w ORDER BY w.UpdatedAt DESC"
    ).map_err(|e| e.to_string())?;

    let works: Vec<(
        i64,
        String,
        i32,
        i32,
        String,
        Option<String>,
        Option<String>,
        String,
        i64,
    )> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut tag_stmt = conn
        .prepare(
            "SELECT wt.WorkId, t.Id, t.Name, t.Category FROM Tags t
         INNER JOIN WorkTags wt ON t.Id = wt.TagId ORDER BY t.Category, t.Name",
        )
        .map_err(|e| e.to_string())?;

    let tag_rows: Vec<(i64, i64, String, String)> = tag_stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut tags_map: std::collections::HashMap<i64, Vec<Tag>> = std::collections::HashMap::new();
    for (work_id, tag_id, name, category) in tag_rows {
        tags_map.entry(work_id).or_default().push(Tag {
            id: tag_id,
            name,
            category,
        });
    }

    let result: Vec<WorkWithTags> = works
        .into_iter()
        .filter(|(_, _, _, _, _, _, _, folder_path, _)| is_archive_complete(folder_path))
        .map(
            |(
                id,
                title,
                year,
                month,
                studio,
                description,
                cover_path,
                folder_path,
                episode_count,
            )| {
                WorkWithTags {
                    id,
                    title,
                    year,
                    month,
                    studio,
                    description,
                    cover_path,
                    folder_path,
                    episode_count,
                    tags: tags_map.remove(&id).unwrap_or_default(),
                }
            },
        )
        .collect();

    Ok(result)
}

#[tauri::command]
fn scan_folder(root_path: String, db: State<Database>) -> Result<Vec<String>, String> {
    let path = std::path::Path::new(&root_path);
    if !path.exists() {
        return Err("路径不存在".to_string());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT FolderPath FROM Works")
        .map_err(|e| e.to_string())?;
    let existing: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|p| p.to_lowercase())
        .collect();

    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let dir_path = entry.path();
            // Check if dir has videos OR has data/ subdir
            let has_video = std::fs::read_dir(&dir_path)
                .ok()
                .map(|entries| {
                    entries.flatten().any(|e| {
                        e.path().is_file() && {
                            let ext = e
                                .path()
                                .extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_lowercase();
                            matches!(
                                ext.as_str(),
                                "mp4" | "mkv" | "avi" | "wmv" | "flv" | "mov" | "webm"
                            )
                        }
                    })
                })
                .unwrap_or(false);
            let archive_complete = is_archive_complete(&dir_path.to_string_lossy());

            if has_video && archive_complete {
                // Return FULL PATH, not just name
                let folder = dir_path.to_string_lossy().to_string();
                if !existing.iter().any(|p| p == &folder.to_lowercase()) {
                    found.push(folder);
                }
            }
        }
    }
    Ok(found)
}

#[tauri::command]
fn import_work_via_json(dir_path: String, db: State<Database>) -> Result<i64, String> {
    let missing = archive_missing_reasons(&dir_path);
    if !missing.is_empty() {
        return Err(format!("建档未完整: {}", missing.join("、")));
    }
    let d = db.conn.lock().map_err(|e| e.to_string())?;
    import_work_dir(&d, &dir_path)
}

#[tauri::command]
fn delete_work(work_id: i64, db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM WorkTags WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM Episodes WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM Works WHERE Id = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("打开文件夹失败: {}", e))?;
    Ok(())
}


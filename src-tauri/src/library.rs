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
        .prepare(
            "SELECT t.Id, t.Name, t.Category
             FROM Tags t
             WHERE EXISTS (
                 SELECT 1 FROM WorkTags wt WHERE wt.TagId = t.Id
             )
             ORDER BY t.Category, t.Name",
        )
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

fn imported_work_is_available(
    conn: &Connection,
    work_id: i64,
    folder_path: &str,
    cover_path: Option<&str>,
) -> bool {
    if !std::path::Path::new(folder_path).is_dir()
        || !cover_path
            .map(|path| std::path::Path::new(path).is_file())
            .unwrap_or(false)
    {
        return false;
    }
    let Ok(mut statement) = conn.prepare(
        "SELECT VideoPath, CoverPath FROM Episodes WHERE WorkId=?1 ORDER BY Number",
    ) else {
        return false;
    };
    let Ok(rows) = statement.query_map(params![work_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
    }) else {
        return false;
    };
    let episodes: Vec<(String, Option<String>)> = rows.filter_map(Result::ok).collect();
    !episodes.is_empty()
        && episodes.iter().all(|(video, cover)| {
            std::path::Path::new(video).is_file()
                && cover
                    .as_deref()
                    .map(|path| std::path::Path::new(path).is_file())
                    .unwrap_or(false)
        })
}

fn read_favorite_characters(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare("SELECT CharacterName FROM FavoriteCharacters ORDER BY CharacterName COLLATE NOCASE")
        .map_err(|e| e.to_string())?;
    let favorites = statement
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(favorites)
}

fn write_character_favorite(
    conn: &rusqlite::Connection,
    character_name: &str,
    favorite: bool,
) -> Result<Vec<String>, String> {
    let name = character_name.trim();
    if name.is_empty() {
        return Err("角色名不能为空".to_string());
    }
    if favorite {
        conn.execute(
            "INSERT OR IGNORE INTO FavoriteCharacters (CharacterName) VALUES (?1)",
            params![name],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "DELETE FROM FavoriteCharacters WHERE CharacterName = ?1",
            params![name],
        )
        .map_err(|e| e.to_string())?;
    }
    read_favorite_characters(conn)
}

#[tauri::command]
fn get_favorite_characters(db: State<Database>) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    read_favorite_characters(&conn)
}

#[tauri::command]
fn set_character_favorite(
    character_name: String,
    favorite: bool,
    db: State<Database>,
) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    write_character_favorite(&conn, &character_name, favorite)
}

#[tauri::command]
fn get_all_works_with_tags(db: State<Database>) -> Result<Vec<WorkWithTags>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath, w.SearchAliases,
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
                row.get(9)?,
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
        .filter(|(id, _, _, _, _, _, cover_path, folder_path, _, _)| {
            imported_work_is_available(&conn, *id, folder_path, cover_path.as_deref())
        })
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
                search_aliases,
                episode_count,
            )| {
                let release_dates = read_work_release_months(&folder_path, year, month);
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
                    release_dates,
                    search_aliases: serde_json::from_str(&search_aliases).unwrap_or_default(),
                    tags: tags_map.remove(&id).unwrap_or_default(),
                }
            },
        )
        .collect();

    Ok(result)
}

#[tauri::command]
fn import_work_via_json(dir_path: String, db: State<Database>) -> Result<i64, String> {
    let missing = archive_missing_reasons(&dir_path);
    if !missing.is_empty() {
        return Err(format!("建档未完整: {}", missing.join("、")));
    }
    let d = db.conn.lock().map_err(|e| e.to_string())?;
    let work_id = import_work_dir(&d, &dir_path)?;
    save_library_snapshot(&d, work_id, &dir_path)?;
    Ok(work_id)
}

fn read_work_release_months(folder_path: &str, fallback_year: i32, fallback_month: i32) -> Vec<String> {
    let meta_path = std::path::Path::new(folder_path).join("data").join("meta.json");
    let mut months = std::fs::read_to_string(meta_path)
        .ok()
        .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .and_then(|json| json.get("episode_list").and_then(|list| list.as_array()).cloned())
        .map(|list| {
            list.into_iter()
                .filter_map(|item| {
                    let date = item.get("release_date")?.as_str()?.trim();
                    let mut parts = date.split('-');
                    let year = parts.next()?.parse::<i32>().ok()?;
                    let month = parts.next()?.parse::<u32>().ok()?;
                    (1..=12)
                        .contains(&month)
                        .then(|| format!("{year:04}-{month:02}"))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut seen = std::collections::HashSet::new();
    months.retain(|month| seen.insert(month.clone()));
    if months.is_empty() {
        months.push(format!("{fallback_year:04}-{fallback_month:02}"));
    }
    months
}

fn delete_work_record(conn: &mut rusqlite::Connection, work_id: i64) -> Result<bool, String> {
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM LibrarySnapshots WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM WorkTags WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM Episodes WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    let deleted = transaction
        .execute("DELETE FROM Works WHERE Id = ?1", params![work_id])
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(deleted > 0)
}

#[tauri::command]
fn delete_work(work_id: i64, db: State<Database>) -> Result<(), String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    if !delete_work_record(&mut conn, work_id)? {
        return Err("数据库中不存在该作品".to_string());
    }
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

#[cfg(test)]
mod imported_work_visibility_tests {
    use super::imported_work_is_available;
    use rusqlite::{params, Connection};

    #[test]
    fn ignores_extra_unimported_videos_when_existing_assets_are_present() {
        let root = std::env::temp_dir().join(format!(
            "hanime-manager-visible-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("data")).unwrap();
        let cover = root.join("data/cover.jpg");
        let episode_cover = root.join("data/cover_ep1.jpg");
        let imported_video = root.join("title #1.mp4");
        let extra_video = root.join("title #2.mp4");
        for path in [&cover, &episode_cover, &imported_video, &extra_video] {
            std::fs::write(path, b"test").unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Episodes (
                Id INTEGER PRIMARY KEY,
                WorkId INTEGER NOT NULL,
                Number INTEGER NOT NULL,
                VideoPath TEXT NOT NULL,
                CoverPath TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Episodes (WorkId, Number, VideoPath, CoverPath) VALUES (1, 1, ?1, ?2)",
            params![
                imported_video.to_string_lossy().to_string(),
                episode_cover.to_string_lossy().to_string()
            ],
        )
        .unwrap();

        assert!(imported_work_is_available(
            &conn,
            1,
            &root.to_string_lossy(),
            Some(&cover.to_string_lossy())
        ));
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod delete_work_record_tests {
    use super::delete_work_record;
    use rusqlite::Connection;

    #[test]
    fn removes_only_the_database_graph_for_the_selected_work() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Works (Id INTEGER PRIMARY KEY, Title TEXT NOT NULL);
             CREATE TABLE Episodes (Id INTEGER PRIMARY KEY, WorkId INTEGER NOT NULL);
             CREATE TABLE WorkTags (WorkId INTEGER NOT NULL, TagId INTEGER NOT NULL);
             CREATE TABLE LibrarySnapshots (WorkId INTEGER PRIMARY KEY, MetaSignature TEXT NOT NULL);
             INSERT INTO Works VALUES (1, 'removed'), (2, 'kept');
             INSERT INTO Episodes VALUES (10, 1), (20, 2);
             INSERT INTO WorkTags VALUES (1, 100), (2, 200);
             INSERT INTO LibrarySnapshots VALUES (1, 'old'), (2, 'kept');",
        )
        .unwrap();

        assert!(delete_work_record(&mut conn, 1).unwrap());
        for table in ["Works", "Episodes", "WorkTags", "LibrarySnapshots"] {
            let removed: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {}=1", if table == "Works" { "Id" } else { "WorkId" }),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(removed, 0, "{table} still contains the deleted work");
        }
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM Works WHERE Id=2", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        assert!(!delete_work_record(&mut conn, 999).unwrap());
    }
}

#[cfg(test)]
mod favorite_character_tests {
    use super::{read_favorite_characters, write_character_favorite};
    use rusqlite::Connection;

    #[test]
    fn toggles_unique_character_names_without_touching_library_metadata() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE FavoriteCharacters (
                CharacterName TEXT PRIMARY KEY,
                CreatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );",
        )
        .unwrap();

        assert_eq!(write_character_favorite(&conn, "  枫  ", true).unwrap(), vec!["枫"]);
        assert_eq!(write_character_favorite(&conn, "枫", true).unwrap(), vec!["枫"]);
        assert_eq!(write_character_favorite(&conn, "铃", true).unwrap(), vec!["枫", "铃"]);
        assert_eq!(write_character_favorite(&conn, "枫", false).unwrap(), vec!["铃"]);
        assert_eq!(read_favorite_characters(&conn).unwrap(), vec!["铃"]);
    }
}


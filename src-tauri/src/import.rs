/// Import a work from a directory following the standard format:
///   dir/data/meta.json, dir/data/cover.jpg, dir/data/cover_epN.png, dir/作品名 #N.mp4
fn import_work_dir(conn: &Connection, dir_path: &str) -> Result<i64, String> {
    let path = std::path::Path::new(dir_path);
    if !path.is_dir() {
        return Err("不是目录".to_string());
    }
    let existing_id = conn
        .query_row(
            "SELECT Id FROM Works WHERE lower(FolderPath) = lower(?1) LIMIT 1",
            params![dir_path],
            |r| r.get::<_, i64>(0),
        )
        .ok();
    let dir_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let data_dir = path.join("data");

    // Find JSON: data/meta.json, data/作品名.json, 作品名.json
    let json_path = {
        let candidates = [
            data_dir.join("meta.json"),
            data_dir.join(format!("{}.json", dir_name)),
            path.join(format!("{}.json", dir_name)),
        ];
        candidates.iter().find(|p| p.exists()).cloned()
    };

    let (title, studio, synopsis, tag_map, episode_list, characters, release) =
        if let Some(jp) = json_path {
            let content = std::fs::read_to_string(&jp).map_err(|e| format!("读JSON失败: {}", e))?;
            let m: WorkMeta =
                serde_json::from_str(&content).map_err(|e| format!("解析JSON失败: {}", e))?;
            (
                m.title,
                m.studio.unwrap_or_default(),
                m.synopsis.unwrap_or_default(),
                m.tag.unwrap_or_default(),
                m.episode_list.unwrap_or_default(),
                m.characters,
                m.release,
            )
        } else {
            (
                dir_name.clone(),
                String::new(),
                String::new(),
                std::collections::HashMap::new(),
                Vec::new(),
                None,
                None,
            )
        };

    // Determine release date from episode_list or top-level release
    let (year, month) = if !episode_list.is_empty() {
        if let Some(first) = episode_list.first() {
            if let Some(ref rd) = first.release_date {
                let parts: Vec<&str> = rd.splitn(2, '-').collect();
                (
                    parts.first().and_then(|s| s.parse().ok()).unwrap_or(2024),
                    parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(1),
                )
            } else {
                (2024, 1)
            }
        } else {
            (2024, 1)
        }
    } else if let Some(ref release) = release {
        parse_year_month(release).unwrap_or((2024, 1))
    } else {
        (2024, 1)
    };

    let videos = collect_numbered_video_paths(path)?;

    let work_id: i64 = if let Some(existing_id) = existing_id {
        conn.execute(
            "UPDATE Works SET Title=?1,Year=?2,Month=?3,Studio=?4,Description=?5,FolderPath=?6,CoverPath=NULL,UpdatedAt=datetime('now','localtime') WHERE Id=?7",
            params![title, year, month, studio, synopsis, dir_path, existing_id],
        ).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM WorkTags WHERE WorkId=?1", params![existing_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM Episodes WHERE WorkId=?1", params![existing_id])
            .map_err(|e| e.to_string())?;
        existing_id
    } else {
        conn.execute("INSERT INTO Works (Title,Year,Month,Studio,Description,FolderPath) VALUES (?1,?2,?3,?4,?5,?6)",
            params![title, year, month, studio, synopsis, dir_path]).map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };

    for (i, vpath) in videos.iter().enumerate() {
        let num = (i + 1) as i32;
        let ep_meta = episode_list
            .iter()
            .find(|e| e.id == Some(num))
            .or_else(|| episode_list.get(i));
        let subtitle = ep_meta
            .and_then(|e| e.subtitle.clone())
            .unwrap_or_default();
        let ep_title = if subtitle.is_empty() {
            format!("第{}集", num)
        } else {
            subtitle
        };
        conn.execute(
            "INSERT INTO Episodes (WorkId,Number,Title,VideoPath) VALUES (?1,?2,?3,?4)",
            params![work_id, num, ep_title, vpath.to_string_lossy().to_string()],
        )
        .map_err(|e| e.to_string())?;
        let ep_id: i64 = conn.last_insert_rowid();

        if let Some(cover_path) = find_import_cover(&data_dir, &dir_name, &format!("cover_ep{}", num)) {
            conn.execute(
                "UPDATE Episodes SET CoverPath=?1 WHERE Id=?2",
                params![cover_path, ep_id],
            )
            .ok();
        }

        // Episode-level tags (theme->剧情, attribute->属性, scene->场景)
        if let Some(ep_meta) = ep_meta {
            if let Some(ref ep_tags) = ep_meta.tags {
                let ep_cat_map = [("theme", "剧情"), ("attribute", "属性"), ("scene", "场景")];
                for (key, category) in &ep_cat_map {
                    if let Some(tags) = ep_tags.get(*key) {
                        for tn in tags {
                            let n = tn.trim();
                            if n.is_empty() {
                                continue;
                            }
                            // Episode tags are stored as work tags (simplified)
                            conn.execute(
                                "INSERT OR IGNORE INTO Tags (Name, Category) VALUES (?1, ?2)",
                                params![n, category],
                            )
                            .ok();
                            if let Ok(tid) = conn.query_row(
                                "SELECT Id FROM Tags WHERE Name=?1",
                                params![n],
                                |r| r.get::<_, i64>(0),
                            ) {
                                conn.execute("INSERT OR IGNORE INTO WorkTags (WorkId, TagId) VALUES (?1, ?2)", params![work_id, tid]).ok();
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(cover_path) = find_import_cover(&data_dir, &dir_name, "cover") {
        conn.execute(
            "UPDATE Works SET CoverPath=?1 WHERE Id=?2",
            params![cover_path, work_id],
        )
        .ok();
    }

    // Work-level tags (thm->剧情, atb->属性, scn->场景, std->制作)
    let cat_map = [
        ("thm", "剧情"),
        ("atb", "属性"),
        ("scn", "场景"),
        ("std", "制作"),
    ];
    for (key, category) in &cat_map {
        if let Some(tags) = tag_map.get(*key) {
            for tn in tags {
                let n = tn.trim();
                if n.is_empty() {
                    continue;
                }
                conn.execute(
                    "INSERT OR IGNORE INTO Tags (Name, Category) VALUES (?1, ?2)",
                    params![n, category],
                )
                .ok();
                if let Ok(tid) =
                    conn.query_row("SELECT Id FROM Tags WHERE Name=?1", params![n], |r| {
                        r.get::<_, i64>(0)
                    })
                {
                    conn.execute(
                        "INSERT OR IGNORE INTO WorkTags (WorkId, TagId) VALUES (?1, ?2)",
                        params![work_id, tid],
                    )
                    .ok();
                }
            }
        }
    }

    // Characters -> 人物 category
    if let Some(chars) = characters {
        for (_, name) in chars {
            let n = name.trim();
            if n.is_empty() {
                continue;
            }
            conn.execute(
                "INSERT OR IGNORE INTO Tags (Name, Category) VALUES (?1, '人物')",
                params![n],
            )
            .ok();
            if let Ok(tid) = conn.query_row("SELECT Id FROM Tags WHERE Name=?1", params![n], |r| {
                r.get::<_, i64>(0)
            }) {
                conn.execute(
                    "INSERT OR IGNORE INTO WorkTags (WorkId, TagId) VALUES (?1, ?2)",
                    params![work_id, tid],
                )
                .ok();
            }
        }
    }

    Ok(work_id)
}


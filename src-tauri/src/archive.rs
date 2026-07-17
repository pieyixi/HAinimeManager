fn is_video_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| {
            matches!(
                s.to_lowercase().as_str(),
                "mp4" | "mkv" | "avi" | "wmv" | "flv" | "mov" | "webm"
            )
        })
        .unwrap_or(false)
}

fn find_existing_cover(data_dir: &std::path::Path, stem: &str) -> Option<String> {
    for ext in ["jpg", "png", "jpeg", "webp"] {
        let p = data_dir.join(format!("{}.{}", stem, ext));
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

fn has_any_image(data_dir: &std::path::Path, stem: &str) -> bool {
    find_existing_cover(data_dir, stem).is_some()
}

fn value_non_empty_string(v: Option<&serde_json::Value>) -> bool {
    v.and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

fn value_non_empty_array(v: Option<&serde_json::Value>) -> bool {
    v.and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false)
}

fn value_string_vec(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn archive_missing_reasons(dir_path: &str) -> Vec<String> {
    let path = std::path::Path::new(dir_path);
    let data_dir = path.join("data");
    let meta_path = data_dir.join("meta.json");
    let mut reasons = Vec::new();

    if !data_dir.exists() {
        reasons.push("缺少 data 文件夹".to_string());
    }
    if !meta_path.exists() {
        reasons.push("缺少 data/meta.json".to_string());
        if !has_any_image(&data_dir, "cover") {
            reasons.push("缺少主封面".to_string());
        }
        let (video_count, _) = folder_video_stats(dir_path);
        for i in 1..=video_count {
            if !has_any_image(&data_dir, &format!("cover_ep{}", i)) {
                reasons.push(format!("缺少第{}集封面", i));
            }
        }
        return reasons;
    }

    let content = match std::fs::read_to_string(&meta_path) {
        Ok(content) => content,
        Err(_) => {
            reasons.push("meta.json 无法读取".to_string());
            return reasons;
        }
    };
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(json) => json,
        Err(_) => {
            reasons.push("meta.json 格式错误".to_string());
            return reasons;
        }
    };

    if !value_non_empty_string(json.get("title")) {
        reasons.push("缺少标题".to_string());
    }
    if !value_non_empty_string(json.get("studio")) {
        reasons.push("缺少制作商".to_string());
    }
    if !value_non_empty_string(json.get("synopsis")) {
        reasons.push("缺少简介".to_string());
    }
    let characters_complete = json
        .get("characters")
        .and_then(|v| v.as_object())
        .map(|m| {
            !m.is_empty()
                && m.values()
                    .any(|v| v.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false))
        })
        .unwrap_or(false);
    if !characters_complete {
        reasons.push("缺少女主/角色".to_string());
    }
    if !has_any_image(&data_dir, "cover") {
        reasons.push("缺少主封面".to_string());
    }

    let (video_count, _) = folder_video_stats(dir_path);
    let episodes = json.get("episode_list").and_then(|v| v.as_array());
    if episodes.map(|e| e.len()).unwrap_or(0) != video_count as usize {
        reasons.push("集数列表与视频数量不一致".to_string());
    }
    for i in 1..=video_count {
        if !has_any_image(&data_dir, &format!("cover_ep{}", i)) {
            reasons.push(format!("缺少第{}集封面", i));
        }
    }
    if let Some(episodes) = episodes {
        for (idx, ep) in episodes.iter().enumerate() {
            let n = idx + 1;
            if !value_non_empty_string(ep.get("release_date")) {
                reasons.push(format!("第{}集缺少发售时间", n));
            }
            let tags = ep.get("tags");
            let has_tags = value_non_empty_array(tags.and_then(|t| t.get("theme")))
                || value_non_empty_array(tags.and_then(|t| t.get("attribute")))
                || value_non_empty_array(tags.and_then(|t| t.get("scene")));
            if !has_tags {
                reasons.push(format!("第{}集缺少 Tag", n));
            }
        }
    }

    reasons
}

fn is_archive_complete(dir_path: &str) -> bool {
    archive_missing_reasons(dir_path).is_empty()
}

fn image_ext_from_data(data: &[u8]) -> &'static str {
    if data.len() > 3 && &data[0..3] == b"\xFF\xD8\xFF" {
        "jpg"
    } else if data.len() > 4 && &data[0..4] == b"\x89PNG" {
        "png"
    } else if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        "webp"
    } else {
        "jpg"
    }
}

fn decode_data_url(input: &str) -> Vec<u8> {
    let data = if input.contains(";base64,") {
        let idx = input.find(";base64,").unwrap_or(0) + 8;
        &input[idx..]
    } else {
        input
    };
    base64_decode(data)
}

fn base64_decode(input: &str) -> Vec<u8> {
    let input = input
        .trim()
        .replace('\n', "")
        .replace('\r', "")
        .replace(' ', "");
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(&input)
        .unwrap_or_default()
}

fn write_image_data(
    data_dir: &std::path::Path,
    stem: &str,
    image_data: &str,
) -> Result<String, String> {
    let data = decode_data_url(image_data);
    if data.is_empty() {
        return Err("图片数据为空或无法解码".to_string());
    }
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let ext = image_ext_from_data(&data);
    let out_path = data_dir.join(format!("{}.{}", stem, ext));
    remove_cover_alternates(data_dir, stem, &out_path);
    std::fs::write(&out_path, data).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

fn remove_cover_alternates(data_dir: &std::path::Path, stem: &str, keep_path: &std::path::Path) {
    for old_ext in ["jpg", "jpeg", "png", "webp"] {
        let old_path = data_dir.join(format!("{}.{}", stem, old_ext));
        if old_path != keep_path && old_path.exists() {
            let _ = std::fs::remove_file(old_path);
        }
    }
}

fn find_import_cover(
    data_dir: &std::path::Path,
    dir_name: &str,
    stem: &str,
) -> Option<String> {
    for ext in ["jpg", "jpeg", "png", "webp"] {
        for candidate in [
            data_dir.join(format!("{}.{}", stem, ext)),
            data_dir.join(format!("{}_{}.{}", dir_name, stem, ext)),
        ] {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn make_archive_draft(
    dir_path: &str,
    title_override: Option<String>,
) -> Result<ArchiveDraft, String> {
    let path = std::path::Path::new(dir_path);
    if !path.is_dir() {
        return Err("不是目录".to_string());
    }
    let dir_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let data_dir = path.join("data");

    let mut videos: Vec<_> = std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_video_file(p))
        .collect();
    videos.sort();

    let mut episode_list = videos
        .iter()
        .enumerate()
        .map(|(i, video)| {
            let id = (i + 1) as i32;
            ArchiveEpisodeDraft {
                id,
                subtitle: String::new(),
                release_date: String::new(),
                video_path: video.to_string_lossy().to_string(),
                cover_path: find_existing_cover(&data_dir, &format!("cover_ep{}", id)),
                tags: ArchiveEpisodeTags::default(),
            }
        })
        .collect::<Vec<_>>();

    let mut title = title_override
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| dir_name.clone());
    let mut studio = String::new();
    let mut synopsis = String::new();
    let mut characters = std::collections::HashMap::new();

    let meta_path = data_dir.join("meta.json");
    if let Ok(content) = std::fs::read_to_string(&meta_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if title == dir_name {
                if let Some(value) = json
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    title = value.to_string();
                }
            }
            if let Some(value) = json.get("studio").and_then(|v| v.as_str()) {
                studio = value.to_string();
            }
            if let Some(value) = json.get("synopsis").and_then(|v| v.as_str()) {
                synopsis = value.to_string();
            }
            if let Some(map) = json.get("characters").and_then(|v| v.as_object()) {
                for (key, value) in map {
                    if let Some(name) = value.as_str().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                        characters.insert(key.clone(), name.to_string());
                    }
                }
            }
            if let Some(existing_episodes) = json.get("episode_list").and_then(|v| v.as_array()) {
                for (idx, existing) in existing_episodes.iter().enumerate() {
                    if let Some(ep) = episode_list.get_mut(idx) {
                        if let Some(value) = existing.get("subtitle").and_then(|v| v.as_str()) {
                            ep.subtitle = value.to_string();
                        }
                        if let Some(value) = existing.get("release_date").and_then(|v| v.as_str()) {
                            ep.release_date = value.to_string();
                        }
                        let tags = existing.get("tags");
                        ep.tags = ArchiveEpisodeTags {
                            theme: value_string_vec(tags.and_then(|t| t.get("theme"))),
                            attribute: value_string_vec(tags.and_then(|t| t.get("attribute"))),
                            scene: value_string_vec(tags.and_then(|t| t.get("scene"))),
                        };
                    }
                }
            }
        }
    }

    Ok(ArchiveDraft {
        dir_path: dir_path.to_string(),
        title,
        episodes: episode_list.len() as i32,
        studio,
        synopsis,
        characters,
        episode_list,
        cover_path: find_existing_cover(&data_dir, "cover"),
        getchu_url: String::new(),
        hanime_url: String::new(),
    })
}

#[tauri::command]
fn inspect_archive_folder(dir_path: String, title: Option<String>) -> Result<ArchiveDraft, String> {
    make_archive_draft(&dir_path, title)
}

#[tauri::command]
fn save_archive_cover(input: ArchiveCoverSaveInput, db: State<Database>) -> Result<String, String> {
    let data_dir = std::path::Path::new(&input.dir_path).join("data");
    let stem = input
        .episode_id
        .map(|id| format!("cover_ep{}", id))
        .unwrap_or_else(|| "cover".to_string());
    let cover_path = write_image_data(&data_dir, &stem, &input.image_data)?;
    if let Ok(conn) = db.conn.lock() {
        if let Ok(work_id) = conn.query_row(
            "SELECT Id FROM Works WHERE lower(FolderPath) = lower(?1) LIMIT 1",
            params![input.dir_path],
            |r| r.get::<_, i64>(0),
        ) {
            if let Some(episode_number) = input.episode_id {
                conn.execute(
                    "UPDATE Episodes SET CoverPath=?1 WHERE WorkId=?2 AND Number=?3",
                    params![cover_path, work_id, episode_number],
                )
                .ok();
            } else {
                conn.execute(
                    "UPDATE Works SET CoverPath=?1, UpdatedAt=datetime('now','localtime') WHERE Id=?2",
                    params![cover_path, work_id],
                )
                .ok();
            }
        }
    }
    Ok(cover_path)
}

#[tauri::command]
fn save_archive_episode_covers(input: ArchiveEpisodeCoverSaveInput) -> Result<Vec<String>, String> {
    let data_dir = std::path::Path::new(&input.dir_path).join("data");
    let mut saved = Vec::new();
    for cover in &input.covers {
        saved.push(write_image_data(
            &data_dir,
            &format!("cover_ep{}", cover.id),
            &cover.image_data,
        )?);
    }
    Ok(saved)
}

#[tauri::command]
fn save_archive_draft(input: ArchiveSaveInput) -> Result<String, String> {
    let path = std::path::Path::new(&input.dir_path);
    if !path.is_dir() {
        return Err("不是目录".to_string());
    }
    let data_dir = path.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    if let Some(ref cover_data) = input.cover_data {
        write_image_data(&data_dir, "cover", cover_data)?;
    }

    let episode_list: Vec<ArchiveEpisodeMetaOutput> = input
        .episode_list
        .iter()
        .map(|ep| ArchiveEpisodeMetaOutput {
            id: ep.id,
            subtitle: ep.subtitle.clone(),
            release_date: ep.release_date.clone(),
            tags: ep.tags.clone(),
        })
        .collect();

    let json = ArchiveMetaOutput {
        title: input.title,
        episodes: episode_list.len(),
        characters: input.characters,
        studio: input.studio,
        synopsis: input.synopsis,
        episode_list,
    };

    let out_path = data_dir.join("meta.json");
    let json_str = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    std::fs::write(&out_path, json_str).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

fn validate_archive_meta_json(json: &serde_json::Value, dir_path: &str) -> Vec<String> {
    let mut reasons = Vec::new();
    if !json.is_object() {
        return vec!["根节点必须是 JSON 对象".to_string()];
    }
    if !value_non_empty_string(json.get("title")) {
        reasons.push("缺少 title".to_string());
    }
    if !value_non_empty_string(json.get("studio")) {
        reasons.push("缺少 studio".to_string());
    }
    if !value_non_empty_string(json.get("synopsis")) {
        reasons.push("缺少 synopsis".to_string());
    }
    let characters_complete = json
        .get("characters")
        .and_then(|v| v.as_object())
        .map(|m| {
            !m.is_empty()
                && m.values()
                    .any(|v| v.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false))
        })
        .unwrap_or(false);
    if !characters_complete {
        reasons.push("缺少 characters".to_string());
    }

    let episodes = json.get("episode_list").and_then(|v| v.as_array());
    if episodes.is_none() {
        reasons.push("缺少 episode_list 数组".to_string());
    }
    let episode_len = episodes.map(|e| e.len()).unwrap_or(0);
    if json
        .get("episodes")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        != Some(episode_len)
    {
        reasons.push("episodes 必须等于 episode_list 数量".to_string());
    }

    let (video_count, _) = folder_video_stats(dir_path);
    if video_count > 0 && episode_len != video_count as usize {
        reasons.push("episode_list 数量必须等于视频数量".to_string());
    }

    if let Some(episodes) = episodes {
        for (idx, ep) in episodes.iter().enumerate() {
            let n = idx + 1;
            if ep.get("id").and_then(|v| v.as_i64()).is_none() {
                reasons.push(format!("第{}集缺少 id", n));
            }
            if !value_non_empty_string(ep.get("release_date")) {
                reasons.push(format!("第{}集缺少 release_date", n));
            }
            let tags = ep.get("tags");
            let has_tags = value_non_empty_array(tags.and_then(|t| t.get("theme")))
                || value_non_empty_array(tags.and_then(|t| t.get("attribute")))
                || value_non_empty_array(tags.and_then(|t| t.get("scene")));
            if !has_tags {
                reasons.push(format!("第{}集缺少 tags", n));
            }
        }
    }

    reasons
}

#[tauri::command]
fn save_archive_json(dir_path: String, json_text: String) -> Result<String, String> {
    let path = std::path::Path::new(&dir_path);
    if !path.is_dir() {
        return Err("不是目录".to_string());
    }
    let json: serde_json::Value =
        serde_json::from_str(&json_text).map_err(|e| format!("JSON 格式错误: {}", e))?;
    let reasons = validate_archive_meta_json(&json, &dir_path);
    if !reasons.is_empty() {
        return Err(format!("JSON 不完整: {}", reasons.join("、")));
    }

    let data_dir = path.join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let out_path = data_dir.join("meta.json");
    std::fs::write(&out_path, format!("{}\n", json_text.trim())).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

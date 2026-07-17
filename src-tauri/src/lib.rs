use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

// ─── Data Models ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Work {
    pub id: i64,
    pub title: String,
    pub year: i32,
    pub month: i32,
    pub studio: String,
    pub description: Option<String>,
    pub cover_path: Option<String>,
    pub folder_path: String,
    pub episode_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Episode {
    pub id: i64,
    pub work_id: i64,
    pub number: i32,
    pub title: String,
    pub video_path: String,
    pub cover_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkWithTags {
    pub id: i64,
    pub title: String,
    pub year: i32,
    pub month: i32,
    pub studio: String,
    pub description: Option<String>,
    pub cover_path: Option<String>,
    pub folder_path: String,
    pub episode_count: i64,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkDetail {
    pub work: Work,
    pub episodes: Vec<Episode>,
    pub tags: Vec<Tag>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ArchiveEpisodeTags {
    pub theme: Vec<String>,
    pub attribute: Vec<String>,
    pub scene: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArchiveEpisodeDraft {
    pub id: i32,
    pub subtitle: String,
    pub release_date: String,
    pub video_path: String,
    pub cover_path: Option<String>,
    pub tags: ArchiveEpisodeTags,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArchiveDraft {
    pub dir_path: String,
    pub title: String,
    pub episodes: i32,
    pub studio: String,
    pub synopsis: String,
    pub characters: std::collections::HashMap<String, String>,
    pub episode_list: Vec<ArchiveEpisodeDraft>,
    pub cover_path: Option<String>,
    pub getchu_url: String,
    pub hanime_url: String,
}

#[derive(Debug, Deserialize)]
pub struct ArchiveSaveInput {
    pub dir_path: String,
    pub title: String,
    pub studio: String,
    pub synopsis: String,
    pub characters: std::collections::HashMap<String, String>,
    pub episode_list: Vec<ArchiveEpisodeDraft>,
    pub cover_data: Option<String>,
}

#[derive(Debug, Serialize)]
struct ArchiveEpisodeMetaOutput {
    id: i32,
    subtitle: String,
    release_date: String,
    tags: ArchiveEpisodeTags,
}

#[derive(Debug, Serialize)]
struct ArchiveMetaOutput {
    title: String,
    episodes: usize,
    characters: std::collections::HashMap<String, String>,
    studio: String,
    synopsis: String,
    episode_list: Vec<ArchiveEpisodeMetaOutput>,
}

#[derive(Debug, Deserialize)]
pub struct EpisodeCoverInput {
    pub id: i32,
    pub image_data: String,
}

#[derive(Debug, Deserialize)]
pub struct ArchiveEpisodeCoverSaveInput {
    pub dir_path: String,
    pub covers: Vec<EpisodeCoverInput>,
}

#[derive(Debug, Deserialize)]
pub struct ArchiveCoverSaveInput {
    pub dir_path: String,
    pub image_data: String,
    pub episode_id: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct CapturedFrameData {
    pub image_data: String,
}

#[derive(Debug, Serialize)]
pub struct CapturePath {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct ImageCandidate {
    pub source: String,
    pub url: String,
}

#[derive(Debug, Serialize, Default)]
pub struct ArchiveScrapeResult {
    pub title: Option<String>,
    pub release_date: Option<String>,
    pub studio: Option<String>,
    pub synopsis: Option<String>,
    pub cover_candidates: Vec<ImageCandidate>,
    pub raw_tags: Vec<String>,
    pub tags: ArchiveEpisodeTags,
}

#[derive(Debug, Serialize, Clone)]
pub struct DuplicateItem {
    pub title: String,
    pub folder_path: String,
    pub source: String,
    pub video_count: i32,
    pub total_size: u64,
}

#[derive(Debug, Serialize)]
pub struct DuplicateGroup {
    pub signature: String,
    pub items: Vec<DuplicateItem>,
}

#[derive(Debug, Serialize)]
pub struct UnarchivedFolder {
    pub title: String,
    pub folder_path: String,
    pub video_count: i32,
    pub has_data_dir: bool,
    pub has_meta_json: bool,
    pub missing_reasons: Vec<String>,
}

// ─── Test Set Format Import ───────────────────────────────

#[derive(Debug, Deserialize)]
struct EpisodeMeta {
    subtitle: Option<String>,
    release_date: Option<String>,
    tags: Option<std::collections::HashMap<String, Vec<String>>>,
}

#[derive(Debug, Deserialize)]
struct WorkMeta {
    title: String,
    release: Option<String>,
    studio: Option<String>,
    synopsis: Option<String>,
    characters: Option<std::collections::HashMap<String, String>>,
    tag: Option<std::collections::HashMap<String, Vec<String>>>,
    episode_list: Option<Vec<EpisodeMeta>>,
}

/// Import a work from a directory following the standard format:
///   dir/data/meta.json, dir/data/cover.jpg, dir/data/cover_epN.png, dir/作品名 #N.mp4
/// Also supports old format: dir/data/作品名.json, dir/data/作品名_cover.jpg
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

    // Scan videos
    let mut videos: Vec<_> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                let ext = p
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if matches!(
                    ext.as_str(),
                    "mp4" | "mkv" | "avi" | "wmv" | "flv" | "mov" | "webm"
                ) {
                    videos.push(p);
                }
            }
        }
    }
    videos.sort();

    for (i, vpath) in videos.iter().enumerate() {
        let num = (i + 1) as i32;
        // Get subtitle from episode_list if available
        let subtitle = episode_list
            .get(i)
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
        if let Some(ep_meta) = episode_list.get(i) {
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

#[derive(Serialize)]
struct MetaOutput {
    title: String,
    year: i32,
    month: i32,
    studio: String,
    synopsis: String,
    cover_path: Option<String>,
    tags: Vec<MetaTag>,
}

#[derive(Serialize)]
struct MetaTag {
    name: String,
    category: String,
}

#[tauri::command]
fn get_work_meta(work_id: i64, db: State<Database>) -> Result<MetaOutput, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let w = conn
        .query_row(
            "SELECT Title,Year,Month,Studio,Description,CoverPath FROM Works WHERE Id=?1",
            params![work_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i32>(1)?,
                    r.get::<_, i32>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT t.Name,t.Category FROM Tags t INNER JOIN WorkTags wt ON t.Id=wt.TagId WHERE wt.WorkId=?1").map_err(|e| e.to_string())?;
    let tags: Vec<MetaTag> = stmt
        .query_map(params![work_id], |r| {
            Ok(MetaTag {
                name: r.get(0)?,
                category: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(MetaOutput {
        title: w.0,
        year: w.1,
        month: w.2,
        studio: w.3,
        synopsis: w.4,
        cover_path: w.5,
        tags,
    })
}

#[tauri::command]
fn update_work_meta(
    work_id: i64,
    year: i32,
    month: i32,
    studio: String,
    synopsis: String,
    db: State<Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE Works SET Year=?1,Month=?2,Studio=?3,Description=?4 WHERE Id=?5",
        params![year, month, studio, synopsis, work_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn write_work_json(work_id: i64, db: State<Database>) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let (title, year, month, studio, synopsis, folder): (String, i32, i32, String, String, String) =
        conn.query_row(
            "SELECT Title,Year,Month,Studio,Description,FolderPath FROM Works WHERE Id=?1",
            params![work_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, String>(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let data_dir = std::path::Path::new(&folder).join("data");
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    // Get tags (if any)
    let mut stmt = conn.prepare("SELECT t.Name,t.Category FROM Tags t INNER JOIN WorkTags wt ON t.Id=wt.TagId WHERE wt.WorkId=?1")
        .map_err(|e| e.to_string())?;
    let mut tag_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let cat_rev = [
        ("剧情", "thm"),
        ("属性", "atb"),
        ("场景", "scn"),
        ("制作", "std"),
        ("人物", "character"),
    ];
    for row in stmt
        .query_map(params![work_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let key = cat_rev
            .iter()
            .find(|(c, _)| *c == row.1)
            .map(|(_, k)| k.to_string())
            .unwrap_or_else(|| row.1.clone());
        tag_map.entry(key).or_default().push(row.0);
    }

    let mut ep_stmt = conn
        .prepare("SELECT Number, Title FROM Episodes WHERE WorkId=?1 ORDER BY Number")
        .map_err(|e| e.to_string())?;
    let episode_list: Vec<serde_json::Value> = ep_stmt
        .query_map(params![work_id], |r| {
            Ok((r.get::<_, i32>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(number, title)| {
            serde_json::json!({
                "id": number,
                "subtitle": title,
                "release_date": format!("{:04}-{:02}", year, month),
                "tags": {}
            })
        })
        .collect();
    let ep_count = episode_list.len();

    let json = serde_json::json!({
        "title": title,
        "episodes": ep_count,
        "release": format!("{:04}-{:02}", year, month),
        "studio": studio,
        "synopsis": synopsis,
        "tag": tag_map,
        "episode_list": episode_list,
    });

    let json_str = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    let out_path = data_dir.join("meta.json");
    std::fs::write(&out_path, &json_str).map_err(|e| e.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

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

fn absolutize_url(base: &str, url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }
    if url.starts_with("//") {
        return format!("https:{}", url);
    }
    if url.starts_with('/') {
        if let Ok(parsed) = reqwest::Url::parse(base) {
            return format!(
                "{}://{}{}",
                parsed.scheme(),
                parsed.host_str().unwrap_or(""),
                url
            );
        }
    }
    reqwest::Url::parse(base)
        .and_then(|b| b.join(url))
        .map(|u| u.to_string())
        .unwrap_or_else(|_| url.to_string())
}

fn fetch_binary(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 HAnimeManager/1.0")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("请求失败: {}", resp.status()));
    }
    resp.bytes().map(|b| b.to_vec()).map_err(|e| e.to_string())
}

fn fetch_html(url: &str) -> Result<String, String> {
    let bytes = fetch_binary(url)?;
    if let Ok(text) = String::from_utf8(bytes.clone()) {
        return Ok(text);
    }
    let (decoded, _, had_errors) = encoding_rs::SHIFT_JIS.decode(&bytes);
    let sjis = decoded.to_string();
    if !had_errors && sjis.contains("<") {
        return Ok(sjis);
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn selector_text(doc: &scraper::Html, selector: &str) -> Option<String> {
    let sel = scraper::Selector::parse(selector).ok()?;
    doc.select(&sel)
        .next()
        .map(|el| el.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty())
}

fn selector_attr(doc: &scraper::Html, selector: &str, attr: &str) -> Option<String> {
    let sel = scraper::Selector::parse(selector).ok()?;
    doc.select(&sel)
        .next()
        .and_then(|el| el.value().attr(attr))
        .map(|s| s.to_string())
}

fn push_image_candidate(
    out: &mut Vec<ImageCandidate>,
    source: &str,
    base: &str,
    url: Option<String>,
) {
    if let Some(url) = url {
        let u = absolutize_url(base, url.trim());
        if !u.is_empty() && !out.iter().any(|c| c.url == u) {
            out.push(ImageCandidate {
                source: source.to_string(),
                url: u,
            });
        }
    }
}

fn clean_hanime_tag(tag: &str) -> Option<String> {
    let t = tag.trim().trim_matches('#').to_string();
    if t.is_empty() {
        return None;
    }
    let lower = t.to_lowercase();
    let blocked = [
        "1080p",
        "720p",
        "4k",
        "60fps",
        "中文字幕",
        "中文",
        "繁體中文",
        "字幕",
        "無碼",
        "无码",
        "uncensored",
        "hd",
        "fhd",
        "痴漢",
        "痴汉",
        "大屌",
        "巨根",
        "男",
        "大叔",
        "肥宅",
        "正太",
    ];
    if blocked.iter().any(|b| lower.contains(&b.to_lowercase())) {
        return None;
    }
    Some(t)
}

fn categorize_tags(tags: &[String]) -> ArchiveEpisodeTags {
    let mut result = ArchiveEpisodeTags::default();
    for tag in tags {
        let lower = tag.to_lowercase();
        let target = if [
            "學校",
            "学校",
            "教室",
            "校園",
            "校园",
            "公眾",
            "公众",
            "溫泉",
            "温泉",
            "職場",
            "办公室",
            "體操服",
            "泳裝",
            "泳装",
        ]
        .iter()
        .any(|k| lower.contains(&k.to_lowercase()))
        {
            &mut result.scene
        } else if [
            "巨乳", "貧乳", "贫乳", "黑絲", "黑丝", "眼鏡", "眼镜", "人妻", "jk", "蘿莉", "萝莉",
            "妹", "白虎",
        ]
        .iter()
        .any(|k| lower.contains(&k.to_lowercase()))
        {
            &mut result.attribute
        } else {
            &mut result.theme
        };
        if !target.iter().any(|t| t == tag) {
            target.push(tag.clone());
        }
    }
    result
}

fn scrape_page(url: &str, source: &str) -> Result<ArchiveScrapeResult, String> {
    let html = fetch_html(url)?;
    let doc = scraper::Html::parse_document(&html);
    let mut result = ArchiveScrapeResult::default();

    result.title = selector_attr(&doc, "meta[property='og:title']", "content")
        .or_else(|| selector_text(&doc, "h1"))
        .or_else(|| selector_text(&doc, "title"))
        .map(|s| {
            s.replace(" - Getchu.com", "")
                .replace(" | Hanime1.me", "")
                .trim()
                .to_string()
        });

    result.synopsis = selector_attr(&doc, "meta[name='description']", "content")
        .or_else(|| selector_attr(&doc, "meta[property='og:description']", "content"));

    push_image_candidate(
        &mut result.cover_candidates,
        source,
        url,
        selector_attr(&doc, "meta[property='og:image']", "content"),
    );
    push_image_candidate(
        &mut result.cover_candidates,
        source,
        url,
        selector_attr(&doc, "meta[name='twitter:image']", "content"),
    );
    push_image_candidate(
        &mut result.cover_candidates,
        source,
        url,
        selector_attr(&doc, "link[rel='image_src']", "href"),
    );

    if let Ok(sel) = scraper::Selector::parse("img") {
        for img in doc.select(&sel).take(20) {
            if let Some(src) = img.value().attr("src") {
                let lower = src.to_lowercase();
                if lower.contains("cover")
                    || lower.contains("package")
                    || lower.contains("img")
                    || source == "hanime1"
                {
                    push_image_candidate(
                        &mut result.cover_candidates,
                        source,
                        url,
                        Some(src.to_string()),
                    );
                }
            }
        }
    }

    if source == "hanime1" {
        if let Ok(sel) = scraper::Selector::parse("a") {
            for a in doc.select(&sel) {
                let href = a.value().attr("href").unwrap_or("").to_lowercase();
                let text = a.text().collect::<Vec<_>>().join("").trim().to_string();
                if (href.contains("tag") || href.contains("search") || href.contains("genre"))
                    && !text.is_empty()
                {
                    if let Some(tag) = clean_hanime_tag(&text) {
                        if !result.raw_tags.iter().any(|t| t == &tag) {
                            result.raw_tags.push(tag);
                        }
                    }
                }
            }
        }
        if result.raw_tags.is_empty() {
            if let Some(keywords) = selector_attr(&doc, "meta[name='keywords']", "content") {
                for item in keywords.split(',') {
                    if let Some(tag) = clean_hanime_tag(item) {
                        if !result.raw_tags.iter().any(|t| t == &tag) {
                            result.raw_tags.push(tag);
                        }
                    }
                }
            }
        }
        result.tags = categorize_tags(&result.raw_tags);
    }

    if source == "getchu" {
        let text = doc.root_element().text().collect::<Vec<_>>().join("\n");
        for line in text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            if result.release_date.is_none()
                && (line.contains("発売日") || line.contains("発売予定"))
            {
                result.release_date = Some(
                    line.replace("発売日", "")
                        .replace("発売予定", "")
                        .trim()
                        .to_string(),
                );
            }
            if result.studio.is_none() && (line.contains("ブランド") || line.contains("メーカー"))
            {
                result.studio = Some(
                    line.replace("ブランド", "")
                        .replace("メーカー", "")
                        .trim()
                        .to_string(),
                );
            }
        }
    }

    Ok(result)
}

#[tauri::command]
fn scrape_archive_sources(
    getchu_url: Option<String>,
    hanime_url: Option<String>,
) -> Result<ArchiveScrapeResult, String> {
    let mut merged = ArchiveScrapeResult::default();
    if let Some(url) = getchu_url.filter(|u| !u.trim().is_empty()) {
        if let Ok(getchu) = scrape_page(&url, "getchu") {
            merged.title = getchu.title;
            merged.release_date = getchu.release_date;
            merged.studio = getchu.studio;
            merged.synopsis = getchu.synopsis;
            merged.cover_candidates.extend(getchu.cover_candidates);
        }
    }
    if let Some(url) = hanime_url.filter(|u| !u.trim().is_empty()) {
        if let Ok(hanime) = scrape_page(&url, "hanime1") {
            if merged.title.is_none() {
                merged.title = hanime.title;
            }
            if merged.synopsis.is_none() {
                merged.synopsis = hanime.synopsis;
            }
            merged.cover_candidates.extend(hanime.cover_candidates);
            merged.raw_tags = hanime.raw_tags;
            merged.tags = hanime.tags;
        }
    }
    Ok(merged)
}

fn normalize_title_for_duplicate(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| {
            !c.is_whitespace() && !matches!(c, '-' | '_' | '[' | ']' | '(' | ')' | '（' | '）')
        })
        .collect()
}

fn folder_video_stats(folder_path: &str) -> (i32, u64) {
    let mut count = 0;
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(folder_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() && is_video_file(&p) {
                count += 1;
                total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            }
        }
    }
    (count, total)
}

fn duplicate_signature(title: &str, video_count: i32, total_size: u64) -> String {
    let normalized = normalize_title_for_duplicate(title);
    let size_bucket = if total_size > 0 {
        total_size / 1_048_576
    } else {
        0
    };
    format!("{}|{}|{}", normalized, video_count, size_bucket)
}

#[tauri::command]
fn detect_duplicates(
    root_path: String,
    db: State<Database>,
) -> Result<Vec<DuplicateGroup>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut buckets: std::collections::HashMap<String, Vec<DuplicateItem>> =
        std::collections::HashMap::new();

    let mut stmt = conn
        .prepare("SELECT Title, FolderPath FROM Works")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        let (video_count, total_size) = folder_video_stats(&row.1);
        let signature = duplicate_signature(&row.0, video_count, total_size);
        buckets.entry(signature).or_default().push(DuplicateItem {
            title: row.0,
            folder_path: row.1,
            source: "数据库".to_string(),
            video_count,
            total_size,
        });
    }

    let root = std::path::Path::new(&root_path);
    if root.exists() {
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                let folder_path = p.to_string_lossy().to_string();
                let title = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                if title.is_empty() {
                    continue;
                }
                let (video_count, total_size) = folder_video_stats(&folder_path);
                if video_count <= 0 {
                    continue;
                }
                let signature = duplicate_signature(&title, video_count, total_size);
                let list = buckets.entry(signature).or_default();
                if !list
                    .iter()
                    .any(|item| item.folder_path.eq_ignore_ascii_case(&folder_path))
                {
                    list.push(DuplicateItem {
                        title,
                        folder_path,
                        source: "磁盘".to_string(),
                        video_count,
                        total_size,
                    });
                }
            }
        }
    }

    let mut groups: Vec<DuplicateGroup> = buckets
        .into_iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(signature, items)| DuplicateGroup { signature, items })
        .collect();
    groups.sort_by(|a, b| {
        b.items
            .len()
            .cmp(&a.items.len())
            .then_with(|| a.signature.cmp(&b.signature))
    });
    Ok(groups)
}

#[tauri::command]
fn list_unarchived_folders(root_path: String) -> Result<Vec<UnarchivedFolder>, String> {
    let root = std::path::Path::new(&root_path);
    if !root.exists() {
        return Err("路径不存在".to_string());
    }
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let folder_path = path.to_string_lossy().to_string();
            let title = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let (video_count, _) = folder_video_stats(&folder_path);
            if video_count <= 0 {
                continue;
            }
            let data_dir = path.join("data");
            let meta_json = data_dir.join("meta.json");
            let missing_reasons = archive_missing_reasons(&folder_path);
            if !missing_reasons.is_empty() {
                result.push(UnarchivedFolder {
                    title,
                    folder_path,
                    video_count,
                    has_data_dir: data_dir.exists(),
                    has_meta_json: meta_json.exists(),
                    missing_reasons,
                });
            }
        }
    }
    result.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(result)
}

// ─── Database ──────────────────────────────────────────────

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

fn portable_cache_dir(kind: &str) -> std::path::PathBuf {
    portable_app_dir().join("cache").join(kind)
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
        ("校园", "剧情"),
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

#[tauri::command]
fn get_works(db: State<Database>) -> Result<Vec<Work>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath,
                (SELECT COUNT(*) FROM Episodes WHERE WorkId = w.Id) as EpisodeCount
         FROM Works w ORDER BY w.UpdatedAt DESC"
    ).map_err(|e| e.to_string())?;

    let works = stmt
        .query_map([], |row| {
            Ok(Work {
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
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|w| is_archive_complete(&w.folder_path))
        .collect();

    Ok(works)
}

#[tauri::command]
fn search_works(keyword: String, db: State<Database>) -> Result<Vec<Work>, String> {
    if keyword.trim().is_empty() {
        return get_works(db);
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let kw = format!("%{}%", keyword.trim());
    let mut stmt = conn.prepare(
        "SELECT DISTINCT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath,
                (SELECT COUNT(*) FROM Episodes WHERE WorkId = w.Id) as EpisodeCount
         FROM Works w
         LEFT JOIN WorkTags wt ON w.Id = wt.WorkId
         LEFT JOIN Tags t ON wt.TagId = t.Id
         WHERE w.Title LIKE ?1 OR w.Studio LIKE ?1 OR w.Description LIKE ?1 OR t.Name LIKE ?1
         ORDER BY w.UpdatedAt DESC"
    ).map_err(|e| e.to_string())?;

    let works = stmt
        .query_map(params![kw], |row| {
            Ok(Work {
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
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|w| is_archive_complete(&w.folder_path))
        .collect();

    Ok(works)
}

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

    let episodes = ep_stmt
        .query_map(params![work_id], |row| {
            Ok(Episode {
                id: row.get(0)?,
                work_id: row.get(1)?,
                number: row.get(2)?,
                title: row.get(3)?,
                video_path: row.get(4)?,
                cover_path: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

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
fn get_works_sorted(sort_by: String, db: State<Database>) -> Result<Vec<Work>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let order = match sort_by.as_str() {
        "title" => "w.Title ASC",
        "year_desc" => "w.Year DESC, w.Month DESC",
        "year_asc" => "w.Year ASC, w.Month ASC",
        "studio" => "w.Studio ASC, w.Title ASC",
        _ => "w.UpdatedAt DESC",
    };
    let sql = format!(
        "SELECT w.Id, w.Title, w.Year, w.Month, w.Studio, w.Description, w.CoverPath, w.FolderPath,
                (SELECT COUNT(*) FROM Episodes WHERE WorkId = w.Id) as EpisodeCount
         FROM Works w ORDER BY {}",
        order
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let works = stmt
        .query_map([], |row| {
            Ok(Work {
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
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .filter(|w| is_archive_complete(&w.folder_path))
        .collect();
    Ok(works)
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
fn update_work_tags(
    work_id: i64,
    tag_names: Vec<String>,
    db: State<Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Remove all existing tag associations
    conn.execute("DELETE FROM WorkTags WHERE WorkId = ?1", params![work_id])
        .map_err(|e| e.to_string())?;

    // Insert new tags
    for name in &tag_names {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        // Insert tag if not exists, get its id
        conn.execute(
            "INSERT OR IGNORE INTO Tags (Name, Category) VALUES (?1, '')",
            params![name],
        )
        .map_err(|e| e.to_string())?;
        let tag_id: i64 = conn
            .query_row("SELECT Id FROM Tags WHERE Name = ?1", params![name], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO WorkTags (WorkId, TagId) VALUES (?1, ?2)",
            params![work_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn add_work(
    title: String,
    year: i32,
    month: i32,
    studio: String,
    description: Option<String>,
    folder_path: String,
    tag_names: Vec<String>,
    db: State<Database>,
) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO Works (Title, Year, Month, Studio, Description, FolderPath)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![title, year, month, studio, description, folder_path],
    )
    .map_err(|e| e.to_string())?;
    let work_id = conn.last_insert_rowid();

    // Scan folder for videos and create episodes
    if !folder_path.is_empty() {
        let path = std::path::Path::new(&folder_path);
        if path.exists() {
            let mut videos: Vec<_> = Vec::new();
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let ext = p
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        if matches!(
                            ext.as_str(),
                            "mp4" | "mkv" | "avi" | "wmv" | "flv" | "mov" | "webm"
                        ) {
                            videos.push(p);
                        }
                    }
                }
            }
            videos.sort();
            for (i, v) in videos.iter().enumerate() {
                let num = (i + 1) as i32;
                let title = format!("第{}集", num);
                let vpath = v.to_string_lossy().to_string();
                conn.execute(
                    "INSERT INTO Episodes (WorkId, Number, Title, VideoPath) VALUES (?1, ?2, ?3, ?4)",
                    params![work_id, num, title, vpath],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    // Attach tags
    for name in &tag_names {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR IGNORE INTO Tags (Name, Category) VALUES (?1, '')",
            params![name],
        )
        .map_err(|e| e.to_string())?;
        let tag_id: i64 = conn
            .query_row("SELECT Id FROM Tags WHERE Name = ?1", params![name], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO WorkTags (WorkId, TagId) VALUES (?1, ?2)",
            params![work_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(work_id)
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

#[tauri::command]
fn update_work_cover(
    work_id: i64,
    cover_data: String,
    db: State<Database>,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let cover_dir = portable_cache_dir("covers");
    std::fs::create_dir_all(&cover_dir).map_err(|e| e.to_string())?;

    // Decode base64 (remove data:image/...;base64, prefix if present)
    let data = if cover_data.contains(";base64,") {
        let idx = cover_data.find(";base64,").unwrap_or(0) + 8;
        base64_decode(&cover_data[idx..])
    } else {
        base64_decode(&cover_data)
    };

    let ext = if data.len() > 3 && &data[0..3] == b"\xFF\xD8\xFF" {
        "jpg"
    } else if data.len() > 4 && &data[0..4] == b"\x89PNG" {
        "png"
    } else {
        "jpg"
    };
    let filename = format!("work_{}.{}", work_id, ext);
    let path = cover_dir.join(&filename);
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;

    let cover_path = path.to_string_lossy().to_string();
    conn.execute(
        "UPDATE Works SET CoverPath=?1 WHERE Id=?2",
        params![cover_path, work_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(cover_path)
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

#[tauri::command]
fn update_episode_cover(
    episode_id: i64,
    cover_data: String,
    db: State<Database>,
) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let cover_dir = portable_cache_dir("episodes");
    std::fs::create_dir_all(&cover_dir).map_err(|e| e.to_string())?;

    let data = if cover_data.contains(";base64,") {
        let idx = cover_data.find(";base64,").unwrap_or(0) + 8;
        base64_decode(&cover_data[idx..])
    } else {
        base64_decode(&cover_data)
    };

    let ext = if data.len() > 3 && &data[0..3] == b"\xFF\xD8\xFF" {
        "jpg"
    } else if data.len() > 4 && &data[0..4] == b"\x89PNG" {
        "png"
    } else {
        "jpg"
    };
    let filename = format!("ep_{}.{}", episode_id, ext);
    let path = cover_dir.join(&filename);
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;

    let cover_path = path.to_string_lossy().to_string();
    conn.execute(
        "UPDATE Episodes SET CoverPath=?1 WHERE Id=?2",
        params![cover_path, episode_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(cover_path)
}

#[tauri::command]
fn prepare_temp_frame_capture() -> Result<CapturePath, String> {
    let dir = portable_app_dir().join("temp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(CapturePath {
        path: dir
            .join(format!(
                "mpv_frame_{}_{}.jpg",
                std::process::id(),
                chrono_like_millis()
            ))
            .to_string_lossy()
            .to_string(),
    })
}

#[tauri::command]
fn read_image_data(path: String) -> Result<CapturedFrameData, String> {
    use base64::Engine as _;
    let temp_path = std::path::PathBuf::from(path);
    if !temp_path.is_file() {
        return Err("图片文件不存在".to_string());
    }
    let data = std::fs::read(&temp_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&temp_path);
    Ok(CapturedFrameData {
        image_data: format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(data)
        ),
    })
}

fn chrono_like_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[tauri::command]
fn play_video(video_path: String) -> Result<(), String> {
    let player = std::env::var("POTPLAYER_PATH").unwrap_or_else(|_| {
        let paths = [
            r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            r"C:\Program Files\PotPlayer\PotPlayer.exe",
            r"C:\Program Files (x86)\PotPlayer\PotPlayer.exe",
        ];
        paths
            .iter()
            .find(|p| std::path::Path::new(p).exists())
            .map(|s| s.to_string())
            .unwrap_or_default()
    });

    if !player.is_empty() {
        std::process::Command::new(&player)
            .arg(&video_path)
            .spawn()
            .map_err(|e| format!("启动播放器失败: {}", e))?;
    } else {
        // Fallback: open with system default
        open::that(&video_path).map_err(|e| format!("打开文件失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn add_new_tag(name: String, category: String, db: State<Database>) -> Result<i64, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Tag名称不能为空".to_string());
    }
    conn.execute(
        "INSERT OR IGNORE INTO Tags (Name, Category) VALUES (?1, ?2)",
        params![name, category],
    )
    .map_err(|e| e.to_string())?;
    let id: i64 = conn
        .query_row("SELECT Id FROM Tags WHERE Name = ?1", params![name], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn delete_tag(tag_id: i64, db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM WorkTags WHERE TagId = ?1", params![tag_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM Tags WHERE Id = ?1", params![tag_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_tag(
    tag_id: i64,
    name: String,
    category: String,
    db: State<Database>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE Tags SET Name = ?1, Category = ?2 WHERE Id = ?3",
        params![name, category, tag_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_years(db: State<Database>) -> Result<Vec<i32>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT Year FROM Works ORDER BY Year DESC")
        .map_err(|e| e.to_string())?;
    let years = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(years)
}

#[tauri::command]
fn get_studios(db: State<Database>) -> Result<Vec<String>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT Studio FROM Works WHERE Studio != '' ORDER BY Studio")
        .map_err(|e| e.to_string())?;
    let studios = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(studios)
}

#[derive(Serialize)]
struct SyncResult {
    new_folders: Vec<String>,
    missing_works: Vec<Work>,
}

#[tauri::command]
fn sync_database(root_path: String, db: State<Database>) -> Result<SyncResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let path = std::path::Path::new(&root_path);
    let mut disk_folders = Vec::new();
    if path.exists() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let has = std::fs::read_dir(entry.path())
                        .ok()
                        .map(|e| {
                            e.flatten().any(|f| {
                                f.path().is_file()
                                    && f.path()
                                        .extension()
                                        .and_then(|e| e.to_str())
                                        .map(|s| {
                                            matches!(
                                                s.to_lowercase().as_str(),
                                                "mp4"
                                                    | "mkv"
                                                    | "avi"
                                                    | "wmv"
                                                    | "flv"
                                                    | "mov"
                                                    | "webm"
                                            )
                                        })
                                        .unwrap_or(false)
                            })
                        })
                        .unwrap_or(false);
                    let archive_complete = is_archive_complete(&entry.path().to_string_lossy());
                    if has && archive_complete {
                        disk_folders.push(entry.path().to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    let mut stmt = conn
        .prepare("SELECT FolderPath FROM Works")
        .map_err(|e| e.to_string())?;
    let db_folders: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    let new_folders: Vec<_> = disk_folders
        .iter()
        .filter(|d| !db_folders.iter().any(|b| b.eq_ignore_ascii_case(d)))
        .cloned()
        .collect();
    let mut missing = Vec::new();
    for fp in &db_folders {
        if !std::path::Path::new(fp).exists() {
            if let Ok(w) = conn.query_row(
                "SELECT Id,Title,Year,Month,Studio,Description,CoverPath,FolderPath,(SELECT COUNT(*) FROM Episodes WHERE WorkId=w.Id) FROM Works w WHERE FolderPath=?1",
                params![fp],
                |row| Ok(Work{id:row.get(0)?,title:row.get(1)?,year:row.get(2)?,month:row.get(3)?,studio:row.get(4)?,description:row.get(5)?,cover_path:row.get(6)?,folder_path:row.get(7)?,episode_count:row.get(8)?})
            ) { missing.push(w); }
        }
    }
    Ok(SyncResult {
        new_folders,
        missing_works: missing,
    })
}

#[tauri::command]
fn batch_import_folders(folders: Vec<String>, db: State<Database>) -> Result<i32, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut count = 0;
    for fp in folders {
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM Works", [], |r| r.get(0))
            .unwrap_or(0);
        import_work_dir(&conn, &fp)?;
        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM Works", [], |r| r.get(0))
            .unwrap_or(before);
        if after > before {
            count += 1;
        }
    }
    Ok(count)
}

#[tauri::command]
fn backup_database(backup_path: String, db: State<Database>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("VACUUM INTO ?1", params![backup_path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn restore_database(restore_path: String) -> Result<(), String> {
    let db_file = portable_app_dir().join("database.db");
    std::fs::copy(&restore_path, &db_file).map_err(|e| format!("恢复失败: {}", e))?;
    Ok(())
}

#[tauri::command]
fn load_cover_cache(cover_paths: Vec<String>) -> Result<Vec<(String, String)>, String> {
    use base64::Engine as _;
    let mut result = Vec::new();
    for path in &cover_paths {
        if let Ok(data) = std::fs::read(path) {
            let ext = if data.len() > 3 && &data[0..3] == b"\xFF\xD8\xFF" {
                "jpeg"
            } else if data.len() > 4 && &data[0..4] == b"\x89PNG" {
                "png"
            } else {
                "jpeg"
            };
            let b64 = format!(
                "data:image/{};base64,{}",
                ext,
                base64::engine::general_purpose::STANDARD.encode(&data)
            );
            result.push((path.clone(), b64));
        }
    }
    Ok(result)
}

// ─── App Entry ────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = init_db();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_libmpv::init())
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            get_works,
            get_works_sorted,
            get_all_works_with_tags,
            search_works,
            get_work_detail,
            get_tags,
            update_work_tags,
            add_work,
            scan_folder,
            add_new_tag,
            delete_tag,
            update_tag,
            delete_work,
            open_folder,
            get_years,
            get_studios,
            sync_database,
            batch_import_folders,
            update_work_cover,
            update_episode_cover,
            prepare_temp_frame_capture,
            read_image_data,
            backup_database,
            restore_database,
            load_cover_cache,
            import_work_via_json,
            inspect_archive_folder,
            save_archive_draft,
            save_archive_json,
            save_archive_cover,
            save_archive_episode_covers,
            scrape_archive_sources,
            detect_duplicates,
            list_unarchived_folders,
            get_work_meta,
            update_work_meta,
            write_work_json,
            play_video,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

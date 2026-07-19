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
    pub release_date: Option<String>,
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
    pub characters: Vec<String>,
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
    id: Option<i32>,
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

fn is_video_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| {
            matches!(
                s.to_lowercase().as_str(),
                "mp4" | "mkv" | "avi" | "wmv" | "flv" | "mov" | "webm" | "m4v"
            )
        })
        .unwrap_or(false)
}

fn episode_number_from_path(path: &std::path::Path) -> Option<i32> {
    let stem = path.file_stem()?.to_str()?;
    let mut found = None;
    for (idx, ch) in stem.char_indices() {
        if ch != '#' && ch != '＃' {
            continue;
        }
        let mut digits = String::new();
        for next in stem[idx + ch.len_utf8()..].chars() {
            if let Some(digit) = next.to_digit(10) {
                digits.push(char::from_digit(digit, 10).unwrap());
            } else if !digits.is_empty() {
                break;
            } else if !next.is_whitespace() {
                break;
            }
        }
        if !digits.is_empty() {
            found = digits.parse::<i32>().ok();
        }
    }
    found
}

fn display_file_name(path: &std::path::Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string()
}

fn collect_numbered_video_paths(path: &std::path::Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut videos: Vec<_> = std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_video_file(p))
        .collect();
    videos.sort();

    let mut numbered = Vec::new();
    let mut missing_number = Vec::new();
    let mut seen = std::collections::HashMap::<i32, Vec<String>>::new();
    for video in videos {
        if let Some(number) = episode_number_from_path(&video) {
            seen.entry(number).or_default().push(display_file_name(&video));
            numbered.push((number, video));
        } else {
            missing_number.push(display_file_name(&video));
        }
    }

    if !missing_number.is_empty() {
        return Err(format!(
            "视频文件名缺少 #数字 编号: {}",
            missing_number.join("、")
        ));
    }

    let duplicates: Vec<_> = seen
        .iter()
        .filter(|(_, names)| names.len() > 1)
        .map(|(number, names)| format!("#{}: {}", number, names.join("、")))
        .collect();
    if !duplicates.is_empty() {
        return Err(format!("视频集数编号重复: {}", duplicates.join("；")));
    }

    numbered.sort_by_key(|(number, path)| (*number, display_file_name(path)));
    let expected_count = numbered.len() as i32;
    for expected in 1..=expected_count {
        if !seen.contains_key(&expected) {
            return Err(format!("视频集数编号不连续，缺少 #{}", expected));
        }
    }

    Ok(numbered.into_iter().map(|(_, path)| path).collect())
}


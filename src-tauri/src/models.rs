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


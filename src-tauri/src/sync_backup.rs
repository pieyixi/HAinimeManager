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

struct ZipItem {
    name: String,
    data: Vec<u8>,
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn push_u16(buf: &mut Vec<u8>, value: u16) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn write_store_zip(path: &std::path::Path, items: Vec<ZipItem>) -> Result<(), String> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for item in items {
        let name = item.name.replace('\\', "/");
        let name_bytes = name.as_bytes();
        let offset = out.len() as u32;
        let crc = crc32(&item.data);
        let size = item.data.len() as u32;

        push_u32(&mut out, 0x0403_4b50);
        push_u16(&mut out, 20);
        push_u16(&mut out, 0);
        push_u16(&mut out, 0);
        push_u16(&mut out, 0);
        push_u16(&mut out, 0);
        push_u32(&mut out, crc);
        push_u32(&mut out, size);
        push_u32(&mut out, size);
        push_u16(&mut out, name_bytes.len() as u16);
        push_u16(&mut out, 0);
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(&item.data);

        push_u32(&mut central, 0x0201_4b50);
        push_u16(&mut central, 20);
        push_u16(&mut central, 20);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u32(&mut central, crc);
        push_u32(&mut central, size);
        push_u32(&mut central, size);
        push_u16(&mut central, name_bytes.len() as u16);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u32(&mut central, 0);
        push_u32(&mut central, offset);
        central.extend_from_slice(name_bytes);
    }

    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    let entry_count = {
        let mut count = 0u16;
        let mut idx = 0usize;
        while idx + 46 <= central.len() {
            let name_len = u16::from_le_bytes([central[idx + 28], central[idx + 29]]) as usize;
            let extra_len = u16::from_le_bytes([central[idx + 30], central[idx + 31]]) as usize;
            let comment_len = u16::from_le_bytes([central[idx + 32], central[idx + 33]]) as usize;
            idx += 46 + name_len + extra_len + comment_len;
            count = count.saturating_add(1);
        }
        count
    };
    out.extend_from_slice(&central);
    push_u32(&mut out, 0x0605_4b50);
    push_u16(&mut out, 0);
    push_u16(&mut out, 0);
    push_u16(&mut out, entry_count);
    push_u16(&mut out, entry_count);
    push_u32(&mut out, central_size);
    push_u32(&mut out, central_offset);
    push_u16(&mut out, 0);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, out).map_err(|e| e.to_string())
}

fn collect_non_video_files(
    root: &std::path::Path,
    dir: &std::path::Path,
    prefix: &str,
    items: &mut Vec<ZipItem>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_non_video_files(root, &path, prefix, items)?;
        } else if path.is_file() && !is_video_file(&path) {
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
            let name = format!("{}/{}", prefix, rel.to_string_lossy().replace('\\', "/"));
            let data = std::fs::read(&path).map_err(|e| e.to_string())?;
            items.push(ZipItem { name, data });
        }
    }
    Ok(())
}

#[tauri::command]
fn backup_data_package(backup_path: String, db: State<Database>) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let folders: Vec<String> = conn
        .prepare("SELECT DISTINCT FolderPath FROM Works")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut items = Vec::new();
    let temp_db = portable_app_dir().join("temp").join("backup-database.db");
    if let Some(parent) = temp_db.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    conn.execute("VACUUM INTO ?1", params![temp_db.to_string_lossy().to_string()])
        .map_err(|e| e.to_string())?;
    if let Ok(data) = std::fs::read(&temp_db) {
        items.push(ZipItem {
            name: "_hanime_manager/database.db".to_string(),
            data,
        });
    }
    let _ = std::fs::remove_file(&temp_db);

    for folder in folders {
        let root = std::path::Path::new(&folder);
        if !root.is_dir() {
            continue;
        }
        let name = root
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("unknown");
        collect_non_video_files(root, root, name, &mut items)?;
    }

    if items.is_empty() {
        return Err("没有可备份的资料文件".to_string());
    }
    let out_path = std::path::PathBuf::from(backup_path);
    write_store_zip(&out_path, items)?;
    Ok(out_path.to_string_lossy().to_string())
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


#[tauri::command]
fn batch_import_folders(folders: Vec<String>, db: State<Database>) -> Result<i32, String> {
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let mut count = 0;
    for fp in folders {
        let missing = archive_missing_reasons(&fp);
        if !missing.is_empty() {
            return Err(format!("{} 建档未完整: {}", fp, missing.join("、")));
        }
        let before: i64 = transaction
            .query_row("SELECT COUNT(*) FROM Works", [], |r| r.get(0))
            .unwrap_or(0);
        let work_id = import_work_dir(&transaction, &fp)?;
        save_library_snapshot(&transaction, work_id, &fp)?;
        let after: i64 = transaction
            .query_row("SELECT COUNT(*) FROM Works", [], |r| r.get(0))
            .unwrap_or(before);
        if after > before {
            count += 1;
        }
    }
    transaction.commit().map_err(|e| e.to_string())?;
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

fn push_u16(buf: &mut Vec<u8>, value: u16) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod zip_filename_tests {
    use super::{write_streaming_store_zip, BackupFile};

    #[test]
    fn marks_local_and_central_names_as_utf8() {
        let root = std::env::temp_dir().join(format!(
            "hanime-manager-utf8-zip-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("meta.json");
        let path = root.join("backup.zip");
        let name = "姉SUMMER！/data/meta.json";
        std::fs::write(&source, b"{}").unwrap();
        write_streaming_store_zip(
            &path,
            &[BackupFile {
                path: source,
                name: name.to_string(),
                size: 2,
            }],
            |_, _| {},
        )
        .unwrap();

        let data = std::fs::read(&path).unwrap();
        let local_flags = u16::from_le_bytes([data[6], data[7]]);
        let central_offset = data
            .windows(4)
            .position(|bytes| bytes == b"\x50\x4b\x01\x02")
            .unwrap();
        let central_flags =
            u16::from_le_bytes([data[central_offset + 8], data[central_offset + 9]]);

        assert_ne!(local_flags & 0x0800, 0);
        assert_ne!(central_flags & 0x0800, 0);
        assert!(data
            .windows(name.as_bytes().len())
            .any(|bytes| bytes == name.as_bytes()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn streams_files_with_progress_and_preserves_an_existing_backup_on_failure() {
        let root = std::env::temp_dir().join(format!(
            "hanime-manager-streaming-zip-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("meta.json");
        let output = root.join("backup.zip");
        std::fs::write(&source, br#"{"title":"test"}"#).unwrap();
        let files = vec![BackupFile {
            path: source.clone(),
            name: "作品/data/meta.json".to_string(),
            size: std::fs::metadata(&source).unwrap().len(),
        }];
        let mut progress = Vec::new();

        write_streaming_store_zip(&output, &files, |percent, _| progress.push(percent)).unwrap();
        let data = std::fs::read(&output).unwrap();
        assert_eq!(u16::from_le_bytes([data[6], data[7]]) & 0x0808, 0x0808);
        assert!(data.windows(4).any(|bytes| bytes == b"\x50\x4b\x07\x08"));
        assert!(data.windows(4).any(|bytes| bytes == b"\x50\x4b\x01\x02"));
        assert_eq!(progress.last(), Some(&98));

        let original = std::fs::read(&output).unwrap();
        let missing = vec![BackupFile {
            path: root.join("missing.json"),
            name: "missing.json".to_string(),
            size: 1,
        }];
        assert!(write_streaming_store_zip(&output, &missing, |_, _| {}).is_err());
        assert_eq!(std::fs::read(&output).unwrap(), original);
        assert!(!output.with_extension("zip.partial").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[derive(Clone, serde::Serialize)]
struct BackupProgressEvent {
    percent: u8,
    text: String,
}

struct BackupFile {
    path: std::path::PathBuf,
    name: String,
    size: u64,
}

struct ZipCentralEntry {
    name: String,
    crc: u32,
    size: u32,
    offset: u32,
}

fn emit_backup_progress(app: &tauri::AppHandle, percent: u8, text: impl Into<String>) {
    use tauri::Emitter as _;
    let _ = app.emit(
        "backup-data-package-progress",
        BackupProgressEvent {
            percent,
            text: text.into(),
        },
    );
}

fn collect_non_video_files(
    root: &std::path::Path,
    dir: &std::path::Path,
    prefix: &str,
    files: &mut Vec<BackupFile>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_non_video_files(root, &path, prefix, files)?;
        } else if path.is_file() && !is_video_file(&path) {
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
            let name = format!("{}/{}", prefix, rel.to_string_lossy().replace('\\', "/"));
            let size = entry.metadata().map_err(|e| e.to_string())?.len();
            if size > u32::MAX as u64 {
                return Err(format!("单个资料文件超过 4 GB，无法写入资料包: {}", path.display()));
            }
            files.push(BackupFile { path, name, size });
        }
    }
    Ok(())
}

fn write_streaming_store_zip(
    path: &std::path::Path,
    files: &[BackupFile],
    mut progress: impl FnMut(u8, String),
) -> Result<(), String> {
    use std::io::{Read as _, Write as _};

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let partial_path = path.with_extension("zip.partial");
    let result = (|| {
        let file = std::fs::File::create(&partial_path).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, file);
        let mut offset = 0u64;
        let total_bytes = files.iter().map(|file| file.size).sum::<u64>().max(1);
        let mut written_bytes = 0u64;
        let mut last_percent = 11u8;
        let mut central_entries = Vec::with_capacity(files.len());
        let mut buffer = vec![0u8; 1024 * 1024];

        for backup_file in files {
            if offset > u32::MAX as u64 {
                return Err("资料包超过 ZIP32 的 4 GB 上限".to_string());
            }
            let name = backup_file.name.replace('\\', "/");
            let name_bytes = name.as_bytes();
            if name_bytes.len() > u16::MAX as usize {
                return Err(format!("资料路径过长: {}", name));
            }
            let local_offset = offset as u32;
            let mut header = Vec::with_capacity(30 + name_bytes.len());
            push_u32(&mut header, 0x0403_4b50);
            push_u16(&mut header, 20);
            push_u16(&mut header, 0x0808);
            push_u16(&mut header, 0);
            push_u16(&mut header, 0);
            push_u16(&mut header, 0);
            push_u32(&mut header, 0);
            push_u32(&mut header, 0);
            push_u32(&mut header, 0);
            push_u16(&mut header, name_bytes.len() as u16);
            push_u16(&mut header, 0);
            header.extend_from_slice(name_bytes);
            writer.write_all(&header).map_err(|e| e.to_string())?;
            offset += header.len() as u64;

            let mut source = std::fs::File::open(&backup_file.path).map_err(|e| {
                format!("读取资料文件失败: {} ({})", backup_file.path.display(), e)
            })?;
            let mut crc = crc32fast::Hasher::new();
            let mut file_bytes = 0u64;
            loop {
                let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                writer.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
                crc.update(&buffer[..count]);
                file_bytes += count as u64;
                written_bytes += count as u64;
                offset += count as u64;
                let percent = 12 + ((written_bytes.saturating_mul(85) / total_bytes) as u8).min(85);
                if percent > last_percent {
                    last_percent = percent;
                    progress(
                        percent,
                        format!(
                            "正在写入资料文件 {}/{}",
                            central_entries.len() + 1,
                            files.len()
                        ),
                    );
                }
            }
            if file_bytes != backup_file.size {
                return Err(format!("备份时文件大小发生变化: {}", backup_file.path.display()));
            }
            let crc = crc.finalize();
            let size = file_bytes as u32;
            let mut descriptor = Vec::with_capacity(16);
            push_u32(&mut descriptor, 0x0807_4b50);
            push_u32(&mut descriptor, crc);
            push_u32(&mut descriptor, size);
            push_u32(&mut descriptor, size);
            writer.write_all(&descriptor).map_err(|e| e.to_string())?;
            offset += descriptor.len() as u64;
            central_entries.push(ZipCentralEntry {
                name,
                crc,
                size,
                offset: local_offset,
            });
        }

        if central_entries.len() > u16::MAX as usize || offset > u32::MAX as u64 {
            return Err("资料包超过 ZIP32 格式上限".to_string());
        }
        progress(98, "正在完成资料包索引".to_string());
        let central_offset = offset as u32;
        let mut central = Vec::new();
        for entry in &central_entries {
            let name_bytes = entry.name.as_bytes();
            push_u32(&mut central, 0x0201_4b50);
            push_u16(&mut central, 20);
            push_u16(&mut central, 20);
            push_u16(&mut central, 0x0808);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, entry.crc);
            push_u32(&mut central, entry.size);
            push_u32(&mut central, entry.size);
            push_u16(&mut central, name_bytes.len() as u16);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, 0);
            push_u32(&mut central, entry.offset);
            central.extend_from_slice(name_bytes);
        }
        if central.len() > u32::MAX as usize {
            return Err("资料包文件索引过大".to_string());
        }
        writer.write_all(&central).map_err(|e| e.to_string())?;
        let mut footer = Vec::with_capacity(22);
        push_u32(&mut footer, 0x0605_4b50);
        push_u16(&mut footer, 0);
        push_u16(&mut footer, 0);
        push_u16(&mut footer, central_entries.len() as u16);
        push_u16(&mut footer, central_entries.len() as u16);
        push_u32(&mut footer, central.len() as u32);
        push_u32(&mut footer, central_offset);
        push_u16(&mut footer, 0);
        writer.write_all(&footer).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&partial_path);
        return result;
    }
    let previous_path = path.with_extension("zip.previous");
    if previous_path.exists() {
        std::fs::remove_file(&previous_path).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        std::fs::rename(path, &previous_path).map_err(|e| e.to_string())?;
    }
    if let Err(error) = std::fs::rename(&partial_path, path) {
        if previous_path.exists() {
            let _ = std::fs::rename(&previous_path, path);
        }
        return Err(error.to_string());
    }
    let _ = std::fs::remove_file(previous_path);
    Ok(())
}

#[tauri::command]
async fn backup_data_package(
    backup_path: String,
    db: State<'_, Database>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    emit_backup_progress(&app, 2, "正在读取媒体库清单");
    let (folders, temp_db) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let folders = {
            let mut statement = conn
                .prepare("SELECT DISTINCT FolderPath FROM Works")
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|row| row.ok()).collect::<Vec<_>>()
        };

        emit_backup_progress(&app, 4, "正在生成数据库快照");
        let temp_db = portable_app_dir().join("temp").join("backup-database.db");
        if let Some(parent) = temp_db.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::remove_file(&temp_db);
        conn.execute(
            "VACUUM INTO ?1",
            params![temp_db.to_string_lossy().to_string()],
        )
        .map_err(|e| e.to_string())?;
        (folders, temp_db)
    };

    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let mut files = Vec::new();
            for (index, folder) in folders.iter().enumerate() {
                let root = std::path::Path::new(folder);
                if root.is_dir() {
                    let name = root
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("unknown");
                    collect_non_video_files(root, root, name, &mut files)?;
                }
                let percent = 5 + (((index + 1) * 6 / folders.len().max(1)) as u8).min(6);
                emit_backup_progress(
                    &app,
                    percent,
                    format!("正在清点资料文件 {}/{}", index + 1, folders.len()),
                );
            }
            if let Ok(metadata) = std::fs::metadata(&temp_db) {
                files.push(BackupFile {
                    path: temp_db.clone(),
                    name: "_hanime_manager/database.db".to_string(),
                    size: metadata.len(),
                });
            }
            if files.is_empty() {
                return Err("没有可备份的资料文件".to_string());
            }
            let out_path = std::path::PathBuf::from(backup_path);
            emit_backup_progress(&app, 12, format!("准备写入 {} 个资料文件", files.len()));
            write_streaming_store_zip(&out_path, &files, |percent, text| {
                emit_backup_progress(&app, percent, text)
            })?;
            emit_backup_progress(&app, 100, "资料包备份完成");
            Ok(out_path.to_string_lossy().to_string())
        })();
        let _ = std::fs::remove_file(&temp_db);
        result
    })
    .await
    .map_err(|error| error.to_string())?
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


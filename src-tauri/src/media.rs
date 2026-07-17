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

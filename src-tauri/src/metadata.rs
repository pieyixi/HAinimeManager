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

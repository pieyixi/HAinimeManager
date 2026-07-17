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

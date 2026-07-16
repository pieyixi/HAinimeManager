# 交接文档

## 项目

**Tauri 版本地里番管理器。**

项目位置：`D:\Code\LiFan\HAnimeManager-Tauri\`

---

## 现有代码

### 后端

`lib.rs` — Rust：

| 命令 | 说明 |
|------|------|
| `get_works_sorted(sort_by)` | 获取作品，支持排序 |
| `search_works(keyword)` | 搜索 |
| `get_work_detail(work_id)` | 详情（含集数、Tag） |
| `get_tags()` | 所有标签 |
| `get_years()` / `get_studios()` | 年份/制作商 |
| `scan_folder(root_path)` | 扫描目录 |
| `import_work_via_json(dir_path)` | 按 JSON 导入 |
| `load_cover_cache(cover_paths)` | 读取封面（返回 base64） |

编译环境：
```
D:\Envirnment\rust\rustup
D:\Envirnment\rust\cargo
D:\Envirnment\rust\cargo\bin;D:\Envirnment\msys2\mingw64\bin;%PATH%
npm run tauri build
```

### 前端（需要重写）

需要基于 `ui-prototype.html` 重写。
重写时将 mock 数据替换为 `window.__TAURI__.core.invoke` 调用即可。

`ui-prototype.html` — 完整 UI 原型。

---

## 数据格式（D:\HAnime\）

```
作品名\
  data\
    meta.json          ← 元数据
    cover.jpg          ← 作品封面
    cover_ep1.png      ← 第1集封面
    cover_ep2.png      ← 第2集封面
  作品名 #1.mp4        ← 视频
  作品名 #2.mp4
```

### meta.json

```json
{
  "title": "标题",
  "episodes": 2,
  "studio": "制作商",
  "synopsis": "简介",
  "characters": { "1": "角色名" },
  "episode_list": [{
    "id": 1,
    "subtitle": "副标题（可选）",
    "release_date": "2013-02",
    "tags": { "theme": ["剧情Tag"], "attribute": ["属性Tag"], "scene": ["场景Tag"] }
  }]
}
```

**Tag 分类：** `theme`→剧情、`attribute`→属性、`scene`→场景、`characters`→人物

---

## 原型 → Tauri 替换对照

| 原型中的 mock | 替换为 |
|---|---|
| `WORKS` 数组 | `invoke('get_works_sorted',{sortBy})` |
| `showDetail` 数据 | `invoke('get_work_detail',{work_id})` |
| 封面路径 | `invoke('load_cover_cache',{cover_paths:[path]})` |
| 筛选选项 | `invoke('get_tags')`, `get_years`, `get_studios` |
| 搜索 | `invoke('search_works',{keyword})` |
| 导入 | `invoke('scan_folder',{root_path})` + `import_work_via_json` |

## 不需要做的

- 增删改作品
- 用户系统、云同步
- 内置播放器（调 PotPlayer）

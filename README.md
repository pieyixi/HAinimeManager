# 本地里番管理器

这是一个 Tauri v2 本地媒体库管理工具，用来管理本地作品目录、`data/meta.json` 元数据、作品封面、每集封面和视频播放。当前正式便携版目录是：

```text
D:\Ark\hanime-manager-app
```

数据库默认放在软件本体旁边的 `database.db`，不是 C 盘。这个目录整体移动后，数据库、运行库和程序仍应跟着一起工作。

## 当前定位

软件的核心目标不是自动从网页判断作品信息，而是帮助整理已经在本地的视频：

- 主库只展示已经建档完整的作品。
- 未建档页面管理有视频但 `data/meta.json`、主封面或每集封面不完整的作品。
- 建档助手负责读取目录、编辑/粘贴 `meta.json`、拖入封面、保存并导入。
- 内置播放器使用 `libmpv`，支持 HEVC/MP4 等更稳定的本地播放和取帧。
- 旧的网页抓取、旧 tag 管理、旧详情页编辑信息、旧换封面入口已经删除。

## 目录结构

```text
.
├─ README.md
├─ src
│  ├─ index.html              # 页面骨架和脚本引用
│  ├─ styles.css              # 全局样式
│  └─ js
│     ├─ state.js             # Tauri invoke、全局状态、布局测量
│     ├─ navigation.js        # 页面切换、封面缓存、初始化
│     ├─ filters.js           # 筛选、排序、分页状态
│     ├─ detail.js            # 主库卡片、详情页渲染
│     ├─ player.js            # libmpv 播放器、进度、音量、取帧
│     ├─ archive.js           # 未建档和建档助手
│     ├─ settings.js          # 设置、扫描、同步、备份
│     └─ events.js            # DOM 事件绑定和启动入口
└─ src-tauri
   ├─ Cargo.toml              # Rust/Tauri 依赖
   ├─ tauri.conf.json         # Tauri 配置
   ├─ build.rs
   └─ src
      ├─ main.rs              # Tauri 程序入口
      ├─ lib.rs               # 后端源码汇总入口
      ├─ models.rs            # 数据结构
      ├─ database.rs          # 便携数据库路径、建表、迁移旧库
      ├─ import.rs            # 按标准目录导入作品
      ├─ library.rs           # 主库、详情、删除、扫描、打开文件夹
      ├─ archive.rs           # 未建档、建档助手、meta/封面保存
      ├─ duplicates.rs        # 查重
      ├─ media.rs             # 播放、取帧临时文件、年份/制作商
      ├─ sync_backup.rs       # 同步、批量导入、数据库/资料包备份
      └─ runtime.rs           # Tauri 命令注册
```

`lib.rs` 当前使用 `include!` 汇总各功能文件。这是为了先把原来的超大单文件拆开并降低重构风险；后续可以再改成真正的 Rust `mod` 模块。

## 作品目录规范

每个作品目录建议长这样：

```text
作品名\
  data\
    meta.json
    cover.jpg 或 cover.png
    cover_ep1.jpg/png/webp
    cover_ep2.jpg/png/webp
  作品名 #1.mp4
  作品名 #2.mp4
```

支持的视频扩展名主要包括：

```text
mp4, mkv, avi, wmv, flv, mov, webm
```

## meta.json 格式

当前判断建档完整时，除了副标题可为空，其他关键字段都要求完整。

```json
{
  "title": "作品标题",
  "episodes": 2,
  "characters": {
    "1": "第一角色",
    "2": "第二角色"
  },
  "studio": "制作商",
  "synopsis": "简介",
  "source": {
    "getchu": "",
    "hanime1": ""
  },
  "episode_list": [
    {
      "id": 1,
      "subtitle": "可为空",
      "release_date": "2026-05",
      "tags": {
        "theme": ["剧情Tag"],
        "attribute": ["属性Tag"],
        "scene": ["场景Tag"]
      }
    }
  ]
}
```

注意事项：

- `characters` 的键是番位顺序，详情页会严格按 `"1"`, `"2"`, `"3"` 排序。
- `episode_list[].release_date` 是逐集年份/月，详情页按集数顺序列出日期 tag。
- tag 输入支持中英文逗号、顿号、分号等分隔，但最终保存到 JSON 时应是数组。
- `subtitle` 是副标题，不是用来重复作品名或 `#1/#2` 的字段。

## 建档完整性

作品只有满足这些条件才进入主库：

- 目录中有视频。
- `data/meta.json` 存在且 JSON 格式正确。
- `title`、`studio`、`synopsis`、`characters`、`episode_list` 等关键字段完整。
- `episodes` 等于 `episode_list` 数量，并且数量等于视频数量。
- 每集有 `release_date` 和 tags。
- 主封面存在。
- 每集封面存在。

不完整的作品会留在“未建档”页面。

## 前端主要流程

前端是原生 HTML/CSS/JS，没有引入 Vue/React：

- `src/index.html` 只保留页面结构，不放大段 CSS/JS。
- `src/styles.css` 放全部样式。
- `src/js/*.js` 按功能拆分，但不是 ES module，仍按普通 `<script>` 顺序加载，所以函数会挂在全局，HTML 里的 `onclick` 能直接访问。
- 主库：加载 `get_all_works_with_tags`，前端本地搜索、排序、分页、筛选。
- 年份筛选：年份表示整年，月份表示精确月份。年份按钮的“当前展开”和“已筛选”是两个不同状态。
- 详情页：调用 `get_work_detail`，展示封面、简介、角色、制作商、tag、集数列表。
- 播放页：通过 `tauri-plugin-libmpv` 嵌入 mpv 播放视频。
- 取帧：播放器取帧后写入临时图片，再由后端读取为 base64，前端保存到建档流程。
- 未建档：调用 `list_unarchived_folders`。
- 建档助手：调用 `inspect_archive_folder`、`save_archive_draft`、`save_archive_json`、`save_archive_cover`、`save_archive_episode_covers`。

## 后端命令

当前 `runtime.rs` 注册的命令是实际前端使用的命令：

```text
get_all_works_with_tags
get_work_detail
get_tags
scan_folder
delete_work
open_folder
get_years
get_studios
sync_database
batch_import_folders
prepare_temp_frame_capture
read_image_data
backup_database
backup_data_package
restore_database
load_cover_cache
import_work_via_json
inspect_archive_folder
save_archive_draft
save_archive_json
save_archive_cover
save_archive_episode_covers
detect_duplicates
list_unarchived_folders
play_video
```

如果新增前端 `invoke(...)`，必须同步检查 `runtime.rs` 是否注册；如果删除 UI 入口，也要清掉后端命令，避免死代码堆积。

## 数据库与便携模式

`database.rs` 使用当前 exe 所在目录作为应用目录：

```text
hanime-manager.exe
hanime_manager_lib.dll
database.db
lib\
```

第一次启动时，如果便携目录没有 `database.db`，会尝试从旧的 AppData 目录迁移一次。之后以软件旁边的 `database.db` 为准。

不要把开发时的测试数据库复制到正式目录覆盖用户数据库。

## 播放器

当前播放器路线：

- Tauri 前端负责播放器 UI。
- `tauri-plugin-libmpv` / `libmpv` 负责真实播放和解码。
- 正式目录下需要保留 `lib\libmpv-2.dll` 和相关运行库。
- 旧 ffmpeg 截帧路线已删除。
- 旧外部播放器路线只作为 `play_video` 的系统打开兜底，不是主播放方案。

## 构建与检查

前端脚本检查：

```powershell
$html = Get-Content -Raw src\index.html
$script = [regex]::Match($html, '<script>([\s\S]*)</script>').Groups[1].Value
$script | node --check -
```

Rust 检查：

```powershell
D:\Envirnment\rust\cargo\bin\cargo.exe check --manifest-path src-tauri\Cargo.toml
```

release 构建必须用 Tauri 构建命令，单独 `cargo build --release` 不会把前端 HTML 打进程序：

```powershell
$env:Path = 'D:\Envirnment\rust\cargo\bin;D:\Envirnment\msys2\mingw64\bin;' + $env:Path
& C:\Users\翊兮\AppData\Roaming\npm\tauri.cmd build
```

构建产物：

```text
src-tauri\target\release\hanime-manager.exe
src-tauri\target\release\hanime_manager_lib.dll
```

发布到正式目录时，只覆盖 exe/dll，不覆盖 `database.db`：

```powershell
$releaseDir = 'D:\Ark\hanime-manager-app'
$exe = Join-Path $releaseDir 'hanime-manager.exe'
Get-Process hanime-manager -ErrorAction SilentlyContinue | Stop-Process -Force
Copy-Item src-tauri\target\release\hanime-manager.exe $exe -Force
Copy-Item src-tauri\target\release\hanime_manager_lib.dll (Join-Path $releaseDir 'hanime_manager_lib.dll') -Force
Start-Process -FilePath $exe
```

## 维护注意事项

- 不要重新引入网页自动抓取，当前产品路线是用户确认/粘贴/拖图/取帧。
- 不要把主库不完整作品强行展示出来，未建档页面就是缓冲区。
- 详情页按钮应保持克制，不再放“更换封面、编辑信息、删除”等破坏性入口。
- 右键删除只应在作品卡片上出现，主库空白右键只做刷新。
- 筛选下拉里 tag 区域可以滚动，但确认/清除按钮必须固定在滚动区域外。
- 大量作品时，分页数量由视口计算，不要写死 20 个。
- 正式版数据库在 `D:\Ark\hanime-manager-app\database.db`，开发时不要误删或覆盖。
- `src-tauri/target` 是编译产物，体积很大，能删但下次编译会重新生成。
- 每次大改后建议提交 git，当前项目已经用 git 作为回退点。

## 已删除的旧路线

这些不是遗漏，是刻意删除：

- getchu/hanime1 自动网页抓取。
- 旧 tag 管理页面和命令。
- 旧详情页编辑信息。
- 旧详情页换主封面/每集封面。
- ffmpeg 截帧链路。
- 根目录旧 `lib.rs` 和旧 UI 原型。

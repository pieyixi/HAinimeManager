# hanime1 源码清洗解析验证工具

这是一个独立验证工具，只放在 `clean` 目录下，不接入主项目。

用途：

- 读取 hanime1 搜索页 `Ctrl+U` 保存的 HTML。
- 读取 hanime1 详情页 `Ctrl+U` 保存的 HTML。
- 提取候选链接、标题、封面、制作商、发布日期、tag、本集封面、播放列表。
- 对 tag 做基础清洗：繁简统一、去掉字幕/清晰度类无用 tag、按 `theme / attribute / scene` 试分类。
- 输出 `parse-result.json`，方便检查字段是否能用于建档助手。

## 使用

在当前目录运行：

```powershell
node .\hanime1-cleaner.js
```

也可以指定输入目录和输出文件：

```powershell
node .\hanime1-cleaner.js D:\Code\LiFan-Tauri\clean D:\Code\LiFan-Tauri\clean\parse-result.json
```

## 输入

把 hanime1 页面 `Ctrl+U` 后保存成 `.html` 或 `.txt` 放到本目录。

支持两类页面：

- 搜索页：例如 `search?query=姉SUMMER！...`
- 详情页：例如 `watch?v=22524`

## 输出

`parse-result.json` 里主要有：

- `pages[]`：每个源码文件解析出的完整结果。
- `pages[].candidates`：搜索页候选。
- `pages[].playlist`：详情页里的同系列播放列表。
- `pages[].tags`：清洗分类后的 tag。
- `pages[].unknown_tags`：未识别分类的 tag，需要人工确认或补映射。
- `pages[].dropped_tags`：被过滤的无用 tag。
- `draft`：把详情页转换成建档草稿的初步结果。

## 注意

当前只是验证工具，不会写数据库，不会修改 `D:\HAnime`，也不会修改主项目代码。

tag 分类表在 `hanime1-cleaner.js` 顶部，后续可以慢慢补。未知 tag 不应该直接入库，应先人工确认。

## 油猴脚本

`hanime1-archive-queue.user.js` 是浏览器用的 Tampermonkey/油猴脚本。

使用方式：

1. 浏览器安装 Tampermonkey。
2. 新建脚本。
3. 把 `hanime1-archive-queue.user.js` 的内容粘贴进去保存。
4. 打开 `https://hanime1.me/watch?v=...` 详情页。
5. 页面右下角会出现“建档信息队列”面板。

功能：

- 自动提取当前详情页的标题行、日期行、制作商行、keywords tag 行。
- 点击“加入队列”后，按顺序生成 `第一话：`、`第二话：`。
- 队列保存在浏览器本地，切到下一集页面后还能继续追加。
- 点击“一键复制队列”复制全部集数信息。
- 点击“清空队列”删除浏览器里保存的当前队列。

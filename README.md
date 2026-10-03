# ExileGuide自制导航

一个纯静态的个人导航页：原生 HTML + CSS + JavaScript，数据以 YAML 维护，**零构建、零 CDN、无后端、无 API key**。改数据只需编辑 `data/sites.yml` 并提交。

![首页](assets/icon/icon.svg)

## 特性

- **首页大图标区**：所有标记 `pinned: true` 的站点，按 YAML 顺序汇总。
- **分类标签页**：点击标签切换，无刷新。
- **搜索引擎切换**：Google / 百度 / Bing 等，记住上次选择。
- **毛玻璃卡片**：统一 `backdrop-filter` 半透明质感，不支持时自动降级为半透明纯色。
- **背景与主题**：背景图、背景模糊、明暗主题全部收口在设置浮窗，支持「跟随系统」；主题在首屏绘制前由 head 内联脚本确定，深色模式不闪白。
- **站点图标降级链**：第三方聚合源 → 站点 `/favicon.ico` → 字母坞，全部失败也保证有精致兜底。
- **响应式**：CSS Grid 自适应列数，手机 375px 下布局不破。
- **滚轮切分类**：鼠标悬停在分类区时滚轮上下滚动即可切换标签页，纵向环形（末项向下回首页）。
- **站点说明 tooltip**：站点可配 `desc`，悬停卡片显示玻璃质感说明。

## 快速开始

页面通过 `fetch` 读取 YAML，**必须走 HTTP，不能直接双击打开 `index.html`**（`file://` 下会被浏览器拦截）：

```bash
python -m http.server 8765 --bind 127.0.0.1
```

然后访问 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)。

## 目录结构

```
/
├── index.html              # 唯一页面；结构与首屏主题脚本
├── css/style.css           # 全部样式，改观感只动这里
├── js/
│   ├── vendor/js-yaml.min.js   # YAML 解析（本地引入，不走 CDN）
│   ├── data.js             # 数据层：YAML → 归一化模型（无 DOM）
│   ├── icons.js            # 图标降级链 + 字母坞（纯函数，无 DOM）
│   ├── prefs.js            # localStorage 读写（无 DOM）
│   ├── ui.js               # UI 层：模型 → DOM，交互经 handlers 上报
│   └── app.js              # 组合根：接线、设置持久化
├── data/sites.yml          # 唯一数据源
├── tools/yaml-editor.html  # 可视化编辑 data/sites.yml（见「数据维护」）
├── assets/
│   ├── bg/                 # 背景图
│   └── icon/               # favicon / apple-touch-icon
└── docs/SRS.md             # 需求规格说明书（实现的唯一依据）
```

## 数据维护

所有导航内容都在 `data/sites.yml`，改完提交即生效。

不想手改 YAML 就用**可视化编辑器**：起本地服务后打开 [http://127.0.0.1:8765/tools/yaml-editor.html](http://127.0.0.1:8765/tools/yaml-editor.html)，或从首页左上齿轮 → 设置浮窗底部的「打开数据编辑器 ↗」进入。它会自动读取 `data/sites.yml`，表单化增删改分类/网站/引擎/背景，实时生成 YAML 并做校验（非法网址、搜索引擎缺少 `%s` 等会当场标红），支持「批量粘贴」（每行一个网址，名称和说明可省）、上下移动排序、一键保存回原文件或下载。YAML 预览区只读——表单是唯一事实源；保存时文件头部注释块会保留，行内手写注释不保留。（`file://` 直接双击打开时无法自动读取，用页面上的「打开 sites.yml」选文件即可。）

```yaml
settings:
  title: 我的导航                    # 页面标题
  background: assets/bg/dusk.svg     # 默认背景（仓库相对路径）
  bgBlur: true                       # 默认背景模糊

searchEngines:                        # 首个为默认，%s 为关键词占位符
  - { name: Google, url: "https://www.google.com/search?q=%s" }
  - { name: 百度,   url: "https://www.baidu.com/s?wd=%s" }

backgrounds:                          # 设置页可切换的候选背景
  - assets/bg/dusk.svg
  - assets/bg/ocean.svg
  
  - assets/bg/ink.svg

categories:
  - name: 开发
    sites:
      - name: MDN
        url: https://developer.mozilla.org
        pinned: true                  # 可选；true 则同时出现在首页大图标区
        desc: Web 文档权威参考        # 可选；悬停卡片以 tooltip 展示
```

维护约定：

- 加网站 = 在对应分类的 `sites` 下加一条，**不要**另建列表。
- 首页是分类数据的**派生视图**：`pinned: true` 的站点按分类顺序自动汇总到首页。
- `url` 仅接受 `http/https`，其它协议（`javascript:` 等）在归一化阶段直接丢弃。
- 单条数据格式不对只丢这一条，不会导致整页失败；YAML 整体语法错误会显示可读的错误提示。
- 新增背景：把图放进 `assets/bg/`，再把路径加进 `backgrounds` 列表。

## 架构分层

分层目的是让 UI 可以大规模重写而不动数据层。**层间契约 = 模型结构 + CSS 类名**。

| 文件            | 职责                                                                     | 禁止                        |
| --------------- | ------------------------------------------------------------------------ | --------------------------- |
| `js/data.js`  | YAML → 归一化模型                                                       | 任何 DOM 操作               |
| `js/icons.js` | 图标降级链、字母坞（纯函数）                                             | DOM                         |
| `js/prefs.js` | localStorage 读写                                                        | DOM                         |
| `js/ui.js`    | 模型 → DOM；有副作用的交互（搜索、引擎、设置）通过`handlers` 回调上报 | fetch / localStorage / YAML |
| `js/app.js`   | 组合根：接线 + 设置持久化                                                | 承载业务                    |

要点：

- **CSS 类名即接口**。`.site-card` / `.site-card--pinned` / `.site-icon` / `.site-tile` / `.site-name` / `.tab[aria-current]` / `.bg-thumb[aria-current]` 等，重写 UI 时请保持这些类名存在。
- **归一化模型**是 UI 层唯一依赖的数据结构（`settings` / `searchEngines` / `backgrounds` / `categories` / `pinned`）。
- **设置浮窗为草稿模式**：打开时拷贝当前生效值进草稿，浮窗内改动不影响页面；关闭（× / 应用并关闭 / 点遮罩 / Esc）时统一应用。

## 设置项

| 项       | 说明                                     |
| -------- | ---------------------------------------- |
| 背景     | 从`backgrounds` 候选中选一张           |
| 背景模糊 | 对背景层做模糊，默认取 YAML 的`bgBlur` |
| 主题     | 跟随系统 / 浅色 / 深色，默认跟随系统     |

优先级：**localStorage 覆盖 > YAML 默认值**。用户选择若与 YAML 默认一致，则**不写入** localStorage，避免日后改了 YAML 反被旧偏好盖住。所有设置合并存在单个 localStorage 键 `nav.settings`（JSON）里，只存覆盖字段。

所有设置项统一收口在设置浮窗，新增设置一律加进浮窗，不要在页面上散落开关。

## 部署

纯静态站点，把仓库根目录直接发布到 GitHub Pages 即可，push 即生效。

仓库当前**尚未初始化 git**。如需部署：

```bash
git init
git add -A && git commit -m "init"
git branch -M main
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

然后在仓库 Settings → Pages 中选择 `main` 分支、根目录 `/`。

> 注意：`data/sites.yml` 里若含自建服务的内网/公网地址（如 `http://<ip>:<port>/`），它们会随仓库一起公开，请自行确认是否适合公开托管。

## 浏览器支持

面向 Chrome / Edge / Firefox 近两个大版本，移动端可用。

- 目标为 ES2017 语法与 `fetch`；不支持 `backdrop-filter` 时卡片降级为半透明纯色，保证可读性。
- 站点说明 tooltip 的淡入效果使用 `display .15s allow-discrete`；旧浏览器忽略该增强声明，退化为直接显隐，不影响功能。

## 相关文档

- [`docs/SRS.md`](docs/SRS.md) —— 需求规格说明书：YAML Schema、FR/NFR 编号需求、验收清单、决策溯源表。改动前建议先对齐它。

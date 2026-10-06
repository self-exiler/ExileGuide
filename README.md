# ExileGuide自制导航

一个纯静态的个人导航站：原生 HTML + CSS + JavaScript，数据以 YAML 维护，**零构建、零 CDN、无后端、无 API key**。改数据只需编辑 `data/sites.yml` 并提交。桌面端是四页，滚轮整页翻动：**第 1 页导航 · 第 2 页大盘云图 · 第 3 页天气预报 · 第 4 页台风路径与警报**。

![首页](assets/icon/icon.svg)

## 特性

- **四页整页翻页（仅电脑）**：滚轮、`↑`/`↓`/`PageUp`/`PageDown`/`Home`/`End`、右侧圆点三种入口；页内内容超高时先滚内容、滚到底才翻页。手机和窄屏自动退回普通长页，四页纵向堆叠。
- **第 2 页 · 大盘云图**：自绘 squarified treemap，面积 = 市值占比、颜色 = 涨跌，行业 → 二级 → 个股三级；六个维度可切（涨跌幅 / 近一周 / 近一月 / 近一年 / 资金净流入 / 市盈率），12s 自动刷新，悬停看个股详情。数据直连金融界公开行情接口，无需 key、无代理。
- **第 3 页 · 天气预报**：当前温度/体感/湿度/风速/降水 + 未来 7 天（含降水概率条）+ 美标 AQI 与 PM2.5/PM10。城市来自 `data/sites.yml` 的预设列表，页头按城市切换（标签上带该城当前温度），**不做搜索**；每 10 分钟自动刷新，页头有手动刷新。数据源 Open-Meteo 匿名接口，无需 key、无代理；无论预设几座城市，一轮刷新只有 2 个请求。
- **第 4 页 · 台风路径与警报**：嵌入浙江省水利厅台风路径实时发布系统（地图 + 台风警报面板）。
- **首页大图标区**：所有标记 `pinned: true` 的站点，按 YAML 顺序汇总。
- **分类标签页**：点击标签切换，无刷新。
- **搜索引擎切换**：Google / 百度 / Bing 等，记住上次选择。
- **毛玻璃卡片**：统一 `backdrop-filter` 半透明质感，不支持时自动降级为半透明纯色。
- **背景与主题**：背景图、背景模糊、明暗主题全部收口在设置浮窗，支持「跟随系统」；主题在首屏绘制前由 head 内联脚本确定，深色模式不闪白。
- **站点图标降级链**：第三方聚合源 → 站点 `/favicon.ico` → 字母坞，全部失败也保证有精致兜底。
- **响应式**：CSS Grid 自适应列数，手机 375px 下布局不破。
- **滚轮切分类**：鼠标悬停在**标签栏那一排**上时，滚轮切换分类标签页，纵向环形（末项向下回首页）；标签栏以外的区域滚轮是整页翻页。
- **站点说明 tooltip**：站点可配 `desc`，悬停卡片显示玻璃质感说明。

### 翻页的两条边界

1. **跨域 iframe 内的滚轮归那个 iframe**：在第 3 页的地图上滚动会缩放/平移地图，不会翻页。这一页请用右侧圆点或 `↑`/`↓` 翻页（页头也写了提示）。
2. **翻页只作用于电脑**：判定条件是「宽度 ≥ 861px 且 有悬停 且 指针精细」。触屏设备（含平板）一律走原生滚动，这是刻意为之——触屏上滑动本身就是翻页，再叠一层手势判定属重复。

## 快速开始

页面通过 `fetch` 读取 YAML，**必须走 HTTP，不能直接双击打开 `index.html`**（`file://` 下会被浏览器拦截）：

```bash
python -m http.server 8765 --bind 127.0.0.1
```

然后访问 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)。

## 目录结构

```
/
├── index.html              # 唯一页面；四页 deck 结构与首屏主题脚本
├── css/style.css           # 全部样式，改观感只动这里（桌面翻页布局在文末的媒体查询里）
├── js/
│   ├── vendor/js-yaml.min.js   # YAML 解析（本地引入，不走 CDN）
│   ├── data.js             # 数据层：YAML → 归一化模型（无 DOM）
│   ├── icons.js            # 图标降级链 + 字母坞（纯函数，无 DOM）
│   ├── prefs.js            # localStorage 读写（无 DOM）
│   ├── treemap.js          # 布局层：squarified treemap 纯几何算法（无 DOM、无请求）
│   ├── market.js           # 行情数据层：金融界接口 → 市值树 + 色阶（无 DOM）
│   ├── weather.js          # 天气数据层：Open-Meteo 两接口 → 多城预报模型（无 DOM）
│   ├── deck.js             # 翻页层：全站唯一的滚轮/键盘入口
│   ├── ui.js               # UI 层：模型 → DOM，交互经 handlers 上报
│   └── app.js              # 组合根：接线、设置持久化、二三层按需加载
├── data/sites.yml          # 唯一数据源（只管第 1 页）
├── tools/yaml-editor.html  # 可视化编辑 data/sites.yml（见「数据维护」）
├── assets/
│   ├── bg/                 # 背景图
│   └── icon/               # favicon / apple-touch-icon
└── docs/SRS.md             # 需求规格说明书（实现的唯一依据）
```

## 数据维护

所有导航内容都在 `data/sites.yml`，改完提交即生效。

不想手改 YAML 就用**可视化编辑器**：起本地服务后打开 [http://127.0.0.1:8765/tools/yaml-editor.html](http://127.0.0.1:8765/tools/yaml-editor.html)，或从首页左上齿轮 → 设置浮窗底部的「打开数据编辑器 ↗」进入。它会自动读取 `data/sites.yml`，表单化增删改分类/网站/引擎/背景/天气城市，实时生成 YAML 并做校验（非法网址、缺少 `%s`、坐标越界等会当场标红），支持「批量粘贴」（每行一个网址，名称和说明可省）、上下移动排序、一键保存回原文件或下载。YAML 预览区只读——表单是唯一事实源；保存时文件头部注释块会保留，行内手写注释不保留。（`file://` 直接双击打开时无法自动读取，用页面上的「打开 sites.yml」选文件即可。）

> 编辑器导出的是**白名单式重建**：只写它认识的顶层键。给 `sites.yml` 加一个新的顶层段，必须同步编辑器的 `blankModel` / `loadText` / `clean` / 表单四处，否则在编辑器里保存一次就会把那段静默抹掉。

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

weather:                              # 第 3 页天气的预设城市（坐标为十进制度）
  cities:
    - { name: 泰州靖江市, lat: 32.02, lon: 120.06 }
    - { name: 宁波鄞州区, lat: 29.8119, lon: 121.5445 }
    - { name: 成都郫都区, lat: 30.7895, lon: 103.8843 }
```

维护约定：

- 加网站 = 在对应分类的 `sites` 下加一条，**不要**另建列表。
- 首页是分类数据的**派生视图**：`pinned: true` 的站点按分类顺序自动汇总到首页。
- `url` 仅接受 `http/https`，其它协议（`javascript:` 等）在归一化阶段直接丢弃。
- 单条数据格式不对只丢这一条，不会导致整页失败；YAML 整体语法错误会显示可读的错误提示。
- 新增背景：把图放进 `assets/bg/`，再把路径加进 `backgrounds` 列表。
- 加天气城市 = 往 `weather.cities` 加一条（名称 + 经纬度），标签栏顺序即列表顺序；坐标无效或名称为空的那一条会被丢弃。查坐标可用任意图拾取工具，写完刷新看一眼标签是否落在你要的地方。
- **云图与台风两页不在 YAML 里**：改它们要动代码；YAML 只为天气提供城市清单这一项数据。

## 第 2~4 页的外部数据

| 页 | 来源 | 取法 |
|----|------|------|
| 第 2 页 大盘云图 | 金融界行情网关 `gateway.jrj.com` 的 `quot-dpyt/v1/market`（市值树）与 `quot-dpyt/v1/hq`（分维度行情） | 浏览器直连 POST，接口回 `Access-Control-Allow-Origin: *`，无需 key、无代理；色阶阈值与数值口径照抄源站 |
| 第 3 页 天气预报 | Open-Meteo：`api.open-meteo.com/v1/forecast`（当前 + 7 天）与 `air-quality-api.open-meteo.com`（美标 AQI / PM2.5 / PM10） | 浏览器直连 GET，两个接口均 CORS 全开、无需 key；两者都支持多地点（`latitude=a,b,c`），故**几座城市都只发 2 个请求**，10 分钟刷新 |
| 第 4 页 台风路径与警报 | 浙江省水利厅 `typhoon.slt.zj.gov.cn` | iframe 嵌入（源站不设 `X-Frame-Options`，实测可嵌） |

**为什么天气不用中国天气网**：它的城市页确实能 iframe，但整页带站头、导航和广告；更关键的是它的 JSON 接口 `d1.weather.com.cn` 实测**不带 Referer 直接 403**，浏览器无法伪造该请求头，数据路线走不通。

**城市从哪来**：`data/sites.yml` 的 `weather.cities`（名称 + 十进制经纬度），页头标签按该顺序显示、点标签换城，**页内没有城市搜索**——切城市是纯视图动作，不发请求、不落 localStorage。改城市清单 = 改 YAML + push。AQI 用的是接口 `us_aqi` 即**美标**口径，与国内 AQI 数值不同，卡面上写明了。

这三页都是**首次翻到才加载**（云图/天气开始取数、iframe 写入 `src`），离开该页或切到后台标签页时停掉轮询。手机上没有翻页动作，故启动即就绪。

这类依赖随时可能因对方改版失效：接口改路径 / 关掉 CORS / 字段改名、台风站加上 `X-Frame-Options`。失效表现为对应页显示错误行并保留上一帧，**第 1 页与其余页不受影响**。要换源就改 `js/market.js` 顶部的 `GATEWAY` 与 `DIMENSIONS`、`js/weather.js` 顶部的两个接口地址与 `WMO` 表。

## 架构分层

分层目的是让 UI 可以大规模重写而不动数据层。**层间契约 = 模型结构 + CSS 类名**。

| 文件            | 职责                                                                     | 禁止                        |
| --------------- | ------------------------------------------------------------------------ | --------------------------- |
| `js/data.js`  | YAML → 归一化模型                                                       | 任何 DOM 操作               |
| `js/icons.js` | 图标降级链、字母坞（纯函数）                                             | DOM                         |
| `js/prefs.js` | localStorage 读写                                                        | DOM                         |
| `js/treemap.js` | squarified treemap 布局算法（纯几何）                                   | DOM、请求                   |
| `js/market.js` | 金融界行情接口 → 市值树 + 色阶/格式化 + 轮询                            | DOM                         |
| `js/weather.js` | Open-Meteo 两接口 → 多城预报模型（一次请求带 N 个坐标）+ WMO/AQI 映射          | DOM                         |
| `js/deck.js`  | 翻页：滚轮路由、键盘、圆点、`transform` 位移                       | 渲染业务内容                |
| `js/ui.js`    | 模型 → DOM；有副作用的交互（搜索、引擎、设置、云图落 DOM）通过 `handlers` 回调上报 | fetch / localStorage / YAML / 自行监听滚轮 |
| `js/app.js`   | 组合根：接线 + 设置持久化 + 二三层按需加载                               | 承载业务                    |

要点：

- **CSS 类名即接口**。`.site-card` / `.site-card--pinned` / `.site-icon` / `.site-tile` / `.site-name` / `.tab[aria-current]` / `.dot[aria-current]` / `.bg-thumb[aria-current]` / `.tm-ind` / `.tm-grp` / `.tm-leaf` 等，重写 UI 时请保持这些类名存在。
- **归一化模型**是 UI 层唯一依赖的数据结构（`settings` / `searchEngines` / `backgrounds` / `categories` / `pinned`）。
- **滚轮监听全站只有 `deck.js` 一处**。它问 `ui.js`「指针是否在标签栏内」，据此决定这一格滚轮是翻标签还是翻整页；两处 `preventDefault` 会互相抢事件。
- **桌面判定条件写两次**：`js/deck.js` 的 `DESKTOP` 字符串与 `css/style.css` 文末的媒体查询必须一致，改一处必须改两处（同 head 内联主题脚本与 `prefs.js` 的键名契约）。
- **设置浮窗为草稿模式**：打开时拷贝当前生效值进草稿，浮窗内改动不影响页面；关闭（× / 应用并关闭 / 点遮罩 / Esc）时统一应用。浮窗打开期间滚轮与键盘翻页一并让位。

## 设置项

| 项       | 说明                                     |
| -------- | ---------------------------------------- |
| 背景     | 从`backgrounds` 候选中选一张           |
| 背景模糊 | 对背景层做模糊，默认取 YAML 的`bgBlur` |
| 主题     | 跟随系统 / 浅色 / 深色，默认跟随系统     |

优先级：**localStorage 覆盖 > YAML 默认值**。用户选择若与 YAML 默认一致，则**不写入** localStorage，避免日后改了 YAML 反被旧偏好盖住。所有设置合并存在单个 localStorage 键 `nav.settings`（JSON）里，只存覆盖字段。

所有设置项统一收口在设置浮窗，新增设置一律加进浮窗，不要在页面上散落开关。

例外：**内容级选择不算设置项**。第 2 页的云图维度标签、第 3 页的天气城市标签都留在各自页头——它们改的是"这一页看什么"，不是站点的外观或行为，所以既不进浮窗也不落盘（城市清单本身在 `data/sites.yml`）。

## 部署

纯静态站点，把仓库根目录直接发布到 GitHub Pages 即可，push 即生效（缓存影响见下方"缓存注意事项"）。

若需在新机器/新仓库上重新搭建：

```bash
git init
git add -A && git commit -m "init"
git branch -M main
git remote add origin git@github.com:<用户名>/<仓库名>.git
git push -u origin main
```

然后在仓库 Settings → Pages 中选择 `main` 分支、根目录 `/`。

> 注意：`data/sites.yml` 里若含自建服务的内网/公网地址（如 `http://<ip>:<port>/`），它们会随仓库一起公开，请自行确认是否适合公开托管。

### 缓存注意事项（改完没生效先看这里）

GitHub Pages 会给**所有静态文件**（含 `index.html`、js、css）统一返回 `Cache-Control: max-age=600`，且不可配置。因此：

- push 后浏览器在 **10 分钟内**重新打开页面，可能直接命中本地缓存、不发任何请求，看到的是旧版——**强制刷新（Ctrl+F5）即可跳过缓存**，或等缓存过期后普通刷新。
- 另有两段时间叠加：GitHub Actions 构建部署本身需要约 1~3 分钟，push ≠ 立即可见。

## 浏览器支持

面向 Chrome / Edge / Firefox 近两个大版本，移动端可用。

- 目标为 ES2017 语法与 `fetch`；不支持 `backdrop-filter` 时卡片降级为半透明纯色，保证可读性。
- 站点说明 tooltip 的淡入效果使用 `display .15s allow-discrete`；旧浏览器忽略该增强声明，退化为直接显隐，不影响功能。
- 整页翻页要求 `(min-width: 861px) and (hover: hover) and (pointer: fine)`；不满足即回落普通文档流长页，功能不缺、只是不翻。
- 云图重排依赖 `ResizeObserver`；缺失时退化为"进入本页时排一次"，窗口改变大小不会自动重排。

## 相关文档

- [`docs/SRS.md`](docs/SRS.md) —— 需求规格说明书：YAML Schema、FR/NFR 编号需求、验收清单、决策溯源表。改动前建议先对齐它。

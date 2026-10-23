# ExileGuide自制导航

一个纯静态的个人导航站：原生 HTML + CSS + JavaScript，数据以 YAML 维护，**零构建、零 CDN、无后端、无 API key**。改数据只需编辑 `data/sites.yml` 并提交。桌面端是五页，滚轮整页翻动：**第 1 页导航 · 第 2 页大盘云图 · 第 3 页天气预报 · 第 4 页台风路径与警报 · 第 5 页投资日历**。

![首页](assets/icon/icon.svg)

## 特性

- **五页整页翻页（仅电脑）**：滚轮、`↑`/`↓`/`PageUp`/`PageDown`/`Home`/`End`、右侧圆点三种入口；页内内容超高时先滚内容、滚到底才翻页。手机和窄屏自动退回普通长页，五页纵向堆叠。
- **第 2 页 · 大盘云图**：自绘 squarified treemap，面积 = 市值占比、颜色 = 涨跌，行业 → 二级 → 个股三级；六个维度可切（涨跌幅 / 近一周 / 近一月 / 近一年 / 资金净流入 / 市盈率），12s 自动刷新，悬停看个股详情。数据直连金融界公开行情接口，无需 key、无代理。
- **第 3 页 · 天气预报**：当前温度/体感/湿度/风速/降水 + 未来 7 天柱状图（含降水概率）+ 美标 AQI 与 PM2.5/PM10，城市在 YAML 里配了 `oilRegion` 时附一张当地油价卡（当前四档价 + 下次调价方向）。城市来自 `data/sites.yml` 的预设列表，页头按城市切换（标签上带该城当前温度），**不做搜索**；每 10 分钟自动刷新，页头有手动刷新。数据源 Open-Meteo 与 60s 油价接口，均为匿名只读、无需 key、无代理；无论预设几座城市，一轮天气刷新只有 2 个请求。
- **第 4 页 · 台风路径与警报**：嵌入浙江省水利厅台风路径实时发布系统（地图 + 台风警报面板）。
- **第 5 页 · 投资日历**：按日展示新股/转债的申购、中签、缴款、上市，转债最后转股日与 REITs 认购/上市，`‹`/`›` 前后翻日（各 15 天）、可回今天。数据直连东方财富数据中心公开报表，无需 key、无代理；结果按日期缓存在 localStorage。原型本是集思录首页日历，但其接口无 CORS 且禁 iframe，纯前端不可行（见「第 2~5 页的外部数据」）。
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

1. **跨域 iframe 内的滚轮归那个 iframe**：在第 4 页的台风地图上滚动会缩放/平移地图，不会翻页。这一页请用右侧圆点或 `↑`/`↓` 翻页（页头也写了提示）。
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
├── index.html              # 唯一页面；五页 deck 结构与首屏主题脚本
├── css/style.css           # 全部样式，改观感只动这里（桌面翻页布局在文末的媒体查询里）
├── js/
│   ├── vendor/js-yaml.min.js   # YAML 解析（本地引入，不走 CDN）
│   ├── data.js             # 数据层：YAML → 归一化模型（无 DOM）
│   ├── icons.js            # 图标降级链 + 字母坞（纯函数，无 DOM）
│   ├── prefs.js            # localStorage 读写（无 DOM）
│   ├── treemap.js          # 布局层：squarified treemap 纯几何算法（无 DOM、无请求）
│   ├── market.js           # 行情数据层：金融界接口 → 市值树 + 色阶（无 DOM）
│   ├── weather.js          # 天气数据层：Open-Meteo 两接口 → 多城预报模型（无 DOM）
│   ├── oil.js              # 油价数据层：当前四档价 + 下次调价窗口（无 DOM）
│   ├── calendar.js         # 投资日历数据层：东财两报表 → 单日事件分组模型（无 DOM）
│   ├── deck.js             # 翻页层：全站唯一的滚轮/键盘入口
│   ├── ui.js               # UI 层：模型 → DOM，交互经 handlers 上报
│   └── app.js              # 组合根：接线、设置持久化、二三层按需加载
├── data/sites.yml          # 导航数据 + 天气预设城市（含油价地区）
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
    - { name: 泰州靖江市, lat: 32.02,  lon: 120.06,  oilRegion: 江苏泰州靖江 }
    - { name: 宁波鄞州区, lat: 29.8119, lon: 121.5445, oilRegion: 浙江宁波鄞州 }
    - { name: 成都郫都区, lat: 30.7895, lon: 103.8843 }   # 不给 oilRegion 则该城不显示油价卡
```

维护约定：

- 加网站 = 在对应分类的 `sites` 下加一条，**不要**另建列表。
- 首页是分类数据的**派生视图**：`pinned: true` 的站点按分类顺序自动汇总到首页。
- `url` 仅接受 `http/https`，其它协议（`javascript:` 等）在归一化阶段直接丢弃。
- 单条数据格式不对只丢这一条，不会导致整页失败；YAML 整体语法错误会显示可读的错误提示。
- 新增背景：把图放进 `assets/bg/`，再把路径加进 `backgrounds` 列表。
- 加天气城市 = 往 `weather.cities` 加一条（名称 + 经纬度），标签栏顺序即列表顺序；坐标无效或名称为空的那一条会被丢弃。可选 `oilRegion` 填该市/区县名，用于取当地油价，留空则该城不显示油价卡。查坐标可用任意图拾取工具，写完刷新看一眼标签是否落在你要的地方。
- **云图、台风与投资日历三页不在 YAML 里**：改它们要动代码；YAML 仅为天气页提供城市清单与油价地区。

## 第 2~5 页的外部数据

| 页                     | 来源                                                                                                                          | 取法                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 第 2 页 大盘云图       | 金融界行情网关`gateway.jrj.com` 的 `quot-dpyt/v1/market`（市值树）与 `quot-dpyt/v1/hq`（分维度行情）                    | 浏览器直连 POST，接口回`Access-Control-Allow-Origin: *`，无需 key、无代理；色阶阈值与数值口径照抄源站                                  |
| 第 3 页 天气预报       | Open-Meteo：`api.open-meteo.com/v1/forecast`（当前 + 7 天）与 `air-quality-api.open-meteo.com`（美标 AQI / PM2.5 / PM10） | 浏览器直连 GET，两个接口均 CORS 全开、无需 key；两者都支持多地点（`latitude=a,b,c`），故**几座城市都只发 2 个请求**，10 分钟刷新 |
| 第 3 页 油价卡         | 60s`60s.viki.moe/v2/fuel-price`（主源 + 镜像）→ `v1.apizero.cn/api/oil-price`（备源，只认省名）                          | 浏览器直连 GET，免 key；主源挂了走镜像，都挂了退到备源，全挂则不出卡片。结果按地区缓存在 localStorage 6 小时                             |
| 第 4 页 台风路径与警报 | 浙江省水利厅`typhoon.slt.zj.gov.cn`                                                                                         | iframe 嵌入（源站不设`X-Frame-Options`，实测可嵌）                                                                                     |
| 第 5 页 投资日历       | 东方财富数据中心`datacenter-web.eastmoney.com/api/data/v1/get`：`RPT_IPO_CALENDAR`（新股/转债 申购·中签·缴款·上市）、`RPT_BOND_CB_LIST`（按 `TRANSFER_END_DATE` 过滤转债最后转股日）与 `RPT_REITS_APPLY_LIST`（REITs 认购总表，全量约百条，独立缓存 24 小时后前端按日匹配认购起止与上市日） | 浏览器直连 GET，接口回 `Access-Control-Allow-Origin: *`，无需 key、无代理；单日最多 3 个请求（REITs 表命中缓存则 2 个），按日结果缓存在 localStorage（当天 10 分钟，其它日期不过期） |

**为什么投资日历不用集思录**：需求原型是集思录首页的投资日历，但实测四条路全堵——接口不回任何 CORS 头（浏览器读不到）、不支持 JSONP、站点 `X-Frame-Options: SAMEORIGIN` 禁 iframe、公共 CORS 代理被源站侧拦截（allorigins/codetabs 超时、corsproxy.io 转收费）。换东财数据中心自组后覆盖面略窄（没有指数调样、宏观发布这类人工整理条目），但链路干净。要换源就改 `js/calendar.js` 顶部的 `HOST` 与两个 `reportName`。

**为什么天气不用中国天气网**：它的城市页确实能 iframe，但整页带站头、导航和广告；更关键的是它的 JSON 接口 `d1.weather.com.cn` 实测**不带 Referer 直接 403**，浏览器无法伪造该请求头，数据路线走不通。

**城市从哪来**：`data/sites.yml` 的 `weather.cities`（名称 + 十进制经纬度），页头标签按该顺序显示、点标签换城，**页内没有城市搜索**——切城市是纯视图动作，不发请求、不落 localStorage。改城市清单 = 改 YAML + push。AQI 用的是接口 `us_aqi` 即**美标**口径，与国内 AQI 数值不同，卡面上写明了。

这四页都是**首次翻到才加载**（云图/天气/日历开始取数、iframe 写入 `src`），离开某页或切到后台标签页时停掉轮询（日历无轮询，取一次驻帧）。手机上没有翻页动作，故启动即就绪。

这类依赖随时可能因对方改版失效：接口改路径 / 关掉 CORS / 字段改名、台风站加上 `X-Frame-Options`。失效表现为对应页显示错误行并保留上一帧，**第 1 页与其余页不受影响**。要换源就改 `js/market.js` 顶部的 `GATEWAY` 与 `DIMENSIONS`、`js/weather.js` 顶部的两个接口地址与 `WMO` 表、`js/oil.js` 顶部的 `SIXTY_HOSTS` 与 `PROVINCE_API`、`js/calendar.js` 顶部的 `HOST` 与报表名。

## 架构分层

分层目的是让 UI 可以大规模重写而不动数据层。**层间契约 = 模型结构 + CSS 类名**。

| 文件              | 职责                                                                                 | 禁止                                       |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `js/data.js`    | YAML → 归一化模型                                                                   | 任何 DOM 操作                              |
| `js/icons.js`   | 图标降级链、字母坞（纯函数）                                                         | DOM                                        |
| `js/prefs.js`   | localStorage 读写                                                                    | DOM                                        |
| `js/treemap.js` | squarified treemap 布局算法（纯几何）                                                | DOM、请求                                  |
| `js/market.js`  | 金融界行情接口 → 市值树 + 色阶/格式化 + 轮询                                        | DOM                                        |
| `js/weather.js` | Open-Meteo 两接口 → 多城预报模型（一次请求带 N 个坐标）+ WMO/AQI 映射               | DOM                                        |
| `js/calendar.js` | 东财两报表 → 单日投资日历分组模型（色值/链接白名单校验）+ 按日期 localStorage 缓存  | DOM                                        |
| `js/oil.js`     | 油价接口 → 四档价 + 下次调价模型（多源降级 + localStorage 缓存）                    | DOM                                        |
| `js/deck.js`    | 翻页：滚轮路由、键盘、圆点、`transform` 位移                                       | 渲染业务内容                               |
| `js/ui.js`      | 模型 → DOM；有副作用的交互（搜索、引擎、设置、云图落 DOM）通过`handlers` 回调上报 | fetch / localStorage / YAML / 自行监听滚轮 |
| `js/app.js`     | 组合根：接线 + 设置持久化 + 二三层按需加载                                           | 承载业务                                   |

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

例外：**内容级选择不算设置项**。第 2 页的云图维度标签、第 3 页的天气城市标签、第 5 页的日历日期都留在各自页头——它们改的是"这一页看什么"，不是站点的外观或行为，所以既不进浮窗也不落盘（城市清单本身在 `data/sites.yml`）。

## 部署

纯静态站点，可部署到github pages或cloudflare pages，踩了一个坑，如果github本身部署了个人博客，项目pages域名会在个人博客/下面，导致缓存冲突无法更新。建议用github pages部署博客的，用别的服务部署这个导航。

## 浏览器支持

面向 Chrome / Edge / Firefox 近两个大版本，移动端可用。

- 目标为 ES2017 语法与 `fetch`；不支持 `backdrop-filter` 时卡片降级为半透明纯色，保证可读性。
- 站点说明 tooltip 的淡入效果使用 `display .15s allow-discrete`；旧浏览器忽略该增强声明，退化为直接显隐，不影响功能。
- 整页翻页要求 `(min-width: 861px) and (hover: hover) and (pointer: fine)`；不满足即回落普通文档流长页，功能不缺、只是不翻。
- 云图重排依赖 `ResizeObserver`；缺失时退化为"进入本页时排一次"，窗口改变大小不会自动重排。

## 相关文档

- [`docs/SRS.md`](docs/SRS.md) —— 需求规格说明书：YAML Schema、FR/NFR 编号需求、验收清单、决策溯源表。改动前建议先对齐它。

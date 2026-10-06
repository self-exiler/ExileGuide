/**
 * UI 层：模型 → DOM。只认识「模型 + CSS 类名」，不做 fetch / localStorage / YAML；
 * 有副作用的交互通过 handlers 回调给 app.js。
 * 设置浮窗为草稿模式：打开时拷贝当前设置，关闭时统一 onSettingsApply(draft)。
 * 大盘云图是个例外：行情数据由 app.js 经 NavMarket 取好后推给 onMarketData，
 * 本层只做「树 + 行情 → 定位好的 DOM 块」，不直接发请求。
 * 滚轮不再由本层监听：全站唯一 wheel 入口在 deck.js，本层只回答「指针是否在标签栏内」。
 */
window.NavUI = (function () {
  'use strict';

  var el = {};
  var handlers = {};
  var model = null;
  var settings = null; // 当前生效设置；applySettings 在 start() 中先于用户交互调用
  var draft = null;     // 浮窗草稿，null 表示未打开
  var activeTab = null; // -1 = 首页；null = 尚未渲染
  var tabButtons = [];  // tabButtons[0] = 首页，[i] = 分类 i-1

  var THEMES = [
    { value: 'auto', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' }
  ];

  var systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  // 云图三级布局参数：面积 = 市值占比，每级顶部留一条标签带（格子太小则不留）
  var TM_LEVELS = [
    { header: 18, minW: 46, minH: 34, gap: 3 },
    { header: 14, minW: 34, minH: 26, gap: 2 },
    { header: 0, minW: 0, minH: 0, gap: 1 }
  ];
  var TM_LEAF = { hideW: 7, hideH: 7, nameW: 26, nameH: 15, valW: 44, valH: 28 };

  var marketView = null;   // 当前帧数据 { dim, tree, hqs }
  var packed = null;       // 缓存的 packTree 几何结果
  var packedBox = null;    // packed 对应的 { tree, w, h }：树或尺寸变了才重算几何
  var leafEls = new Map(); // sid → 个股格子，跨帧复用
  var groupEls = new Map();
  var indEls = new Map();
  var tipLeaf = null;
  var tipRaf = 0;          // tooltip 合帧句柄
  var tipPending = null;   // 本帧待绘的 { leaf, x, y }
  var tipBase = null;      // 缓存 #market 视口矩形：悬停期间只读一次
  var tipSize = null;      // 缓存 tooltip 自身尺寸：仅内容重建时重算

  var weatherData = [];    // 预设城市的最近一帧预报
  var wxIndex = 0;         // 当前选中的城市下标（纯视图状态）

  function $(id) { return document.getElementById(id); }

  function init(callbacks) {
    handlers = callbacks || {};
    el.bgLayer = $('bg-layer');
    el.title = document.querySelector('title');
    el.deck = $('deck');
    el.dots = $('dots');
    el.stage = $('stage');
    el.searchForm = $('search-form');
    el.searchInput = $('search-input');
    el.engineSelect = $('engine-select');
    el.tabs = $('tabs');
    el.grid = $('grid');
    el.error = $('error');
    el.market = $('market');
    el.marketTabs = $('market-tabs');
    el.marketLegend = $('market-legend');
    el.marketTime = $('market-time');
    el.marketStatus = $('market-status');
    el.marketError = $('market-error');
    el.marketTip = $('market-tip');
    el.typhoonFrame = $('typhoon-frame');
    el.wxCities = $('wx-tabs');
    el.weatherGrid = $('weather-grid');
    el.weatherStatus = $('weather-status');
    el.weatherError = $('weather-error');
    el.weatherMeta = $('weather-meta');
    el.weatherRefresh = $('weather-refresh');
    el.settingsToggle = $('settings-toggle');
    el.overlay = $('settings-overlay');
    el.panel = $('settings-panel');
    el.settingsClose = $('settings-close');
    el.settingsApply = $('settings-apply');
    el.settingsBg = $('settings-bg');
    el.settingsBlur = $('settings-blur');
    el.settingsTheme = $('settings-theme');

    el.searchForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = el.searchInput.value.trim();
      if (!q) return;
      if (handlers.onSearch) handlers.onSearch(q, el.engineSelect.value);
      el.searchInput.value = '';
    });

    el.weatherRefresh.addEventListener('click', function () {
      if (handlers.onWeatherRefresh) handlers.onWeatherRefresh();
    });

    el.settingsToggle.addEventListener('click', openSettings);
    el.settingsClose.addEventListener('click', function () { closeSettings(true); });
    el.settingsApply.addEventListener('click', function () { closeSettings(true); });
    el.overlay.addEventListener('click', function (ev) {
      if (ev.target === el.overlay) closeSettings(true);
    });
    document.addEventListener('keydown', function (ev) {
      if (!draft) return;
      if (ev.key === 'Escape') closeSettings(true);
      if (ev.key === 'Tab') trapFocus(ev); // aria-modal 要求焦点锁在浮窗内
    });

    el.settingsBlur.addEventListener('change', function () {
      if (draft) draft.bgBlur = el.settingsBlur.checked;
    });

    el.engineSelect.addEventListener('change', function () {
      if (handlers.onEngineChange) handlers.onEngineChange(el.engineSelect.value);
    });

    systemDark.addEventListener('change', function () {
      if (settings && settings.theme === 'auto') paintTheme();
    });

    // 悬停个股格子时的浮动信息：委托到容器，避免给上千个格子各挂一个监听。
    // 合帧绘制：mousemove 每帧可触发多次，逐次「读 getBoundingClientRect 再写 transform」
    // 会在含上千格子的子树上反复强制回流；改为每帧至多绘一次，并缓存矩形（见 showTip）。
    el.market.addEventListener('mousemove', function (ev) {
      scheduleTip(ev.target && ev.target.closest ? ev.target.closest('.tm-leaf') : null, ev.clientX, ev.clientY);
    });
    el.market.addEventListener('mouseleave', function () {
      tipPending = null;
      if (tipRaf) { cancelAnimationFrame(tipRaf); tipRaf = 0; }
      hideTip();
    });

    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (marketView) layoutMarket(); }).observe(el.market);
    }
  }

  // 供 deck.js 判定滚轮归属：首页标签栏内翻标签，其余翻整页
  function isTabArea(target) {
    return !!(target && target.closest && target.closest('#tabs'));
  }

  // 设置浮窗打开时 deck 不接管滚轮与键盘
  function settingsOpen() { return !!draft; }

  // 环形切换：末项向下回首页，首项向上回末项。
  // activeTab 用 -1 表示首页、0..n-1 表示分类，与 0-based 索引不同源，故不走取模。
  function stepTab(dir) {
    if (!model) return;
    var last = model.categories.length - 1;
    if (last < 1) return;
    var next = activeTab + dir;
    if (next > last) next = -1;
    else if (next < -1) next = last;
    showTab(next);
  }

  /* ---------------- 渲染 ---------------- */

  // 首屏：标题、搜索引擎下拉、标签栏、首页网格
  function render(data, selectedEngine) {
    model = data;
    activeTab = null;
    if (model.settings.title) el.title.textContent = model.settings.title;

    el.engineSelect.textContent = '';
    model.searchEngines.forEach(function (engine) {
      var opt = document.createElement('option');
      opt.value = engine.url;
      opt.textContent = engine.name;
      el.engineSelect.appendChild(opt);
    });
    el.engineSelect.value = selectedEngine || '';
    // 保存的引擎已不在列表里时回落第一项
    if (!el.engineSelect.value && model.searchEngines.length) el.engineSelect.selectedIndex = 0;
    el.engineSelect.hidden = model.searchEngines.length < 2;

    tabButtons = [tabButton('首页', -1)].concat(
      model.categories.map(function (cat, i) { return tabButton(cat.name, i); })
    );
    el.tabs.textContent = '';
    tabButtons.forEach(function (btn) { el.tabs.appendChild(btn); });

    showTab(-1);
  }

  // 切换分类：-1 = 首页大图标，>=0 = 对应分类
  function showTab(index) {
    if (index === activeTab) return;
    activeTab = index;
    tabButtons.forEach(function (btn, i) {
      btn.setAttribute('aria-current', String(i - 1 === index));
    });
    renderGrid();
  }

  function tabButton(label, index) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab';
    btn.textContent = label;
    btn.addEventListener('click', function () { showTab(index); });
    return btn;
  }

  function renderGrid() {
    el.grid.textContent = '';
    el.grid.classList.toggle('grid--pinned', activeTab === -1);

    var sites = activeTab === -1
      ? model.pinned
      : (model.categories[activeTab] || { sites: [] }).sites;

    if (!sites.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = activeTab === -1
        ? '还没有常用网站：在 data/sites.yml 里给网站加 pinned: true'
        : '这个分类暂时没有网站';
      el.grid.appendChild(empty);
      return;
    }

    var frag = document.createDocumentFragment();
    sites.forEach(function (site) { frag.appendChild(siteCard(site, activeTab === -1)); });
    el.grid.appendChild(frag);
  }

  function siteCard(site, pinned) {
    var card = document.createElement('a');
    card.className = 'site-card' + (pinned ? ' site-card--pinned' : '');
    card.href = site.url;
    card.target = '_blank';
    card.rel = 'noreferrer noopener';
    card.appendChild(iconNode(site, pinned));

    var name = document.createElement('span');
    name.className = 'site-name';
    name.textContent = site.name;
    card.appendChild(name);

    // 自定义 tooltip，不用原生 title 以免双重提示；aria-label 兼顾无障碍
    if (site.desc) {
      card.setAttribute('aria-label', site.name + '：' + site.desc);
      var tip = document.createElement('span');
      tip.className = 'site-tip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = site.desc;
      card.appendChild(tip);
    }
    return card;
  }

  // 图标降级链：聚合源 → 站点 favicon.ico → 字母兜底
  function iconNode(site, pinned) {
    var wrap = document.createElement('div');
    wrap.className = 'site-icon';

    var chain = NavIcons.chain(site.url);
    if (!chain.length) {
      wrap.appendChild(letterNode(site));
      return wrap;
    }

    var img = document.createElement('img');
    img.alt = '';
    img.loading = pinned ? 'eager' : 'lazy'; // 首页大图标在首屏
    img.decoding = 'async';
    img.referrerpolicy = 'no-referrer';      // 不向第三方图标源泄露本站地址
    var step = 0;
    img.addEventListener('error', function () {
      step += 1;
      if (step < chain.length) {
        img.src = chain[step];
      } else if (img.parentNode) {
        img.parentNode.replaceChild(letterNode(site), img);
      }
    });
    img.src = chain[step];
    wrap.appendChild(img);
    return wrap;
  }

  function letterNode(site) {
    var tile = NavIcons.letterTile(site);
    var node = document.createElement('div');
    node.className = 'site-tile';
    node.style.setProperty('--tile-hue', tile.hue);
    node.style.setProperty('--tile-hue2', tile.hue2);

    var charEl = document.createElement('span');
    charEl.className = 'site-tile__char';
    charEl.textContent = tile.char;
    node.appendChild(charEl);

    // 域名小字仅 64px 大图标有空间显示（是否显示由 CSS 控制）
    if (tile.host) {
      var sub = document.createElement('span');
      sub.className = 'site-tile__sub';
      sub.textContent = tile.host;
      node.appendChild(sub);
    }
    return node;
  }

  /* ---------------- 大盘云图 ---------------- */

  // 三层平铺：行业 / 二级 / 个股。同级互不重叠、层间由后往前覆盖，
  // 因此所有块都用 packTree 算出的绝对坐标直接摆，不需要嵌套定位。
  function tmLayers() {
    if (!el.tmLayers) {
      el.tmLayers = ['tm-ind', 'tm-grp', 'tm-leaf'].map(function () {
        var layer = document.createElement('div');
        layer.className = 'tm-layer';
        el.market.appendChild(layer);
        return layer;
      });
    }
    return el.tmLayers;
  }

  function renderMarketTabs(dims, activeKey) {
    el.marketTabs.textContent = '';
    dims.forEach(function (dim) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.textContent = dim.label;
      btn.dataset.key = dim.key;
      btn.setAttribute('aria-current', String(dim.key === activeKey));
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-current') === 'true') return;
        Array.prototype.forEach.call(el.marketTabs.children, function (child) {
          child.setAttribute('aria-current', String(child === btn));
        });
        if (handlers.onMarketDim) handlers.onMarketDim(dim.key);
      });
      el.marketTabs.appendChild(btn);
    });
  }

  function renderLegend(dim) {
    el.marketLegend.textContent = '';
    NavMarket.legendOf(dim).forEach(function (band) {
      var cell = document.createElement('span');
      cell.className = 'legend-band';
      cell.style.background = band.color;
      cell.textContent = band.label;
      el.marketLegend.appendChild(cell);
    });
  }

  function marketMessage(text) {
    el.marketStatus.hidden = !text;
    el.marketStatus.textContent = text || '';
  }

  function marketError(text) {
    el.marketError.hidden = !text;
    el.marketError.textContent = text ? '云图数据加载失败：' + text : '';
  }

  function onMarketData(payload) {
    marketView = { dim: payload.dim, tree: payload.tree, hqs: payload.hqs || {} };
    marketMessage('');
    marketError('');
    el.marketTime.textContent = NavMarket.tradingStamp(payload.td, payload.tm);
    renderLegend(payload.dim);
    layoutMarket();
  }

  function layoutMarket() {
    var view = marketView;
    if (!view) return;
    var w = el.market.clientWidth;
    var h = el.market.clientHeight;
    // 容器尚无有效尺寸（手机未展开、页面刚切换）时跳过，ResizeObserver 会再叫一次
    if (w < 240 || h < 160) return;

    // 几何只取决于「树权重 + 容器尺寸」：轮询与切维度时二者都不变，直接复用上次 packTree 结果，
    // 跳过对全树 5000+ 节点的重算，只重绘颜色与文字（对齐 FR-12.5「每轮只改样式与文本」）。
    var repacked = !(packed && packedBox &&
                     packedBox.tree === view.tree && packedBox.w === w && packedBox.h === h);
    if (repacked) {
      packed = NavTreemap.packTree(view.tree, { x: 0, y: 0, w: w, h: h }, TM_LEVELS);
      packedBox = { tree: view.tree, w: w, h: h };
      tipBase = null;   // 尺寸变了，缓存的容器矩形作废
    }

    var layers = tmLayers();
    var seen = { ind: new Set(), grp: new Set(), leaf: new Set() };

    function block(map, key, layer, cls, barCls) {
      var box = map.get(key);
      if (box) return box;
      box = document.createElement('div');
      box.className = cls;
      if (barCls) {
        var bar = document.createElement('span');
        bar.className = barCls;
        box.appendChild(bar);
        box.bar = bar;
      }
      layer.appendChild(box);
      map.set(key, box);
      return box;
    }

    function place(box, n) {
      box.style.transform = 'translate(' + Math.round(n.x) + 'px,' + Math.round(n.y) + 'px)';
      box.style.width = Math.round(n.w) + 'px';
      box.style.height = Math.round(n.h) + 'px';
      if (box.bar) {
        box.bar.hidden = n.header <= 0;
        box.bar.style.height = n.header + 'px';
      }
    }

    // 接口给的 scale 是「占父级」的比重，tooltip 要的是全市场比重，逐级乘下来
    function walk(nodes, level, path, shareIn) {
      nodes.forEach(function (n) {
        var share = shareIn * n.node.weight / 100;
        if (level === 2) { leaf(n, share); return; }
        var isInd = level === 0;
        var map = isInd ? indEls : groupEls;
        var key = isInd ? n.node.name : path + n.node.name;
        (isInd ? seen.ind : seen.grp).add(key);
        var box = block(map, key, layers[level],
          isInd ? 'tm-ind' : 'tm-grp',
          isInd ? 'tm-ind__bar' : 'tm-grp__bar');
        if (repacked) {
          place(box, n);
          // 行业带文字含占比（权重派生，跨维度/轮询恒定），几何不变时无需重写
          box.bar.textContent = isInd
            ? n.node.name + ' ' + share.toFixed(1) + '%'
            : n.node.name;
        }
        walk(n.children, level + 1, key + '/', share);
      });
    }

    function leaf(n, share) {
      var stock = n.node;
      if (n.w < TM_LEAF.hideW || n.h < TM_LEAF.hideH) return;   // 亚像素块直接丢弃，省上千个节点
      var key = String(stock.sid);
      seen.leaf.add(key);
      var box = leafEls.get(key);
      if (!box) {
        box = document.createElement('div');
        box.className = 'tm-leaf';
        box.nameEl = document.createElement('span');
        box.nameEl.className = 'tm-leaf__n';
        box.valEl = document.createElement('span');
        box.valEl.className = 'tm-leaf__v';
        box.appendChild(box.nameEl);
        box.appendChild(box.valEl);
        leafEls.set(key, box);
      }
      if (!box.parentNode) layers[2].appendChild(box);
      var quote = view.hqs[key];
      var raw = quote ? quote.var : null;
      if (repacked) {
        place(box, n);
        box.classList.toggle('tm-leaf--named', n.w >= TM_LEAF.nameW && n.h >= TM_LEAF.nameH);
        box.classList.toggle('tm-leaf--valued', n.w >= TM_LEAF.valW && n.h >= TM_LEAF.valH);
      }
      box.style.background = NavMarket.colorOf(view.dim, raw);
      box.nameEl.textContent = stock.name;
      box.valEl.textContent = NavMarket.textOf(view.dim, raw);
      box.info = {
        sid: key,
        name: stock.name,
        code: stock.code,
        price: quote && quote.np != null ? quote.np : null,
        dim: view.dim.label,
        value: NavMarket.textOf(view.dim, raw),
        share: share
      };
    }

    walk(packed, 0, '', 100);
    prune(indEls, seen.ind);
    prune(groupEls, seen.grp);
    prune(leafEls, seen.leaf);
  }

  function prune(map, keep) {
    map.forEach(function (box, key) {
      if (keep.has(key)) return;
      map.delete(key);
      if (box.parentNode) box.parentNode.removeChild(box);
    });
  }

  /* ---------------- 云图浮动信息 ---------------- */

  function scheduleTip(leaf, x, y) {
    tipPending = { leaf: leaf, x: x, y: y };
    if (tipRaf) return;
    tipRaf = requestAnimationFrame(function () {
      tipRaf = 0;
      var p = tipPending;
      if (p) showTip(p.leaf, p.x, p.y);
    });
  }

  function hideTip() {
    tipLeaf = null;
    tipBase = null;
    tipSize = null;
    el.marketTip.hidden = true;
  }

  // tooltip 定位在 #market 的坐标系里：deck 带 transform，其后代的 fixed
  // 参照物会变成 deck 本身，故不用视口坐标而用云图容器坐标。
  // 每帧至多调用一次（见 scheduleTip）；矩形缓存后，稳定悬停期间只写 transform、不读布局。
  function showTip(leaf, x, y) {
    if (!leaf || !leaf.info) {
      if (tipLeaf) hideTip();
      return;
    }
    tipLeaf = leaf;
    var info = leaf.info;
    if (el.marketTip.dataset.key !== info.sid) {
      el.marketTip.dataset.key = info.sid;
      el.marketTip.textContent = '';
      addTipLine(el.marketTip, info.name + ' ' + info.code, 'tm-tip__title');
      addTipLine(el.marketTip, '现价 ' + (info.price == null ? '--' : info.price), '');
      addTipLine(el.marketTip, info.dim + ' ' + info.value, '');
      addTipLine(el.marketTip, '全市场占比 ' + info.share.toFixed(2) + '%', '');
      tipSize = null;   // 内容变了，尺寸作废，本帧重算一次
    }
    el.marketTip.hidden = false;

    if (!tipBase) tipBase = el.market.getBoundingClientRect();
    if (!tipSize) tipSize = el.marketTip.getBoundingClientRect();
    var left = x - tipBase.left + 14;
    var top = y - tipBase.top + 16;
    if (left + tipSize.width > tipBase.width - 4) left = x - tipBase.left - tipSize.width - 14;
    if (top + tipSize.height > tipBase.height - 4) top = y - tipBase.top - tipSize.height - 16;
    el.marketTip.style.transform = 'translate(' + Math.max(4, left) + 'px,' + Math.max(4, top) + 'px)';
  }

  function addTipLine(parent, text, cls) {
    var line = document.createElement('span');
    if (cls) line.className = cls;
    line.textContent = text;
    parent.appendChild(line);
  }

  /* ---------------- 第 3 页 · 天气 ---------------- */

  function weatherMessage(text) {
    el.weatherStatus.hidden = !text;
    el.weatherStatus.textContent = text || '';
  }

  // 出错只加一行提示，保留上一帧画面（与云图 FR-12.7 同一处置原则）
  function weatherError(text) {
    el.weatherError.hidden = !text;
    el.weatherError.textContent = text ? '天气数据加载失败：' + text : '';
  }

  // 一次请求回全部预设城市；选中哪座城市只是本页视图状态，不落盘、不回源
  function onWeatherData(list) {
    weatherData = list;
    if (wxIndex >= list.length) wxIndex = 0;
    weatherMessage('');
    weatherError('');
    renderCityTabs();
    renderWeather();
  }

  function renderCityTabs() {
    el.wxCities.textContent = '';
    weatherData.forEach(function (model, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.appendChild(document.createTextNode(model.city.name));
      var badge = document.createElement('span');
      badge.className = 'tab__wx';
      badge.textContent = fmtTemp(model.now.temp) + ' ' + model.now.cond;
      btn.appendChild(badge);
      btn.setAttribute('aria-current', String(i === wxIndex));
      btn.addEventListener('click', function () {
        if (i === wxIndex) return;
        wxIndex = i;
        Array.prototype.forEach.call(el.wxCities.children, function (child, j) {
          child.setAttribute('aria-current', String(j === i));
        });
        renderWeather();
      });
      el.wxCities.appendChild(btn);
    });
  }

  function renderWeather() {
    var model = weatherData[wxIndex];
    if (!model) return;
    el.weatherMeta.textContent = model.city.name + (model.updated ? ' · ' + model.updated.replace('T', ' ') + ' 更新' : '');
    // 只重建网格，不动状态行：状态行与卡片同级，整体清空容器会把它一起删掉
    el.weatherGrid.textContent = '';
    el.weatherGrid.appendChild(nowCard(model.now));
    if (model.air) el.weatherGrid.appendChild(airCard(model.air));
    el.weatherGrid.appendChild(daysChart(model.days));
  }

  function fmtTemp(v) {
    return v == null || isNaN(v) ? '--' : Math.round(v) + '°';
  }

  function span(cls, text) {
    var node = document.createElement('span');
    node.className = cls;
    node.textContent = text;
    return node;
  }

  function nowCard(now) {
    var card = document.createElement('div');
    card.className = 'wx-now wx--' + now.group;
    var temp = document.createElement('strong');
    temp.className = 'wx-now__temp';
    temp.textContent = fmtTemp(now.temp);
    card.appendChild(temp);
    card.appendChild(span('wx-now__cond', now.cond));

    var facts = document.createElement('dl');
    facts.className = 'wx-facts';
    [['体感', fmtTemp(now.feels)], ['湿度', now.humidity == null ? '--' : now.humidity + '%'],
     ['风速', now.wind == null ? '--' : now.wind + ' km/h'],
     ['降水', (now.precip == null ? 0 : now.precip) + ' mm']].forEach(function (pair) {
      facts.appendChild(span('wx-facts__k', pair[0]));
      facts.appendChild(span('wx-facts__v', pair[1]));
    });
    card.appendChild(facts);
    return card;
  }

  function airCard(air) {
    var box = document.createElement('div');
    box.className = 'wx-air ' + air.band.cls;
    box.appendChild(span('wx-air__num', String(air.aqi)));
    box.appendChild(span('wx-air__band', air.band.label));
    box.appendChild(span('wx-air__sub',
      '美标 AQI · PM2.5 ' + (air.pm25 == null ? '--' : air.pm25) + ' · PM10 ' + (air.pm10 == null ? '--' : air.pm10)));
    return box;
  }

  function daysChart(days) {
    var wrap = document.createElement('div');
    wrap.className = 'wx-chart';

    var barArea = document.createElement('div');
    barArea.className = 'wx-chart__bars';

    var globalMin = Infinity, globalMax = -Infinity;
    days.forEach(function (d) {
      if (d.min < globalMin) globalMin = d.min;
      if (d.max > globalMax) globalMax = d.max;
    });
    var range = globalMax - globalMin || 1;

    days.forEach(function (d) {
      var col = document.createElement('div');
      col.className = 'wx-chart__col wx--' + d.group;

      var maxLabel = document.createElement('span');
      maxLabel.className = 'wx-chart__max';
      maxLabel.textContent = fmtTemp(d.max);
      col.appendChild(maxLabel);

      var bar = document.createElement('div');
      bar.className = 'wx-chart__bar';
      var pctH = ((d.max - d.min) / range) * 100;
      var pctBottom = ((d.min - globalMin) / range) * 100;
      bar.style.height = Math.max(8, pctH) + '%';
      bar.style.bottom = pctBottom + '%';
      if (d.rain != null && d.rain > 0) {
        bar.style.opacity = String(0.45 + (d.rain / 100) * 0.55);
      }
      col.appendChild(bar);

      var minLabel = document.createElement('span');
      minLabel.className = 'wx-chart__min';
      minLabel.textContent = fmtTemp(d.min);
      col.appendChild(minLabel);

      barArea.appendChild(col);
    });
    wrap.appendChild(barArea);

    var labels = document.createElement('div');
    labels.className = 'wx-chart__labels';
    days.forEach(function (d) {
      var cell = document.createElement('div');
      cell.className = 'wx-chart__label';
      cell.appendChild(span('wx-chart__day', d.label));
      cell.appendChild(span('wx-chart__cond', d.cond));
      if (d.rain != null && d.rain > 0) {
        cell.appendChild(span('wx-chart__rain', d.rain + '%'));
      }
      labels.appendChild(cell);
    });
    wrap.appendChild(labels);

    return wrap;
  }

  /* ---------------- 台风页 ---------------- */

  // 重型 SPA，只在首次进入第 4 页时才真正挂载
  function mountTyphoon() {
    var frame = el.typhoonFrame;
    if (!frame || frame.dataset.mounted) return;
    frame.dataset.mounted = '1';
    frame.src = 'https://typhoon.slt.zj.gov.cn/';
  }

  /* ---------------- 设置 ---------------- */

  function applySettings(next) {
    settings = {
      background: next.background || '',
      bgBlur: !!next.bgBlur,
      theme: next.theme || 'auto'
    };
    renderBackground(settings.background);
    document.body.classList.toggle('bg-blur', settings.bgBlur);
    paintTheme();
  }

  function renderBackground(path) {
    if (!path) {
      el.bgLayer.style.removeProperty('background-image');
      return;
    }
    el.bgLayer.style.backgroundImage = cssUrl(path);
  }

  // 路径来自 YAML，拼进 url() 前转义引号与反斜杠，防 CSS 注入
  function cssUrl(path) {
    return 'url("' + String(path).replace(/["\\]/g, '\\$&') + '")';
  }

  function paintTheme() {
    var theme = settings.theme === 'auto'
      ? (systemDark.matches ? 'dark' : 'light')
      : settings.theme;
    document.documentElement.setAttribute('data-theme', theme);
  }

  function openSettings() {
    if (!model || !settings || draft) return;
    draft = { background: settings.background, bgBlur: settings.bgBlur, theme: settings.theme };

    renderBgPicker();
    el.settingsBlur.checked = draft.bgBlur;
    renderThemeSeg();

    el.overlay.hidden = false;
    el.settingsToggle.setAttribute('aria-expanded', 'true');
    el.settingsClose.focus();
  }

  function closeSettings(commit) {
    if (!draft) return;
    var result = draft;
    draft = null;
    el.overlay.hidden = true;
    el.settingsToggle.setAttribute('aria-expanded', 'false');
    el.settingsToggle.focus();
    if (commit && handlers.onSettingsApply) handlers.onSettingsApply(result);
  }

  function renderBgPicker() {
    el.settingsBg.innerHTML = '';
    if (!model.backgrounds.length) {
      var hint = document.createElement('p');
      hint.className = 'bg-hint';
      hint.textContent = 'data/sites.yml 的 backgrounds 列表为空';
      el.settingsBg.appendChild(hint);
      return;
    }
    model.backgrounds.forEach(function (path) {
      var thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'bg-thumb';
      thumb.style.backgroundImage = cssUrl(path);
      thumb.title = path;
      thumb.dataset.path = path;
      thumb.setAttribute('aria-label', '背景 ' + path);
      thumb.setAttribute('aria-current', String(path === draft.background));
      thumb.addEventListener('click', function () {
        draft.background = path;
        Array.prototype.forEach.call(el.settingsBg.children, function (node) {
          node.setAttribute('aria-current', String(node.dataset.path === path));
        });
      });
      el.settingsBg.appendChild(thumb);
    });
  }

  function renderThemeSeg() {
    el.settingsTheme.innerHTML = '';
    THEMES.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'seg-item';
      btn.textContent = opt.label;
      btn.setAttribute('aria-pressed', String(opt.value === draft.theme));
      btn.addEventListener('click', function () {
        draft.theme = opt.value;
        Array.prototype.forEach.call(el.settingsTheme.children, function (child, i) {
          child.setAttribute('aria-pressed', String(THEMES[i].value === draft.theme));
        });
      });
      el.settingsTheme.appendChild(btn);
    });
  }

  function trapFocus(ev) {
    var focusables = el.panel.querySelectorAll('button, input, select, textarea, [href]');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function showError(message) {
    el.error.hidden = false;
    el.error.textContent = message;
  }

  return {
    init: init,
    render: render,
    applySettings: applySettings,
    showError: showError,
    // 供 deck.js 使用
    isTabArea: isTabArea,
    settingsOpen: settingsOpen,
    stepTab: stepTab,
    // 供 app.js 接线云图与嵌入页
    renderMarketTabs: renderMarketTabs,
    onMarketData: onMarketData,
    marketMessage: marketMessage,
    marketError: marketError,
    mountTyphoon: mountTyphoon,
    // 供 app.js 接线天气页
    onWeatherData: onWeatherData,
    weatherMessage: weatherMessage,
    weatherError: weatherError
  };
})();

/**
 * UI 层：模型 → DOM。只认识「模型 + CSS 类名」，不做 fetch / localStorage / YAML；
 * 有副作用的交互通过 handlers 回调给 app.js。
 * 设置浮窗为草稿模式：打开时拷贝当前设置，关闭时统一 onSettingsApply(draft)。
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

  function $(id) { return document.getElementById(id); }

  function init(callbacks) {
    handlers = callbacks || {};
    el.bgLayer = $('bg-layer');
    el.title = document.querySelector('title');
    el.searchForm = $('search-form');
    el.searchInput = $('search-input');
    el.engineSelect = $('engine-select');
    el.tabs = $('tabs');
    el.grid = $('grid');
    el.error = $('error');
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
    showError: showError
  };
})();

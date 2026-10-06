/**
 * 数据层：data/sites.yml → 归一化模型（UI 层唯一依赖的数据结构）
 * { settings, searchEngines, backgrounds, categories, pinned, weather }
 * 本文件不做任何 DOM 操作。
 */
window.NavData = (function () {
  'use strict';

  var DEFAULT_SETTINGS = { title: '导航', background: '', bgBlur: false };

  async function load() {
    var res = await fetch('data/sites.yml', { cache: 'no-cache' });
    if (!res.ok) throw new Error('无法加载数据文件（HTTP ' + res.status + '）');
    var text = await res.text();
    try {
      return normalize(window.jsyaml.load(text));
    } catch (e) {
      throw new Error('YAML 解析失败：' + (e && e.message ? e.message : e));
    }
  }

  // 单条数据不合法就丢弃该条，不让整页失败
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') raw = {};

    var settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings);
    settings.title = String(settings.title || DEFAULT_SETTINGS.title);
    settings.background = String(settings.background || '');
    settings.bgBlur = !!settings.bgBlur;

    var searchEngines = (Array.isArray(raw.searchEngines) ? raw.searchEngines : [])
      .filter(function (e) { return e && isHttpUrl(e.url) && String(e.url).indexOf('%s') !== -1; })
      .map(function (e) { return { name: String(e.name || '搜索'), url: e.url }; });

    var backgrounds = (Array.isArray(raw.backgrounds) ? raw.backgrounds : [])
      .filter(Boolean).map(String);
    // 默认背景不在候选清单里时补进去，保证设置页能标示当前项
    if (settings.background && backgrounds.indexOf(settings.background) === -1) {
      backgrounds.unshift(settings.background);
    }

    var categories = [];
    var pinned = [];
    (Array.isArray(raw.categories) ? raw.categories : []).forEach(function (cat) {
      if (!cat || typeof cat !== 'object') return;
      var name = String(cat.name || '未命名');
      var sites = (Array.isArray(cat.sites) ? cat.sites : []).map(function (s) {
        if (!s || !isHttpUrl(String(s.url || ''))) return null;
        var site = {
          name: String(s.name || '') || hostOf(s.url),
          url: String(s.url),
          host: hostOf(s.url),
          pinned: !!s.pinned,
          desc: String(s.desc || '')
        };
        if (site.pinned) pinned.push(Object.assign({ category: name }, site));
        return site;
      }).filter(Boolean);
      categories.push({ name: name, sites: sites });
    });

    // 天气预设城市：name 必填，坐标须是范围内的十进制度；无效条目照单条原则丢弃
    var cities = (Array.isArray(raw.weather && raw.weather.cities) ? raw.weather.cities : [])
      .map(function (c) {
        if (!c || typeof c !== 'object') return null;
        var name = String(c.name || '').trim();
        var lat = Number(c.lat);
        var lon = Number(c.lon);
        if (!name || !isFinite(lat) || !isFinite(lon)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return { name: name, lat: lat, lon: lon };
      }).filter(Boolean);

    return {
      settings: settings,
      searchEngines: searchEngines,
      backgrounds: backgrounds,
      categories: categories,
      pinned: pinned,
      weather: { cities: cities }
    };
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch (e) { return ''; }
  }

  // 链接只放行 http/https，挡掉 javascript: 等注入
  function isHttpUrl(url) {
    try {
      var p = new URL(url).protocol;
      return p === 'http:' || p === 'https:';
    } catch (e) {
      return false;
    }
  }

  return { load: load };
})();

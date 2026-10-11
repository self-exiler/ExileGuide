/**
 * 油价数据层：只取「当前四档价 + 下次调价窗口」，不做走势。
 * 主源 60s API（免 key、Access-Control-Allow-Origin: *，上游为发改委调价公告口径），
 * 主站挂了走镜像，两个都挂了再退到 apizero（省级，1 QPS）。
 * 全部失败就返回 null，由 UI 层不显示卡片。本文件不做任何 DOM 操作。
 */
window.NavOil = (function () {
  'use strict';

  var SIXTY_HOSTS = [
    'https://60s.viki.moe/v2/fuel-price',
    'https://60s-api.viki.moe/v2/fuel-price'
  ];
  var PROVINCE_API = 'https://v1.apizero.cn/api/oil-price';
  var STORE_KEY = '***';
  // 成品油 10 个工作日才动一次，6 小时缓存足够，也避免打爆公共实例的限流
  var TTL = 6 * 60 * 60 * 1000;

  var memory = {};

  function load(region) {
    if (!region) return Promise.resolve(null);
    var hit = readCache(region);
    if (hit) return Promise.resolve(hit);
    return fromSixty(region).then(function (model) {
      return model || fromProvinceApi(region);
    }).then(function (model) {
      if (model) writeCache(region, model);
      return model || null;
    });
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  /* ---------------- 主源：60s ---------------- */

  function fromSixty(region) {
    var chain = Promise.resolve(null);
    SIXTY_HOSTS.forEach(function (host) {
      chain = chain.then(function (model) {
        if (model) return model;
        return getJson(host + '?region=' + encodeURIComponent(region))
          .then(normalizeSixty)
          .catch(function () { return null; });
      });
    });
    return chain;
  }

  function normalizeSixty(json) {
    var d = json && json.code === 200 ? json.data : null;
    if (!d || !Array.isArray(d.items) || !d.items.length) return null;
    var trend = d.trend || {};
    return {
      region: String(d.region || ''),
      prices: d.items.map(function (i) {
        return { label: String(i.name || '').replace(/汽油|柴油/, ''), price: i.price };
      }),
      next: String(trend.next_adjustment_date || ''),
      direction: String(trend.direction || ''),
      range: String(trend.change_liter_desc || ''),
      updated: String(d.updated || '')
    };
  }

  /* ---------------- 备源：apizero（只认省名） ---------------- */

  function fromProvinceApi(region) {
    // 接口只接受省名，取前两个字；黑龙江/内蒙古这类三字省名会匹配失败，届时静默不出卡片
    var province = String(region).slice(0, 2);
    return getJson(PROVINCE_API + '?province=' + encodeURIComponent(province))
      .then(normalizeProvince)
      .catch(function () { return null; });
  }

  function normalizeProvince(json) {
    var d = json && json.code === 0 ? json.data : null;
    if (!d || !Array.isArray(d.prices) || !d.prices.length) return null;
    var forecast = String(d.forecast || '');
    return {
      region: String(d.province || ''),
      prices: d.prices.map(function (p) {
        return { label: String(p.name || '').replace(/号汽油|号柴油/, ''), price: p.price };
      }),
      next: String(d.next_adjustment || '').replace(/^下次油价/, '').replace(/调整$/, ''),
      direction: (forecast.match(/上调|下调|搁浅/) || [''])[0],
      range: (forecast.match(/\(([^)]+)\)/) || ['', ''])[1],
      updated: String(d.update_date || '')
    };
  }

  /* ---------------- 缓存：内存 + localStorage ---------------- */

  function readCache(region) {
    var now = Date.now();
    var entry = memory[region];
    if (entry && now - entry.at < TTL) return entry.model;
    entry = store()[region];
    if (entry && entry.model && now - entry.at < TTL) {
      memory[region] = entry;
      return entry.model;
    }
    return null;
  }

  function writeCache(region, model) {
    var entry = { at: Date.now(), model: model };
    memory[region] = entry;
    var all = store();
    all[region] = entry;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) { /* 隐私模式或配额满：只剩内存缓存，不影响本次显示 */ }
  }

  function store() {
    var all = null;
    try {
      all = JSON.parse(localStorage.getItem(STORE_KEY));
    } catch (e) { all = null; }
    if (!all || typeof all !== 'object') all = {};
    var now = Date.now();
    Object.keys(all).forEach(function (k) {
      if (!all[k] || !all[k].model || now - all[k].at > TTL) delete all[k];
    });
    return all;
  }

  return { load: load };
})();

/**
 * localStorage 偏好封装：单键 nav.settings（JSON 对象），只存用户显式覆盖的字段。
 * 键名与结构同时被 index.html 首屏内联脚本读取，改动须两处同步。
 * 不可用（隐私模式等）时静默回落空对象。
 */
window.NavPrefs = (function () {
  'use strict';

  var KEY = 'nav.settings'; // { background?, bgBlur?, theme?, engine? }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      return s && typeof s === 'object' ? s : {};
    } catch (e) {
      return {};
    }
  }

  // 字段传 undefined 表示删除该项；对象为空时整个键移除，回落 YAML 默认
  function save(patch) {
    try {
      var s = load();
      Object.keys(patch).forEach(function (k) {
        if (patch[k] === undefined) delete s[k];
        else s[k] = patch[k];
      });
      if (Object.keys(s).length) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch (e) { /* 隐私模式 */ }
  }

  return { load: load, save: save };
})();

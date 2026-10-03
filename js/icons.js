/** 图标解析（纯函数，无 DOM）：URL → 降级链；失败时提供字母兜底所需信息 */
window.NavIcons = (function () {
  'use strict';

  // 国内可达的聚合 favicon 源，{domain} 替换为主机名；换源只改这里
  var FAVICON_PRIMARY = 'https://api.iowen.cn/favicon/{domain}.ico';

  function chain(url) {
    try {
      var u = new URL(url);
      return [FAVICON_PRIMARY.replace('{domain}', u.hostname), u.origin + '/favicon.ico'];
    } catch (e) {
      return [];
    }
  }

  // 字母兜底：首字符 + 按 host 哈希的稳定渐变色
  function letterTile(site) {
    var name = (site && (site.name || site.host)) || '?';
    var hue = hueOf((site && site.host) || name);
    return {
      char: (Array.from(String(name).trim())[0] || '?').toUpperCase(),
      hue: hue,
      hue2: (hue + 28) % 360,
      host: (site && site.host) || ''
    };
  }

  function hueOf(seed) {
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
  }

  return { chain: chain, letterTile: letterTile };
})();

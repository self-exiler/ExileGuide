/**
 * 行情数据层：金融界「大盘云图」公开接口 → 归一化市值树 + 维度行情。
 * 本文件不做任何 DOM 操作；色阶与阈值原样对齐源站，便于对照校验。
 *
 * 接口（均为 POST + JSON，网关回 Access-Control-Allow-Origin: *，无需 key）：
 *   /quot-dpyt/v1/market {mkt:1}  → 行业 → 二级 → 个股 的市值占比树（scale 单位 %，同级相对值）
 *   /quot-dpyt/v1/hq {column:key} → { hqs: { sid: { np: 现价, var: 该维度值 } }, td: 交易日, tm: 时间 }
 * 请求不带凭据（fetch 默认 same-origin 凭据策略），符合 NFR-4。
 */
window.NavMarket = (function () {
  'use strict';

  var GATEWAY = 'https://gateway.jrj.com';
  var POLL_MS = 12000;      // 源站 dpytData 轮询周期
  var FALLBACK = 'rgb(79, 69, 84)'; // 停牌 / 无数据

  // 源站 25 档细分色带：绿（跌）→ 灰 → 红（涨）
  var FLAG_COLORS = [
    '#00D641', '#30CB5B', '#21C558', '#1AA448', '#1C9344', '#177D39', '#0E6F2F', '#0F682D',
    '#0C6A2B', '#085421', '#37694E', '#3B5A51', '#424453', '#4E4655', '#704552', '#6D1414',
    '#7D1616', '#8E0E0E', '#961010', '#A10808', '#AE0A0A', '#BE0808', '#C51010', '#CD1111', '#E41414'
  ];
  // 源站 9 档标尺色（图例用）
  var BAND_COLORS = ['#28d742', '#1da548', '#106f2f', '#0a5421', '#424454', '#6d1414', '#960f0f', '#be1207', '#e41813'];

  var DIMENSIONS = [
    { key: 'chg', label: '涨跌幅', kind: 'pct', range: [-4, -3, -2, -1, 0, 1, 2, 3, 4] },
    { key: 'chgw', label: '近一周', kind: 'pct', range: [-8, -6, -4, -2, 0, 2, 4, 6, 8] },
    { key: 'chgm', label: '近一月', kind: 'pct', range: [-16, -12, -8, -4, 0, 4, 8, 12, 16] },
    { key: 'chgy', label: '近一年', kind: 'pct', range: [-32, -24, -16, -8, 0, 8, 16, 24, 32] },
    { key: 'netin', label: '资金净流入', kind: 'money', range: [-5000, -3000, -1000, -500, 0, 500, 1000, 3000, 5000] },
    { key: 'pefwd', label: '市盈率', kind: 'ratio', range: [0, 15, 30, 45, 60, 75, 90, 105, 120], reverse: true }
  ];

  var tree = null;          // loadTree() 后缓存：结构一天内基本不变
  var timer = null;
  var session = null;       // { dim, onData, onError }
  var seq = 0;              // 丢弃过期响应

  /* ---------------- 维度与色阶 ---------------- */

  function dimension(key) {
    for (var i = 0; i < DIMENSIONS.length; i++) if (DIMENSIONS[i].key === key) return DIMENSIONS[i];
    return DIMENSIONS[0];
  }

  // 接口原值 → 色阶刻度值（百分比列接口给的是小数，净流入给的是元）
  function scaledValue(dim, raw) {
    if (raw === null || raw === undefined || isNaN(raw)) return null;
    if (dim.kind === 'pct') return raw * 100;
    if (dim.kind === 'money') return raw / 1e4;
    return Number(raw);
  }

  // 源站 showColor 的等价实现（越界钳位，避免 index 落到数组外）
  function colorOf(dim, raw) {
    var value = scaledValue(dim, raw);
    if (value === null) return FALLBACK;
    var colors = dim.reverse ? FLAG_COLORS.slice().reverse() : FLAG_COLORS;
    var r = dim.range;
    var last = r.length - 1;
    if (value <= (r[0] + r[1]) / 2) return colors[0];
    if (value > (r[last] + r[last - 1]) / 2) return colors[colors.length - 1];
    var index = Math.round((value - r[0]) / (r[last] - r[0]) * colors.length);
    return colors[Math.max(0, Math.min(colors.length - 1, index))];
  }

  function textOf(dim, raw) {
    var value = scaledValue(dim, raw);
    if (value === null) return '--';
    if (dim.kind === 'pct') return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
    if (dim.kind === 'money') {
      var abs = Math.abs(value);
      var unit = abs > 1e4 ? '亿' : '万';
      var num = abs > 1e4 ? abs / 1e4 : abs;
      return (value < 0 ? '-' : '+') + num.toFixed(2) + unit;
    }
    return value.toFixed(2);
  }

  // 图例：9 档色块 + 刻度文本（净流入刻度单位是万）
  function legendOf(dim) {
    var palette = dim.reverse ? BAND_COLORS.slice().reverse() : BAND_COLORS;
    return dim.range.map(function (tick, i) {
      var label;
      if (dim.kind === 'pct') label = (tick > 0 ? '+' : '') + tick + '%';
      else if (dim.kind === 'money') label = (tick > 0 ? '+' : '') + tick + '万';
      else label = String(tick);
      return { color: palette[i], label: label };
    });
  }

  /* ---------------- 请求 ---------------- */

  function post(path, body) {
    return fetch(GATEWAY + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      if (!json || json.code !== 20000) throw new Error('接口 code=' + (json && json.code));
      return json.data;
    });
  }

  // 归一化为 { name, weight, children } / 叶子 { sid, name, code, weight }
  function normalizeTree(indus) {
    return (Array.isArray(indus) ? indus : []).map(function (ind) {
      return {
        name: String(ind.name || '未命名'),
        weight: Number(ind.scale) || 0,
        children: (Array.isArray(ind.children) ? ind.children : []).map(function (grp) {
          return {
            name: String(grp.name || '未命名'),
            weight: Number(grp.scale) || 0,
            children: (Array.isArray(grp.children) ? grp.children : []).map(function (stock) {
              return {
                sid: stock.sid,
                code: String(stock.code || ''),
                name: String(stock.name || stock.code || ''),
                weight: Number(stock.scale) || 0
              };
            })
          };
        })
      };
    }).filter(function (n) { return n.weight > 0 && n.children.length; });
  }

  function loadTree() {
    if (tree) return Promise.resolve(tree);
    return post('/quot-dpyt/v1/market', { mkt: 1 }).then(function (data) {
      tree = normalizeTree(data && data.indus);
      if (!tree.length) throw new Error('市值树为空');
      return tree;
    });
  }

  function loadQuotes(dimKey) {
    var dim = dimension(dimKey);
    return loadTree().then(function (t) {
      return post('/quot-dpyt/v1/hq', { column: dim.key }).then(function (data) {
        return { dim: dim, tree: t, hqs: data.hqs || {}, td: data.td, tm: data.tm };
      });
    });
  }

  /* ---------------- 轮询 ---------------- */

  function pump() {
    if (!session) return;
    var my = ++seq;
    loadQuotes(session.dim).then(function (payload) {
      if (my === seq && session) session.onData(payload);
    }).catch(function (e) {
      if (my === seq && session && session.onError) session.onError(e);
    });
  }

  // 开始（或换维度重来）：立即取一次，之后每 POLL_MS 一次
  function watch(dimKey, callbacks) {
    session = {
      dim: dimension(dimKey).key,
      onData: callbacks.onData,
      onError: callbacks.onError
    };
    restartTimer();
    pump();
  }

  function setDimension(dimKey) {
    if (!session) return;
    session.dim = dimension(dimKey).key;
    pump();
  }

  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(pump, POLL_MS);
  }

  // 页面不可见 / 不在云图页时停表，回到本页立刻补一次
  function pause() { clearInterval(timer); timer = null; }

  function resume() {
    if (!session || timer) return;
    pump();
    restartTimer();
  }

  function tradingStamp(td, tm) {
    var d = String(td || '');
    var t = String(tm || '').padStart(6, '0');
    if (d.length !== 8) return '';
    return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + ' ' +
           t.slice(0, 2) + ':' + t.slice(2, 4) + ':' + t.slice(4, 6);
  }

  return {
    DIMENSIONS: DIMENSIONS,
    colorOf: colorOf,
    textOf: textOf,
    legendOf: legendOf,
    watch: watch,
    setDimension: setDimension,
    pause: pause,
    resume: resume,
    tradingStamp: tradingStamp
  };
})();

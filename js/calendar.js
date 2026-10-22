/**
 * 投资日历数据层：东方财富数据中心两个公开报表自组「投资日历」，只取数不做 DOM。
 *
 * 背景：需求原型是集思录首页的投资日历，但其接口无 CORS 头、不支持 JSONP、站点禁 iframe，
 * 公共 CORS 代理又实测被源站拦截——纯前端不可行。东财 datacenter 接口带
 * Access-Control-Allow-Origin: *，可浏览器直连：
 *   RPT_IPO_CALENDAR   新股/转债 申购·中签率·中签号·缴款日·上市（按 TRADE_DATE 过滤单日）
 *   RPT_BOND_CB_LIST   转债全表（按 TRANSFER_END_DATE 过滤出「最后转股日」）
 * 休市只按周末本地判断（法定节假日接口均不适合免后端使用）。
 * 结果按日期缓存于 localStorage：当天 10 分钟（事件日内仍会追加），其它日期不过期。
 */
window.NavCalendar = (function () {
  'use strict';

  var HOST = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  var IPO_BASE = HOST + '?reportName=RPT_IPO_CALENDAR&columns=ALL' +
    '&pageSize=500&pageNumber=1&sortColumns=DATE_TYPE&sortTypes=1&source=WEB&client=WEB&filter=';
  var CB_BASE = HOST + '?reportName=RPT_BOND_CB_LIST' +
    '&columns=SECURITY_CODE,SECURITY_NAME_ABBR,CONVERT_STOCK_CODE,TRANSFER_END_DATE' +
    '&pageSize=200&pageNumber=1&source=WEB&client=WEB&filter=';
  var EM = 'https://data.eastmoney.com';
  var STORE_KEY = 'nav.calendar';
  var TTL_TODAY = 10 * 60 * 1000;
  var FETCH_TIMEOUT = 12000;

  // 新股=0、转债=1 两组事件名与固定配色（对齐集思录日历的观感）
  var IPO_TYPES = {
    '申购':   { kind: 'stock', title: '新股申购',   color: '#5bb9dc' },
    '中签率': { kind: 'stock', title: '新股中签',   color: '#e4c47e' },
    '中签号': { kind: 'stock', title: '新股中签',   color: '#e4c47e' },
    '缴款日': { kind: 'stock', title: '新股缴款',   color: '#d9599b' },
    '上市':   { kind: 'stock', title: '新股上市',   color: '#e26c58' }
  };
  var CB_TYPES = {
    '申购':   { kind: 'cb', title: '转债申购', color: '#5bb9dc' },
    '中签率': { kind: 'cb', title: '转债中签', color: '#e4c47e' },
    '中签号': { kind: 'cb', title: '转债中签', color: '#e4c47e' },
    '缴款日': { kind: 'cb', title: '转债缴款', color: '#d9599b' },
    '上市':   { kind: 'cb', title: '转债上市', color: '#e26c58' }
  };
  var CEASE = { title: '转债最后转股日', color: '#e4c47e' };

  async function load(dateKey, opts) {
    var force = !!(opts && opts.force);
    if (!force) {
      var hit = readCache(dateKey);
      if (hit) return hit;
    }
    var next = shiftKey(dateKey, 1);
    var rows = await Promise.all([
      fetchRows(IPO_BASE + dayFilter('TRADE_DATE', dateKey, next), '新股日历'),
      fetchRows(CB_BASE + dayFilter('TRANSFER_END_DATE', dateKey, next), '转债表')
    ]);
    var model = buildModel(dateKey, rows[0], rows[1]);
    writeCache(dateKey, model);
    return model;
  }

  /* ---------------- 请求 ---------------- */

  // 东财 filter 语法：括号串联，字符串用单引号；'YYYY-MM-DD' 前缀比较即可覆盖 '... 00:00:00'
  function dayFilter(field, from, to) {
    return encodeURIComponent('(' + field + '>=' + sq(from) + ')(' + field + '<' + sq(to) + ')');
  }

  function sq(s) { return "'" + s + "'"; }

  function fetchRows(url, label) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT);
    return fetch(url, { cache: 'no-store', signal: ctrl.signal }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error(label + ' HTTP ' + res.status);
      return res.json();
    }, function (e) {
      clearTimeout(timer);
      throw new Error(label + '请求失败：' + (e && e.name === 'AbortError' ? '超时' : (e && e.message) || e));
    }).then(function (json) {
      var r = json && json.result;
      // 0 行时东财不返回 result，而是 success:false + code 9201「返回数据为空」，须与真错误区分
      if (!r) {
        if (json && (json.success === true || json.code === 9201)) return [];
        throw new Error(label + '接口返回异常' + (json && json.message ? '：' + json.message : ''));
      }
      return Array.isArray(r.data) ? r.data : [];
    });
  }

  /* ---------------- 归一化 ---------------- */

  function buildModel(dateKey, ipoRows, ceaseRows) {
    var order = [];
    var byTitle = {};

    function push(conf, item) {
      if (!byTitle[conf.title]) {
        byTitle[conf.title] = { title: conf.title, color: conf.color, items: [] };
        order.push(conf.title);
      }
      byTitle[conf.title].items.push(item);
    }

    ipoRows.forEach(function (r) {
      var conf = (String(r.SECURITY_TYPE) === '1' ? CB_TYPES : IPO_TYPES)[r.DATE_TYPE];
      if (!conf) return;
      push(conf, {
        code: String(r.SECURITY_CODE || ''),
        name: String(r.SECURITY_NAME_ABBR || ''),
        notes: String(r.DATE_TYPE || '') + ' · ' + dateKey + marketOf(r.SECUCODE),
        // 转债与新股都带 ORG_CODE（发行公司），按券/股选不同的详情页
        url: conf.kind === 'cb'
          ? EM + '/kzz/detail/' + encodeURIComponent(String(r.SECURITY_CODE)) + '.html'
          : r.ORG_CODE
            ? EM + '/xg/xg/detail/' + encodeURIComponent(String(r.ORG_CODE)) + '.html'
            : ''
      });
    });

    ceaseRows.forEach(function (r) {
      push(CEASE, {
        code: String(r.SECURITY_CODE || ''),
        name: String(r.SECURITY_NAME_ABBR || ''),
        notes: '最后转股日 ' + dateKey + '，次日停止交易',
        url: EM + '/kzz/detail/' + encodeURIComponent(String(r.SECURITY_CODE)) + '.html'
      });
    });

    var weekend = isWeekend(dateKey);
    return {
      date: dateKey,
      rest: weekend,
      restLabel: weekend ? '周末' : '',
      groups: order.map(function (t) { return byTitle[t]; })
    };
  }

  function marketOf(secu) {
    var s = String(secu || '');
    if (/\.SH$/.test(s)) return '·沪';
    if (/\.SZ$/.test(s)) return '·深';
    if (/\.BJ$/.test(s)) return '·北交所';
    return '';
  }

  /* ---------------- 日期工具（只用本地字段，避开 new Date('YYYY-MM-DD') 的 UTC 偏移坑） ---------------- */

  function fmtKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function shiftKey(key, days) {
    var p = key.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days);
    return fmtKey(d);
  }

  function isWeekend(key) {
    var p = key.split('-');
    var day = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
    return day === 0 || day === 6;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------------- 缓存：localStorage（按日期键） ---------------- */

  function readCache(dateKey) {
    var entry = store()[dateKey];
    return entry ? entry.model : null;
  }

  function writeCache(dateKey, model) {
    var all = store();
    all[dateKey] = { at: Date.now(), model: model };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) { /* 隐私模式或配额满：本次显示仍正常，只是下次要重新取 */ }
  }

  function store() {
    var all = null;
    try {
      all = JSON.parse(localStorage.getItem(STORE_KEY));
    } catch (e) { all = null; }
    if (!all || typeof all !== 'object') all = {};
    var today = fmtKey(new Date());
    var now = Date.now();
    Object.keys(all).forEach(function (k) {
      // 非今天的条目不过期；只有「今天」的条目按 TTL_TODAY 滚动失效
      var ttl = k === today ? TTL_TODAY : Infinity;
      if (!all[k] || !all[k].model || typeof all[k].at !== 'number' || now - all[k].at > ttl) delete all[k];
    });
    return all;
  }

  return { load: load, fmtKey: fmtKey, shiftKey: shiftKey };
})();

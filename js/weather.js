/**
 * 天气数据层：Open-Meteo 接口 + YAML 预设城市 → 每城归一化预报模型。
 * 本文件不做任何 DOM 操作，也不读 YAML / localStorage（城市列表由 app.js 传入）。
 *
 * 接口（均回 Access-Control-Allow-Origin: *，无需 key，实测 2026-10-06）：
 *   api.open-meteo.com/v1/forecast        当前 + 7 天逐日
 *   air-quality-api.open-meteo.com       美标 AQI + PM2.5/PM10（失败不拖累主数据）
 * 两者都支持**多地点**：latitude=a,b,c&longitude=… 一次回一个数组，按请求顺序对齐，
 * 故 N 座城市只需 2 个请求（单地点时接口回对象而非数组，须归一）。
 *
 * 已放弃的路线：中国天气网 JSON（无 Referer 直接 403，浏览器无法伪造）、
 * geocoding 城市搜索（本期的城市改为 YAML 预设，见 FR-13）。
 */
window.NavWeather = (function () {
  'use strict';

  var FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
  var AIR_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  var REFRESH_MS = 600000;   // 10 分钟：上游逐小时更新，再快没有意义
  var FORECAST_DAYS = 7;

  // WMO 天气代码 → 中文标签 + 分组（分组决定卡片强调色，见 style.css 的 .wx--*）
  var WMO = {
    0: ['晴', 'clear'], 1: ['晴间多云', 'clear'], 2: ['多云', 'cloud'], 3: ['阴', 'cloud'],
    45: ['雾', 'fog'], 48: ['凇雾', 'fog'],
    51: ['弱毛毛雨', 'drizzle'], 53: ['毛毛雨', 'drizzle'], 55: ['浓毛毛雨', 'drizzle'],
    56: ['冻毛毛雨', 'drizzle'], 57: ['冻毛毛雨', 'drizzle'],
    61: ['小雨', 'rain'], 63: ['中雨', 'rain'], 65: ['大雨', 'rain'],
    66: ['冻雨', 'rain'], 67: ['强冻雨', 'rain'],
    71: ['小雪', 'snow'], 73: ['中雪', 'snow'], 75: ['大雪', 'snow'], 77: ['雪粒', 'snow'],
    80: ['弱阵雨', 'showers'], 81: ['阵雨', 'showers'], 82: ['强阵雨', 'showers'],
    85: ['弱阵雪', 'snow'], 86: ['阵雪', 'snow'],
    95: ['雷阵雨', 'thunder'], 96: ['雷暴伴冰雹', 'thunder'], 99: ['强雷暴伴冰雹', 'thunder']
  };

  // 美标 AQI 分级（口径与源接口一致，标签里写明"美标"避免与国内 AQI 混淆）
  var AQI_BANDS = [
    { max: 50, label: '优', cls: 'aqi--good' },
    { max: 100, label: '良', cls: 'aqi--moderate' },
    { max: 150, label: '轻度污染', cls: 'aqi--usg' },
    { max: 200, label: '中度污染', cls: 'aqi--unhealthy' },
    { max: 300, label: '重度污染', cls: 'aqi--very' },
    { max: Infinity, label: '严重污染', cls: 'aqi--hazardous' }
  ];

  var session = null;   // { cities, onData, onError }
  var timer = null;
  var seq = 0;

  /* ---------------- 归一化 ---------------- */

  function condition(code) {
    var hit = WMO[code];
    return hit ? { label: hit[0], group: hit[1] } : { label: '未知', group: 'cloud' };
  }

  function aqiBand(value) {
    for (var i = 0; i < AQI_BANDS.length; i++) if (value <= AQI_BANDS[i].max) return AQI_BANDS[i];
    return AQI_BANDS[AQI_BANDS.length - 1];
  }

  // daily[0] 即"当地今天"（接口按 timezone=auto 返回），据此定今天/明天/星期，
  // 不能用 new Date('YYYY-MM-DD') 推星期——那按 UTC 解析，东八区会整体偏一天。
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dayLabel(ymd, offset) {
    if (offset === 0) return '今天';
    if (offset === 1) return '明天';
    var p = String(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? ymd.slice(5) : WEEKDAYS[d.getDay()];
  }

  function normalize(city, forecast, air) {
    var cur = (forecast && forecast.current) || {};
    var day = (forecast && forecast.daily) || {};
    var days = [];
    for (var i = 0; i < (day.time ? day.time.length : 0); i++) {
      var cond = condition(day.weather_code[i]);
      days.push({
        date: day.time[i],
        label: dayLabel(day.time[i], i),
        cond: cond.label,
        group: cond.group,
        max: day.temperature_2m_max[i],
        min: day.temperature_2m_min[i],
        rain: day.precipitation_probability_max ? day.precipitation_probability_max[i] : null
      });
    }
    var now = condition(cur.weather_code);
    return {
      city: city,
      updated: cur.time,
      now: {
        temp: cur.temperature_2m,
        feels: cur.apparent_temperature,
        humidity: cur.relative_humidity_2m,
        wind: cur.wind_speed_10m,
        precip: cur.precipitation,
        cond: now.label,
        group: now.group
      },
      days: days,
      air: air && air.current && air.current.us_aqi != null ? {
        aqi: air.current.us_aqi,
        pm25: air.current.pm2_5,
        pm10: air.current.pm10,
        band: aqiBand(air.current.us_aqi)
      } : null
    };
  }

  /* ---------------- 请求 ---------------- */

  function get(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      if (json && !Array.isArray(json) && json.error) throw new Error(json.reason || '接口返回 error');
      // 单地点时接口回对象而非数组，统一成数组再按顺序对齐
      return Array.isArray(json) ? json : [json];
    });
  }

  function joinCoords(cities, key) {
    return cities.map(function (c) { return Number(c[key]); }).join(',');
  }

  function forecastUrl(cities) {
    return FORECAST_API + '?latitude=' + joinCoords(cities, 'lat') + '&longitude=' + joinCoords(cities, 'lon') +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&forecast_days=' + FORECAST_DAYS;
  }

  function airUrl(cities) {
    return AIR_API + '?latitude=' + joinCoords(cities, 'lat') + '&longitude=' + joinCoords(cities, 'lon') +
      '&current=us_aqi,pm2_5,pm10&timezone=auto';
  }

  // 空气质量是附加信息：失败降级为全城无 AQI 块，不让整页报错
  function load(cities) {
    return Promise.all([
      get(forecastUrl(cities)),
      get(airUrl(cities)).catch(function () { return []; })
    ]).then(function (res) {
      var forecasts = res[0];
      var airs = res[1] || [];
      return cities.map(function (city, i) {
        return normalize(city, forecasts[i], airs[i]);
      });
    });
  }

  /* ---------------- 轮询 ---------------- */

  function pump() {
    if (!session || !session.cities.length) return;
    var my = ++seq;
    load(session.cities).then(function (list) {
      if (my === seq && session) session.onData(list);
    }).catch(function (e) {
      if (my === seq && session.onError) session.onError(e);
    });
  }

  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(pump, REFRESH_MS);
  }

  function watch(cities, callbacks) {
    session = { cities: cities || [], onData: callbacks.onData, onError: callbacks.onError };
    restartTimer();
    pump();
  }

  function pause() { clearInterval(timer); timer = null; }

  function resume() {
    if (!session || timer) return;
    pump();
    restartTimer();
  }

  // 手动刷新：立即补一次并重置计时，避免与到点轮询撞成两个请求
  function refresh() {
    if (!session) return;
    restartTimer();
    pump();
  }

  return {
    watch: watch,
    refresh: refresh,
    pause: pause,
    resume: resume
  };
})();

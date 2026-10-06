/**
 * 组合根：接线数据层、偏好层、翻页层、UI 层，负责设置持久化与第 2~4 页的按需加载。
 * 设置优先级：nav.settings 覆盖 > sites.yml 默认；与默认一致的字段不落盘。
 */
(function () {
  'use strict';

  // deck 索引：0 导航 / 1 大盘云图 / 2 天气 / 3 台风
  var MARKET_PAGE = 1;
  var WEATHER_PAGE = 2;
  var TYPHOON_PAGE = 3;

  var model = null;
  var marketDim = 'chg';
  var marketStarted = false;
  var weatherStarted = false;

  var handlers = {
    onSearch: function (query, engineUrl) {
      if (!engineUrl) return;
      // split/join 而非 replace：替换 URL 里所有 %s
      window.open(engineUrl.split('%s').join(encodeURIComponent(query)), '_blank', 'noopener');
    },
    onEngineChange: function (url) {
      NavPrefs.save({ engine: url });
    },
    onSettingsApply: function (draft) {
      persist(draft);
      NavUI.applySettings(draft);
    },
    onMarketDim: function (key) {
      marketDim = key;
      if (marketStarted) NavMarket.setDimension(key);
    },
    onWeatherRefresh: function () {
      if (weatherStarted) NavWeather.refresh();
      else startWeather();
    }
  };

  function readSettings() {
    var s = NavPrefs.load();
    var d = model.settings;
    return {
      background: s.background !== undefined ? s.background : d.background,
      bgBlur: s.bgBlur !== undefined ? !!s.bgBlur : !!d.bgBlur,
      theme: s.theme || 'auto'
    };
  }

  function persist(current) {
    var d = model.settings;
    NavPrefs.save({
      background: current.background === d.background ? undefined : current.background,
      bgBlur: current.bgBlur === !!d.bgBlur ? undefined : current.bgBlur,
      theme: current.theme === 'auto' ? undefined : current.theme
    });
  }

  /* ---------------- 按需加载 ---------------- */

  function startMarket() {
    if (marketStarted) return;
    marketStarted = true;
    NavUI.marketMessage('正在加载行情…');
    NavMarket.watch(marketDim, {
      onData: NavUI.onMarketData,
      onError: function (e) { NavUI.marketError(e && e.message ? e.message : String(e)); }
    });
  }

  function startWeather() {
    if (weatherStarted) return;
    var cities = model.weather.cities;
    if (!cities.length) {
      NavUI.weatherError('data/sites.yml 的 weather.cities 为空');
      return;
    }
    weatherStarted = true;
    NavUI.weatherMessage('正在加载天气…');
    NavWeather.watch(cities, {
      onData: NavUI.onWeatherData,
      onError: function (e) { NavUI.weatherError(e && e.message ? e.message : String(e)); }
    });
  }

  // 桌面端：翻到某页才加载该页的重型内容，离开即停表；移动端无翻页事件，启动即全就绪
  function onPageChange(index) {
    if (index === MARKET_PAGE) {
      startMarket();
      NavMarket.resume();
    } else {
      NavMarket.pause();
    }
    if (index === WEATHER_PAGE) {
      startWeather();
      NavWeather.resume();
    } else {
      NavWeather.pause();
    }
    if (index === TYPHOON_PAGE) NavUI.mountTyphoon();
  }

  function onVisibility() {
    if (document.hidden) {
      NavMarket.pause();
      NavWeather.pause();
      return;
    }
    var active = NavDeck.isDesktop() ? NavDeck.activeIndex() : -1;
    if (marketStarted && (active === MARKET_PAGE || active === -1)) NavMarket.resume();
    if (weatherStarted && (active === WEATHER_PAGE || active === -1)) NavWeather.resume();
  }

  async function start() {
    NavUI.init(handlers);
    NavDeck.init({
      deck: document.getElementById('deck'),
      dots: document.getElementById('dots'),
      hooks: {
        busy: NavUI.settingsOpen,
        isTabArea: NavUI.isTabArea,
        onTabWheel: NavUI.stepTab,
        onPageChange: onPageChange
      }
    });

    try {
      model = await NavData.load();
    } catch (e) {
      NavUI.showError('数据加载失败：' + e.message + '。请检查 data/sites.yml，并通过本地 HTTP 服务访问。');
      return;
    }
    NavUI.render(model, NavPrefs.load().engine || '');
    NavUI.applySettings(readSettings());
    NavUI.renderMarketTabs(NavMarket.DIMENSIONS, marketDim);

    if (!NavDeck.isDesktop()) {
      startMarket();
      startWeather();
      NavUI.mountTyphoon();
    }
    document.addEventListener('visibilitychange', onVisibility);
  }

  document.addEventListener('DOMContentLoaded', start);
})();

/**
 * 组合根：接线数据层、偏好层、UI 层，负责设置持久化。
 * 设置优先级：nav.settings 覆盖 > sites.yml 默认；与默认一致的字段不落盘。
 */
(function () {
  'use strict';

  var model = null;

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

  async function start() {
    NavUI.init(handlers);
    try {
      model = await NavData.load();
    } catch (e) {
      NavUI.showError('数据加载失败：' + e.message + '。请检查 data/sites.yml，并通过本地 HTTP 服务访问。');
      return;
    }
    NavUI.render(model, NavPrefs.load().engine || '');
    NavUI.applySettings(readSettings());
  }

  document.addEventListener('DOMContentLoaded', start);
})();

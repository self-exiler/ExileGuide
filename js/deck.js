/**
 * 翻页层：把若干 .page 组成一个纵向 deck，桌面端用滚轮 / 键盘 / 圆点整页切换。
 *
 * 滚轮路由（本文件是全站唯一的 wheel 监听点）：
 *   1. 移动端（不满足 DESKTOP）→ 完全放行，浏览器按文档流原生滚动；
 *   2. 设置浮窗打开（hooks.busy）→ 放行，让浮窗自己滚；
 *   3. 横向手势为主（|dx| >= |dy|）→ 放行；
 *   4. 指针在首页标签栏内 → 翻分类标签（交回 hooks.onTabWheel）；
 *   5. 指针所在页的内部滚动区还能继续滚 → 放行，先滚内容再翻页；
 *   6. 其余 → 整页翻页。
 *
 * 跨域 iframe 内的滚轮由该 iframe 自己的文档消费，父页收不到事件，
 * 因此嵌入页（台风）的翻页入口是圆点与键盘，页头已写明该提示。
 *
 * DESKTOP 条件与 css/style.css 里启用 deck 布局的媒体查询是同一份契约，改一处须改两处。
 */
window.NavDeck = (function () {
  'use strict';

  var DESKTOP = '(min-width: 861px) and (hover: hover) and (pointer: fine)';
  var WHEEL_STEP = 40;    // 累积位移达多少 px 才算一次动作（对齐 FR-7.3）
  var WHEEL_IDLE = 220;   // 动作后锁定时长，防一次惯性滑动连跳

  var mq = window.matchMedia(DESKTOP);
  var deck = null;
  var dotsBox = null;
  var pages = [];
  var hooks = {};
  var index = 0;

  var wheelAcc = 0;
  var wheelMode = null;
  var wheelLocked = false;
  var lockTimer = null;
  // 翻页锁要盖住整段过渡（CSS .deck 过渡 520ms），否则过渡中排队的手势会连着翻两页；
  // 翻标签无需过渡，用 FR-7.3 的 220ms 停歇锁。
  var PAGE_LOCK = 560;

  function isDesktop() { return mq.matches; }

  function init(config) {
    deck = config.deck;
    dotsBox = config.dots;
    hooks = config.hooks || {};
    pages = Array.prototype.slice.call(deck.querySelectorAll('.page')).map(function (el, i) {
      return { el: el, id: el.dataset.page || String(i), label: el.getAttribute('aria-label') || '' };
    });
    if (!pages.length) return;

    pages.forEach(function (page, i) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dot';
      btn.title = page.label;
      btn.setAttribute('aria-label', '第 ' + (i + 1) + ' 页：' + page.label);
      btn.addEventListener('click', function () { go(i); });
      dotsBox.appendChild(btn);
    });

    // passive:false 才能 preventDefault 掉浏览器滚动
    window.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('keydown', onKeydown);
    mq.addEventListener('change', sync);
    window.addEventListener('resize', onResize);
    sync();
  }

  // 移动端：清掉 transform，交回文档流
  function sync() {
    if (!isDesktop()) {
      deck.style.transform = '';
      setDots(0);
      return;
    }
    go(index, true);
  }

  var resizeTimer = null;
  function onResize() {
    if (!isDesktop()) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { go(index, true); }, 120);
  }

  function go(next, instant) {
    if (!pages.length) return;
    index = Math.max(0, Math.min(pages.length - 1, next));   // 页间不环形：首尾越界即停
    if (instant) deck.classList.add('deck--instant');
    deck.style.transform = 'translateY(' + (-index * 100) + 'vh)';
    if (instant) {
      // 强制回流让 instant 类生效后再摘掉，否则下一次切换没有过渡
      void deck.offsetWidth;
      deck.classList.remove('deck--instant');
    }
    setDots(index);
    if (hooks.onPageChange) hooks.onPageChange(index);
  }

  function setDots(active) {
    Array.prototype.forEach.call(dotsBox.children, function (btn, i) {
      btn.setAttribute('aria-current', String(i === active));
    });
  }

  function step(dir) { go(index + dir); }

  /* ---------------- 滚轮 ---------------- */

  function onWheel(ev) {
    if (!isDesktop()) return;
    if (hooks.busy && hooks.busy()) return;

    // deltaMode 归一化为像素：Firefox 鼠标滚轮常为按行（1）报告，原值累计要滚十几格
    var scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1;
    var dy = ev.deltaY * scale;
    var dx = ev.deltaX * scale;
    if (Math.abs(dy) <= Math.abs(dx)) return;

    var mode;
    if (hooks.isTabArea && hooks.isTabArea(ev.target)) mode = 'tab';
    else if (canScrollInside(ev.target, dy)) return;
    else mode = 'page';

    ev.preventDefault();
    if (wheelLocked) return;

    if (mode !== wheelMode) { wheelMode = mode; wheelAcc = 0; }
    wheelAcc += dy;
    if (Math.abs(wheelAcc) < WHEEL_STEP) return;

    var dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    if (mode === 'tab') {
      lock(WHEEL_IDLE);
      if (hooks.onTabWheel) hooks.onTabWheel(dir);
    } else {
      lock(PAGE_LOCK);
      step(dir);
    }
  }

  function lock(ms) {
    wheelLocked = true;
    clearTimeout(lockTimer);
    lockTimer = setTimeout(function () { wheelLocked = false; }, ms);
  }

  // 页内滚动区（[data-scroll]）还有余量时先让它滚，滚到底才翻页
  function canScrollInside(target, dy) {
    var box = closest(target);
    if (!box || box.scrollHeight <= box.clientHeight + 1) return false;
    return dy > 0 ? box.scrollTop + box.clientHeight < box.scrollHeight - 1 : box.scrollTop > 0;
  }

  function closest(target) {
    var node = target;
    if (!node || !node.closest) return null;
    return node.closest('[data-scroll]');
  }

  /* ---------------- 键盘 ---------------- */

  function onKeydown(ev) {
    if (!isDesktop()) return;
    if (hooks.busy && hooks.busy()) return;
    var t = ev.target;
    // 焦点在文本框/下拉里时方向键归控件自己（BUTTON 不挡：方向键对其无默认行为）
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

    var dir = 0;
    if (ev.key === 'ArrowDown' || ev.key === 'PageDown') dir = 1;
    else if (ev.key === 'ArrowUp' || ev.key === 'PageUp') dir = -1;
    else if (ev.key === 'Home') { ev.preventDefault(); go(0); return; }
    else if (ev.key === 'End') { ev.preventDefault(); go(pages.length - 1); return; }
    else return;

    ev.preventDefault();
    step(dir);
  }

  function activeIndex() { return index; }

  return {
    init: init,
    go: go,
    activeIndex: activeIndex,
    isDesktop: isDesktop
  };
})();

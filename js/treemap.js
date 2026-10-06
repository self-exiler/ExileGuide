/**
 * 布局层：squarified treemap（Bruls, Huizing, van Wijk 1991）纯几何算法。
 * 输入 = 数值树 + 目标矩形，输出 = 带坐标的节点树；本文件不做任何 DOM、不发请求。
 *
 * 算法要点：每次都取剩余矩形的短边作为「行」的长度，往行里加元素，
 * 直到加入下一个会让最坏长宽比变差为止 —— 这保证格子尽量接近正方形。
 */
window.NavTreemap = (function () {
  'use strict';

  /**
   * 把 values 按面积铺进 rect。
   * @param {number[]} values 与调用方数组同长的权重（<=0 的项被丢弃）
   * @param {{x:number,y:number,w:number,h:number}} rect
   * @returns {Array<{index:number,x:number,y:number,w:number,h:number}>} 按 index 升序
   */
  function squarify(values, rect) {
    var out = [];
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) return out;

    var items = [];
    var total = 0;
    for (var i = 0; i < values.length; i++) {
      var v = Number(values[i]);
      if (v > 0 && isFinite(v)) { items.push({ i: i, a: v }); total += v; }
    }
    if (!items.length || total <= 0) return out;

    items.sort(function (a, b) { return b.a - a.a; });
    var scale = (rect.w * rect.h) / total;
    items.forEach(function (it) { it.a *= scale; });

    var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    var p = 0;
    while (p < items.length) {
      var vertical = w >= h;              // 短边为高 → 本次铺一条贴在顶部的横带
      var length = vertical ? h : w;      // 行沿短边展开

      var row = [items[p]];
      var rowArea = items[p].a;
      var worstNow = worst(row, length);
      var q = p + 1;
      while (q < items.length) {
        var nextRow = row.concat([items[q]]);
        var nextWorst = worst(nextRow, length);
        if (nextWorst > worstNow) break;  // 变差就封行，下一轮重开
        row = nextRow;
        rowArea += items[q].a;
        worstNow = nextWorst;
        q++;
      }

      var thick = rowArea / length;       // 行的厚度
      var off = 0;
      row.forEach(function (e) {
        var span = e.a / thick;
        out.push(vertical
          ? { index: e.i, x: x, y: y + off, w: thick, h: span }
          : { index: e.i, x: x + off, y: y, w: span, h: thick });
        off += span;
      });

      if (vertical) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      p = q;
    }

    out.sort(function (a, b) { return a.index - b.index; });
    return out;
  }

  // 一行里最差的长宽比：短边 length、行面积和 sum、元素面积 min/max
  function worst(row, length) {
    var sum = 0, mx = 0, mn = Infinity;
    for (var i = 0; i < row.length; i++) {
      var a = row[i].a;
      sum += a;
      if (a > mx) mx = a;
      if (a < mn) mn = a;
    }
    var s2 = sum * sum, l2 = length * length;
    return Math.max((l2 * mn) / s2, s2 / (l2 * mx));
  }

  /**
   * 递归铺三级树。
   * @param {Array} nodes  同层节点数组，需含 weight 与可选 children
   * @param {Object} rect  本层可用矩形
   * @param {Array} levels 每级样式参数：{ header, minW, minH, gap }
   *   header = 顶部标签带高度；节点小于 minW×minH 时不预留标签带（否则小格子全被标签吃掉）
   *   gap    = 该级块与四周的间距，块自身向内缩 gap/2（同级相邻块之间因此得到 gap 的空隙）
   * @param {number} level 当前层级（内部递归用）
   * @returns {Array<{node:Object,x:number,y:number,w:number,h:number,header:number,children:Array}>}
   *   x/y/w/h 已是**内缩后的可绘制矩形**
   */
  function packTree(nodes, rect, levels, level) {
    level = level || 0;
    var cfg = levels[level];
    if (!nodes || !cfg) return [];

    var laid = squarify(nodes.map(function (n) { return n.weight; }), rect);
    var isLast = level >= levels.length - 1;
    var insetBy = (cfg.gap || 0) / 2;

    return laid.map(function (r) {
      var node = nodes[r.index];
      var head = headerOf(node, cfg, r);
      var children = [];

      if (!isLast && Array.isArray(node.children) && node.children.length) {
        children = packTree(node.children, {
          x: r.x, y: r.y + head, w: r.w, h: r.h - head
        }, levels, level + 1);
      }

      return {
        node: node,
        x: r.x + insetBy,
        y: r.y + insetBy,
        w: Math.max(0, r.w - insetBy * 2),
        h: Math.max(0, r.h - insetBy * 2),
        header: Math.max(0, head - insetBy),
        children: children
      };
    });
  }

  function headerOf(node, cfg, r) {
    var head = cfg.header || 0;
    if (!head) return 0;
    if (r.w < (cfg.minW || 0) || r.h < (cfg.minH || 0)) return 0;
    return head;
  }

  return { packTree: packTree };
})();

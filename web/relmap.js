// 关系图：中心是“你”，点一个圆，镜头移过去并散开下一层；再点一次收回。
// 首页用示例人物（EXAMPLE），结果页用真实结果拼出来的树。
// 节点：{ id, kind: me|group|person|theirs, label, short?, fit?, note?, href?, tab?, kids? }
export const EXAMPLE = {
  id: 'me', kind: 'me', label: '你', short: 'C',
  kids: [
    { id: 'ideal', kind: 'group', label: '你的理想型', short: 'B', note: 'B · 你的理想型', hub: { label: '你', planet: 'planet-c', at: 'me', note: '离你越近，越符合你的要求' },
      kids: [
        { id: 'p1', kind: 'person', label: '晴川', pct: 98, note: '再点一下，看他想找谁', kids: [{ id: 'p1i', kind: 'theirs', label: '他想找的', fit: '你 4/5', note: '你符合他 4 条，差 1 条' }] },
        { id: 'p2', kind: 'person', label: '远山', pct: 91, note: '再点一下，看他想找谁', kids: [{ id: 'p2i', kind: 'theirs', label: '他想找的', fit: '你 5/5', note: '你也全符合：两边都对得上' }] },
        { id: 'p3', kind: 'person', label: '南风', pct: 84, note: '再点一下，看他想找谁', kids: [{ id: 'p3i', kind: 'theirs', label: '他想找的', fit: '你 3/4', note: '你符合他 3 条' }] },
        { id: 'p4', kind: 'person', label: '映雪', pct: 76, note: '符合你 76% 的要求' },
        { id: 'p5', kind: 'person', label: '星野', pct: 69, note: '符合你 69% 的要求' },
      ] },
    { id: 'seekers', kind: 'group', label: '想找你这样的人', short: 'D', note: 'D · 想找你这样的人', hub: { label: '你', planet: 'planet-c', at: 'me', note: '离你越近，你越符合他们的要求' },
      kids: [
        { id: 's1', kind: 'person', label: '青禾', pct: 100, note: '你符合他全部要求' },
        { id: 's2', kind: 'person', label: '白石', pct: 92, note: '你符合他大部分要求' },
        { id: 's3', kind: 'person', label: '知秋', pct: 80, note: '你符合他 4 条' },
      ] },
    { id: 'theirs', kind: 'group', label: '理想型的理想型', short: 'A', note: 'A · 理想型的理想型',
      kids: [
        { id: 't1', kind: 'person', label: '若溪', fit: '3/3', note: '完全符合 3 位理想型人选的要求' },
        { id: 't2', kind: 'person', label: '初夏', fit: '2/3', note: '完全符合其中 2 位的要求' },
        { id: 't3', kind: 'person', label: '你', fit: '前 12%', note: '按他们的要求，你排在前 12% 左右' },
      ] },
  ],
};

const SIZE = { me: 84, group: 70, person: 50, theirs: 50 };
// Z 字完全照 logo：A 理想型的理想型（左上）、B 你的理想型（右，稍低）、C 你（左，再低）、D 想找你这样的人（右下）
// 下面的数字都是从 logo 原图（1254×1254）里量出来的：四颗星的圆心和半径、三条光丝的贝塞尔曲线
let filterN = 0; // 每张图的滤镜 id 各不相同
const LOGO_C = 627, ZK = 0.42, BODY = 1; // BODY：四颗主星比 logo 原比例略小一点，留出光丝
const STAR = { theirs: [362.2, 276.6, 107.9], ideal: [859.9, 472.5, 111.5], me: [399.3, 756, 109.2], seekers: [855.8, 948.2, 114.2] };
// 换成蓝色的星球（A 冰月、B 极光）：它们的边缘光、光丝那一头用冷光
const COLD = new Set(['theirs', 'ideal']);
const THREAD = { // 起点、两个控制点、终点；起点终点就在星球边上光丝接触的地方
  AB: [[455.5, 330.8], [539.6, 348.4], [692.7, 378.3], [775.8, 399.3]],
  CB: [[466.1, 669.6], [537.8, 621.6], [690.7, 595.2], [779.6, 549.8]],
  CD: [[469, 840.1], [533.7, 868.3], [674.5, 943], [743.8, 925.8]],
};
const L2P = ([x, y]) => [(x - LOGO_C) * ZK, (y - LOGO_C) * ZK];
// 主线按关系方向画（光点沿这个方向流动）：你 → B，B → A，D → 你
const ZLINE = { ideal: THREAD.CB, theirs: [...THREAD.AB].reverse(), seekers: [...THREAD.CD].reverse() };
const ZEND = { ideal: ['me', 'ideal'], theirs: ['ideal', 'theirs'], seekers: ['seekers', 'me'] }; // 每条主线两端各接哪颗星

// 光丝的宽度也是从原图量的（亮度过半的宽度，原图像素）：接触处约 55，10% 处约 30，20% 处约 15，中间只有 2~4
const ZW = (t) => 2.5 + 52 * (Math.exp(-t / 0.12) + Math.exp(-(1 - t) / 0.12));
const bez = (c, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]); };
// 沿曲线按宽度函数铺出一条“喇叭形”的光带：两端宽、中间细
function ribbon(c, k = 1, add = 0) {
  const N = 48, l = [], r = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = bez(c, t), q = bez(c, Math.min(1, t + 0.005)), o = bez(c, Math.max(0, t - 0.005));
    const tx = q[0] - o[0], ty = q[1] - o[1], n = Math.hypot(tx, ty) || 1, nx = -ty / n, ny = tx / n;
    const hw = (ZW(t) * ZK * k + add) / 2;
    l.push(`${(p[0] + nx * hw).toFixed(1)} ${(p[1] + ny * hw).toFixed(1)}`); r.push(`${(p[0] - nx * hw).toFixed(1)} ${(p[1] - ny * hw).toFixed(1)}`);
  }
  return `M${l.join(' L')} L${r.reverse().join(' L')} Z`;
}
// 星球边上的光：从接触点沿边缘向两侧各走约 40°，越远越暗（原图里亮度在 15°~20° 内降一半）
function rimArcs(key, pt, id, tag) {
  const star = STAR[key], [cx, cy] = L2P(star);
  return rimAt(key, cx, cy, star[2] * ZK * BODY, COLD.has(key), pt, id, tag); // A、B 是蓝色星球：边缘用冷光；“你”和 D 保持暖光
}
function rimAt(key, cx, cy, R, cold, pt, id, tag, span = 1) {
  const a0 = Math.atan2(pt[1] - cy, pt[0] - cx);
  // 一组弧放进一个 <g>：这颗星球被选中、放大时，弧跟着一起放大，始终贴在边上
  return `<g class="rim" data-star="${key}" style="transform-origin:${cx.toFixed(1)}px ${cy.toFixed(1)}px">${[-1, 1].map((sgn, j) => {
    const a1 = a0 + sgn * span, ex = cx + Math.cos(a1) * R, ey = cy + Math.sin(a1) * R, sx = cx + Math.cos(a0) * R, sy = cy + Math.sin(a0) * R;
    const gid = `rm-rim-${id}-${tag}${j}`;
    const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} A ${R.toFixed(1)} ${R.toFixed(1)} 0 0 ${sgn > 0 ? 1 : 0} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    return `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}"><stop offset="0" stop-color="${cold ? '#EDF7FF' : '#FFF3E0'}" stop-opacity="1"/><stop offset=".45" stop-color="${cold ? '#92C6FF' : '#FFD9A6'}" stop-opacity=".45"/><stop offset="1" stop-color="${cold ? '#92C6FF' : '#FFD9A6'}" stop-opacity="0"/></linearGradient>
      <path data-to="${id}" class="rim-glow" style="stroke:url(#${gid})" d="${d}"/><path data-to="${id}" class="rim-core" style="stroke:url(#${gid})" d="${d}"/>
      <path data-to="${id}" class="rim-flow${cold ? ' cold' : ''}" pathLength="100" style="animation-delay:${(j * 0.9 + (tag === 'b' ? 1.8 : 0)).toFixed(1)}s" d="${d}"/>`;
  }).join('')}</g>`;
}
// 轨道按名次排：最合适的在最里圈，往外一圈一个分数档；同分同一圈。实际分数写在名字旁边
// （名单里的人分数常常挤在 95~100，按分数直接换算半径会叠成一圈）
const ORBIT0 = 132, ORBIT_GAP = 42;
// 每个人一颗自己的星球：贴图、色相、转角都由 id 算出来，同一个人永远是同一颗；不和所在组、轨道中心撞同一张图
const TEX = ['blue-a', 'blue-b', 'planet-a', 'planet-b', 'planet-d'];
const GROUP_TEX = { theirs: ['blue-a', 'blue-b'], ideal: ['blue-b'], seekers: ['planet-d'] }; // A 组的轨道中心是 B 的星球，也避开
const hashOf = (id) => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
function planetPick(id, group) {
  const h = hashOf(id), pool = TEX.filter((t) => !(GROUP_TEX[group] || []).includes(t));
  return { tex: pool[h % pool.length], hue: ((h >>> 8) % 70) - 35, rot: (h >>> 16) % 360 };
}
export function planetOf(id, group) {
  const { tex, hue, rot } = planetPick(id, group);
  return `--planet:url(/brand/${tex}.jpg);--hue:${hue}deg;--rot:${rot}deg`;
}
// 光丝靠近这个人的一端，取他星球的色调：蓝星偏冷、暖星偏暖，再跟着星球的色相偏一点
const TEX_HUE = { 'blue-a': 210, 'blue-b': 190, 'planet-a': 32, 'planet-b': 18, 'planet-d': 24 };
const tint = (tex, hue, l) => `hsl(${(TEX_HUE[tex] + hue + 360) % 360} ${/^blue/.test(tex) ? 90 : 95}% ${l}%)`;
function layout(n, x, y, dir, parent, depth, out) {
  out[n.id] = { n, x, y, parent };
  const k = n.kids || [];
  if (depth === 0) { // 根“你”是 logo 里左边第二颗星，三组按 logo 的位置和大小放
    [x, y] = L2P(STAR.me); Object.assign(out[n.id], { x, y, d: STAR.me[2] * 2 * ZK * BODY });
    k.forEach((c) => {
      const st = STAR[c.id] || [LOGO_C, LOGO_C, 0];
      const [cx, cy] = L2P(st);
      layout(c, cx, cy, Math.atan2(cy, cx), n.id, 1, out);
      if (st[2]) out[c.id].d = st[2] * 2 * ZK * BODY;
      if (c.id === 'theirs' && k.some((o) => o.id === 'ideal')) out[c.id].linkFrom = 'ideal'; // B → A
    });
    return out;
  }
  // 每个人都带“合适程度”（pct）时，围着中心散开、各连一条光丝：越合适离中心越近（同分同远）
  // 方向按名次均匀错开；不做竖向拉伸，免得上下的人看着比左右的远，读错远近
  if (k.length && k.every((c) => typeof c.pct === 'number')) {
    out[n.id].orbits = true;
    const tiers = [...new Set(k.map((c) => c.pct))].sort((a, b) => b - a), lo = tiers[tiers.length - 1], hi = tiers[0];
    k.forEach((c, i) => {
      const R = ORBIT0 + tiers.indexOf(c.pct) * ORBIT_GAP, a = -Math.PI / 2 + (i / k.length) * Math.PI * 2 + (i % 2 ? 0.22 : -0.1);
      layout(c, x + Math.cos(a) * R, y + Math.sin(a) * R, a, n.id, depth + 1, out);
      out[c.id].orbit = R;
      out[c.id].d = Math.round(34 + 38 * (hi > lo ? (c.pct - lo) / (hi - lo) : 1)); // 越合适，星球越大（组内 34~72）
      out[c.id].up = Math.sin(a) < -0.3; // 上半圈的人：名字写在星球上面，朝外，不压中间的组星
    });
    return out;
  }
  const R = 118; // 星球按 logo 变大了，展开的人离得远一点，名字不互相压住
  const spread = Math.min(2.6, 0.82 * (k.length - 1));
  k.forEach((c, i) => {
    const a = dir + (k.length === 1 ? 0 : (i / (k.length - 1) - 0.5) * spread);
    layout(c, x + Math.cos(a) * R, y + Math.sin(a) * R, a, n.id, depth + 1, out);
  });
  return out;
}
const under = (P, id, root) => { for (let p = id; p; p = P[p].parent) if (p === root) return true; return false; };

// maxH：总览时展台最高多少（默认 540）；still：只看不能点；hug：展台宽度贴着星球收窄（首页小图用）
// 挂在 window 上的监听（拖动、窗口大小），每张图一组；画新图时，把已经离开页面的旧图那组一起撤掉，不越积越多
const alive = new Set();
export function relMap(el, tree, { esc = (s) => s, onFocus = null, onList = null, onOpen = null, initial = null, maxH = 540, hug = false, still = false } = {}) {
  for (const x of alive) if (!x.el.isConnected) { x.ac.abort(); alive.delete(x); }
  const ac = new AbortController(), sig = { signal: ac.signal };
  alive.add({ el, ac });
  const P = layout(tree, 0, 0, 0, null, 0, {});
  const open = new Set([tree.id]);
  let focus = tree.id;
  el.innerHTML = `<div class="rm-view"><div class="rm-stage"><svg class="rm-lines" width="1" height="1"></svg></div></div><div class="rm-note" aria-live="polite"></div>`;
  const stage = el.querySelector('.rm-stage'), svg = el.querySelector('svg'), note = el.querySelector('.rm-note'), viewEl = el.querySelector('.rm-view');
  // still：只是展示（第一次来的首页），点、拖、键盘都不响应
  if (still) { viewEl.inert = true; el.classList.add('still'); }
  // 每个圆属于哪一组（A/B/D），星球按组上色
  let sparkN = 0;
  const groupOf = (id) => { let g = id; while (P[g]?.parent && P[g].parent !== tree.id) g = P[g].parent; return g; };
  // 中心和一个人之间的光丝：和 Z 字主线同一套画法（光晕 + 喇叭形光带 + 细亮线 + 两头星球边上的光 + 流动的光点）
  // 光点方向跟关系走：B、A 从中心流向这个人，D 从这个人流向你
  const visR = (d) => d * 0.49; // 星球贴图实际看得见的半径
  // 每条都不一样（按人算，同一个人每次一样）：越合适越粗越亮；弯的方向和幅度、单弧或 S 形、颜色、光点速度各不相同
  const personThread = (h, q, inward) => {
    const hn = h.n, hid = esc(q.n.id), hR = visR(h.d || SIZE[hn.kind]), qR = visR(q.d || SIZE.person);
    const r = hashOf(q.n.id), rnd = (k) => ((r >>> k) & 255) / 255; // 几个互不相关的 0~1
    const pcts = (hn.kids || []).map((k) => k.pct), lo = Math.min(...pcts), hi = Math.max(...pcts);
    const strong = hi > lo ? (q.n.pct - lo) / (hi - lo) : 1; // 组内名次：1 最合适，0 最不合适
    const dx = q.x - h.x, dy = q.y - h.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, len = L - hR - qR;
    const a = [h.x + ux * hR, h.y + uy * hR], e = [q.x - ux * qR, q.y - uy * qR];
    const b1 = (rnd(0) < 0.5 ? -1 : 1) * (0.05 + 0.17 * rnd(8)) * len, b2 = rnd(16) < 0.3 ? -b1 * 0.8 : b1 * (0.6 + 0.6 * rnd(24)); // 三成是 S 形
    const at = (t, b) => [a[0] + (e[0] - a[0]) * t - uy * b, a[1] + (e[1] - a[1]) * t + ux * b];
    const cs = [a, at(0.3 + 0.1 * rnd(4), b1), at(0.62 + 0.1 * rnd(12), b2), e], path = (c) => `M${c[0][0].toFixed(1)} ${c[0][1].toFixed(1)} C ${c.slice(1).map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(', ')}`;
    const hubCold = hn.hub ? /^blue/.test(hn.hub.planet) : COLD.has(hn.id);
    const { tex, hue } = planetPick(q.n.id, groupOf(q.n.id)), farCold = /^blue/.test(tex);
    const grad = (tag, near, far, op) => `<linearGradient id="rm-${tag}-${hid}" gradientUnits="userSpaceOnUse" x1="${a[0]}" y1="${a[1]}" x2="${e[0]}" y2="${e[1]}"><stop offset=".12" stop-color="${near}" stop-opacity="${op}"/><stop offset=".9" stop-color="${far}" stop-opacity="${op}"/></linearGradient>`;
    const glow = 0.3 + 0.25 * strong, w = 0.22 + 0.16 * strong + 0.05 * rnd(20), halo = 0.7 + 0.45 * strong;
    return `${grad('zh', hubCold ? '#78BEFF' : '#FFD29A', tint(tex, hue, 68), glow.toFixed(2))}${grad('zb', hubCold ? '#EAF6FF' : '#FFF4E2', tint(tex, hue, 90), (0.7 + 0.25 * strong).toFixed(2))}${grad('zc', hubCold ? '#F2F9FF' : '#FFFBF4', tint(tex, hue, 95), 0.95)}
      <path data-to="${hid}" class="z-halo" style="fill:url(#rm-zh-${hid})" d="${ribbon(cs, halo, 4 + 4 * strong)}"/>
      <path data-to="${hid}" class="z-body" style="fill:url(#rm-zb-${hid})" d="${ribbon(cs, w, 0.4)}"/>
      <path data-to="${hid}" class="z" style="stroke:url(#rm-zc-${hid});stroke-width:${(0.7 + 0.6 * strong).toFixed(2)}" d="${path(cs)}"/>
      ${rimAt(hn.id, h.x, h.y, hR, hubCold, a, hid, 'a', 0.5 + 0.35 * strong)}${rimAt(q.n.id, q.x, q.y, qR, farCold, e, hid, 'b', 0.6 + 0.5 * rnd(28))}
      <path data-to="${hid}" class="spark" pathLength="600" style="animation-duration:${(3 + 2.6 * rnd(2)).toFixed(1)}s;animation-delay:${(-5 * rnd(10)).toFixed(1)}s" d="${path(inward ? [...cs].reverse() : cs)}"/>`;
  };
  for (const { n, x, y, parent, linkFrom, d: dz, up } of Object.values(P)) {
    const d = dz || SIZE[n.kind], fit = n.fit || (typeof n.pct === 'number' ? `${n.pct}%` : '');
    stage.insertAdjacentHTML('beforeend', `<button type="button" class="rm-node k-${n.kind} g-${esc(groupOf(n.id))}${up ? ' lb-up' : ''}" data-id="${esc(n.id)}" style="left:${x}px;top:${y}px;--d:${d}px${parent && P[parent].orbits ? `;--fx:${(P[parent].x - x).toFixed(1)}px;--fy:${(P[parent].y - y).toFixed(1)}px` : ''}${n.kind === 'person' ? `;${planetOf(n.id, groupOf(n.id))}` : ''}">
      <span class="dot" aria-hidden="true"></span>
      <span class="lb">${n.short ? `<b>${esc(n.short)}</b>` : ''}${esc(n.label)}${n.seal ? '<i class="seal">代号</i>' : ''}${fit ? `<span class="fit">${esc(fit)}</span>` : ''}</span></button>`);
    if (parent && P[parent].orbits) svg.insertAdjacentHTML('beforeend', personThread(P[parent], P[n.id], n.id === 'seekers' || groupOf(n.id) === 'seekers'));
    else if (parent) {
      const p = P[linkFrom || parent];
      // Z 字主线带箭头：你 → B，B → A，D → 你；箭头停在圆边上
      const z = n.kind === 'group';
      let [x1, y1, x2, y2] = n.id === 'seekers' ? [x, y, p.x, p.y] : [p.x, p.y, x, y];
      let d, coreStyle = '';
      if (z && ZLINE[n.id]) {
        // 照 logo 原图的光丝：外面一层宽而柔的光晕，里面是喇叭形的光带（两端宽、中间细），正中一根细亮线
        const [s0, s1] = ZEND[n.id], id = esc(n.id);
        // 星球缩了 BODY，光丝两端跟着往圆心收，仍然贴在边上
        const pull = (pt, key) => { const [cx, cy] = STAR[key]; return L2P([cx + (pt[0] - cx) * BODY, cy + (pt[1] - cy) * BODY]); };
        const src = ZLINE[n.id], cs = [pull(src[0], s0), L2P(src[1]), L2P(src[2]), pull(src[3], s1)], [a, b, c, e] = cs;
        d = `M${a[0]} ${a[1]} C ${b[0]} ${b[1]}, ${c[0]} ${c[1]}, ${e[0]} ${e[1]}`;
        // 光丝颜色跟着两头的星球走：暖星（你、D）一端是暖光，冷星（A、B）一端是冷光，中间顺着光丝慢慢过渡
        const grad = (tag, warm, cold, op) => {
          const c0 = COLD.has(s0) ? cold : warm, c1 = COLD.has(s1) ? cold : warm;
          return `<linearGradient id="rm-${tag}-${id}" gradientUnits="userSpaceOnUse" x1="${a[0]}" y1="${a[1]}" x2="${e[0]}" y2="${e[1]}"><stop offset=".12" stop-color="${c0}" stop-opacity="${op}"/><stop offset=".88" stop-color="${c1}" stop-opacity="${op}"/></linearGradient>`;
        };
        const mixed = COLD.has(s0) !== COLD.has(s1);
        svg.insertAdjacentHTML('beforeend', `${grad('zh', '#FFD29A', '#78BEFF', 0.5)}${grad('zb', '#FFF4E2', '#EAF6FF', 0.95)}${grad('zc', '#FFFBF4', '#F2F9FF', 0.95)}
          <path data-to="${id}" class="z-halo" style="fill:url(#rm-zh-${id})" d="${ribbon(cs, 1.35, 10)}"/>
          <path data-to="${id}" class="z-body" style="fill:url(#rm-zb-${id})${mixed ? ';filter:var(--f-bodym)' : ''}" d="${ribbon(cs, 0.42, 0.6)}"/>
          ${rimArcs(s0, a, id, 'a')}${rimArcs(s1, e, id, 'b')}`);
        coreStyle = ` style="stroke:url(#rm-zc-${id})"`;
      } else {
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
        d = `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
      }
      svg.insertAdjacentHTML('beforeend', `<path data-to="${esc(n.id)}" class="${z ? 'z' : ''}"${coreStyle} d="${d}"/>`);
      // Z 字主线上加一个沿着关系方向流动的光点（你 → B → A，D → 你）
      if (z) svg.insertAdjacentHTML('beforeend', `<path data-to="${esc(n.id)}" class="spark" style="animation-delay:${(sparkN++ * 1.4).toFixed(1)}s" d="${d}"/>`);
    }
  }
  // 光晕、柔边用 SVG 自己的 <filter>：iOS（Safari、微信）不认 SVG 里元素上的 CSS blur()/drop-shadow()，
  // 会把光晕画成一整块实心光带。滤镜范围只框住这张图，免得手机上每条光丝开一块大缓冲
  {
    const all = Object.values(P), pad = 80;
    const fx = Math.min(...all.map((p) => p.x - (p.d || 84))) - pad, fy = Math.min(...all.map((p) => p.y - (p.d || 84))) - pad;
    const fw = Math.max(...all.map((p) => p.x + (p.d || 84))) + pad - fx, fh = Math.max(...all.map((p) => p.y + (p.d || 84))) + pad - fy;
    const uid = ++filterN, box = `filterUnits="userSpaceOnUse" x="${fx.toFixed(0)}" y="${fy.toFixed(0)}" width="${fw.toFixed(0)}" height="${fh.toFixed(0)}" color-interpolation-filters="sRGB"`;
    const shadow = (sd, c, o) => `<feDropShadow dx="0" dy="0" stdDeviation="${sd}" flood-color="${c}" flood-opacity="${o}"/>`;
    const F = {
      halo: '<feGaussianBlur stdDeviation="5"/>',
      body: `<feGaussianBlur stdDeviation=".5"/>${shadow(1, '#FFDCAA', 0.9)}`,
      bodym: `<feGaussianBlur stdDeviation=".5"/>${shadow(1, '#ECE8F0', 0.75)}`,
      rim: '<feGaussianBlur stdDeviation="4"/>',
      line: `${shadow(2, '#FFD296', 0.75)}${shadow(0.5, '#FFF5E6', 0.9)}`,
      spark: shadow(2, '#FFE2B8', 0.95),
      flow: shadow(1.5, '#FFE0B0', 0.95),
      flowc: shadow(1.5, '#82C3FF', 0.95),
    };
    svg.insertAdjacentHTML('afterbegin', `<defs>${Object.entries(F).map(([k, v]) => `<filter id="rm-f-${k}-${uid}" ${box}>${v}</filter>`).join('')}</defs>`);
    for (const k in F) svg.style.setProperty(`--f-${k}`, `url(#rm-f-${k}-${uid})`);
  }
  // 拖动：镜头中心只能在当前看得见的圆的范围里移动，拖不到空白处
  let cam = { cx: 0, cy: 0, sc: 1 };
  const place = () => {
    const W = viewEl.clientWidth, H = viewEl.clientHeight;
    stage.style.transform = `translate(${W / 2}px, ${H / 2}px) scale(${cam.sc}) translate(${-cam.cx}px, ${-cam.cy}px)`;
    stage.style.setProperty('--sc', cam.sc); // 名字按镜头倍数反向放大，手机上看起来字号不变
  };
  const bounds = () => {
    const ids = Object.keys(P).filter(visible);
    const xs = ids.map((i) => P[i].x), ys = ids.map((i) => P[i].y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  let drag = null, moved = false;
  // 拖动范围在按下时算一次，拖动过程中不再反复遍历所有圆
  viewEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy, b: bounds() }; moved = false; });
  addEventListener('pointermove', (e) => {
    if (!drag || !el.isConnected) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    if (!moved) { moved = true; stage.classList.add('dragging'); }
    const [x0, x1, y0, y1] = drag.b, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    cam.cx = clamp(drag.cx - dx / cam.sc, x0, x1);
    cam.cy = clamp(drag.cy - dy / cam.sc, y0, y1);
    place();
  }, sig);
  addEventListener('pointerup', () => { drag = null; stage.classList.remove('dragging'); }, sig);
  // 拖完松手不算点击
  viewEl.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); moved = false; } }, true);
  const visible = (id) => { const p = P[id].parent; return p === null || (open.has(p) && visible(p)); };
  let inT = 0, drawn = false;
  const draw = () => {
    // 打开一组的轨道时，只留这一组：其他星球和 Z 字光丝都先收起来，轨道单独占满画面
    // 点了轨道上的某个人：轨道照样整圈留着，只高亮这个人
    const hub = P[focus].orbits && open.has(focus) ? focus : P[P[focus].parent]?.orbits ? P[focus].parent : null;
    const orbitView = !!hub;
    // 中心是“拿谁来比”：那颗星球（你，或 A 组里的理想型）走到这一组的位置上站着，这一组散成一个个人
    const stand = hub && P[P[hub].n.hub?.at] ? P[hub].n.hub.at : null;
    const away = (id) => orbitView && id !== hub && id !== stand && !under(P, id, hub);
    // 进场编排：先收起别的，再按名次一个个从中心流出去（每个人和他的光丝各自晚一点点）
    const order = orbitView ? P[hub].n.kids.map((k) => k.id) : [];
    const stagger = (id, t) => {
      stage.querySelector(`.rm-node[data-id="${CSS.escape(id)}"]`)?.style.setProperty('--in', `${t}s`);
      svg.querySelectorAll(`[data-to="${CSS.escape(id)}"]`).forEach((l) => l.style.setProperty("--in", `${t + 0.4}s`));
    };
    stage.querySelectorAll('.rm-node').forEach((b) => {
      const id = b.dataset.id, was = b.classList.contains('show');
      b.classList.toggle('show', visible(id) && !away(id) && !(stand && id === hub));
      b.classList.toggle('split', !!stand && id === hub);
      b.classList.toggle('at-hub', id === stand);
      if (id === stand) { b.style.setProperty('--mx', `${P[hub].x - P[id].x}px`); b.style.setProperty('--my', `${P[hub].y - P[id].y}px`); }
      if (!was && b.classList.contains('show') && drawn) { const i = order.indexOf(id); stagger(id, i < 0 ? 0.2 : 0.38 + i * 0.07); }
      b.classList.toggle('focus', id === focus);
      // 轨道中心代表“拿谁来比”：B、D 组比的是你，中心换成你的星球；A 组比的是你的理想型
      b.classList.toggle('dim', focus !== tree.id && !(P[focus].n.kind === 'group' && !(P[focus].n.kids || []).length) && id !== stand && visible(id) && !away(id) && !under(P, id, focus) && !under(P, focus, id));
    });
    svg.querySelectorAll('[data-to]').forEach((l) => { const to = l.dataset.to; l.classList.toggle('show', visible(to) && !away(to) && to !== hub && to !== stand); l.classList.toggle('dim', !!stage.querySelector(`.rm-node.dim[data-id="${CSS.escape(to)}"]`)); });
    svg.querySelectorAll('.rim').forEach((g) => g.classList.toggle('big', g.dataset.star === focus));
    // 进场完了把延迟清掉，之后点人、变暗都即时响应
    clearTimeout(inT); inT = setTimeout(() => el.querySelectorAll('[style*="--in"]').forEach((e) => e.style.removeProperty('--in')), 1600);
    drawn = true;
    let W = hug ? el.parentElement.clientWidth : viewEl.clientWidth, H = viewEl.clientHeight;
    const ids = orbitView ? [hub, ...P[hub].n.kids.map((k) => k.id), ...(focus !== hub && open.has(focus) ? (P[focus].n.kids || []).map((k) => k.id) : [])]
      : [focus, P[focus].parent, ...(open.has(focus) ? (P[focus].n.kids || []).map((k) => k.id) : [])].filter(Boolean);
    // 点的是没有下一层的组：镜头不动，整张 Z 字图都留在画面里，只高亮这一组
    if (focus === tree.id || (P[focus].n.kind === 'group' && !(P[focus].n.kids || []).length)) ids.push(tree.id, ...(tree.kids || []).map((k) => k.id));
    const xs = ids.map((i) => P[i].x), ys = ids.map((i) => P[i].y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    // 按实际尺寸留边：星球直径随镜头缩放；名字字号固定（屏幕像素），左右各留名字超出星球的部分，下面留一行名字的高度
    const dMax = Math.max(...ids.map((i) => P[i].d || SIZE[P[i].n.kind] || 50));
    // 名字是固定的屏幕像素宽（字号按镜头反向补偿），量出来：每颗星左右占的宽度 = 星球和名字里更宽的那个
    const scNow = parseFloat(stage.style.getPropertyValue('--sc')) || 1;
    const lbW = Object.fromEntries(ids.map((i) => [i, (stage.querySelector(`.rm-node[data-id="${CSS.escape(i)}"] .lb`)?.offsetWidth || 0) * scNow]));
    // 名字被藏起来时（首页的小图），不用给名字留地方
    const noLabels = ids.every((i) => !lbW[i]);
    const PAD = noLabels ? 10 : 14, LABEL_H = noLabels ? 0 : 34, PAD_Y = noLabels ? 10 : 12;
    const half = (i, s) => Math.max((P[i].d || SIZE[P[i].n.kind] || 50) * s / 2, lbW[i] / 2);
    const extent = (s) => [Math.min(...ids.map((i) => P[i].x * s - half(i, s))), Math.max(...ids.map((i) => P[i].x * s + half(i, s)))];
    // 总览时展台高度跟着内容走：先按最高 540 算出能放多大，再把高度收到刚好装下，窄屏上不留一大片空
    const overview = focus === tree.id;
    const Hmax = overview ? (typeof maxH === 'function' ? maxH() : maxH) : H;
    let sc = Math.min(1.4, (Hmax - LABEL_H - 2 * PAD_Y) / (y1 - y0 + dMax));
    for (let k = 0; k < 80; k++) { const [l, r] = extent(sc); if (r - l <= W - 2 * PAD) break; sc *= 0.98; }
    if (overview) { H = Math.round((y1 - y0 + dMax) * sc + LABEL_H + 2 * PAD_Y); viewEl.style.height = `${H}px`; }
    const [l, r] = extent(sc);
    if (hug && overview) viewEl.style.width = `${Math.ceil(r - l + 2 * PAD)}px`;
    cam = { cx: (l + r) / 2 / sc, cy: (y0 + y1) / 2 + LABEL_H / 2 / sc, sc };
    place();
    const f = P[focus].n, said = focus === hub && f.hub?.note ? `${f.short ? `${f.short} · ` : ''}${f.hub.note}` : f.note;
    const more = focus === hub && f.count && onList ? `<button type="button" class="rm-more">${f.count > (f.kids || []).length ? `看全部 ${f.count} 位` : '看名单'}<span aria-hidden="true"> ↓</span></button>` : '';
    note.innerHTML = `<span>${esc(said || '')}</span>${f.href ? `<a class="btn primary sm" href="${esc(f.href)}">看详细</a>` : more}`;
    onFocus?.(f);
  };
  const select = (id) => {
    const { n, parent } = P[id];
    if (id === focus && parent !== null) { // 再点一次：收回
      for (const k of Object.keys(P)) if (under(P, k, id)) open.delete(k);
      focus = parent;
    } else {
      if (parent) for (const sib of P[parent].n.kids || []) if (sib.id !== id) for (const k of Object.keys(P)) if (under(P, k, sib.id)) open.delete(k);
      if (n.kids?.length) open.add(id);
      focus = id;
    }
    // 离开一组的轨道（比如点了中心的“你”回总览），这一组的人跟着收起，不留在总览图上
    for (const o of [...open]) if (P[o].orbits && o !== focus && !under(P, focus, o)) for (const k of Object.keys(P)) if (under(P, k, o)) open.delete(k);
    draw();
  };
  stage.addEventListener('click', (e) => {
    const b = e.target.closest('.rm-node');
    if (!b) return;
    // 一个具体的人（没有下一层）：点了直接去他的详情，不在图上多停一步
    const n = P[b.dataset.id].n;
    if (n.kind === 'person' && n.href && !(n.kids || []).length) { if (onOpen) onOpen(n, b); else location.hash = n.href; return; }
    select(b.dataset.id);
  });
  note.addEventListener('click', (e) => { if (e.target.closest('.rm-more')) onList?.(P[focus].n); });
  if (initial && P[initial]) { open.add(initial); focus = initial; }
  requestAnimationFrame(draw);
  // 窗口大小变化：每帧最多重画一次；图已离开页面就撤掉全部监听
  let rq = 0;
  addEventListener('resize', () => {
    if (!el.isConnected) return ac.abort();
    if (!rq) rq = requestAnimationFrame(() => { rq = 0; draw(); });
  }, { passive: true, ...sig });
  return { select, show: (id) => { if (P[id] && id !== focus) select(id); } };
}

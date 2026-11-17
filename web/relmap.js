// 关系图：中心是“你”，点一个圆，镜头移过去并散开下一层；再点一次收回。
// 首页用示例人物（EXAMPLE），结果页用真实结果拼出来的树。
// 节点：{ id, kind: me|group|person|theirs, label, short?, fit?, note?, href?, tab?, kids? }
export const EXAMPLE = {
  id: 'me', kind: 'me', label: '你', note: '这是示例 · 填完就换成你的',
  kids: [
    { id: 'ideal', kind: 'group', label: '他适合你', short: '3', note: '符合你要求的人',
      kids: [
        { id: 'p1', kind: 'person', label: '晴川', fit: '6/6', note: '再点一下，看他想找谁', kids: [{ id: 'p1i', kind: 'theirs', label: '他想找的', fit: '你 4/5', note: '你符合他 4 条，差 1 条' }] },
        { id: 'p2', kind: 'person', label: '远山', fit: '5/6', note: '再点一下，看他想找谁', kids: [{ id: 'p2i', kind: 'theirs', label: '他想找的', fit: '你 5/5', note: '你也全符合：互相适合' }] },
        { id: 'p3', kind: 'person', label: '南风', fit: '5/6', note: '再点一下，看他想找谁', kids: [{ id: 'p3i', kind: 'theirs', label: '他想找的', fit: '你 3/4', note: '你符合他 3 条' }] },
      ] },
    { id: 'seek', kind: 'group', label: '你适合他', short: '3', note: '你符合他们的要求',
      kids: [
        { id: 's1', kind: 'person', label: '青禾', fit: '5/5', note: '你符合他全部要求' },
        { id: 's2', kind: 'person', label: '白石', fit: '4/4', note: '你符合他全部要求' },
        { id: 's3', kind: 'person', label: '知秋', fit: '4/5', note: '你符合他 4 条' },
      ] },
    { id: 'mutual', kind: 'group', label: '互相适合', short: '1', note: '两边都对得上',
      kids: [{ id: 'm1', kind: 'person', label: '远山', fit: '双向', note: '你们互相符合' }] },
  ],
};

const SIZE = { me: 76, group: 62, person: 50, theirs: 50 };
function layout(n, x, y, dir, parent, depth, out) {
  out[n.id] = { n, x, y, parent };
  const k = n.kids || [];
  const R = depth === 0 ? 118 : 108;
  const spread = Math.min(2.4, 0.62 * (k.length - 1));
  k.forEach((c, i) => {
    const a = depth === 0 ? -Math.PI / 2 + (i * 2 * Math.PI) / k.length
      : dir + (k.length === 1 ? 0 : (i / (k.length - 1) - 0.5) * spread);
    layout(c, x + Math.cos(a) * R, y + Math.sin(a) * R, a, n.id, depth + 1, out);
  });
  return out;
}
const under = (P, id, root) => { for (let p = id; p; p = P[p].parent) if (p === root) return true; return false; };

export function relMap(el, tree, { esc = (s) => s, onFocus = null, initial = null } = {}) {
  const P = layout(tree, 0, 0, 0, null, 0, {});
  const open = new Set([tree.id]);
  let focus = tree.id;
  el.innerHTML = `<div class="rm-view"><div class="rm-stage"><svg class="rm-lines" width="1" height="1"></svg></div></div><div class="rm-note" aria-live="polite"></div>`;
  const stage = el.querySelector('.rm-stage'), svg = el.querySelector('svg'), note = el.querySelector('.rm-note'), viewEl = el.querySelector('.rm-view');
  for (const { n, x, y, parent } of Object.values(P)) {
    const d = SIZE[n.kind];
    stage.insertAdjacentHTML('beforeend', `<button type="button" class="rm-node k-${n.kind}" data-id="${esc(n.id)}" style="left:${x}px;top:${y}px;--d:${d}px">
      <span class="dot">${esc(n.short || (n.kind === 'me' ? n.label : [...n.label][0]))}</span>
      ${n.kind === 'me' ? '' : `<span class="lb">${esc(n.label)}${n.seal ? '<i class="seal">代号</i>' : ''}</span>`}
      ${n.fit ? `<span class="fit">${esc(n.fit)}</span>` : ''}</button>`);
    if (parent) {
      const p = P[parent], mx = (p.x + x) / 2 + (y - p.y) * 0.12, my = (p.y + y) / 2 - (x - p.x) * 0.12;
      svg.insertAdjacentHTML('beforeend', `<path data-to="${esc(n.id)}" d="M${p.x} ${p.y} Q${mx} ${my} ${x} ${y}"/>`);
    }
  }
  // 拖动：镜头中心只能在当前看得见的圆的范围里移动，拖不到空白处
  let cam = { cx: 0, cy: 0, sc: 1 };
  const place = () => {
    const W = viewEl.clientWidth, H = viewEl.clientHeight;
    stage.style.transform = `translate(${W / 2}px, ${H / 2}px) scale(${cam.sc}) translate(${-cam.cx}px, ${-cam.cy}px)`;
  };
  const bounds = () => {
    const ids = Object.keys(P).filter(visible);
    const xs = ids.map((i) => P[i].x), ys = ids.map((i) => P[i].y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  let drag = null, moved = false;
  viewEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy }; moved = false; });
  addEventListener('pointermove', (e) => {
    if (!drag || !el.isConnected) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    if (!moved) { moved = true; stage.classList.add('dragging'); }
    const [x0, x1, y0, y1] = bounds(), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    cam.cx = clamp(drag.cx - dx / cam.sc, x0, x1);
    cam.cy = clamp(drag.cy - dy / cam.sc, y0, y1);
    place();
  });
  addEventListener('pointerup', () => { drag = null; stage.classList.remove('dragging'); });
  // 拖完松手不算点击
  viewEl.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); moved = false; } }, true);
  const visible = (id) => { const p = P[id].parent; return p === null || (open.has(p) && visible(p)); };
  const draw = () => {
    stage.querySelectorAll('.rm-node').forEach((b) => {
      const id = b.dataset.id;
      b.classList.toggle('show', visible(id));
      b.classList.toggle('focus', id === focus);
      b.classList.toggle('dim', focus !== tree.id && visible(id) && !under(P, id, focus) && !under(P, focus, id));
    });
    svg.querySelectorAll('path').forEach((l) => l.classList.toggle('show', visible(l.dataset.to)));
    const W = viewEl.clientWidth, H = viewEl.clientHeight;
    const ids = [focus, P[focus].parent, ...(open.has(focus) ? (P[focus].n.kids || []).map((k) => k.id) : [])].filter(Boolean);
    if (focus === tree.id) ids.push(...(tree.kids || []).map((k) => k.id));
    const xs = ids.map((i) => P[i].x), ys = ids.map((i) => P[i].y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sc = Math.min(1.15, (W - 20) / (x1 - x0 + 110), (H - 20) / (y1 - y0 + 110));
    cam = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - 8, sc };
    place();
    const f = P[focus].n;
    note.innerHTML = `<span>${esc(f.note || '')}</span>${f.href ? `<a class="btn primary sm" href="${esc(f.href)}">看详细</a>` : ''}`;
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
    draw();
  };
  stage.addEventListener('click', (e) => { const b = e.target.closest('.rm-node'); if (b) select(b.dataset.id); });
  if (initial && P[initial]) { open.add(initial); focus = initial; }
  requestAnimationFrame(draw);
  const onR = () => (el.isConnected ? draw() : removeEventListener('resize', onR));
  addEventListener('resize', onR, { passive: true });
  return { select, show: (id) => { if (P[id] && id !== focus) select(id); } };
}

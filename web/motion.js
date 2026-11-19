// 苹果官网式的几处小动效：顶栏滑动后显出分隔线；分段控件的滑块
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 顶栏：页面往下滑了才加分隔线
const top = document.querySelector('.top');
const onScroll = () => top?.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// 分段控件：选中项后面放一块滑块，换选项时滑过去。
// 结果页的“一个个看 / 对照着看”每次会整块重画，所以按控件里的文字记住上一次的位置，新画出来时从那里滑过去
const SEL = '.tabs, .seg-switch, .pay-tabs';
const last = new Map();
const keyOf = (box) => box.className.split(' ')[0] + ':' + [...box.querySelectorAll(':scope > button')].map((b) => b.textContent.trim()).join('|');
function place(box, animate) {
  const on = box.querySelector(':scope > button.on');
  const thumb = box.querySelector(':scope > .seg-thumb');
  if (!thumb) return;
  if (!on) { thumb.style.opacity = '0'; return; }
  thumb.style.opacity = '';
  const pos = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
  thumb.classList.toggle('no-anim', !animate || reduce());
  thumb.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  thumb.style.width = `${pos.w}px`; thumb.style.height = `${pos.h}px`;
  last.set(keyOf(box), pos);
}
function attach(box) {
  if (box.querySelector(':scope > .seg-thumb') || !box.querySelector(':scope > button')) return;
  box.classList.add('has-thumb');
  const thumb = document.createElement('span');
  thumb.className = 'seg-thumb no-anim';
  thumb.setAttribute('aria-hidden', 'true');
  box.prepend(thumb);
  const prev = last.get(keyOf(box));
  if (prev) { // 先放在上一次的位置，下一帧再滑到现在选中的那一项
    Object.assign(thumb.style, { transform: `translate(${prev.x}px, ${prev.y}px)`, width: `${prev.w}px`, height: `${prev.h}px` });
    requestAnimationFrame(() => requestAnimationFrame(() => place(box, true)));
  } else place(box, false);
  new MutationObserver((ms) => { if (ms.some((m) => m.target.tagName === 'BUTTON')) place(box, true); }).observe(box, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
const scan = (root = document) => root.querySelectorAll?.(SEL).forEach(attach);
const view = document.getElementById('view');
if (view) new MutationObserver(() => scan(view)).observe(view, { childList: true, subtree: true });
scan();
addEventListener('resize', () => document.querySelectorAll('.has-thumb').forEach((b) => place(b, false)), { passive: true });

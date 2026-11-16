// VIER 前端：一屏一问的引导式流程。hash 路由；所有打分在服务端完成。
const view = document.getElementById('view');
const S = { config: null, F: null, me: null, results: null, pDraft: null, iDraft: null, backToReview: false, tab: 'ideal' };
let dir = 'fwd';

// ---------- 基础工具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式下忽略 */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const go = (h, d = 'fwd') => { dir = d; if (location.hash === h) route(); else location.hash = h; };
const wan = (yuan) => Math.round((yuan / 10000) * 10) / 10;

async function api(method, path, body) {
  const token = store.get('vier.token');
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '网络不太好，请再试一次'), { status: res.status });
  return data;
}

async function ensureSession() {
  if (store.get('vier.token')) {
    try { S.me = await api('GET', '/api/me'); return; } catch (e) { if (e.status !== 401) throw e; store.del('vier.token'); }
  }
  const { token } = await api('POST', '/api/session');
  store.set('vier.token', token);
  S.me = await api('GET', '/api/me');
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- 图标（线性 SVG，统一 24×24） ----------
const I = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M1.5 21a7.5 7.5 0 0 1 15 0"/><path d="M16 4.1a4 4 0 0 1 0 7.8M22.5 21a7.5 7.5 0 0 0-4.5-6.9"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7Z"/>',
  crown: '<path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5Z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  swap: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  half: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

// ---------- 文案：每个问题都用口语问出来 ----------
const P1 = ['gender', 'age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle'];
const P2 = ['incomeAnnual', 'personalNetAssets', 'housing', 'familySupport', 'familyNetAssets', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage'];
const I1 = ['age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'incomeAnnual', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle'];
const I2 = ['personalNetAssets', 'housing', 'familySupport', 'familyNetAssets', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage'];

const ME_Q = {
  gender: ['你是？', '目前只为男生和女生之间做推荐。'],
  age: ['你今年多大？', '按周岁算。点加减号，或者拖动下面的滑条。'],
  heightCm: ['你有多高？', '不穿鞋的身高。'],
  city: ['你现在住在哪个城市？'],
  settlement: ['以后打算在哪里安家？'],
  education: ['你的最高学历是？', '读到哪一步就选哪一个。'],
  occupation: ['你做哪一行？', '选最接近的一个就行。'],
  marriagePlan: ['你打算什么时候结婚？'],
  childrenPlan: ['以后想要孩子吗？'],
  personality: ['你和别人相处，更像哪一种？'],
  lifestyle: ['你平时的生活，更像哪一种？'],
  incomeAnnual: ['你一年大概挣多少钱？', '工资加奖金，扣税以前的数。不算父母给的。'],
  personalNetAssets: ['你自己有多少家底？', '房子、车、存款加起来，再减掉欠的钱。'],
  housing: ['你现在住在哪里？'],
  familySupport: ['家里能给你多大帮助？'],
  familyNetAssets: ['父母家大概有多少家底？', '房子、存款加起来，再减掉欠的钱。'],
  parentsSecurity: ['父母有养老保险和医保吗？'],
  siblings: ['你有兄弟姐妹吗？'],
  care: ['你需要照顾父母吗？'],
  parentsMarriage: ['父母现在的婚姻情况是？'],
};
const IDEAL_Q = {
  age: ['你希望 TA 多大？', '设一个年龄范围。'],
  heightCm: ['你希望 TA 多高？', '设一个身高范围。'],
  city: ['你希望 TA 住在哪个城市？', '可以选好几个。'],
  settlement: ['你希望 TA 以后在哪安家？', '可以选好几个。'],
  education: ['你希望 TA 的学历至少是？', '选一个最低要求。'],
  occupation: ['你能接受 TA 做哪一行？', '可以选好几个。'],
  incomeAnnual: ['你希望 TA 一年至少挣多少？', '选一个最低要求。'],
  marriagePlan: ['你希望 TA 什么时候结婚？', '可以选好几个。'],
  childrenPlan: ['关于孩子，你能接受 TA 怎么想？', '可以选好几个。'],
  personality: ['你喜欢 TA 是哪种性格？', '可以选好几个。'],
  lifestyle: ['你喜欢 TA 过哪种生活？', '可以选好几个。'],
  personalNetAssets: ['你希望 TA 自己至少有多少家底？', '选一个最低要求。'],
  housing: ['你能接受 TA 现在住哪里？', '可以选好几个。'],
  familySupport: ['你希望 TA 家里能给多少帮助？', '可以选好几个。'],
  familyNetAssets: ['你希望 TA 父母家至少有多少家底？', '选一个最低要求。'],
  parentsSecurity: ['你能接受 TA 父母的养老情况是？', '可以选好几个。'],
  siblings: ['你能接受 TA 有几个兄弟姐妹？', '可以选好几个。'],
  care: ['你能接受 TA 照顾父母到什么程度？', '可以选好几个。'],
  parentsMarriage: ['你能接受 TA 父母的婚姻情况是？', '可以选好几个。'],
};
const NUM = { age: { min: 18, max: 80, unit: '岁' }, heightCm: { min: 140, max: 210, unit: '厘米' } };
const INCOME_P = [['5 万以下', 30000, 0, 50000], ['5–10 万', 75000, 50000, 100000], ['10–15 万', 125000, 100000, 150000], ['15–20 万', 175000, 150000, 200000], ['20–30 万', 250000, 200000, 300000], ['30–50 万', 400000, 300000, 500000], ['50 万以上', 700000, 500000, Infinity]];
const MIN_WAN = { incomeAnnual: [5, 10, 15, 20, 30, 50], personalNetAssets: [10, 50, 100, 300, 600], familyNetAssets: [50, 150, 300, 600] };
const IMP = [
  ['off', '不在意', '这一条不看。'],
  ['1', '有更好', '有最好，没有也没关系。'],
  ['2', '在意', '会认真比较这一条。'],
  ['3', '很在意', '非常看重，分数占得多。'],
  ['must', '必须', '达不到就直接不看这个人。请少用，用多了可能一个人都找不到。'],
];
const IMP_LABEL = Object.fromEntries(IMP.map(([v, l]) => [v, l]));

// ---------- 示例数据（一键体验） ----------
const DEMO = {
  female: {
    nickname: '示例·顾念',
    profile: {
      age: 29, heightCm: 165, city: '上海', settlement: '计划长期上海', education: '硕士', occupation: '设计与传媒',
      incomeAnnual: 180000, personalNetAssets: '50–100万元', housing: '自有住房（无贷款）', familySupport: '可应急小额支持',
      familyNetAssets: '150–300万元', parentsSecurity: '双方有基本养老与医保', siblings: '独生子女', care: '暂时无固定照护责任',
      parentsMarriage: '父母目前为婚姻关系', marriagePlan: '1–3年内考虑结婚', childrenPlan: '希望育儿', personality: '直接沟通', lifestyle: '规律作息',
    },
    requirements: [
      { field: 'age', op: 'range', target: [28, 35], importance: 3 },
      { field: 'heightCm', op: 'range', target: [175, 190], importance: 2 },
      { field: 'incomeAnnual', op: 'atLeast', target: 150000, importance: 3 },
      { field: 'education', op: 'atLeast', target: '本科', importance: 2 },
      { field: 'settlement', op: 'in', target: ['计划长期上海', '城市可协商'], importance: 2 },
      { field: 'childrenPlan', op: 'in', target: ['希望育儿'], importance: 'must' },
      { field: 'personality', op: 'in', target: ['直接沟通', '慢热温和'], importance: 1 },
    ],
  },
  male: {
    nickname: '示例·周启明',
    profile: {
      age: 31, heightCm: 178, city: '上海', settlement: '计划长期上海', education: '本科', occupation: '软件与技术',
      incomeAnnual: 250000, personalNetAssets: '10–50万元', housing: '整租', familySupport: '可部分支持首付',
      familyNetAssets: '50–150万元', parentsSecurity: '一方有养老金，双方有医保', siblings: '一位兄弟姐妹', care: '定期探望及协助',
      parentsMarriage: '父母目前为婚姻关系', marriagePlan: '1–3年内考虑结婚', childrenPlan: '希望育儿', personality: '慢热温和', lifestyle: '户外运动',
    },
    requirements: [
      { field: 'age', op: 'range', target: [25, 32], importance: 3 },
      { field: 'heightCm', op: 'range', target: [158, 170], importance: 2 },
      { field: 'education', op: 'atLeast', target: '本科', importance: 2 },
      { field: 'marriagePlan', op: 'in', target: ['1–3年内考虑结婚', '婚姻安排可协商'], importance: 2 },
      { field: 'childrenPlan', op: 'in', target: ['希望育儿', '尚未决定'], importance: 'must' },
      { field: 'lifestyle', op: 'in', target: ['户外运动', '规律作息', '喜欢社交'], importance: 1 },
    ],
  },
};

async function runFullDemo(gender) {
  await ensureSession();
  const d = DEMO[gender];
  await api('PUT', '/api/me/profile', { gender, profile: d.profile, identity: { nickname: d.nickname } });
  await api('PUT', '/api/me/requirements', { requirements: d.requirements });
  if (!S.me.consent?.scoring) await api('PUT', '/api/me/consent', { scoring: true, pool: false, research: false });
  S.me = await api('GET', '/api/me');
  S.results = null; S.pDraft = null; S.iDraft = null; S.tab = 'ideal';
  go('#/results');
}

// ---------- 通用界面片段 ----------
function paint(html, { wide = false } = {}) {
  view.className = wide ? 'wide' : '';
  view.innerHTML = `<div class="screen ${dir === 'back' ? 'back' : ''}">${html}</div>`;
}

function qHead(backHref, label, idx, total) {
  const pct = Math.round(((idx + 1) / total) * 100);
  return `<div class="qhead">
    <button class="back-btn" data-back="${backHref}" aria-label="上一步">${ic('back')}</button>
    <div class="progress"><div class="progress-meta"><b>${esc(label)}</b><span>${idx + 1} / ${total}</span></div>
      <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="--p:${Math.max(0, pct - 100 / total)}%"></i></div></div>
  </div>`;
}
// 进度条从上一题的位置长到这一题
function growBar(idx, total) {
  const bar = view.querySelector('.bar i');
  if (bar) requestAnimationFrame(() => requestAnimationFrame(() => bar.style.setProperty('--p', `${((idx + 1) / total) * 100}%`)));
}

function optList(items, sel, { multi = false, cls = '' } = {}) {
  return `<div class="opts ${cls}" role="${multi ? 'group' : 'radiogroup'}">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="opt ${multi ? 'multi' : ''} ${it.soft ? 'soft' : ''} ${on ? 'on' : ''}" data-v="${esc(it.v)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}">
      <span class="mark">${ic('check')}</span><span class="opt-t">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
  }).join('')}</div>`;
}

function chipList(items, sel, { multi = false } = {}) {
  return `<div class="chips" role="${multi ? 'group' : 'radiogroup'}">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${esc(it.v)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}">${ic('check')}${esc(it.label)}</button>`;
  }).join('')}</div>`;
}

function stepperHtml(id, val, unit, lab = '') {
  return `<div class="stepper" data-stepper="${id}">
    ${lab ? `<span class="lab">${lab}</span>` : ''}
    <button type="button" data-d="-1" aria-label="减一">${ic('minus')}</button>
    <div class="val" aria-live="polite"><b data-val>${val}</b><span>${unit}</span></div>
    <button type="button" data-d="1" aria-label="加一">${ic('plus')}</button>
  </div>`;
}

// 加减按钮：点一下加减 1，按住不放会连续变化
function bindStepper(el, get, set) {
  let t1, t2;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  const step = (d) => {
    set(get() + d);
    const b = el.querySelector('[data-val]');
    b.textContent = get();
    b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
  };
  el.querySelectorAll('[data-d]').forEach((btn) => {
    const d = Number(btn.dataset.d);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      step(d);
      t1 = setTimeout(() => { t2 = setInterval(() => step(d), 80); }, 420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', (e) => { if (e.detail === 0) step(d); }); // 键盘操作
  });
}

function milestone(title, text, note, actions) {
  return `<section class="milestone">
    <svg class="done-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52"/><path d="M38 61l15 15 30-32"/></svg>
    <h1 class="display rise">${title}</h1>
    <p class="lead rise" style="--i:1">${text}</p>
    ${note ? `<div class="note-card rise" style="--i:2">${ic('lock')}<span>${note}</span></div>` : ''}
    <div class="stack rise" style="--i:3">${actions}</div>
  </section>`;
}

function bindBack() {
  view.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => go(b.dataset.back, 'back')));
}

// ---------- 首页 ----------
function venn({ left = '你想找的人', right = '在找你的人', mid = '双向合拍', nums = null } = {}) {
  const n = (v, x, y) => (nums ? `<text class="num" x="${x}" y="${y}" text-anchor="middle" data-count="${v}">0</text>` : '');
  return `<svg class="venn" viewBox="0 0 340 206" role="img" aria-label="关系图：${left}、${right}，中间重叠的是${mid}">
    <g class="c1 hit" data-tab="ideal"><circle cx="122" cy="108" r="92" style="fill:color-mix(in srgb, var(--brand) 20%, transparent);stroke:var(--brand);stroke-width:1.5"/>
      ${n(nums?.left, 82, 112)}<text x="82" y="${nums ? 136 : 114}" text-anchor="middle">${left}</text></g>
    <g class="c2 hit" data-tab="seekers"><circle cx="218" cy="108" r="92" style="fill:color-mix(in srgb, var(--gold) 24%, transparent);stroke:var(--gold);stroke-width:1.5"/>
      ${n(nums?.right, 258, 112)}<text x="258" y="${nums ? 136 : 114}" text-anchor="middle">${right}</text></g>
    <g class="mid hit" data-tab="mutual">
      ${nums ? `<text class="num" x="170" y="104" text-anchor="middle" style="fill:var(--brand)" data-count="${nums.mid}">0</text><text x="170" y="128" text-anchor="middle">${mid}</text>`
    : `<path transform="translate(158 82) scale(1)" d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" style="fill:var(--brand)"/><text x="170" y="130" text-anchor="middle" style="fill:var(--brand)">${mid}</text>`}
    </g>
  </svg>`;
}

async function renderHome() {
  const hasResult = () => S.me?.gender && S.me?.requirements?.length && S.me?.consent?.scoring;
  const draw = () => {
    const ret = hasResult();
    paint(`<section class="hero">
      <p class="eyebrow rise">${ic('sparkle')} 3 分钟 · 选一选就能完成</p>
      <h1 class="display rise" style="--i:1">看看你和理想型<br><em>合不合拍</em></h1>
      ${venn()}
      <p class="lead rise" style="--i:2">你想找什么样的人？那些人又想找什么样的人？谁恰好也在找你？一次看明白。</p>
      <div class="stack rise" style="--i:3">
        ${ret ? `<a class="btn primary block" href="#/results">${ic('list')}看我的结果</a>
          <a class="btn block" href="#/me/gender">重新填一遍</a>`
    : `<a class="btn primary block" href="${store.get('vier.intro') ? '#/me/gender' : '#/intro'}">开始测试 ${ic('arrow')}</a>
          <button class="btn block" id="demo">${ic('play')}先看个例子</button>`}
      </div>
      <ul class="benefits">
        <li class="rise" style="--i:4"><span class="n">1</span><div><b>说说你自己</b><span>点选就行，不想说的可以跳过</span></div></li>
        <li class="rise" style="--i:5"><span class="n">2</span><div><b>说说你想找的人</b><span>每条要求，告诉我们有多在意</span></div></li>
        <li class="rise" style="--i:6"><span class="n">3</span><div><b>看结果</b><span>谁适合你、你适合谁，一目了然</span></div></li>
      </ul>
      <p class="fine">${ic('lock', 'sm')} 资料加密保存，别人看不到你的收入和家庭细节。<br>分数只比较条件，不代表一个人好不好。</p>
    </section>`);
    const demo = document.getElementById('demo');
    if (demo) demo.onclick = openDemoSheet;
  };
  draw();
  // 已有会话时，悄悄读取资料，把按钮换成“看我的结果”
  if (!S.me && store.get('vier.token')) {
    try { await ensureSession(); if (hasResult() && location.hash.replace(/^#/, '') in { '': 1, '/': 1 }) { dir = 'none'; draw(); } } catch { /* 忽略 */ }
  }
}

function openDemoSheet() {
  const m = sheet(`<h2>先看个例子</h2>
    <p class="lead">我们帮你填好一份示例资料，直接看结果长什么样。之后可以随时改成你自己的。</p>
    <div class="opts gender" style="margin-top:18px">
      <button class="opt" data-g="female"><span class="face">${ic('user')}</span><span class="opt-t"><b>女生的例子</b><small>29 岁 · 设计师</small></span></button>
      <button class="opt" data-g="male"><span class="face">${ic('user')}</span><span class="opt-t"><b>男生的例子</b><small>31 岁 · 程序员</small></span></button>
    </div>`);
  m.el.querySelectorAll('[data-g]').forEach((b) => (b.onclick = async () => {
    b.classList.add('on');
    m.el.querySelectorAll('[data-g]').forEach((x) => (x.disabled = true));
    try { await runFullDemo(b.dataset.g); m.close(); } catch (e) { toast(e.message); m.close(); }
  }));
}

// ---------- 新手引导 ----------
function renderIntro() {
  const slides = [
    ['user', '第一步：说说你自己', '年龄、身高、在哪工作……都是点一点就能选。不想说的，点“跳过”。'],
    ['heart', '第二步：说说你想找的人', '每一条要求，告诉我们你有多在意。“必须”就是达不到就不看。'],
    ['users', '第三步：看结果', '谁最符合你的要求？你又符合谁的要求？两边都对上的，就是“双向合拍”。'],
  ];
  paint(`<section class="intro">
    <div class="slides" id="slides">${slides.map(([i, h, p]) => `<div class="slide"><div class="art">${ic(i)}</div><h2>${h}</h2><p>${p}</p></div>`).join('')}</div>
    <div class="dots" aria-hidden="true">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
    <div class="stack"><button class="btn primary block" id="nx">下一页 ${ic('arrow')}</button><button class="btn ghost" id="skip">跳过介绍</button></div>
  </section>`);
  const box = document.getElementById('slides'), dots = view.querySelectorAll('.dots i'), nx = document.getElementById('nx');
  let cur = 0, target = -1; // target：按钮触发的滚动目标，滚到之前不被中间位置打断
  const done = () => { store.set('vier.intro', '1'); go('#/me/gender'); };
  const sync = (i) => {
    cur = i;
    dots.forEach((d, k) => d.classList.toggle('on', k === i));
    nx.innerHTML = i === slides.length - 1 ? `好的，开始 ${ic('arrow')}` : `下一页 ${ic('arrow')}`;
  };
  box.addEventListener('scroll', () => requestAnimationFrame(() => {
    const i = Math.round(box.scrollLeft / box.clientWidth);
    if (target >= 0) { if (i === target) target = -1; else return; }
    if (i !== cur) sync(i);
  }), { passive: true });
  nx.onclick = () => {
    if (cur === slides.length - 1) return done();
    target = cur + 1;
    sync(target);
    box.scrollTo({ left: target * box.clientWidth, behavior: reduceMotion() ? 'auto' : 'smooth' });
  };
  document.getElementById('skip').onclick = done;
}

// ---------- 第一部分：关于你（一屏一问） ----------
function pDraft() {
  if (!S.pDraft) S.pDraft = { gender: S.me.gender || '', profile: { ...(S.me.profile || {}) }, nickname: S.me.identity?.nickname || '' };
  return S.pDraft;
}

async function saveProfile() {
  const d = pDraft();
  const profile = Object.fromEntries(Object.entries(d.profile).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  await api('PUT', '/api/me/profile', { gender: d.gender, profile, identity: { nickname: d.nickname } });
  S.me = await api('GET', '/api/me');
  S.results = null;
}

function meNav(key) {
  const part1 = P1.includes(key), list = part1 ? P1 : P2, i = list.indexOf(key);
  return {
    list, i, part1,
    back: i > 0 ? `#/me/${list[i - 1]}` : part1 ? '#/' : '#/me/break',
    async next() {
      if (i < list.length - 1) return go(`#/me/${list[i + 1]}`);
      await saveProfile();
      go(part1 ? '#/me/break' : '#/me/done');
    },
  };
}

function renderMeQ(key) {
  const d = pDraft(), f = S.F[key];
  if (!f && key !== 'gender') return go('#/me/gender');
  if (key !== 'gender' && !d.gender) return go('#/me/gender');
  const nav = meNav(key);
  const [q, hint] = ME_Q[key];
  const cur = key === 'gender' ? d.gender : d.profile[key];
  let body = '', stepper = false;

  if (key === 'gender') {
    body = `<div class="gender" role="radiogroup">${[['female', '我是女生', '想认识男生'], ['male', '我是男生', '想认识女生']].map(([v, l, s], i) =>
      `<button type="button" class="opt ${cur === v ? 'on' : ''}" data-v="${v}" role="radio" aria-checked="${cur === v}" style="--i:${i}"><span class="face">${ic('user')}</span><span class="opt-t"><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>`;
  } else if (f.type === 'number') {
    stepper = true;
    const n = NUM[key];
    const def = key === 'age' ? 28 : d.gender === 'male' ? 175 : 163;
    const v = typeof cur === 'number' ? cur : def;
    body = `${stepperHtml(key, v, n.unit)}<input class="slider" type="range" min="${n.min}" max="${n.max}" value="${v}" aria-label="${esc(f.label)}">`;
  } else {
    let items;
    let sel = cur ?? '';
    if (key === 'incomeAnnual') {
      items = INCOME_P.map(([l, v]) => ({ v: String(v), label: l }));
      if (typeof cur === 'number') sel = String(INCOME_P.find(([, , lo, hi]) => cur >= lo && cur < hi)?.[1] ?? '');
    } else {
      items = (f.bands ? Object.keys(f.bands) : f.levels || f.options).map((o) => ({ v: o, label: o }));
    }
    if (f.tier === 'L2') items.push({ v: '不愿透露', label: '不想说', soft: true });
    body = optList(items, String(sel), { cls: items.length > 7 && key === 'occupation' ? 'grid2' : '' });
  }

  paint(`${qHead(nav.back, nav.part1 ? '第一部分 · 关于你' : '第二部分 · 经济和家庭', nav.i, nav.list.length)}
    <h1 class="q">${q}</h1>
    ${hint ? `<p class="qhint">${hint}</p>` : '<p class="qhint">点一下就会自动进入下一题。</p>'}
    ${f?.tier === 'L2' ? `<p class="qhint">${ic('lock')}只用来计算，不会把具体数字给别人看。</p>` : ''}
    ${body}
    <div class="qfoot">
      ${stepper ? `<button class="btn primary" id="ok">好了，下一题 ${ic('arrow')}</button>` : ''}
      ${key !== 'gender' ? `<button class="btn ghost skip" id="skip">跳过</button>` : ''}
    </div>`);
  growBar(nav.i, nav.list.length);
  bindBack();

  let busy = false;
  const advance = async () => {
    if (busy) return; busy = true;
    try { await nav.next(); } catch (e) { busy = false; toast(e.message); }
  };
  const skip = document.getElementById('skip');
  if (skip) skip.onclick = () => { delete d.profile[key]; advance(); };

  if (stepper) {
    const n = NUM[key], slider = view.querySelector('.slider'), el = view.querySelector('[data-stepper]');
    let v = Number(slider.value);
    const clamp = (x) => Math.min(n.max, Math.max(n.min, x));
    bindStepper(el, () => v, (x) => { v = clamp(x); slider.value = v; });
    slider.oninput = () => { v = Number(slider.value); el.querySelector('[data-val]').textContent = v; };
    document.getElementById('ok').onclick = () => { d.profile[key] = v; advance(); };
    return;
  }
  view.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
    if (busy) return;
    view.querySelectorAll('.opt').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    const v = b.dataset.v;
    if (key === 'gender') {
      if (d.gender && d.gender !== v) S.iDraft = null; // 换了性别，理想型默认值要重算
      d.gender = v;
    } else if (key === 'incomeAnnual' && v !== '不愿透露') d.profile[key] = Number(v);
    else d.profile[key] = v;
    setTimeout(advance, reduceMotion() ? 60 : 340);
  }));
}

function renderMeBreak() {
  paint(milestone('基本情况填好了', '下面几题是<b>经济和家庭情况</b>，全部选填。填了结果更准，不填也能看结果。',
    '这些内容加密保存，只用来计算。别人只能看到“符合 / 不符合”，看不到你的具体数字。',
    `<button class="btn primary block" id="more">继续填（大约 1 分钟）</button>
     <button class="btn block" id="skip">跳过，去说说想找的人</button>
     <button class="btn ghost" data-back="#/me/lifestyle">${ic('back')} 返回上一题</button>`));
  bindBack();
  document.getElementById('more').onclick = () => go('#/me/incomeAnnual');
  document.getElementById('skip').onclick = () => go('#/ideal/age');
}

function renderMeDone() {
  paint(milestone('关于你，填好了', '接下来说说<b>你想找什么样的人</b>。每条要求，再告诉我们你有多在意。', '',
    `<button class="btn primary block" id="go">说说我想找的人 ${ic('arrow')}</button>
     <button class="btn ghost" data-back="#/me/parentsMarriage">${ic('back')} 返回上一题</button>`));
  bindBack();
  document.getElementById('go').onclick = () => go('#/ideal/age');
}

// ---------- 第二部分：你的理想型 ----------
function defaultTarget(key) {
  const f = S.F[key], g = S.me.gender, myAge = S.me.profile?.age;
  if (key === 'age') {
    const a = typeof myAge === 'number' ? myAge : 28;
    const r = g === 'male' ? [a - 5, a + 1] : [a - 1, a + 5];
    return r.map((x) => Math.min(80, Math.max(18, x)));
  }
  if (key === 'heightCm') return g === 'male' ? [158, 170] : [172, 185];
  if (f.type === 'category') return [];
  return null;
}

function iDraft() {
  if (S.iDraft) return S.iDraft;
  const byField = Object.fromEntries((S.me.requirements || []).map((r) => [r.field, r]));
  S.iDraft = {};
  for (const key of [...I1, ...I2]) {
    const r = byField[key];
    if (!r) { S.iDraft[key] = { imp: 'off', target: defaultTarget(key), dirty: false }; continue; }
    let target = r.target;
    const f = S.F[key];
    if (f.type === 'number' && r.op !== 'range') target = r.op === 'atMost' ? [NUM[key].min, r.target] : r.op === 'about' ? [r.target - 2, r.target + 2] : [r.target, NUM[key].max];
    if (f.type === 'money' && Array.isArray(target)) target = target[0];
    if (f.type === 'category' || (f.type === 'ordinal' && r.op === 'in')) target = Array.isArray(target) ? target : [target];
    if (f.type === 'ordinal' && r.op === 'in') target = target[0];
    S.iDraft[key] = { imp: String(r.importance), target, orig: r, dirty: false };
  }
  return S.iDraft;
}

function entryValid(key, e) {
  const f = S.F[key];
  if (f.type === 'category') return Array.isArray(e.target) && e.target.length > 0;
  if (f.type === 'number') return Array.isArray(e.target);
  return e.target !== null && e.target !== undefined && e.target !== '';
}

function toReq(key, e) {
  if (e.imp === 'off' || !entryValid(key, e)) return null;
  const importance = e.imp === 'must' ? 'must' : Number(e.imp);
  if (!e.dirty && e.orig) return { ...e.orig, importance };
  const f = S.F[key];
  if (f.type === 'number') return { field: key, op: 'range', target: [...e.target], importance };
  if (f.type === 'money' || f.type === 'ordinal') return { field: key, op: 'atLeast', target: e.target, importance };
  return { field: key, op: 'in', target: e.target, importance };
}

function describe(key, e) {
  const f = S.F[key];
  if (!e.dirty && e.orig && f.type === 'number' && e.orig.op !== 'range') {
    const t = e.orig.target;
    return `${{ atLeast: '至少', atMost: '最多', about: '大约' }[e.orig.op] || ''} ${t} ${NUM[key].unit}`;
  }
  if (f.type === 'number') return `${e.target[0]} – ${e.target[1]} ${NUM[key].unit}`;
  if (f.type === 'money') return `至少 ${wan(e.target)} 万`;
  if (f.type === 'ordinal') return `${e.target} 及以上`;
  return e.target.join('、');
}

function iNav(key) {
  const part1 = I1.includes(key), list = part1 ? I1 : I2, i = list.indexOf(key);
  return {
    list, i, part1,
    back: S.backToReview ? '#/ideal/review' : i > 0 ? `#/ideal/${list[i - 1]}` : part1 ? '#/me/done' : '#/ideal/break',
    next() {
      if (S.backToReview) { S.backToReview = false; return go('#/ideal/review'); }
      if (i < list.length - 1) return go(`#/ideal/${list[i + 1]}`);
      go(part1 ? '#/ideal/break' : '#/ideal/review');
    },
  };
}

function impBlock(e) {
  const note = IMP.find(([v]) => v === e.imp)[2];
  return `<div class="imp" id="imp">
    <h3>这一条，你有多在意？</h3>
    <div class="imp-pills" role="radiogroup" aria-label="在意程度">${IMP.map(([v, l]) => `<button type="button" data-imp="${v}" class="${e.imp === v ? 'on' : ''}" role="radio" aria-checked="${e.imp === v}">${l}</button>`).join('')}</div>
    <p class="imp-note">${ic('info')}<span id="imp-note">${note}</span></p>
  </div>`;
}

function renderIdealQ(key) {
  if (!S.me.gender) return go('#/me/gender');
  const f = S.F[key];
  if (!f || !IDEAL_Q[key]) return go('#/ideal/age');
  const e = iDraft()[key], nav = iNav(key);
  const [q, hint] = IDEAL_Q[key];
  let body = '';

  if (f.type === 'number') {
    const t = e.target || defaultTarget(key);
    body = `<div class="range-pair">${stepperHtml('a', t[0], NUM[key].unit, '从')}${stepperHtml('b', t[1], NUM[key].unit, '到')}</div>`;
  } else if (f.type === 'money') {
    body = chipList(MIN_WAN[key].map((w) => ({ v: String(w * 10000), label: `至少 ${w} 万` })), e.target == null ? '' : String(e.target));
  } else if (f.type === 'ordinal') {
    body = chipList(f.levels.map((l) => ({ v: l, label: `${l}及以上` })), e.target || '');
  } else {
    body = chipList(f.options.map((o) => ({ v: o, label: o })), e.target || [], { multi: true });
  }

  paint(`${qHead(nav.back, nav.part1 ? '你想找的人' : '你想找的人 · 经济和家庭', nav.i, nav.list.length)}
    <h1 class="q">${q}</h1>
    <p class="qhint">${hint}</p>
    <div id="target">${body}</div>
    ${impBlock(e)}
    <div class="qfoot">
      <button class="btn primary" id="ok">${S.backToReview ? '改好了' : '下一题'} ${ic('arrow')}</button>
    </div>`);
  growBar(nav.i, nav.list.length);
  bindBack();

  const setImp = (v, flash) => {
    e.imp = v;
    view.querySelectorAll('[data-imp]').forEach((b) => { b.classList.toggle('on', b.dataset.imp === v); b.setAttribute('aria-checked', b.dataset.imp === v); });
    document.getElementById('imp-note').textContent = IMP.find(([x]) => x === v)[2];
    if (flash) { const box = document.getElementById('imp'); box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  };
  // 选了具体条件，却还是“不在意”时，自动改成“在意”，并闪一下提醒
  const touched = () => { e.dirty = true; if (e.imp === 'off') setImp('2', true); };
  view.querySelectorAll('[data-imp]').forEach((b) => (b.onclick = () => setImp(b.dataset.imp, false)));

  if (f.type === 'number') {
    const n = NUM[key];
    if (!e.target) e.target = defaultTarget(key);
    const clamp = (x) => Math.min(n.max, Math.max(n.min, x));
    const [ea, eb] = ['a', 'b'].map((id) => view.querySelector(`[data-stepper="${id}"]`));
    const show = () => { ea.querySelector('[data-val]').textContent = e.target[0]; eb.querySelector('[data-val]').textContent = e.target[1]; };
    bindStepper(ea, () => e.target[0], (x) => { e.target = [clamp(x), Math.max(clamp(x), e.target[1])]; touched(); show(); });
    bindStepper(eb, () => e.target[1], (x) => { e.target = [Math.min(clamp(x), e.target[0]), clamp(x)]; touched(); show(); });
  } else {
    const multi = f.type === 'category';
    view.querySelectorAll('#target .chip').forEach((c) => (c.onclick = () => {
      const v = c.dataset.v;
      if (multi) {
        const s = new Set(e.target || []);
        s.has(v) ? s.delete(v) : s.add(v);
        e.target = f.options.filter((o) => s.has(o));
        c.classList.toggle('on', s.has(v)); c.setAttribute('aria-checked', s.has(v));
      } else {
        e.target = f.type === 'money' ? Number(v) : v;
        view.querySelectorAll('#target .chip').forEach((x) => { x.classList.toggle('on', x === c); x.setAttribute('aria-checked', x === c); });
      }
      touched();
    }));
  }

  document.getElementById('ok').onclick = () => {
    if (e.imp !== 'off' && !entryValid(key, e)) {
      toast(multiMsg(f));
      const t = document.getElementById('target'); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
      return;
    }
    nav.next();
  };
}
const multiMsg = (f) => (f.type === 'category' ? '请至少选一个；如果都可以，就选“不在意”' : '请先选一个；如果无所谓，就选“不在意”');

function renderIdealBreak() {
  paint(milestone('主要的要求说完了', '还想对 TA 的<b>经济和家庭情况</b>提要求吗？这部分可以不填。', '',
    `<button class="btn primary block" id="review">不用了，看看我的要求 ${ic('arrow')}</button>
     <button class="btn block" id="more">要加几条（大约 1 分钟）</button>
     <button class="btn ghost" data-back="#/ideal/lifestyle">${ic('back')} 返回上一题</button>`));
  bindBack();
  document.getElementById('more').onclick = () => go('#/ideal/personalNetAssets');
  document.getElementById('review').onclick = () => go('#/ideal/review');
}

function renderIdealReview() {
  if (!S.me.gender) return go('#/me/gender');
  const d = iDraft();
  const on = [...I1, ...I2].filter((k) => toReq(k, d[k]));
  const mustN = on.filter((k) => d[k].imp === 'must').length;
  paint(`<div class="qhead"><button class="back-btn" data-back="#/ideal/break" aria-label="上一步">${ic('back')}</button><div class="progress"><div class="progress-meta"><b>最后确认</b><span>共 ${on.length} 条要求</span></div><div class="bar"><i style="--p:100%"></i></div></div></div>
    <h1 class="q">这是你的要求</h1>
    <p class="qhint">点任意一条可以修改。确认没问题，就去看结果。</p>
    ${on.length ? `<div class="sum-list">${on.map((k, i) => `<button class="sum-item" data-k="${k}" style="--i:${i}">
        <div class="t"><b>${esc(S.F[k].label)}</b><span>${esc(describe(k, d[k]))}</span></div>
        <span class="badge ${d[k].imp === 'must' ? 'must' : d[k].imp === '3' ? 'l3' : ''}">${IMP_LABEL[d[k].imp]}</span>${ic('next')}</button>`).join('')}</div>`
    : `<div class="empty">${ic('search')}<b>还没有任何要求</b>至少选一条，我们才知道帮你找什么样的人。</div>`}
    ${mustN >= 4 ? `<div class="tip" style="animation-delay:0s">${ic('info')}<span>你有 <b>${mustN} 条“必须”</b>。“必须”太多，可能一个人都找不到。可以把一些改成“很在意”。</span></div>` : ''}
    <div class="stack">
      ${on.length ? `<button class="btn primary block" id="save">就这些，看结果 ${ic('arrow')}</button>` : `<button class="btn primary block" data-back="#/ideal/age">去选要求</button>`}
      <button class="btn block" id="add">${ic('plus')}再加几条要求</button>
    </div>`);
  bindBack();
  view.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { S.backToReview = true; go(`#/ideal/${b.dataset.k}`); }));
  document.getElementById('add').onclick = () => {
    const first = [...I1, ...I2].find((k) => !on.includes(k)) || 'age';
    go(`#/ideal/${first}`);
  };
  const save = document.getElementById('save');
  if (save) save.onclick = async () => {
    save.classList.add('loading');
    try {
      const requirements = on.map((k) => toReq(k, d[k]));
      await api('PUT', '/api/me/requirements', { requirements });
      S.me = await api('GET', '/api/me');
      S.results = null; S.iDraft = null;
      go(S.me.consent?.scoring ? '#/results' : '#/consent');
    } catch (e) { save.classList.remove('loading'); toast(e.message); }
  };
}

// ---------- 同意 ----------
function toggleCard(name, title, text, checked, { required = false, i = 0 } = {}) {
  return `<label class="toggle-card" style="--i:${i}">
    <div class="t"><b>${title}${required ? '<span class="req-pill">必须</span>' : '<span class="req-pill" style="background:var(--surface-2);color:var(--ink-2)">可选</span>'}</b><span>${text}</span></div>
    <span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} role="switch"><i></i></span>
  </label>`;
}

function renderConsent() {
  const c = S.me.consent || {};
  paint(`<div class="qhead"><button class="back-btn" data-back="#/ideal/review" aria-label="上一步">${ic('back')}</button><div class="progress"><div class="progress-meta"><b>最后一步</b><span>你的资料，你做主</span></div><div class="bar"><i style="--p:100%"></i></div></div></div>
    <h1 class="q">你的资料怎么用，你说了算</h1>
    <p class="qhint">${ic('lock')}资料加密保存。以后随时可以在“我的资料”里修改或删除。</p>
    <form id="f">
      ${toggleCard('scoring', '用我的资料算结果', '只在我们的服务器里计算，不给任何人看。不打开就没法出结果。', c.scoring ?? true, { required: true, i: 0 })}
      ${toggleCard('pool', '让别人也能匹配到我', '你会以一个随机代号出现在别人的结果里。别人只看得到年龄、身高、城市这类基本情况，看不到收入和家庭细节。', !!c.pool, { i: 1 })}
      ${toggleCard('research', '用于匿名统计', '只用来算“很多人加在一起”的统计，不会单独展示你。', !!c.research, { i: 2 })}
      <div class="stack"><button class="btn primary block" id="go">同意，开始计算 ${ic('arrow')}</button></div>
      <p class="fine">同意版本 ${esc(S.config.consentVersion)}</p>
    </form>`);
  bindBack();
  const form = document.getElementById('f'), btn = document.getElementById('go');
  const sync = () => { btn.disabled = !form.scoring.checked; btn.innerHTML = form.scoring.checked ? `同意，开始计算 ${ic('arrow')}` : '请先打开第一项'; };
  form.addEventListener('change', sync); sync();
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    btn.classList.add('loading');
    try {
      await api('PUT', '/api/me/consent', { scoring: true, pool: form.pool.checked, research: form.research.checked });
      S.me = await api('GET', '/api/me');
      go('#/results');
    } catch (e) { btn.classList.remove('loading'); toast(e.message); }
  };
}

// ---------- 计算中 ----------
async function loadResults(force) {
  if (!S.results || force) S.results = await api('GET', '/api/me/results');
  return S.results;
}

async function renderCalc() {
  const steps = ['读取你的要求', '和人选库里的每个人比一比', '反过来，看你符合谁的要求', '整理结果'];
  paint(`<section class="calc">
    <div class="pulse" aria-hidden="true"><i></i><i></i><i></i><b>${ic('heart')}</b></div>
    <h1 class="q">正在帮你找……</h1>
    <ul class="calc-steps">${steps.map((s) => `<li><span class="dot">${ic('check')}</span>${s}</li>`).join('')}</ul>
  </section>`);
  const lis = [...view.querySelectorAll('.calc-steps li')];
  const job = loadResults();
  const per = reduceMotion() ? 0 : 520;
  for (let i = 0; i < lis.length; i++) {
    lis[i].classList.add('on');
    await delay(per);
    if (i === lis.length - 1) await job;
    lis[i].classList.add('done');
  }
  await delay(per / 2);
}

// ---------- 结果 ----------
const fmt = (t) => (t.low === t.high ? `${Math.round(t.low)}` : `${Math.round(t.low)}–${Math.round(t.high)}`);
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (c, lg) => `<span class="avatar ${lg ? 'lg' : ''}" style="--h:${hue(c.alias)}" aria-hidden="true">${esc(String(c.alias).replace(/^[^A-Za-z0-9一-龥]+/, '').slice(0, 1) || 'TA')}</span>`;
const facts = (c, n = 5) => Object.values(c.facts).slice(0, n).map((v) => `<span>${esc(v)}</span>`).join('');

function meter(label, t, { tone = 'var(--brand)', note = '', i = 0 } = {}) {
  const lo = Math.max(0, Math.min(100, t.low)), hi = Math.max(lo, Math.min(100, t.high));
  return `<div class="meter">
    <div class="meter-l"><span>${label}</span><b>${fmt(t)}<small>分</small></b></div>
    <div class="track" style="--v:${lo}%;--w:${hi - lo}%;--tone:${tone};--i:${i}"><i></i><em></em></div>
    ${note ? `<div class="meter-note">${note}</div>` : ''}
  </div>`;
}

function pcard(c, inner, { href = '', i = 0, head = '' } = {}) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="pcard" ${href ? `href="${href}"` : ''} style="--i:${i}">
    <div class="pcard-head">${avatar(c)}<div class="pcard-name"><b>${esc(c.alias)}</b><span>${esc(c.gender)}${c.facts['年龄'] ? ` · ${esc(c.facts['年龄'])}` : ''}${c.facts['常住城市'] ? ` · ${esc(c.facts['常住城市'])}` : ''}</span></div>
      ${head}${c.simulated ? '<span class="badge sim">模拟</span>' : ''}</div>
    <div class="facts">${Object.entries(c.facts).filter(([k]) => k !== '年龄' && k !== '常住城市').slice(0, 4).map(([, v]) => `<span>${esc(v)}</span>`).join('')}</div>
    <div class="meters">${inner}</div>
    ${href ? `<div class="pcard-more">看详细对比 ${ic('next')}</div>` : ''}
  </${tag}>`;
}

const TABS = {
  ideal: { label: '我想找的', flow: ['你', 'TA'], text: '最符合你要求的人。点开能看到：TA 的要求，你符合多少。' },
  mutual: { label: '互相合适', flow: ['你', 'TA', true], text: 'TA 符合你的要求，你也符合 TA 的要求。' },
  seekers: { label: '在找我的', flow: ['TA', '你'], text: '你正好符合 TA 的要求。只是条件对得上，不代表 TA 已经喜欢你。' },
};

function tabList(r, tab) {
  const GOOD = 'var(--good)';
  if (tab === 'ideal') {
    return r.idealMatches.map((m, i) => pcard(m,
      meter('TA 符合你的要求', m.fit.total, { i }) + meter('你符合 TA 的要求', m.myFitToThem.total, { tone: GOOD, i, note: m.myFitToThem.gate === 'fail' ? 'TA 有一条“必须”，你没达到' : '' }),
      { href: `#/match/${i}`, i, head: `<span class="rank">第 ${i + 1} 名</span>` })).join('')
      || emptyCard('没有人达到你所有的“必须”', '可以把一两条“必须”改成“很在意”，再看看。', '#/ideal/review', '去改要求');
  }
  if (tab === 'mutual') {
    return r.mutual.map((m, i) => pcard(m,
      meter('两边合拍度', m.mutualScore, { i }) + `<p class="small muted" style="margin:0">TA 符合你 ${fmt(m.fitToMyIdeal)} 分 · 你符合 TA ${fmt(m.myFitToThem)} 分</p>`, { i })).join('')
      || emptyCard('暂时没有两边都对得上的人', '先看看“我想找的”和“在找我的”，或者把要求放宽一点。');
  }
  return r.seekers.map((m, i) => pcard(m,
    meter('你符合 TA 的要求', m.myFitToThem.total, { tone: GOOD, i })
    + (m.theirFitEligible ? meter('TA 符合你的要求', m.theirFitToMyIdeal, { i }) : '<p class="small muted" style="margin:0">TA 没达到你的某条“必须”。</p>'), { i })).join('')
    || emptyCard('暂时没有', '人选库里还没有人的要求正好对上你。');
}

function emptyCard(title, text, href, btn) {
  return `<div class="empty">${ic('search')}<b>${title}</b>${text}${href ? `<div class="stack" style="margin-top:14px"><a class="btn sm" href="${href}">${btn}</a></div>` : ''}</div>`;
}

function countUp(root = view) {
  root.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count) || 0;
    if (reduceMotion() || !to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 900;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    setTimeout(() => requestAnimationFrame(tick), 500);
  });
}

async function renderResults() {
  if (!S.me.gender) return go('#/me/gender');
  if (!S.me.requirements?.length) return go('#/ideal/age');
  if (!S.me.consent?.scoring) return go('#/consent');
  if (!S.results) await renderCalc();
  const r = await loadResults();
  const s = r.summary, plan = S.config.plans[r.plan];
  const showTip = !store.get('vier.tip.score');

  paint(`<section class="res-head">
      <p class="eyebrow rise">${ic('sparkle')} 共比对了 ${s.counterpartCount} 个人</p>
      <h1 class="display rise" style="--i:1">你的结果出来了</h1>
      ${venn({ left: '符合你的要求', right: '你符合TA要求', mid: '双向合拍', nums: { left: s.matchesEligible, right: s.iFitCount, mid: s.mutualCount } })}
      <p class="small muted rise" style="--i:2">点圆圈，或点下面的标签，切换查看</p>
    </section>
    ${showTip ? `<div class="tip" id="tip">${ic('help')}<span><b>分数怎么看？</b>100 分 = 完全符合。分数只比较条件，不代表一个人好不好。<br>浅色的一段，是因为资料没填全，分数可能在这个范围里。</span><button class="x" aria-label="知道了">${ic('x')}</button></div>` : ''}
    <div class="tabs" role="tablist">${Object.entries(TABS).map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}" class="${S.tab === k ? 'on' : ''}">${t.label}</button>`).join('')}</div>
    <div id="tabpanel"></div>
    ${r.plan === 'vip'
    ? `<div class="vip">${ic('crown')}<div class="t"><b>你是 VIP</b><span>每组可以看 ${S.config.plans.vip.matches} 位</span></div></div>`
    : `<div class="vip">${ic('crown')}<div class="t"><b>想多看几位？</b><span>升级 VIP，每组从 ${S.config.plans.free.matches} 位变成 ${S.config.plans.vip.matches} 位</span></div><button class="btn gold sm" id="upgrade">¥${(S.config.plans.vip.priceFen / 100).toFixed(2)} 升级</button></div>`}
    <div class="stack">
      <a class="btn block" href="#/ideal/review">${ic('edit')}改改我的要求</a>
      <a class="btn ghost" href="#/me/gender">改改我自己的情况</a>
    </div>
    <p class="disclaimer">每组最多显示 ${plan.matches} 位${s.matchesPending ? ` · ${s.matchesPending} 位资料不全，暂不排名` : ''}${s.seekersExcludedFewRequirements ? ` · ${s.seekersExcludedFewRequirements} 位要求太少，没放进“在找我的”` : ''}<br>分数只比较条件，不是好感，也不代表一个人的价值。</p>`, { wide: true });

  const panel = document.getElementById('tabpanel');
  const show = (tab, scroll) => {
    S.tab = tab;
    view.querySelectorAll('.tabs [data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    const t = TABS[tab];
    panel.innerHTML = `<div class="tab-explain"><span class="flow"><span>${t.flow[0]}</span>${ic(t.flow[2] ? 'swap' : 'arrow')}<span>${t.flow[1]}</span></span><span>${t.text}</span></div><div class="cards">${tabList(r, tab)}</div>`;
    if (scroll) view.querySelector('.tabs').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab, b.tagName.toLowerCase() === 'g')));
  show(S.tab);
  countUp();
  const tip = document.getElementById('tip');
  if (tip) tip.querySelector('.x').onclick = () => { store.set('vier.tip.score', '1'); tip.remove(); };
  const up = document.getElementById('upgrade');
  if (up) up.onclick = () => openPayment('vip');
}

// ---------- 人选详情 ----------
const STATUS = {
  符合: ['t-good', 'check', '符合'],
  部分符合: ['t-warn', 'half', '部分符合'],
  '可能符合（资料为区间）': ['t-warn', 'help', '可能符合'],
  不符合: ['t-bad', 'x', '不符合'],
  未填写: ['t-unk', 'help', '没填'],
};

function checks(items, whoReq, whoVal) {
  return `<div class="legend"><span class="t-good"><i></i>符合</span><span class="t-warn"><i></i>差一点 / 可能</span><span class="t-bad"><i></i>不符合</span><span class="t-unk"><i></i>没填</span></div>
  <div class="checks">${items.map((it, i) => {
    const [tone, icon, word] = STATUS[it.status] || ['t-unk', 'help', it.status];
    return `<div class="check ${tone}" style="--i:${i}"><span class="st">${ic(icon)}</span>
      <div class="t"><b>${esc(it.label)}</b> ${it.must ? '<span class="badge must">必须</span>' : ''}
        <div class="kv"><span>${whoReq}</span><span>${esc(it.requirement)}</span><span>${whoVal}</span><span>${it.value === null ? '不公开' : esc(it.value)}</span></div></div>
      <span class="res">${word}</span></div>`;
  }).join('')}</div>`;
}

function ring(label, sub, t, tone) {
  const v = Math.max(0, Math.min(100, t.low));
  return `<div class="ring-card"><div class="ring" style="--tone:${tone}"><svg viewBox="0 0 110 110" aria-hidden="true"><circle class="bg" cx="55" cy="55" r="46"/><circle class="fg" cx="55" cy="55" r="46" data-v="${v}"/></svg><b class="${t.low === t.high ? '' : 'range'}">${fmt(t)}</b></div>
    <p><b>${label}</b>${sub}</p></div>`;
}

async function renderMatch(idx) {
  const r = await loadResults();
  const m = r.idealMatches[idx];
  if (!m) return go('#/results', 'back');
  const n = r.idealMatches.length;
  const place = m.myPlace ? (m.myPlace.rankRange[0] === m.myPlace.rankRange[1] ? m.myPlace.rankRange[0] : m.myPlace.rankRange.join('–')) : null;
  paint(`<div class="detail-nav">
      <button class="btn ghost sm" data-back="#/results">${ic('back')}返回结果</button>
      <div class="pager"><a href="#/match/${idx - 1}" aria-label="上一位" aria-disabled="${idx === 0}">${ic('back')}</a><a href="#/match/${idx + 1}" aria-label="下一位" aria-disabled="${idx >= n - 1}">${ic('next')}</a></div>
    </div>
    <section class="profile-top rise">
      ${avatar(m, true)}
      <h1>${esc(m.alias)} ${m.simulated ? '<span class="badge sim">模拟</span>' : ''}</h1>
      <p class="small muted" style="margin:2px 0 0">${esc(m.gender)} · 你的第 ${idx + 1} 位人选</p>
      <div class="facts">${facts(m, 8)}</div>
    </section>
    <div class="rings rise" style="--i:1">
      ${ring('TA 符合你', '的要求', m.fit.total, 'var(--brand)')}
      ${ring('你符合 TA', '的要求', m.myFitToThem.total, 'var(--good)')}
    </div>
    <div class="callout rise" style="--i:2">${ic('users')}<span>${place
    ? `按 TA 的要求，在 ${m.myPlace.of} 位合格的人里，你大约排第 <b>${place}</b> 名。`
    : '按 TA 的要求，你暂时没进入排名（有“必须”没达到，或资料没填全）。'}</span></div>

    <h2 class="sec-title">${ic('heart')}TA 和你的要求比一比</h2>
    ${checks(m.fit.items, '你要', 'TA 是')}
    <h2 class="sec-title">${ic('user')}TA 的要求，你符合多少</h2>
    ${checks(m.myFitToThem.items, 'TA 要', '你是')}

    <h2 class="sec-title">${ic('users')}TA 可能更想找谁</h2>
    <p class="small muted" style="margin:-4px 0 12px">按 TA 的要求，和你同性别的人里，谁最合适。</p>
    ${m.theirPicks.length ? `<div class="hscroll">${m.theirPicks.map((p, i) => pcard(p, meter('符合 TA 的要求', p.score, { tone: 'var(--gold)', i }), { i })).join('')}</div>` : emptyCard('暂时没有', '')}
    <div class="stack"><button class="btn block" data-back="#/results">${ic('back')}返回结果</button></div>`, { wide: true });
  bindBack();
  requestAnimationFrame(() => requestAnimationFrame(() => view.querySelectorAll('.ring .fg').forEach((c) => (c.style.strokeDashoffset = 289 * (1 - Number(c.dataset.v) / 100)))));
}

// ---------- 弹层 ----------
function sheet(html) {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="close" aria-label="关闭">${ic('x')}</button>${html}</div>`;
  document.body.appendChild(el);
  const prev = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    m.onclose?.();
    el.classList.add('closing');
    setTimeout(() => { el.remove(); prev?.focus?.(); }, reduceMotion() ? 0 : 220);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('.close').onclick = close;
  el.onclick = (e) => { if (e.target === el) close(); };
  el.querySelector('.close').focus();
  const m = { el, close, onclose: null };
  return m;
}

// ---------- 扫码支付 ----------
function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
}

function openPayment(planId) {
  const plan = S.config.plans[planId], free = S.config.plans.free;
  const providers = S.config.payments?.providers || [];
  const m = sheet(`<div id="pay"><h2>升级 ${esc(plan.label)}</h2>
    <p class="price"><small>¥</small>${(plan.priceFen / 100).toFixed(2)}</p>
    <ul class="perks"><li>${ic('check')}每组人选从 ${free.matches} 位增加到 ${plan.matches} 位</li><li>${ic('check')}“TA 可能更想找谁”也多看 ${plan.theirPicks - free.theirPicks} 位</li><li>${ic('check')}一次付费，不自动续费</li></ul>
    ${providers.length ? `<div class="pay-tabs" role="tablist">${providers.map((p, i) => `<button data-p="${p.id}" class="${i ? '' : 'on'}" role="tab">${esc(p.label)}</button>`).join('')}</div>
      <div class="qr" id="qr"><span class="spin"></span></div><p class="pay-hint" id="pay-hint">正在生成二维码…</p>`
    : '<p class="err">暂时还不能在线支付。请稍后再试。</p>'}</div>`);
  let timer = null, current = null, closed = false;
  m.onclose = () => { closed = true; clearTimeout(timer); };

  async function start(pid) {
    clearTimeout(timer);
    m.el.querySelectorAll('[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === pid));
    const box = m.el.querySelector('#qr'), hint = m.el.querySelector('#pay-hint');
    box.innerHTML = '<span class="spin"></span>'; hint.textContent = '正在生成二维码…';
    try {
      const o = await api('POST', '/api/me/orders', { plan: planId, provider: pid });
      if (closed) return;
      current = o.orderNo;
      const app = pid === 'alipay' ? '支付宝' : '微信';
      box.innerHTML = qrSvg(o.codeUrl);
      hint.innerHTML = `打开<b>${app}</b>，点“扫一扫”，对准上面的二维码。<br><span class="wait">付完会自动升级，不用关这个窗口</span>`
        + (o.mock ? `<br><span class="badge sim" style="margin-top:10px">模拟支付 · 不会真的扣钱</span><br><button class="btn sm" id="mock-pay" style="margin-top:10px">模拟“付款成功”</button>` : '');
      const mp = m.el.querySelector('#mock-pay');
      if (mp) mp.onclick = () => { mp.classList.add('loading'); api('POST', `/api/me/orders/${o.orderNo}/mock-pay`).catch((e) => toast(e.message)); };
      poll(o.orderNo);
    } catch (e) { box.innerHTML = ''; hint.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  }

  async function poll(orderNo) {
    if (closed || orderNo !== current) return;
    try {
      const s = await api('GET', `/api/me/orders/${orderNo}`);
      if (s.status === 'paid') {
        m.el.querySelector('#pay').innerHTML = `<div class="milestone" style="padding-top:6px"><svg class="done-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52"/><path d="M38 61l15 15 30-32"/></svg><h2>付款成功</h2><p class="lead">你已经是 VIP 了，正在刷新结果…</p></div>`;
        S.me = await api('GET', '/api/me');
        await loadResults(true);
        setTimeout(() => { m.close(); dir = 'none'; renderResults(); }, 1400);
        return;
      }
      if (s.status === 'expired') { m.el.querySelector('#pay-hint').textContent = '二维码过期了，请点上面重新选择付款方式。'; return; }
    } catch { /* 网络抖动时继续轮询 */ }
    timer = setTimeout(() => poll(orderNo), 2000);
  }

  m.el.querySelectorAll('[data-p]').forEach((a) => (a.onclick = () => start(a.dataset.p)));
  if (providers.length) start(providers[0].id);
}

// ---------- 我的资料 ----------
function renderPrivacy() {
  const c = S.me.consent || {};
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${S.me.consent?.scoring ? '#/results' : '#/'}">${ic('back')}返回</button></div>
    <h1 class="q">我的资料</h1>
    <p class="qhint">${ic('lock')}资料加密保存，只按你同意的方式使用。改动会马上生效。</p>
    <form id="f">
      ${toggleCard('scoring', '用我的资料算结果', '关掉后就看不到结果了。', !!c.scoring, { required: true, i: 0 })}
      ${toggleCard('pool', '让别人也能匹配到我', '以随机代号出现，别人看不到收入和家庭细节。', !!c.pool, { i: 1 })}
      ${toggleCard('research', '用于匿名统计', '只用于很多人加在一起的统计。', !!c.research, { i: 2 })}
    </form>
    <h2 class="sec-title">${ic('edit')}修改</h2>
    <div class="list-card">
      <a href="#/me/gender"><span class="ico">${ic('user')}</span><span class="t">我自己的情况<span>年龄、学历、家庭等</span></span>${ic('next')}</a>
      <a href="#/ideal/review"><span class="ico">${ic('heart')}</span><span class="t">我的要求<span>${S.me.requirements?.length || 0} 条</span></span>${ic('next')}</a>
    </div>
    <h2 class="sec-title">${ic('shield')}数据</h2>
    <div class="list-card">
      <button id="export"><span class="ico">${ic('download')}</span><span class="t">下载我的全部资料<span>保存成一个文件</span></span>${ic('next')}</button>
      <button id="delete" class="danger-row"><span class="ico">${ic('trash')}</span><span class="t">永久删除我的全部资料<span>删除后不能恢复</span></span>${ic('next')}</button>
    </div>`);
  bindBack();
  const form = document.getElementById('f');
  form.addEventListener('change', async () => {
    try {
      await api('PUT', '/api/me/consent', { scoring: form.scoring.checked, pool: form.pool.checked, research: form.research.checked });
      S.me = await api('GET', '/api/me');
      S.results = null;
      toast(form.scoring.checked ? '已保存' : '已保存。要看结果时，需要重新打开第一项');
    } catch (e) { toast(e.message); }
  });
  document.getElementById('export').onclick = async () => {
    try {
      const data = await api('GET', '/api/me/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'vier-my-data.json';
      a.click();
      toast('已开始下载');
    } catch (e) { toast(e.message); }
  };
  document.getElementById('delete').onclick = () => {
    const m = sheet(`<h2>确定要删除吗？</h2>
      <p class="lead">你的资料、要求、同意记录都会从服务器上永久删除，<b>不能恢复</b>。</p>
      <div class="stack"><button class="btn danger block" id="yes">${ic('trash')}确定删除</button><button class="btn block" id="no">先不删</button></div>`);
    m.el.querySelector('#no').onclick = m.close;
    m.el.querySelector('#yes').onclick = async (ev) => {
      ev.currentTarget.classList.add('loading');
      try {
        await api('DELETE', '/api/me');
        store.del('vier.token');
        Object.assign(S, { me: null, results: null, pDraft: null, iDraft: null });
        m.close();
        paint(milestone('已经删除', '你的全部资料都已从服务器上删除。', '', `<a class="btn primary block" href="#/">回到首页</a>`));
      } catch (e) { toast(e.message); m.close(); }
    };
  };
}

// ---------- 路由 ----------
async function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a = '', b = ''] = h.split('/');
  try {
    if (!S.config) {
      S.config = await api('GET', '/api/config');
      S.F = Object.fromEntries(S.config.fields.map((f) => [f.key, f]));
      document.getElementById('sim-banner').hidden = S.config.poolMode !== 'simulated';
    }
    if (a === '') return await renderHome();
    if (a === 'intro') return renderIntro();
    if (!S.me) await ensureSession();
    if (a === 'me') {
      if (!b) return go('#/me/gender');
      if (b === 'break') return renderMeBreak();
      if (b === 'done') return renderMeDone();
      return renderMeQ(b);
    }
    if (a === 'ideal') {
      if (!b) return go(S.me.requirements?.length ? '#/ideal/review' : '#/ideal/age');
      if (b === 'break') return renderIdealBreak();
      if (b === 'review') return renderIdealReview();
      return renderIdealQ(b);
    }
    if (a === 'consent') return renderConsent();
    if (a === 'results') return await renderResults();
    if (a === 'match') return await renderMatch(Number(b));
    if (a === 'privacy') return renderPrivacy();
    return await renderHome();
  } catch (e) {
    paint(`<section class="milestone"><h1 class="display">出了点小问题</h1><p class="lead">${esc(e.message)}</p>
      <div class="stack"><button class="btn primary block" id="retry">再试一次</button><a class="btn block" href="#/">回到首页</a></div></section>`);
    document.getElementById('retry').onclick = () => route();
  } finally {
    if (dir !== 'none') window.scrollTo(0, 0);
    dir = 'fwd';
  }
}
window.addEventListener('hashchange', route);
route();

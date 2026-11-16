// VIER 前端：一屏一问的引导式流程。hash 路由；所有打分在服务端完成。
// 设计原则：每一步都自动保存、随时能退回来；全站只用一套说法；用“他 / 她”代替“TA”。
const view = document.getElementById('view');
const S = { config: null, F: null, me: null, results: null, pDraft: null, iDraft: null, backToReview: false, backToMeReview: false, tab: 'ideal', saved: '' };
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

// 提示条；可以带一个动作按钮（例如“改一下”）
let toastTimer;
function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  t.classList.toggle('act', !!action);
  t.classList.add('show');
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2600);
}

// ---------- 自动保存：每答一题就保存，按顺序排队，页面上显示状态 ----------
let saveChain = Promise.resolve();
const SAVED_TEXT = { saving: '保存中…', ok: '✓ 已自动保存', err: '没保存上，请检查网络' };
function setSaved(s) {
  S.saved = s;
  const el = document.getElementById('saved');
  if (el) { el.textContent = SAVED_TEXT[s] || ''; el.className = `saved ${s}`; }
}
function queueSave(fn) {
  setSaved('saving');
  saveChain = saveChain.then(fn).then(() => setSaved('ok')).catch((e) => { setSaved('err'); toast(`没保存上：${e.message}`); });
  return saveChain;
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
  half: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  play: '<path d="m7 4 13 8-13 8Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

// ---------- 全站统一说法 ----------
// 对方：女生看到“他”，男生看到“她”，还不知道性别时说“对方”
const T = () => (S.me?.gender === 'female' ? '他' : S.me?.gender === 'male' ? '她' : '对方');
// 一群对方：男生 / 女生
const THEM = () => (S.me?.gender === 'female' ? '男生' : S.me?.gender === 'male' ? '女生' : '人');
const tx = (s) => String(s).replace(/\{T\}/g, T());
// 三种关系，全站只用这三个名字
const REL = {
  ideal: () => `${T()}适合你`,
  seekers: () => `你适合${T()}`,
  mutual: () => '互相适合',
};
// 服务端字段名里的术语，换成口语
const LABELS = {
  '年收入（税前劳动收入）': '一年挣多少（税前）', '个人净资产': '自己的家底', '父母家庭净资产': '父母家的家底',
  '家庭可提供的支持': '家里能帮多少', '父母养老保障': '父母的养老保险', '父母照护责任': '要不要照顾父母',
  '父母婚姻状态': '父母的婚姻', '常住城市': '住在哪个城市', '未来定居': '以后在哪安家', '最高学历': '学历',
  '职业大类': '做哪一行', '本人住房': '现在住哪', '生育打算': '要不要孩子', '沟通方式': '性格', '生活方式': '生活习惯',
};
const lab = (s) => LABELS[s] || s;
// 显示用：范围写成“到”，未知值说人话
const nice = (s) => (s === null || s === undefined ? '' : String(s).replace(/\s*–\s*/g, ' 到 ').replace('不愿透露', '不想说').replace('未填写', '没填'));
const IMP_FROM_SERVER = { 灵活: '加分', 重要: '在意', 很重要: '很在意', 必须: '必须有' };

// ---------- 题目 ----------
const P1 = ['gender', 'age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle'];
const P2 = ['incomeAnnual', 'personalNetAssets', 'housing', 'familySupport', 'familyNetAssets', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage'];
const I1 = ['age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'incomeAnnual', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle'];
const I2 = ['personalNetAssets', 'housing', 'familySupport', 'familyNetAssets', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage'];
const TOTAL_Q = P1.length + P2.length + I1.length + I2.length;
// 四段：进度条全程只有一条，分成四格，不会中途重置
const SEGS = [
  { label: '你的情况', list: P1 },
  { label: '你的经济和家庭', list: P2, optional: true },
  { label: '你想找的人', list: I1 },
  { label: '对方的经济和家庭', list: I2, optional: true },
];

const ME_Q = {
  gender: ['你是？', '目前只为男生和女生之间做推荐。'],
  age: ['你今年多大？', '按周岁算。按住加减号不放，数字会快速变化。'],
  heightCm: ['你有多高？', '不穿鞋的身高。按住加减号不放，数字会快速变化。'],
  city: ['你现在住在哪个城市？'],
  settlement: ['以后打算在哪里安家？'],
  education: ['你的学历是？', '读到哪一步就选哪一个。'],
  occupation: ['你做哪一行？', '选最接近的一个就行。'],
  marriagePlan: ['你打算什么时候结婚？'],
  childrenPlan: ['以后想要孩子吗？'],
  personality: ['你和别人相处，更像哪一种？'],
  lifestyle: ['你平时的生活，更像哪一种？'],
  incomeAnnual: ['你一年大概挣多少钱？', '工资加奖金，扣税以前的数，不算父母给的。不确定就选“不清楚”。'],
  personalNetAssets: ['你自己有多少家底？', '房子、车、存款加起来，再减掉欠的钱。不确定就选“不清楚”。'],
  housing: ['你现在住在哪里？'],
  familySupport: ['家里能给你多大帮助？'],
  familyNetAssets: ['父母家大概有多少家底？', '房子、存款加起来，再减掉欠的钱。不确定就选“不清楚”。'],
  parentsSecurity: ['父母有养老保险和医保吗？', '不确定就选“不清楚”。'],
  siblings: ['你有兄弟姐妹吗？'],
  care: ['你需要照顾父母吗？'],
  parentsMarriage: ['父母现在的婚姻情况是？'],
};
const IDEAL_Q = {
  age: ['你希望{T}多大？', '设一个年龄范围。'],
  heightCm: ['你希望{T}多高？', '设一个身高范围。'],
  city: ['你希望{T}住在哪个城市？', '可以选好几个。'],
  settlement: ['你希望{T}以后在哪安家？', '可以选好几个。'],
  education: ['你希望{T}的学历至少是？', '选一个最低要求。'],
  occupation: ['你能接受{T}做哪一行？', '可以选好几个。'],
  incomeAnnual: ['你希望{T}一年至少挣多少？', '税前，选一个最低要求。'],
  marriagePlan: ['你希望{T}什么时候结婚？', '可以选好几个。'],
  childrenPlan: ['关于孩子，你能接受{T}怎么想？', '可以选好几个。'],
  personality: ['你喜欢{T}是哪种性格？', '可以选好几个。'],
  lifestyle: ['你喜欢{T}过哪种生活？', '可以选好几个。'],
  personalNetAssets: ['你希望{T}自己至少有多少家底？', '选一个最低要求。'],
  housing: ['你能接受{T}现在住哪里？', '可以选好几个。'],
  familySupport: ['你希望{T}家里能给多少帮助？', '可以选好几个。'],
  familyNetAssets: ['你希望{T}父母家至少有多少家底？', '选一个最低要求。'],
  parentsSecurity: ['你能接受{T}父母的养老情况是？', '可以选好几个。'],
  siblings: ['你能接受{T}有几个兄弟姐妹？', '可以选好几个。'],
  care: ['你能接受{T}照顾父母到什么程度？', '可以选好几个。'],
  parentsMarriage: ['你能接受{T}父母的婚姻情况是？', '可以选好几个。'],
};
const NUM = { age: { min: 18, max: 80, unit: '岁' }, heightCm: { min: 140, max: 210, unit: '厘米' } };
const INCOME_P = [['5 万以下', 30000, 0, 50000], ['5 到 10 万', 75000, 50000, 100000], ['10 到 15 万', 125000, 100000, 150000], ['15 到 20 万', 175000, 150000, 200000], ['20 到 30 万', 250000, 200000, 300000], ['30 到 50 万', 400000, 300000, 500000], ['50 万以上', 700000, 500000, Infinity]];
const MIN_WAN = { incomeAnnual: [5, 10, 15, 20, 30, 50], personalNetAssets: [10, 50, 100, 300, 600], familyNetAssets: [50, 150, 300, 600] };
const IMP = [
  ['off', '不看这条', '这一条不影响结果。'],
  ['1', '加分', '有就加分，没有也行。'],
  ['2', '在意', '会认真比较这一条。'],
  ['3', '很在意', '非常看重，占的分量大。'],
  ['must', '必须有', '达不到就不看这个人。最好只给 1 到 2 条用。'],
];
const IMP_LABEL = Object.fromEntries(IMP.map(([v, l]) => [v, l]));

// 跳过的题记在本机，“继续填写”时不再重复问
const skipped = {
  all: () => { try { return new Set(JSON.parse(store.get('vier.skipped') || '[]')); } catch { return new Set(); } },
  set(key, on) { const s = this.all(); on ? s.add(key) : s.delete(key); store.set('vier.skipped', JSON.stringify([...s])); },
};

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

// 用户下一步该去哪：已经填过或跳过的题不再问
function resumeHash() {
  if (!S.me?.gender) return '#/me/gender';
  const p = S.me.profile || {}, sk = skipped.all();
  const k = P1.find((x) => x !== 'gender' && p[x] === undefined && !sk.has(x));
  if (k) return `#/me/${k}`;
  if (!S.me.requirements?.length) return '#/ideal/age';
  if (!S.me.consent?.scoring) return '#/consent';
  return '#/results';
}

// ---------- 通用界面片段 ----------
function paint(html, { wide = false } = {}) {
  view.className = wide ? 'wide' : '';
  view.innerHTML = `<div class="screen ${dir === 'back' ? 'back' : ''}">${html}</div>`;
}

// 进度：一条四格的总进度，下面一行写清楚“这一段第几题”和保存状态
function qHead(backHref, seg, idx) {
  const s = SEGS[seg], n = s.list.length;
  const segs = SEGS.map((_, k) => {
    const from = k < seg ? 100 : k > seg ? 0 : Math.round((idx / n) * 100);
    const to = k === seg ? Math.round(((idx + 1) / n) * 100) : from;
    return `<span class="seg"><i style="--p:${from}%" data-to="${to}"></i></span>`;
  }).join('');
  return `<div class="qhead">
    <button class="back-btn" data-back="${backHref}" aria-label="上一步">${ic('back')}</button>
    <div class="progress">
      <div class="progress-meta"><b>${s.label}${s.optional ? '（选填）' : ''}</b><span>第 ${seg + 1} 段，共 4 段</span></div>
      <div class="segs" role="progressbar" aria-label="总进度" aria-valuenow="${seg + 1}" aria-valuemin="1" aria-valuemax="4">${segs}</div>
      <div class="progress-sub"><span>这一段第 ${idx + 1} 题，共 ${n} 题</span><span id="saved" class="saved ${S.saved}">${SAVED_TEXT[S.saved] || ''}</span></div>
    </div>
  </div>`;
}
function simpleHead(backHref, title, right) {
  return `<div class="qhead"><button class="back-btn" data-back="${backHref}" aria-label="上一步">${ic('back')}</button>
    <div class="progress"><div class="progress-meta"><b>${title}</b><span>${right}</span></div>
    <div class="segs">${SEGS.map(() => '<span class="seg"><i style="--p:100%"></i></span>').join('')}</div></div></div>`;
}
function growBar() {
  requestAnimationFrame(() => requestAnimationFrame(() => view.querySelectorAll('.segs i[data-to]').forEach((i) => i.style.setProperty('--p', `${i.dataset.to}%`))));
}

function optList(items, sel, { multi = false, cls = '' } = {}) {
  return `<div class="opts ${cls}" role="${multi ? 'group' : 'radiogroup'}">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="opt ${multi ? 'multi' : ''} ${it.soft ? 'soft' : ''} ${on ? 'on' : ''}" data-v="${esc(it.v)}" data-label="${esc(it.label)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}">
      <span class="mark">${ic('check')}</span><span class="opt-t">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
  }).join('')}</div>`;
}

function chipList(items, sel, { multi = false } = {}) {
  return `<div class="chips" role="${multi ? 'group' : 'radiogroup'}">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${esc(it.v)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}">${ic('check')}${esc(it.label)}</button>`;
  }).join('')}</div>`;
}

function stepperHtml(id, val, unit, lab2 = '') {
  return `<div class="stepper" data-stepper="${id}">
    ${lab2 ? `<span class="lab">${lab2}</span>` : ''}
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

function bindBack(before) {
  view.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => { before?.(); go(b.dataset.back, 'back'); }));
}

// ---------- 首页 ----------
function venn({ nums = null } = {}) {
  const [left, right, mid] = [REL.ideal(), REL.seekers(), REL.mutual()];
  const n = (v, x, y) => (nums ? `<text class="num" x="${x}" y="${y}" text-anchor="middle">${v}</text>` : '');
  return `<svg class="venn" viewBox="0 0 340 206" role="img" aria-label="关系图：${left}${nums ? ` ${nums.left} 位` : ''}，${right}${nums ? ` ${nums.right} 位` : ''}，中间重叠的是${mid}${nums ? ` ${nums.mid} 位` : ''}">
    <g class="c1 hit" data-tab="ideal"><circle cx="122" cy="108" r="92" style="fill:color-mix(in srgb, var(--brand) 20%, transparent);stroke:var(--brand);stroke-width:1.5"/>
      ${n(nums?.left, 80, 112)}<text x="80" y="${nums ? 136 : 114}" text-anchor="middle">${left}</text></g>
    <g class="c2 hit" data-tab="seekers"><circle cx="218" cy="108" r="92" style="fill:color-mix(in srgb, var(--gold) 24%, transparent);stroke:var(--gold);stroke-width:1.5"/>
      ${n(nums?.right, 260, 112)}<text x="260" y="${nums ? 136 : 114}" text-anchor="middle">${right}</text></g>
    <g class="mid hit" data-tab="mutual">
      ${nums ? `<text class="num" x="170" y="104" text-anchor="middle" style="fill:var(--brand)">${nums.mid}</text><text x="170" y="128" text-anchor="middle">${mid}</text>`
    : `<path transform="translate(158 82)" d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" style="fill:var(--brand)"/><text x="170" y="130" text-anchor="middle" style="fill:var(--brand)">${mid}</text>`}
    </g>
  </svg>`;
}

async function renderHome() {
  const state = () => {
    if (!S.me?.gender) return 'new';
    return S.me.requirements?.length && S.me.consent?.scoring ? 'done' : 'partial';
  };
  const draw = () => {
    const st = state();
    const filled = S.me ? Object.keys(S.me.profile || {}).length + (S.me.gender ? 1 : 0) + (S.me.requirements?.length || 0) : 0;
    const actions = {
      new: `<a class="btn primary block" href="${store.get('vier.intro') ? '#/me/gender' : '#/intro'}">开始填写 ${ic('arrow')}</a>
            <button class="btn block" id="demo">${ic('play')}先看个例子</button>`,
      partial: `<a class="btn primary block" href="${resumeHash()}">继续填写 ${ic('arrow')}</a>
            <p class="small muted" style="margin:0">上次已经填了 ${filled} 题，都保存好了。</p>
            <a class="btn block" href="#/me/review">看看我填了什么</a>`,
      done: `<a class="btn primary block" href="#/results">${ic('list')}看谁适合我</a>
            <a class="btn block" href="#/me/review">改改我填的资料</a>`,
    }[st];
    paint(`<section class="hero">
      <p class="eyebrow rise">${ic('sparkle')} 大约 6 到 8 分钟 · 可以分几次填</p>
      <h1 class="display rise" style="--i:1">看看<em>谁适合你</em></h1>
      ${venn()}
      <p class="lead rise" style="--i:2">说说你的情况，再说说你想找的人。我们帮你找出双方条件都合适的人。</p>
      <div class="stack rise" style="--i:3">${actions}</div>
      <ul class="benefits">
        <li class="rise" style="--i:4"><span class="n">1</span><div><b>说说你自己</b><span>点选就行，不想说的可以跳过</span></div></li>
        <li class="rise" style="--i:5"><span class="n">2</span><div><b>说说你想找的人</b><span>每条要求，告诉我们有多在意</span></div></li>
        <li class="rise" style="--i:6"><span class="n">3</span><div><b>看看谁适合你</b><span>每个人符合你几条、你符合对方几条，一看就懂</span></div></li>
      </ul>
      <p class="fine">${ic('lock')} 每答一题都会自动保存，随时可以退出，下次接着填。<br>别人看不到你的收入和家庭细节。只比较条件，不代表一个人好不好。</p>
    </section>`);
    const demo = document.getElementById('demo');
    if (demo) demo.onclick = openDemoSheet;
  };
  draw();
  // 已有会话时读取资料，把按钮换成“继续填写”或“看谁适合我”
  if (!S.me && store.get('vier.token')) {
    try { await ensureSession(); if ((location.hash.replace(/^#/, '') || '/') === '/' && state() !== 'new') { dir = 'none'; draw(); } } catch { /* 忽略 */ }
  }
}

function openDemoSheet() {
  const m = sheet(`<h2>先看个例子</h2>
    <p class="lead">我们用一份示例资料，直接给你看结果长什么样。之后可以随时改成你自己的。</p>
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
    ['user', '第一步：说说你自己', `年龄、身高、在哪工作……点一点就能选。全部一共 ${TOTAL_Q} 题，不想说的点“跳过”。`],
    ['heart', '第二步：说说你想找的人', '每一条要求，告诉我们你有多在意。“必须有”就是达不到就不看。'],
    ['users', '第三步：看看谁适合你', '每个人符合你几条要求、你符合对方几条，都写得清清楚楚。'],
  ];
  paint(`<section class="intro">
    <div class="slides" id="slides">${slides.map(([i, h, p]) => `<div class="slide"><div class="art">${ic(i)}</div><h2>${h}</h2><p>${p}</p></div>`).join('')}</div>
    <div class="dots" aria-hidden="true">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
    <p class="fine">${ic('lock')} 每答一题都自动保存，中途退出也不会丢。</p>
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

// ---------- 第一、二段：关于你（一屏一问，每题自动保存） ----------
function pDraft() {
  if (!S.pDraft) S.pDraft = { gender: S.me.gender || '', profile: { ...(S.me.profile || {}) }, nickname: S.me.identity?.nickname || '' };
  return S.pDraft;
}

function saveProfile() {
  const d = pDraft();
  if (!d.gender) return saveChain;
  const profile = Object.fromEntries(Object.entries(d.profile).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  return queueSave(async () => {
    await api('PUT', '/api/me/profile', { gender: d.gender, profile, identity: { nickname: d.nickname } });
    S.me.gender = d.gender;
    S.me.profile = profile;
    S.results = null;
  });
}

function meNav(key) {
  const seg = P1.includes(key) ? 0 : 1, list = SEGS[seg].list, i = list.indexOf(key);
  return {
    seg, i,
    back: S.backToMeReview ? '#/me/review' : i > 0 ? `#/me/${list[i - 1]}` : seg === 0 ? '#/' : '#/me/break',
    next() {
      if (S.backToMeReview) { S.backToMeReview = false; return go('#/me/review'); }
      if (i < list.length - 1) return go(`#/me/${list[i + 1]}`);
      go(seg === 0 ? '#/me/break' : '#/me/done');
    },
  };
}

// 怎么把一个资料值说给用户听
function profileText(key, v) {
  if (key === 'gender') return { female: '女生', male: '男生' }[v] || '';
  if (v === undefined || v === null || v === '') return '';
  if (key === 'incomeAnnual' && typeof v === 'number') return INCOME_P.find(([, , lo, hi]) => v >= lo && v < hi)?.[0] || `${wan(v)} 万`;
  if (NUM[key] && typeof v === 'number') return `${v} ${NUM[key].unit}`;
  return nice(v);
}

function renderMeQ(key) {
  const d = pDraft(), f = S.F[key];
  if (!ME_Q[key]) return go('#/me/gender');
  if (key !== 'gender' && !d.gender) return go('#/me/gender');
  const nav = meNav(key);
  const [q, hint] = ME_Q[key];
  const cur = key === 'gender' ? d.gender : d.profile[key];
  let body = '', stepper = false;

  if (key === 'gender') {
    body = `<div class="gender" role="radiogroup">${[['female', '我是女生', '想认识男生'], ['male', '我是男生', '想认识女生']].map(([v, l, s], i) =>
      `<button type="button" class="opt ${cur === v ? 'on' : ''}" data-v="${v}" data-label="${l}" role="radio" aria-checked="${cur === v}" style="--i:${i}"><span class="face">${ic('user')}</span><span class="opt-t"><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>`;
  } else if (f.type === 'number') {
    stepper = true;
    const def = key === 'age' ? 28 : d.gender === 'male' ? 175 : 163;
    body = stepperHtml(key, typeof cur === 'number' ? cur : def, NUM[key].unit);
  } else {
    let items;
    let sel = cur ?? '';
    if (key === 'incomeAnnual') {
      items = INCOME_P.map(([l, v]) => ({ v: String(v), label: l }));
      if (typeof cur === 'number') sel = String(INCOME_P.find(([, , lo, hi]) => cur >= lo && cur < hi)?.[1] ?? '');
    } else {
      items = (f.bands ? Object.keys(f.bands) : f.levels || f.options).map((o) => ({ v: o, label: nice(o) }));
    }
    // 敏感题：既可以“不清楚”，也可以“不想说”
    if (f.tier === 'L2') items.push({ v: '不清楚', label: '不清楚', soft: true }, { v: '不愿透露', label: '不想说', soft: true });
    body = optList(items, String(sel), { cls: key === 'occupation' ? 'grid2' : '' });
  }

  paint(`${qHead(nav.back, nav.seg, nav.i)}
    <h1 class="q">${q}</h1>
    <p class="qhint">${hint || '点一下就会进入下一题。'}</p>
    ${f?.tier === 'L2' ? `<p class="qhint">${ic('lock')}只用来计算，不会把具体数字给别人看。</p>` : ''}
    ${body}
    <div class="qfoot">
      ${stepper ? `<button class="btn primary" id="ok">好了，下一题 ${ic('arrow')}</button>` : ''}
      ${key !== 'gender' ? `<button class="btn ${stepper ? 'ghost' : 'block'}" id="skip">跳过这题</button>` : ''}
    </div>`);
  growBar();
  bindBack();

  let busy = false;
  const here = location.hash;
  const advance = (label) => {
    if (busy) return; busy = true;
    nav.next();
    // 自动跳题后给一个“改一下”的机会
    if (label) toast(`已选：${label}`, { label: '改一下', fn: () => go(here, 'back') });
  };
  const skip = document.getElementById('skip');
  if (skip) skip.onclick = () => { delete d.profile[key]; skipped.set(key, true); saveProfile(); advance(); };

  if (stepper) {
    const n = NUM[key], el = view.querySelector('[data-stepper]');
    let v = Number(el.querySelector('[data-val]').textContent);
    bindStepper(el, () => v, (x) => { v = Math.min(n.max, Math.max(n.min, x)); });
    document.getElementById('ok').onclick = () => { d.profile[key] = v; skipped.set(key, false); saveProfile(); advance(); };
    return;
  }
  view.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
    if (busy) return;
    view.querySelectorAll('.opt').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    const v = b.dataset.v;
    if (key === 'gender') {
      if (d.gender && d.gender !== v) S.iDraft = null; // 换了性别，理想型默认值要重算
      d.gender = v;
    } else if (key === 'incomeAnnual' && !['不愿透露', '不清楚'].includes(v)) d.profile[key] = Number(v);
    else d.profile[key] = v;
    skipped.set(key, false);
    saveProfile();
    setTimeout(() => advance(b.dataset.label), reduceMotion() ? 80 : 600);
  }));
}

function renderMeBreak() {
  paint(milestone('你的情况填好了', '下面几题是<b>你的经济和家庭情况</b>，全部选填。填了结果更准，不填也能看结果。',
    '这些内容加密保存，只用来计算。别人只能看到“符合 / 不符合”，看不到你的具体数字。',
    `<button class="btn primary block" id="more">继续填（9 题，大约 1 分钟）</button>
     <button class="btn block" id="skip">跳过，去说说想找的人</button>
     <button class="btn ghost" data-back="#/me/lifestyle">${ic('back')} 返回上一题</button>`));
  bindBack();
  document.getElementById('more').onclick = () => go('#/me/incomeAnnual');
  document.getElementById('skip').onclick = () => go(S.me.requirements?.length ? '#/ideal/review' : '#/ideal/age');
}

function renderMeDone() {
  paint(milestone('你的情况填好了', '接下来说说<b>你想找什么样的人</b>。每条要求，再告诉我们你有多在意。', '',
    `<button class="btn primary block" id="go">说说我想找的人 ${ic('arrow')}</button>
     <a class="btn block" href="#/me/review">看看我填了什么</a>
     <button class="btn ghost" data-back="#/me/parentsMarriage">${ic('back')} 返回上一题</button>`));
  bindBack();
  document.getElementById('go').onclick = () => go(S.me.requirements?.length ? '#/ideal/review' : '#/ideal/age');
}

// 资料回顾：每一行都能点进去改，改完回到这里
function renderMeReview() {
  if (!S.me.gender) return go('#/me/gender');
  const d = pDraft(); // 本地草稿：答完立即更新，保存在后台排队进行
  const row = (k, i) => {
    const v = k === 'gender' ? d.gender : d.profile[k];
    const t = profileText(k, v);
    return `<button class="sum-item" data-k="${k}" style="--i:${i}"><div class="t"><b>${k === 'gender' ? '性别' : esc(lab(S.F[k].label))}</b><span class="${t ? '' : 'none'}">${esc(t || '没填')}</span></div>${ic('edit')}</button>`;
  };
  const next = S.me.requirements?.length ? (S.me.consent?.scoring ? ['#/results', '看谁适合我'] : ['#/ideal/review', '下一步：确认我的要求']) : ['#/ideal/age', '下一步：说说我想找的人'];
  paint(`${simpleHead('#/', '我填的资料', '随时可以改')}
    <h1 class="q">这是你填的资料</h1>
    <p class="qhint">点任意一行可以修改，改完会回到这里。都已经自动保存了。</p>
    <h2 class="sec-title">${ic('user')}你的情况</h2>
    <div class="sum-list">${P1.map(row).join('')}</div>
    <h2 class="sec-title">${ic('lock')}你的经济和家庭（选填）</h2>
    <div class="sum-list">${P2.map((k, i) => row(k, i + P1.length)).join('')}</div>
    <div class="qfoot"><a class="btn primary block" href="${next[0]}">${next[1]} ${ic('arrow')}</a></div>`);
  bindBack();
  view.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { S.backToMeReview = true; go(`#/me/${b.dataset.k}`); }));
}

// ---------- 第三、四段：你想找的人 ----------
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
    if (f.type === 'ordinal' && r.op === 'in') target = Array.isArray(target) ? target[0] : target;
    if (f.type === 'category') target = Array.isArray(target) ? target : [target];
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
    return `${{ atLeast: '至少', atMost: '最多', about: '大约' }[e.orig.op] || ''} ${e.orig.target} ${NUM[key].unit}`;
  }
  if (f.type === 'number') return `${e.target[0]} 到 ${e.target[1]} ${NUM[key].unit}`;
  if (f.type === 'money') return `至少 ${wan(e.target)} 万`;
  if (f.type === 'ordinal') return `${e.target}及以上`;
  return e.target.map(nice).join('、');
}

function saveReqs() {
  const d = iDraft();
  const requirements = [...I1, ...I2].map((k) => toReq(k, d[k])).filter(Boolean);
  return queueSave(async () => {
    await api('PUT', '/api/me/requirements', { requirements });
    S.me.requirements = requirements;
    S.results = null;
  });
}

function iNav(key) {
  const seg = I1.includes(key) ? 2 : 3, list = SEGS[seg].list, i = list.indexOf(key);
  return {
    seg, i,
    back: S.backToReview ? '#/ideal/review' : i > 0 ? `#/ideal/${list[i - 1]}` : seg === 2 ? '#/me/done' : '#/ideal/break',
    next() {
      if (S.backToReview) { S.backToReview = false; return go('#/ideal/review'); }
      if (i < list.length - 1) return go(`#/ideal/${list[i + 1]}`);
      go(seg === 2 ? '#/ideal/break' : '#/ideal/review');
    },
  };
}

function impBlock(e) {
  return `<div class="imp" id="imp">
    <h3>这一条，你有多在意？</h3>
    <div class="imp-list" role="radiogroup" aria-label="在意程度">${IMP.map(([v, l, note]) => `<button type="button" class="imp-opt ${e.imp === v ? 'on' : ''}" data-imp="${v}" role="radio" aria-checked="${e.imp === v}">
      <span class="mark">${ic('check')}</span><span class="t"><b>${l}</b><span>${note}</span></span></button>`).join('')}</div>
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
    body = chipList(f.options.map((o) => ({ v: o, label: nice(o) })), e.target || [], { multi: true });
  }

  paint(`${qHead(nav.back, nav.seg, nav.i)}
    <h1 class="q">${tx(q)}</h1>
    <p class="qhint">${hint}</p>
    <div id="target">${body}</div>
    ${impBlock(e)}
    <div class="qfoot">
      <button class="btn primary" id="ok">${S.backToReview ? '改好了' : '下一题'} ${ic('arrow')}</button>
    </div>`);
  growBar();
  bindBack(() => { if (e.imp === 'off' || entryValid(key, e)) saveReqs(); });

  const setImp = (v, flash) => {
    e.imp = v;
    view.querySelectorAll('[data-imp]').forEach((b) => { b.classList.toggle('on', b.dataset.imp === v); b.setAttribute('aria-checked', b.dataset.imp === v); });
    if (flash) { const box = document.getElementById('imp'); box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  };
  // 选了具体条件，却还是“不看这条”时，自动改成“在意”，并闪一下提醒
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
      toast(f.type === 'category' ? '请至少选一个；如果都可以，就选“不看这条”' : '请先选一个；如果无所谓，就选“不看这条”');
      const t = document.getElementById('target'); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
      return;
    }
    saveReqs();
    nav.next();
  };
}

function renderIdealBreak() {
  paint(milestone('主要的要求说完了', `还想对${T()}的<b>经济和家庭情况</b>提要求吗？这部分可以不填。`, '',
    `<button class="btn primary block" id="review">不用了，看看我的要求 ${ic('arrow')}</button>
     <button class="btn block" id="more">要加几条（8 题，大约 1 分钟）</button>
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
  paint(`${simpleHead('#/ideal/break', '确认你的要求', `共 ${on.length} 条`)}
    <h1 class="q">这是你的要求</h1>
    <p class="qhint">点任意一条可以修改。都已经自动保存了。</p>
    ${on.length ? `<div class="sum-list">${on.map((k, i) => `<button class="sum-item" data-k="${k}" style="--i:${i}">
        <div class="t"><b>${esc(lab(S.F[k].label))}</b><span>${esc(describe(k, d[k]))}</span></div>
        <span class="badge ${d[k].imp === 'must' ? 'must' : d[k].imp === '3' ? 'l3' : ''}">${IMP_LABEL[d[k].imp]}</span>${ic('edit')}</button>`).join('')}</div>`
    : `<div class="empty">${ic('search')}<b>还没有任何要求</b>至少选一条，我们才知道帮你找什么样的人。</div>`}
    ${mustN >= 4 ? `<div class="tip" style="animation-delay:0s">${ic('info')}<span>你有 <b>${mustN} 条“必须有”</b>。太多了可能一个人都找不到，可以把一些改成“很在意”。</span></div>` : ''}
    <div class="stack"><button class="btn block" id="add">${ic('plus')}再加几条要求</button></div>
    <div class="qfoot">${on.length ? `<button class="btn primary block" id="save">就这些，看谁适合我 ${ic('arrow')}</button>` : `<button class="btn primary block" data-back="#/ideal/age">去选要求</button>`}</div>`);
  bindBack();
  view.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { S.backToReview = true; go(`#/ideal/${b.dataset.k}`); }));
  document.getElementById('add').onclick = () => go(`#/ideal/${[...I1, ...I2].find((k) => !on.includes(k)) || 'age'}`);
  const save = document.getElementById('save');
  if (save) save.onclick = async () => {
    save.classList.add('loading');
    await saveReqs();
    if (S.saved === 'err') { save.classList.remove('loading'); return; }
    S.iDraft = null;
    go(S.me.consent?.scoring ? '#/results' : '#/consent');
  };
}

// ---------- 同意：一句人话 + 两个“可以 / 不要”的选择 ----------
const SEE_CARD = () => `<div class="see-card">
  <p class="see-title">${ic('eye')}别人能看到你的什么？</p>
  <div class="see-row t-good"><span class="st">${ic('check')}</span><div><b>能看到</b>年龄、身高、城市、学历、职业、结婚和孩子的打算</div></div>
  <div class="see-row t-warn"><span class="st">${ic('half')}</span><div><b>只看到大概范围</b>收入（比如“15 到 20 万”）</div></div>
  <div class="see-row t-bad"><span class="st">${ic('eyeOff')}</span><div><b>看不到</b>你的名字、存款、父母和家里的情况</div></div>
  <p class="small muted" style="margin:10px 0 0">你会用一个随机代号出现，别人不知道是你。</p>
</div>`;

function choice(name, cur, yes, no) {
  return `<div class="choice" role="radiogroup">${[['1', '可以', yes], ['0', '不要', no]].map(([v, l, s]) =>
    `<button type="button" class="opt ${cur === v ? 'on' : ''}" data-name="${name}" data-v="${v}" role="radio" aria-checked="${cur === v}"><span class="mark">${ic('check')}</span><span class="opt-t"><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>`;
}

function renderConsent() {
  const c = S.me.consent || {};
  const st = { pool: c.pool ? '1' : '0', research: c.research ? '1' : '0' };
  paint(`${simpleHead('#/ideal/review', '最后一步', '你的资料，你做主')}
    <h1 class="q">最后，问你两件事</h1>
    <div class="note-card" style="margin-top:6px">${ic('lock')}<span>要帮你找人，我们会用你填的资料来计算。只在我们的服务器里算，不给任何人看。以后随时可以在“我的资料”里删除。</span></div>
    <h2 class="sec-title">1. 让别人也能找到你吗？</h2>
    ${choice('pool', st.pool, '别人的结果里也可能出现你', '别人搜不到你')}
    ${SEE_CARD()}
    <h2 class="sec-title">2. 用于匿名统计吗？</h2>
    ${choice('research', st.research, '只算很多人加在一起的数', '不参与统计')}
    <div class="qfoot"><button class="btn primary block" id="go">同意，开始找人 ${ic('arrow')}</button></div>
    <p class="fine">点“同意”表示你同意我们用你的资料计算结果（同意内容 ${esc(String(S.config.consentVersion).replace(/^consent-/, ''))} 版）。</p>`);
  bindBack();
  view.querySelectorAll('.choice .opt').forEach((b) => (b.onclick = () => {
    st[b.dataset.name] = b.dataset.v;
    view.querySelectorAll(`[data-name="${b.dataset.name}"]`).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  }));
  const btn = document.getElementById('go');
  btn.onclick = async () => {
    btn.classList.add('loading');
    try {
      await api('PUT', '/api/me/consent', { scoring: true, pool: st.pool === '1', research: st.research === '1' });
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

// ---------- 结果：主结论是“符合几条”，分数收进详情 ----------
const fmt = (t) => (Math.round(t.low) === Math.round(t.high) ? `${Math.round(t.low)}` : `${Math.round(t.low)} 到 ${Math.round(t.high)}`);
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const avatar = (c, lg) => `<span class="avatar ${lg ? 'lg' : ''}" style="--h:${hue(c.alias)}" aria-hidden="true">${esc(String(c.alias).replace(/^[^A-Za-z0-9一-龥]+/, '').slice(0, 1).toUpperCase() || '?')}</span>`;

const STATUS = {
  符合: ['t-good', 'check', '符合'],
  部分符合: ['t-warn', 'half', '差一点'],
  '可能符合（资料为区间）': ['t-warn', 'help', '可能符合'],
  不符合: ['t-bad', 'x', '不符合'],
  未填写: ['t-unk', 'help', '没填'],
};
const toneOf = (it) => (STATUS[it.status] || ['t-unk'])[0];
function tally(items) {
  const n = { 't-good': 0, 't-warn': 0, 't-bad': 0, 't-unk': 0 };
  for (const it of items || []) n[toneOf(it)]++;
  return { met: n['t-good'], near: n['t-warn'], no: n['t-bad'], unk: n['t-unk'], total: (items || []).length };
}
// 例：“他的 6 条要求，你符合 4 条（1 条差一点，1 条没填）”
function fitLine(owner, subject, items) {
  if (!items?.length) return '';
  const t = tally(items);
  const extra = [t.near && `${t.near} 条差一点`, t.no && `${t.no} 条不符合`, t.unk && `${t.unk} 条没填`].filter(Boolean).join('，');
  return `<div class="fitline"><p>${owner}的 ${t.total} 条要求，${subject}符合 <b>${t.met}</b> 条${extra ? `<span class="extra">（${extra}）</span>` : ''}</p>
    <span class="dots-row" aria-hidden="true">${items.map((it) => `<i class="${toneOf(it)}"></i>`).join('')}</span></div>`;
}

function pcard(c, inner, { href = '', i = 0, head = '', more = '' } = {}) {
  const tag = href ? 'a' : 'div';
  const sub = [c.gender, c.facts['年龄'], c.facts['常住城市']].filter(Boolean).map(esc).join(' · ');
  return `<${tag} class="pcard" ${href ? `href="${href}"` : ''} style="--i:${i}">
    <div class="pcard-head">${avatar(c)}<div class="pcard-name"><b>${esc(c.alias)}</b><span>${sub}</span></div>
      ${head}${c.simulated ? '<span class="badge sim">模拟</span>' : ''}</div>
    <div class="facts">${Object.entries(c.facts).filter(([k]) => k !== '年龄' && k !== '常住城市').slice(0, 4).map(([, v]) => `<span>${esc(nice(v))}</span>`).join('')}</div>
    ${inner}
    ${href ? `<div class="pcard-more">${more || '看详细'} ${ic('next')}</div>` : ''}
  </${tag}>`;
}

const TABS = {
  ideal: { flow: () => ['你', T()], text: () => `最符合你要求的人。点开看看${T()}在找什么样的人。` },
  seekers: { flow: () => [T(), '你'], text: () => `你正好符合${T()}的要求。只是条件对得上，不代表${T()}已经对你有意思。` },
  mutual: { flow: () => ['你', T(), true], text: () => `${T()}符合你的要求，你也符合${T()}的要求。` },
};

function tabList(r, tab) {
  const t = T();
  if (tab === 'ideal') {
    return r.idealMatches.map((m, i) => pcard(m,
      fitLine('你', t, m.fit.items) + fitLine(t, '你', m.myFitToThem.items),
      { href: `#/match/${i}`, i, head: `<span class="rank">第 ${i + 1} 位</span>`, more: `看看${t}在找什么样的人` })).join('')
      || emptyCard('没有人达到你所有的“必须有”', '可以把一两条“必须有”改成“很在意”，再看看。', '#/ideal/review', '去改要求');
  }
  if (tab === 'mutual') {
    // 同一个人在另外两组里有逐条结果，就借来用；找不到时只说结论
    const byAlias = (list) => Object.fromEntries(list.map((x) => [x.alias, x]));
    const im = byAlias(r.idealMatches), sk = byAlias(r.seekers);
    return r.mutual.map((m, i) => {
      const a = im[m.alias]?.fit.items, b = (im[m.alias] || sk[m.alias])?.myFitToThem.items;
      const inner = a || b ? fitLine('你', t, a) + fitLine(t, '你', b) : '<p class="fitline">两边的条件都对得上。</p>';
      return pcard(m, inner, { i });
    }).join('') || emptyCard('暂时没有两边都适合的人', `先看看“${REL.ideal()}”和“${REL.seekers()}”，或者把要求放宽一点。`);
  }
  return r.seekers.map((m, i) => pcard(m,
    fitLine(t, '你', m.myFitToThem.items)
    + `<p class="small muted" style="margin:8px 0 0">${m.theirFitEligible ? `${t}也达到了你所有的“必须有”。` : `${t}没达到你的某条“必须有”。`}</p>`, { i })).join('')
    || emptyCard('暂时没有', '人选库里还没有人的要求正好对上你。');
}

function emptyCard(title, text, href, btn) {
  return `<div class="empty">${ic('search')}<b>${title}</b>${text}${href ? `<div class="stack" style="margin-top:14px"><a class="btn sm" href="${href}">${btn}</a></div>` : ''}</div>`;
}

async function renderResults() {
  await saveChain;
  if (!S.me.gender) return go('#/me/gender');
  if (!S.me.requirements?.length) return go('#/ideal/age');
  if (!S.me.consent?.scoring) return go('#/consent');
  if (!S.results) await renderCalc();
  const r = await loadResults();
  const s = r.summary, plan = S.config.plans[r.plan];
  const showTip = !store.get('vier.tip.dots');

  paint(`<section class="res-head">
      <p class="eyebrow rise">${ic('sparkle')} 从 ${s.counterpartCount} 位${THEM()}里帮你挑</p>
      <h1 class="display rise" style="--i:1">看看谁适合你</h1>
      ${venn({ nums: { left: s.matchesEligible, right: s.iFitCount, mid: s.mutualCount } })}
      <p class="small muted rise" style="--i:2">点圆圈，或点下面的按钮，切换查看</p>
    </section>
    ${showTip ? `<div class="tip" id="tip">${ic('help')}<span><b>怎么看？</b>每个小圆点是一条要求：<span class="legend-inline"><span><i class="t-good"></i>符合</span><span><i class="t-warn"></i>差一点</span><span><i class="t-bad"></i>不符合</span><span><i class="t-unk"></i>没填</span></span><br>只比较条件，不代表一个人好不好。</span><button class="x" aria-label="知道了">${ic('x')}</button></div>` : ''}
    <div class="tabs" role="tablist">${['ideal', 'seekers', 'mutual'].map((k) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}" class="${S.tab === k ? 'on' : ''}">${REL[k]()}</button>`).join('')}</div>
    <div id="tabpanel"></div>
    ${r.plan === 'vip'
    ? `<div class="vip">${ic('crown')}<div class="t"><b>你是 VIP</b><span>每组可以看 ${S.config.plans.vip.matches} 位</span></div></div>`
    : `<div class="vip">${ic('crown')}<div class="t"><b>想多看几位？</b><span>升级 VIP，每组从 ${S.config.plans.free.matches} 位变成 ${S.config.plans.vip.matches} 位</span></div><button class="btn gold sm" id="upgrade">¥${(S.config.plans.vip.priceFen / 100).toFixed(2)} 升级</button></div>`}
    <div class="stack">
      <a class="btn block" href="#/ideal/review">${ic('edit')}改改我的要求</a>
      <a class="btn ghost" href="#/me/review">改改我自己的资料</a>
    </div>
    <p class="disclaimer">每组最多显示 ${plan.matches} 位${s.matchesPending ? ` · ${s.matchesPending} 位资料不全，暂时没放进来` : ''}${s.seekersExcludedFewRequirements ? ` · ${s.seekersExcludedFewRequirements} 位要求太少，没放进“${REL.seekers()}”` : ''}<br>只比较条件，不是好感，也不代表一个人的价值。</p>`, { wide: true });

  const panel = document.getElementById('tabpanel');
  const show = (tab, scroll) => {
    S.tab = tab;
    view.querySelectorAll('.tabs [data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    const t = TABS[tab], fl = t.flow();
    panel.innerHTML = `<div class="tab-explain"><span class="flow"><span>${fl[0]}</span>${ic(fl[2] ? 'swap' : 'arrow')}<span>${fl[1]}</span></span><span>${t.text()}</span></div><div class="cards">${tabList(r, tab)}</div>`;
    if (scroll) view.querySelector('.tabs').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab, b.tagName.toLowerCase() === 'g')));
  show(S.tab);
  const tip = document.getElementById('tip');
  if (tip) tip.querySelector('.x').onclick = () => { store.set('vier.tip.dots', '1'); tip.remove(); };
  const up = document.getElementById('upgrade');
  if (up) up.onclick = () => openPayment('vip');
}

// ---------- 人选详情：先讲“对方在找什么样的人”，分数和名次收起来 ----------
function checks(items, whoReq, whoVal) {
  return `<div class="checks">${items.map((it, i) => {
    const [tone, icon, word] = STATUS[it.status] || ['t-unk', 'help', nice(it.status)];
    return `<div class="check ${tone}" style="--i:${i}"><span class="st">${ic(icon)}</span>
      <div class="t"><b>${esc(lab(it.label))}</b> ${it.must ? '<span class="badge must">必须有</span>' : ''}
        <div class="kv"><span>${whoReq}</span><span>${esc(nice(it.requirement))}</span><span>${whoVal}</span><span>${it.value === null ? '不公开' : esc(nice(it.value))}</span></div></div>
      <span class="res">${word}</span></div>`;
  }).join('')}</div>`;
}

function ring(label, t) {
  const v = Math.max(0, Math.min(100, t.low));
  return `<div class="ring-card"><div class="ring"><svg viewBox="0 0 110 110" aria-hidden="true"><circle class="bg" cx="55" cy="55" r="46"/><circle class="fg" cx="55" cy="55" r="46" data-v="${v}"/></svg><b class="${Math.round(t.low) === Math.round(t.high) ? '' : 'range'}">${fmt(t)}</b></div>
    <p>${label}</p></div>`;
}

async function renderMatch(idx) {
  const r = await loadResults();
  const m = r.idealMatches[idx];
  if (!m) return go('#/results', 'back');
  const t = T(), n = r.idealMatches.length;
  const top = m.myPlace ? m.myPlace.rankRange[1] : null;
  paint(`<div class="detail-nav">
      <button class="btn ghost sm" data-back="#/results">${ic('back')}返回</button>
      <div class="pager"><a href="#/match/${idx - 1}" aria-label="上一位" aria-disabled="${idx === 0}">${ic('back')}</a><a href="#/match/${idx + 1}" aria-label="下一位" aria-disabled="${idx >= n - 1}">${ic('next')}</a></div>
    </div>
    <section class="profile-top rise">
      ${avatar(m, true)}
      <h1>${esc(m.alias)} ${m.simulated ? '<span class="badge sim">模拟</span>' : ''}</h1>
      <p class="small muted" style="margin:2px 0 0">${esc(m.gender)} · “${REL.ideal()}”第 ${idx + 1} 位</p>
      <div class="facts">${Object.values(m.facts).slice(0, 8).map((v) => `<span>${esc(nice(v))}</span>`).join('')}</div>
    </section>
    <div class="summary-card rise" style="--i:1">
      ${fitLine('你', t, m.fit.items)}
      ${fitLine(t, '你', m.myFitToThem.items)}
    </div>

    <h2 class="sec-title">${ic('search')}${t}在找什么样的人</h2>
    ${m.theirIdeal.length ? `<div class="sum-list">${m.theirIdeal.map((q, i) => `<div class="sum-item static" style="--i:${i}"><div class="t"><b>${esc(lab(q.label))}</b><span>${esc(nice(q.text))}</span></div><span class="badge ${q.must ? 'must' : ''}">${IMP_FROM_SERVER[q.importance] || esc(q.importance)}</span></div>`).join('')}</div>`
    : `<p class="muted">${t}没有写要求。</p>`}

    <h2 class="sec-title">${ic('user')}${t}的要求，你符合哪些</h2>
    ${checks(m.myFitToThem.items, `${t}要`, '你是')}
    <h2 class="sec-title">${ic('heart')}你的要求，${t}符合哪些</h2>
    ${checks(m.fit.items, '你要', `${t}是`)}

    <details class="more" id="more">
      <summary>${ic('info')}想看分数和更多比较？</summary>
      <p class="small muted">分数只是把上面一条条的比较加起来，100 分 = 全部符合。</p>
      <div class="rings">${ring(`${t}符合你的要求`, m.fit.total)}${ring(`你符合${t}的要求`, m.myFitToThem.total)}</div>
      <p class="small" style="margin:14px 0 0">${top ? `按${t}的要求，在 ${m.myPlace.of} 位条件合适的人里，你在前 ${top} 位左右。` : `按${t}的要求，你暂时没排进去（有“必须有”没达到，或资料没填全）。`}</p>
      ${m.theirPicks.length ? `<h3 class="small" style="margin:18px 0 8px">按${t}的要求，最合适的几位</h3><div class="hscroll">${m.theirPicks.map((p, i) => pcard(p, `<p class="small muted" style="margin:10px 0 0">符合${t}的要求：${fmt(p.score)} 分</p>`, { i })).join('')}</div>` : ''}
    </details>
    <div class="stack"><button class="btn block" data-back="#/results">${ic('back')}返回</button></div>`, { wide: true });
  bindBack();
  document.getElementById('more').addEventListener('toggle', (e) => {
    if (e.target.open) requestAnimationFrame(() => requestAnimationFrame(() => view.querySelectorAll('.ring .fg').forEach((c) => (c.style.strokeDashoffset = 289 * (1 - Number(c.dataset.v) / 100)))));
  });
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
    <ul class="perks"><li>${ic('check')}每组从 ${free.matches} 位增加到 ${plan.matches} 位</li><li>${ic('check')}一次付费，长期有效，不自动续费</li></ul>
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
      hint.innerHTML = `打开<b>${app}</b>，点“扫一扫”，对准上面的二维码。<br><span class="wait">付完会自动升级，不用关这个窗口</span>
        <br><button class="btn sm" id="paid" style="margin-top:12px">我已经付好了</button>`
        + (o.mock ? `<br><span class="badge sim" style="margin-top:10px">模拟支付 · 不会真的扣钱</span><br><button class="btn sm" id="mock-pay" style="margin-top:10px">模拟“付款成功”</button>` : '');
      m.el.querySelector('#paid').onclick = () => { clearTimeout(timer); poll(o.orderNo, true); };
      const mp = m.el.querySelector('#mock-pay');
      if (mp) mp.onclick = () => { mp.classList.add('loading'); api('POST', `/api/me/orders/${o.orderNo}/mock-pay`).catch((e) => toast(e.message)); };
      poll(o.orderNo);
    } catch (e) { box.innerHTML = ''; hint.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  }

  async function poll(orderNo, manual) {
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
      if (manual) toast('还没收到付款。如果已经扣钱了，稍等一会儿会自动升级。');
    } catch { /* 网络抖动时继续轮询 */ }
    timer = setTimeout(() => poll(orderNo), 2000);
  }

  m.el.querySelectorAll('[data-p]').forEach((a) => (a.onclick = () => start(a.dataset.p)));
  if (providers.length) start(providers[0].id);
}

// ---------- 我的资料 ----------
function toggleCard(name, title, text, checked, { required = false, i = 0 } = {}) {
  return `<label class="toggle-card" style="--i:${i}">
    <div class="t"><b>${title}${required ? '<span class="req-pill">必须</span>' : ''}</b><span>${text}</span></div>
    <span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} role="switch"><i></i></span>
  </label>`;
}

function renderPrivacy() {
  const c = S.me.consent || {};
  const st = S.me.gender ? (S.me.requirements?.length && c.scoring ? 'done' : 'partial') : 'new';
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${st === 'done' ? '#/results' : '#/'}">${ic('back')}返回</button></div>
    <h1 class="q">我的资料</h1>
    <p class="qhint">${ic('lock')}资料加密保存，只按你同意的方式使用。改动会马上生效。</p>
    ${st !== 'done' ? `<a class="btn primary block" href="${resumeHash()}" style="margin-bottom:8px">${st === 'new' ? '开始填写' : '继续填写'} ${ic('arrow')}</a>` : ''}
    <div class="list-card">
      <a href="#/me/review"><span class="ico">${ic('user')}</span><span class="t">我填的资料<span>年龄、学历、家庭等，点进去可以改</span></span>${ic('next')}</a>
      <a href="${S.me.requirements?.length ? '#/ideal/review' : '#/ideal/age'}"><span class="ico">${ic('heart')}</span><span class="t">我的要求<span>${S.me.requirements?.length || 0} 条</span></span>${ic('next')}</a>
    </div>
    <h2 class="sec-title">${ic('shield')}你的资料怎么用</h2>
    <form id="f">
      ${toggleCard('scoring', '用我的资料帮我找人', '关掉后就看不到结果了。', !!c.scoring, { required: true, i: 0 })}
      ${toggleCard('pool', '让别人也能找到我', '以随机代号出现，别人看不到收入细节和家里情况。关掉后，别人搜不到你。', !!c.pool, { i: 1 })}
      ${toggleCard('research', '用于匿名统计', '只用于很多人加在一起的统计。', !!c.research, { i: 2 })}
    </form>
    <h2 class="sec-title">${ic('download')}下载或删除</h2>
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
        store.del('vier.token'); store.del('vier.skipped');
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
      if (b === 'review') return renderMeReview();
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

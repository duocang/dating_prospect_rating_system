// VIER 前端：一屏一问的引导式流程。hash 路由；所有打分在服务端完成。
// 设计原则：每一步都自动保存、随时能退回来；全站只用一套说法；用“他 / 她”代替“TA”。
const view = document.getElementById('view');
const S = { view: 'cards', config: null, F: null, me: null, results: null, pDraft: null, iDraft: null, backToReview: false, backToMeReview: false, tab: 'ideal', saved: '' };
let dir = 'fwd';
import { relMap, EXAMPLE } from './relmap.js';

// ---------- 基础工具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式下忽略 */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};
S.view = store.get('vier.view') === 'table' ? 'table' : 'cards'; // 结果页“一个个看 / 对照着看”的偏好
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
  if (!res.ok) throw Object.assign(new Error(data.error || '网络不太好，请再试一次'), { status: res.status, data });
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
// 提示条浮在底部按钮的上方，不挡住“下一题 / 跳过这题”；换页后再量一次
function placeToast() {
  const t = document.getElementById('toast'), foot = view.querySelector('.qfoot');
  const top = foot ? Math.min(foot.getBoundingClientRect().top, innerHeight) : innerHeight;
  t.style.bottom = `${Math.max(24, innerHeight - top + 12)}px`;
}
let toastTimer;
function toast(msg, action) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  t.classList.toggle('act', !!action);
  placeToast();
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
  ideal: () => '你的理想型',
  theirs: () => '理想型的理想型',
  seekers: () => '想找你这样的人',
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
const nice = (s) => (s === null || s === undefined ? '' : String(s).replace(/\s*–\s*/g, ' 到 ').replace(/\s+\/\s+/g, '、').replace('不愿透露', '不想说').replace('未填写', '没填'));
const IMP_RANK = { 灵活: 1, 重要: 2, 很重要: 3, 必须: 4 }; // 越在意排越前
const IMP_FROM_SERVER = { 灵活: '有最好', 重要: '在意', 很重要: '很在意', 必须: '必须有' };

// ---------- 题目 ----------
const P1 = ['gender', 'age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'maritalStatus', 'childrenStatus', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle'];
const P2 = ['incomeAnnual', 'personalNetAssets', 'housing', 'familySupport', 'familyNetAssets', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage'];
const I1 = ['age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'incomeAnnual', 'maritalStatus', 'childrenStatus', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle'];
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
  age: ['你今年多大？', '点数字可以直接输入。'],
  heightCm: ['你有多高？', '不穿鞋。点数字可以直接输入。'],
  city: ['你现在住在哪个城市？'],
  settlement: ['以后打算在哪里安家？'],
  education: ['你的学历是？', '读到哪一步就选哪一个。'],
  occupation: ['你做哪一行？', '选最接近的一个就行。'],
  maritalStatus: ['你现在的婚姻状况？'],
  childrenStatus: ['你现在有孩子吗？'],
  marriagePlan: ['你打算什么时候结婚？'],
  childrenPlan: ['以后想要孩子吗？'],
  personality: ['你和别人相处，更像哪一种？'],
  lifestyle: ['你平时的生活，更像哪一种？'],
  incomeAnnual: ['你一年大概挣多少钱？', '选个大概。工资加奖金，扣税前。'],
  personalNetAssets: ['你自己有多少家底？', '选个大概。房子、车、存款，减掉欠的钱。'],
  housing: ['你现在住在哪里？'],
  familySupport: ['家里能给你多大帮助？'],
  familyNetAssets: ['父母家大概有多少家底？', '选个大概，不知道就选“不清楚”。'],
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
  maritalStatus: ['你能接受{T}的婚姻状况是？', '可以选好几个。'],
  childrenStatus: ['你能接受{T}有孩子吗？', '可以选好几个。'],
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
// 意思不一眼明白的选项，下面加一句小字
const OPT_SUB = {
  直接沟通: '有话直说', 慢热温和: '熟了才放得开', 活跃外向: '爱说爱笑，喜欢热闹', 独立安静: '喜欢自己待着',
  规律作息: '每天差不多同一时间睡觉起床', 弹性作息: '睡觉起床时间不固定', 偏好安静: '喜欢安静、人少的地方',
  喜欢社交: '常和朋友聚会', 户外运动: '常去运动、爬山、跑步', 居家休闲: '休息时喜欢待在家',
  计划长期定居本城: '打算一直在现在的城市', 城市可协商: '去哪里可以商量', 未来可能离开本城: '以后可能换城市',
};
const NUM = { age: { min: 18, max: 80, unit: '岁' }, heightCm: { min: 140, max: 210, unit: '厘米' } };
const INCOME_P = [['5 万以下', 30000, 0, 50000], ['5 到 10 万', 75000, 50000, 100000], ['10 到 15 万', 125000, 100000, 150000], ['15 到 20 万', 175000, 150000, 200000], ['20 到 30 万', 250000, 200000, 300000], ['30 到 50 万', 400000, 300000, 500000], ['50 万以上', 700000, 500000, Infinity]];
const MIN_WAN = { incomeAnnual: [5, 10, 15, 20, 30, 50], personalNetAssets: [10, 50, 100, 300, 600], familyNetAssets: [50, 150, 300, 600] };
const IMP = [
  ['off', '不在意', '这一条不看，不影响结果。'],
  ['1', '有最好', '没有也行'],
  ['2', '在意', '会认真比较'],
  ['3', '很在意', '分量很大'],
  ['must', '必须有', '不符合就不看'],
];
const IMP_LABEL = Object.fromEntries(IMP.map(([v, l]) => [v, l]));
// 默认在意程度：用户点了某条要求的具体条件时，先按常见情况预填，随时能改。
// 这是起点，大致按公开婚恋调查里各项的排序给出；同意参与统计的用户多了以后，
// 改成按性别、年龄段、城市分组的平均值（docs/WEIGHTS.md）。键：找男生用 m，找女生用 f。
const DEFAULT_IMP = {
  age: { m: '3', f: '3' }, heightCm: { m: '2', f: '1' }, city: { m: '3', f: '3' }, settlement: { m: '2', f: '2' },
  education: { m: '2', f: '2' }, occupation: { m: '1', f: '1' }, incomeAnnual: { m: '3', f: '1' },
  maritalStatus: { m: '3', f: '3' }, childrenStatus: { m: '3', f: '3' },
  marriagePlan: { m: '3', f: '3' }, childrenPlan: { m: '3', f: '3' }, personality: { m: '2', f: '2' }, lifestyle: { m: '1', f: '1' },
  personalNetAssets: { m: '1', f: '1' }, housing: { m: '2', f: '1' }, familySupport: { m: '1', f: '1' }, familyNetAssets: { m: '1', f: '1' },
  parentsSecurity: { m: '2', f: '2' }, siblings: { m: '1', f: '1' }, care: { m: '1', f: '1' }, parentsMarriage: { m: '1', f: '1' },
};
const defaultImp = (key) => DEFAULT_IMP[key]?.[S.me?.gender === 'female' ? 'm' : 'f'] || '2';
const IMP_WEIGHT = { 1: 1, 2: 2, 3: 3 };

// 跳过的题记在本机，“继续填写”时不再重复问
const skipped = {
  all: () => { try { return new Set(JSON.parse(store.get('vier.skipped') || '[]')); } catch { return new Set(); } },
  set(key, on) { const s = this.all(); on ? s.add(key) : s.delete(key); store.set('vier.skipped', JSON.stringify([...s])); },
};

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
      <div class="progress-meta"><b>${s.label}${s.optional ? '（选填）' : ''}</b><span id="saved" class="saved ${S.saved}">${SAVED_TEXT[S.saved] || ''}</span></div>
      <div class="segs" role="progressbar" aria-label="总进度" aria-valuenow="${seg + 1}" aria-valuemin="1" aria-valuemax="4">${segs}</div>
      <div class="progress-sub"><span>${leftText(seg, idx)}</span></div>
    </div>
  </div>`;
}
// 只说“还剩多久”，不让人数段数、题数。每题按 8 秒估；选填段不算
function leftText(seg, idx) {
  let n = SEGS[seg].list.length - idx;
  SEGS.forEach((x, k) => { if (k > seg && !x.optional) n += x.list.length; });
  const min = Math.max(1, Math.round((n * 8) / 60));
  return n <= 1 ? '最后一题' : `还剩约 ${min} 分钟`;
}
function simpleHead(backHref, title, right) {
  return `<div class="qhead"><button class="back-btn" data-back="${backHref}" aria-label="上一步">${ic('back')}</button>
    <div class="progress"><div class="progress-meta"><b>${title}</b><span>${right}</span></div>
    <div class="segs">${SEGS.map(() => '<span class="seg"><i style="--p:100%"></i></span>').join('')}</div></div></div>`;
}
function growBar() {
  requestAnimationFrame(() => requestAnimationFrame(() => view.querySelectorAll('.segs i[data-to]').forEach((i) => i.style.setProperty('--p', `${i.dataset.to}%`))));
}

// 选项很多（100 个城市）时：只摆出 10 个常见大城市和已选的，其他城市输入名字搜出来
const TOP_CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉', '南京', '西安'];
const longList = (items) => items.length > 20;
const hiddenMore = (items, it, on) => longList(items) && !on && !TOP_CITIES.includes(it.v);
const searchBox = (items) => (longList(items) ? `<input class="text-input opt-filter" type="search" placeholder="其他城市：输入名字搜索" aria-label="搜索城市" style="margin:0 0 12px">` : '');
function optList(items, sel, { multi = false, cls = '' } = {}) {
  return `${searchBox(items)}<div class="opts ${cls}" role="${multi ? 'group' : 'radiogroup'}">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="opt ${multi ? 'multi' : ''} ${it.soft ? 'soft' : ''} ${on ? 'on' : ''}" data-v="${esc(it.v)}" data-label="${esc(it.label)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}"${hiddenMore(items, it, on) ? ' data-more hidden' : ''}>
      <span class="mark">${ic('check')}</span><span class="opt-t">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
  }).join('')}</div>`;
}

function chipList(items, sel, { multi = false } = {}) {
  return `${searchBox(items)}<div class="chips" role="${multi ? 'group' : 'radiogroup'}">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${esc(it.v)}" data-label="${esc(it.label)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}"${hiddenMore(items, it, on) ? ' data-more hidden' : ''}>${ic('check')}${esc(it.label)}</button>`;
  }).join('')}</div>`;
}

function stepperHtml(id, val, unit, lab2 = '') {
  return `<div class="stepper" data-stepper="${id}">
    ${lab2 ? `<span class="lab">${lab2}</span>` : ''}
    <button type="button" data-d="-1" aria-label="减一">${ic('minus')}</button>
    <div class="val" aria-live="polite"><b data-val role="button" tabindex="0" aria-label="点一下直接输入">${val}</b><span>${unit}</span></div>
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
  // 点中间的数字：变成输入框，直接输入（从 31 改到 22 不用点 9 下）
  const b = el.querySelector('[data-val]');
  const edit = () => {
    if (el.querySelector('input')) return;
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'number', inputMode: 'numeric', value: get(), className: 'val-input' });
    inp.setAttribute('aria-label', '输入数字');
    b.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      const n = parseInt(inp.value, 10);
      if (Number.isFinite(n)) set(n);
      inp.replaceWith(b); b.textContent = get();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  };
  b.addEventListener('click', edit);
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
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

// 返回时取消“改完回到确认页”的标记，免得之后点“下一题”又被拉回确认页
function bindBack(before) {
  view.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => {
    before?.();
    if (S.backToReview) S.fromEdit = true; // 从“改一条”退回确认页，确认页的返回键保持原来的去处
    S.backToReview = false; S.backToMeReview = false;
    go(b.dataset.back, 'back');
  }));
}

// ---------- 首页 ----------
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
            <a class="btn ghost block" href="#/login">已经填过？用手机号登录</a>`,
      partial: `<a class="btn primary block" href="${resumeHash()}">继续填写 ${ic('arrow')}</a>
            <p class="small muted" style="margin:0">上次已经填了 ${filled} 题，都保存好了。</p>
            <a class="btn block" href="#/me/review">看看我填了什么</a>`,
      done: `${brokerNotice()}<a class="btn primary block" href="#/results">${ic('list')}看我的 Z 字图</a>
            <a class="btn block" href="#/me/review">改改我填的资料</a>`,
    }[st];
    paint(`<section class="hero">
      <h1 class="display rise">你喜欢的人，<em>喜欢谁</em></h1>
      ${st === 'new' ? '<p class="hero-sub rise">约 5 分钟 · 免费 · 不用注册</p>' : ''}
      <div class="relmap rise" id="relmap" style="--i:1"></div>
      <div class="stack rise" style="--i:2">${actions}</div>
      <p class="fine">${ic('lock')} 自动保存 · 别人看不到你的收入和家庭</p>
    </section>`);
    relMap(document.getElementById('relmap'), EXAMPLE, { esc, onFocus: st === 'done' ? (n) => { const t = { ideal: 'ideal', seekers: 'seekers', theirs: 'theirs' }[n.id]; if (t) { S.tab = t; go('#/results'); } } : null });
    // 已经开始填的人：首页底部可以退出登录 / 换个人重新开始
    if (st !== 'new') {
      const acts = document.querySelector('.hero .stack');
      acts.insertAdjacentHTML('beforeend', `<button class="btn block" id="restart">${S.me.phone ? `退出登录（${esc(S.me.phone)}）` : '换个人，从头开始'}</button>`);
      document.getElementById('restart').onclick = () => {
        const lose = !S.me.phone;
        const m = sheet(`<h2>${lose ? '从头开始？' : '退出登录？'}</h2>
          <p class="lead">${lose ? '你还没登录，资料会丢。想留着就先登录。' : '下次用手机号登录就能回来。'}</p>
          <div class="stack">${lose ? `<a class="btn primary block" href="#/login">先登录保存</a>` : ''}
          <button class="btn ${lose ? 'danger' : 'primary'} block" id="yes">${lose ? '不保留，从头开始' : '退出登录'}</button><button class="btn block" id="no">再想想</button></div>`);
        m.el.querySelector('#no').onclick = m.close;
        m.el.querySelector('a')?.addEventListener('click', m.close);
        m.el.querySelector('#yes').onclick = () => { m.close(); store.del('vier.token'); Object.assign(S, { me: null, results: null, pDraft: null, iDraft: null }); dir = 'none'; draw(); };
      };
    }
  };
  draw();
  // 已有会话时读取资料，把按钮换成“继续填写”或“看谁适合我”
  if (!S.me && store.get('vier.token')) {
    try { await ensureSession(); if ((location.hash.replace(/^#/, '') || '/') === '/' && state() !== 'new') { dir = 'none'; draw(); } } catch { /* 忽略 */ }
  }
}

// ---------- 新手引导 ----------
function renderIntro() {
  const slides = [
    ['user', '第一步：说说你自己', `点一点就行，不想答可以跳过。`],
    ['heart', '第二步：说说你想找的人', '每条要求，说说你有多在意。'],
    ['users', '第三步：看看你喜欢的人，喜欢谁', '还有谁在找你这样的人。'],
  ];
  paint(`<section class="intro">
    <div class="slides" id="slides">${slides.map(([i, h, p]) => `<div class="slide"><div class="art">${ic(i)}</div><h2>${h}</h2><p>${p}</p></div>`).join('')}</div>
    <div class="dots" aria-hidden="true">${slides.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
    <p class="fine">${ic('lock')} 自动保存，随时退出。</p>
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
  if (key !== 'gender' && !d.gender) { toast('先选一下你是男生还是女生'); return go('#/me/gender'); }
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
      items = (f.bands ? Object.keys(f.bands) : f.levels || f.options).map((o) => ({ v: o, label: nice(o), sub: OPT_SUB[o] }));
    }
    // 敏感题：既可以“不清楚”，也可以“不想说”
    if (f.tier === 'L2') items.push({ v: '不清楚', label: '不清楚', soft: true }, { v: '不愿透露', label: '不想说', soft: true });
    // 城市和“你想找的人”里一样：小圆角标签，只摆 10 个大城市，其他搜索
    body = key === 'city' ? chipList(items, String(sel)) : optList(items, String(sel), { cls: key === 'occupation' ? 'grid2' : '' });
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
  // 选完到自动跳题之间有一小段等待：期间返回、跳过或改选，都先取消这次跳题
  let busy = false, timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; };
  bindBack(cancel);

  const advance = (label) => {
    cancel();
    if (busy) return; busy = true;
    nav.next();
  };
  const skip = document.getElementById('skip');
  if (skip) skip.onclick = () => { cancel(); delete d.profile[key]; skipped.set(key, true); saveProfile(); advance(); };

  if (stepper) {
    const n = NUM[key], el = view.querySelector('[data-stepper]');
    let v = Number(el.querySelector('[data-val]').textContent);
    bindStepper(el, () => v, (x) => { v = Math.min(n.max, Math.max(n.min, x)); });
    document.getElementById('ok').onclick = () => { d.profile[key] = v; skipped.set(key, false); saveProfile(); advance(); };
    return;
  }
  view.querySelectorAll('.opt, .chip').forEach((b) => (b.onclick = () => {
    if (busy) return;
    view.querySelectorAll('.opt, .chip').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    const v = b.dataset.v;
    if (key === 'gender') {
      if (d.gender && d.gender !== v) S.iDraft = null; // 换了性别，理想型默认值要重算
      d.gender = v;
    } else if (key === 'incomeAnnual' && !['不愿透露', '不清楚'].includes(v)) d.profile[key] = Number(v);
    else d.profile[key] = v;
    skipped.set(key, false);
    saveProfile();
    cancel(); // 等待期间改选：以最后一次为准，重新计时
    timer = setTimeout(() => advance(b.dataset.label), reduceMotion() ? 80 : 600);
  }));
}

function renderMeBreak() {
  paint(milestone('你的情况填好了', '下面几题是<b>你的经济和家庭情况</b>，都可以不填。填了更准。',
    '这些都选填。别人看不到具体数字，只知道符不符合。',
    `<button class="btn primary block" id="more">继续填（9 题，大约 1 分钟）</button>
     <button class="btn block" id="skip">这 9 题都跳过，去说说想找的人</button>
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
  const next = S.me.requirements?.length ? (S.me.consent?.scoring ? ['#/results', '看看结果'] : ['#/ideal/review', '下一步：确认我的要求']) : ['#/ideal/age', '下一步：说说我想找的人'];
  paint(`${simpleHead('#/', '我填的资料', '随时可以改')}
    <h1 class="q">这是你填的资料</h1>
    <p class="qhint">点一行就能改。</p>
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
      if (S.backToReview) { S.backToReview = false; S.fromEdit = true; return go('#/ideal/review'); }
      if (i < list.length - 1) return go(`#/ideal/${list[i + 1]}`);
      if (seg === 2) return go('#/ideal/break');
      finishIdeal();
    },
  };
}

function impBlock(e, key) {
  return `<div class="imp" id="imp">
    <h3>这一条，你有多在意？</h3>
    <div class="imp-list" role="radiogroup" aria-label="在意程度">${IMP.filter(([v]) => v !== 'off').map(([v, l, note]) => `<button type="button" class="imp-opt ${e.imp === v ? 'on' : ''}" data-imp="${v}" role="radio" aria-checked="${e.imp === v}">
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
    body = chipList(f.levels.map((l, i) => ({ v: l, label: i === 0 ? '都可以' : `${l}及以上` })), e.target || ''); // 最低一档写“及以上”很别扭（如“高中及以下及以上”）
  } else {
    body = chipList(f.options.map((o) => ({ v: o, label: nice(o) })), e.target || [], { multi: true });
  }

  paint(`${qHead(nav.back, nav.seg, nav.i)}
    <h1 class="q">${tx(q)}</h1>
    <p class="qhint">${hint}</p>
    <div id="target">${body}</div>
    <div id="impwrap" ${f.type === 'number' || entryValid(key, e) ? '' : 'hidden'}>${impBlock(e, key)}</div>
    <div class="qfoot">
      ${e.imp !== 'off' ? `<button class="btn primary" id="ok">${S.backToReview ? '改好了' : '好了，下一题'} ${ic('arrow')}</button><button class="btn ghost" id="skip">不在意</button>` : '<button class="btn block" id="skip">不在意，跳过这题</button>'}
    </div>`);
  growBar();

  const setImp = (v, flash) => {
    e.imp = v;
    view.querySelectorAll('[data-imp]').forEach((b) => { b.classList.toggle('on', b.dataset.imp === v); b.setAttribute('aria-checked', b.dataset.imp === v); });
    if (flash) { const box = document.getElementById('imp'); box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  };
  // 和“关于你”一样：选完条件，下面才出现“有多在意”；点了在意程度，就自动进入下一题
  let timer = null, busy = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  bindBack(() => { cancel(); if (e.imp === 'off' || entryValid(key, e)) saveReqs(); });
  const advance = (label) => {
    cancel(); if (busy) return; busy = true;
    saveReqs();
    nav.next();
  };
  const touched = () => {
    e.dirty = true;
    const w = document.getElementById('impwrap'), ok = entryValid(key, e);
    if (w.hidden && ok) { w.hidden = false; w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash'); }
    if (!ok) { w.hidden = true; cancel(); }
  };
  view.querySelectorAll('[data-imp]').forEach((b) => (b.onclick = () => {
    if (busy) return;
    setImp(b.dataset.imp, false);
    cancel(); // 等待期间改选：以最后一次为准
    timer = setTimeout(() => advance(`${describe(key, e)} · ${IMP_LABEL[b.dataset.imp]}`), reduceMotion() ? 80 : 600);
  }));

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

  document.getElementById('skip').onclick = () => { setImp('off', false); advance(); };
  // 改已有的要求：在意程度本来就选好了，给一个“改好了”按钮，不用为了跳走再点一次在意程度
  const ok = document.getElementById('ok');
  if (ok) ok.onclick = () => {
    if (!entryValid(key, e)) { toast('请至少选一个；都可以的话就点“不在意”'); return; }
    advance();
  };
}

// 要求填完：保存，直接去看谁适合你（第一次会先经过同意页）
async function finishIdeal(btn) {
  btn?.classList.add('loading');
  await saveReqs();
  if (S.saved === 'err') { btn?.classList.remove('loading'); return; }
  if (!S.me.requirements?.length) { btn?.classList.remove('loading'); toast('还没有选任何要求，先选一条吧'); return go('#/ideal/review'); }
  S.iDraft = null;
  go(S.me.consent?.scoring ? '#/results' : '#/consent');
}

function renderIdealBreak() {
  paint(milestone('主要的要求说完了', `还想对${T()}的<b>经济和家庭情况</b>提要求吗？这部分可以不填。`, '',
    `<button class="btn primary block" id="done">不用了，看看结果 ${ic('arrow')}</button>
     <button class="btn block" id="more">要加几条（8 题，大约 1 分钟）</button>
     <button class="btn ghost" id="review">${ic('list')} 先检查一下我的要求</button>
     <button class="btn ghost" data-back="#/ideal/lifestyle">${ic('back')} 返回上一题</button>`));
  bindBack();
  document.getElementById('more').onclick = () => go('#/ideal/personalNetAssets');
  document.getElementById('review').onclick = () => go('#/ideal/review');
  const done = document.getElementById('done');
  done.onclick = () => finishIdeal(done);
}

// 在意程度的直观分布：“必须有”单独列出（达不到就不看），其余按分量从高到低画横条
function weightBars(on, d) {
  const must = on.filter((k) => d[k].imp === 'must');
  const rest = on.filter((k) => IMP_WEIGHT[d[k].imp]).sort((a, b) => IMP_WEIGHT[d[b].imp] - IMP_WEIGHT[d[a].imp]);
  if (!rest.length) return '';
  const total = rest.reduce((t, k) => t + IMP_WEIGHT[d[k].imp], 0);
  // 默认收起，点开再看比例
  return `<details class="wbars"><summary class="wb-title">${ic('list')}<span>各条要求在打分里占多少</span><span class="chev">${ic('next')}</span></summary>
    ${must.length ? `<p class="small muted" style="margin:0 0 8px">必须有：${must.map((k) => esc(lab(S.F[k].label))).join('、')}（达不到就不看，不参与比例）</p>` : ''}
    ${rest.map((k) => { const pc = Math.round((IMP_WEIGHT[d[k].imp] / total) * 100); return `<div class="wb-row"><span>${esc(lab(S.F[k].label))}</span><i><b style="width:${pc}%"></b></i><em>${pc}%</em></div>`; }).join('')}
  </details>`;
}

function renderIdealReview() {
  if (!S.me.gender) return go('#/me/gender');
  const d = iDraft();
  const on = [...I1, ...I2].filter((k) => toReq(k, d[k]));
  const mustN = on.filter((k) => d[k].imp === 'must').length;
  // 返回键回到来的那一页（结果页、我的资料、上一题……）；从同意页来的不回去，免得两页来回跳
  if (!S.fromEdit) S.reviewFrom = /^#\/(ideal\/(?!review)|results|privacy|me\/)/.test(S.prev || '') ? S.prev : '#/ideal/break';
  S.fromEdit = false;
  paint(`${simpleHead(S.reviewFrom, '确认你的要求', `共 ${on.length} 条`)}
    <h1 class="q">这是你的要求</h1>
    <p class="qhint">点一条就能改。</p>
    ${on.length ? `<div class="sum-list">${on.map((k, i) => `<button class="sum-item" data-k="${k}" style="--i:${i}">
        <div class="t"><b>${esc(lab(S.F[k].label))}</b><span>${esc(describe(k, d[k]))}</span></div>
        <span class="badge imp-${d[k].imp === 'must' ? 4 : d[k].imp}">${IMP_LABEL[d[k].imp]}</span>${ic('edit')}</button>`).join('')}</div>`
    : `<div class="empty">${ic('search')}<b>还没有任何要求</b>至少选一条。</div>`}
    ${weightBars(on, d)}
    ${mustN >= 4 ? `<div class="tip" style="animation-delay:0s">${ic('info')}<span>你有 <b>${mustN} 条“必须有”</b>。太多可能找不到人，改几条成“很在意”试试。</span></div>` : ''}
    <div class="stack"><button class="btn block" id="add">${ic('plus')}再加几条要求</button></div>
    <div class="qfoot">${on.length ? `<button class="btn primary block" id="save">就这些，看看结果 ${ic('arrow')}</button>` : `<button class="btn primary block" id="pick">${ic('plus')}去选要求</button>`}</div>`);
  bindBack();
  view.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { S.backToReview = true; go(`#/ideal/${b.dataset.k}`); }));
  // 加条件：弹出还没加的条件列表，选一条、改完直接回到这里，不再从头走一遍
  const addSheet = () => {
    const rest = (list) => list.filter((k) => !on.includes(k));
    const group = (title, list) => (list.length ? `<h3 class="sheet-sub">${title}</h3><div class="sum-list">${list.map((k) => `<button class="sum-item" data-add="${k}"><div class="t"><b>${esc(lab(S.F[k].label))}</b><span>${esc(tx(IDEAL_Q[k][0]))}</span></div>${ic('plus')}</button>`).join('')}</div>` : '');
    const m = sheet(`<h2>想加哪一条？</h2><p class="lead">选一条，设好以后会回到这里。</p>
      ${group('主要条件', rest(I1))}${group(`${T()}的经济和家庭`, rest(I2))}
      ${rest(I1).length + rest(I2).length ? '' : '<p class="lead">所有条件都已经加上了。</p>'}`);
    m.el.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { m.close(); S.backToReview = true; go(`#/ideal/${b.dataset.add}`); }));
  };
  document.getElementById('add').onclick = addSheet;
  const pick = document.getElementById('pick');
  if (pick) pick.onclick = addSheet;
  const save = document.getElementById('save');
  if (save) save.onclick = () => finishIdeal(save);
}

// ---------- 同意：一句人话 + 两个“可以 / 不要”的选择 ----------
// 默认收起：只一行“别人只看到代号和基本情况”，点开再看三档明细
const SEE_CARD = () => `<details class="see-card">
  <summary class="see-title">${ic('eye')}<span>别人只看到你的代号和基本情况</span><em>详情</em><span class="chev">${ic('next')}</span></summary>
  <div class="see-row t-good"><span class="st">${ic('check')}</span><div><b>能看到</b>年龄、身高、城市、学历、职业、婚育打算</div></div>
  <div class="see-row t-warn"><span class="st">${ic('half')}</span><div><b>只看到大概范围</b>收入（比如“15 到 20 万”）</div></div>
  <div class="see-row t-bad"><span class="st">${ic('eyeOff')}</span><div><b>看不到</b>你的名字、存款、父母和家里的情况</div></div>
  <p class="small muted" style="margin:10px 0 0">你用代号出现，别人不知道是你。</p>
</details>`;

function choice(name, cur, yes, no) {
  return `<div class="choice" role="radiogroup">${[['1', '可以', yes], ['0', '不要', no]].map(([v, l, s]) =>
    `<button type="button" class="opt ${cur === v ? 'on' : ''}" data-name="${name}" data-v="${v}" role="radio" aria-checked="${cur === v}"><span class="mark">${ic('check')}</span><span class="opt-t"><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>`;
}

function renderConsent() {
  const c = S.me.consent || {};
  const st = { pool: c.pool ? '1' : '0', research: c.research ? '1' : '0', willing: '0' };
  paint(`${simpleHead('#/ideal/review', '最后一步', '你的资料，你做主')}
    <h1 class="q">最后，问你几件事</h1>
    <div class="note-card" style="margin-top:6px">${ic('lock')}<span>只用来帮你找人，不给任何人看。随时可以删。</span></div>
    <h2 class="sec-title">1. 让别人也能找到你吗？</h2>
    ${choice('pool', st.pool, '别人的结果里也可能出现你', '别人搜不到你')}
    ${SEE_CARD()}
    <h2 class="sec-title">2. 用于匿名统计吗？</h2>
    ${choice('research', st.research, '只算很多人加在一起的数', '不参与统计')}
    <div id="wq" ${st.pool === '1' ? '' : 'hidden'}>
      <h2 class="sec-title">3. 愿意被想认识你的人联系吗？</h2>
      ${choice('willing', st.willing, '有人想认识你时，问你同不同意', '别人联系不到你')}
    </div>
    <div id="cq" hidden>
    <h2 class="sec-title">${ic('user')}用手机号登录</h2>
    <p class="small muted" style="margin:0 0 10px">用手机号登录。你同意后，这个号码才会发给对方一次。</p>
    <div id="lbox">${S.me.phone ? loggedInNote() : loginBlock()}</div>
    </div>
    <button type="button" class="check-row ${c.adult ? 'on' : ''}" id="adult" role="checkbox" aria-checked="${!!c.adult}"><span class="mark">${ic('check')}</span><span>我已满 18 岁，同意<a href="#/terms">用户协议</a>和<a href="#/policy">隐私政策</a></span></button>
    <div class="qfoot"><button class="btn primary block" id="go">同意，开始找人 ${ic('arrow')}</button></div>`);
  bindBack();
  view.querySelectorAll('.choice .opt').forEach((b) => (b.onclick = () => {
    st[b.dataset.name] = b.dataset.v;
    if (b.dataset.name === 'pool') document.getElementById('wq').hidden = b.dataset.v !== '1';
    document.getElementById('cq').hidden = !(st.pool === '1' && st.willing === '1');
    view.querySelectorAll(`[data-name="${b.dataset.name}"]`).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  }));
  if (!S.me.phone) bindLogin(document.getElementById('lbox'), () => { document.getElementById('lbox').innerHTML = loggedInNote(); });
  let adult = !!c.adult;
  const ad = document.getElementById('adult');
  ad.onclick = (e) => { if (e.target.closest('a')) return; adult = !adult; ad.classList.toggle('on', adult); ad.setAttribute('aria-checked', adult); };
  const btn = document.getElementById('go');
  btn.onclick = async () => {
    if (!adult) { toast('请先勾选“我已满 18 岁”'); ad.classList.add('shake'); setTimeout(() => ad.classList.remove('shake'), 500); return; }
    btn.classList.add('loading');
    try {
      const wantBroker = st.pool === '1' && st.willing === '1';
      if (wantBroker && !S.me.phone) { btn.classList.remove('loading'); toast('选了“可以”，请先用手机号登录'); document.getElementById('lphone')?.focus(); return; }
      await api('PUT', '/api/me/consent', { adult: true, scoring: true, pool: st.pool === '1', research: st.research === '1' });
      if (S.me.phone) await api('PUT', '/api/me/broker/willing', { willing: wantBroker });
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

// 计算中：一个细圆环 + 一行会换的字 + 一条细进度条。干净，不堆勾选
async function renderCalc() {
  const steps = ['读取你的要求', '和每个人比一比', '看你符合谁的要求', '整理结果'];
  paint(`<section class="calc">
    <div class="spin" aria-hidden="true"></div>
    <p class="calc-t" aria-live="polite">${steps[0]}</p>
    <div class="calc-bar" aria-hidden="true"><i></i></div>
  </section>`);
  const t = view.querySelector('.calc-t'), bar = view.querySelector('.calc-bar i');
  const job = loadResults();
  const per = reduceMotion() ? 0 : 450;
  for (let i = 0; i < steps.length; i++) {
    t.textContent = steps[i];
    bar.style.width = `${((i + 1) / steps.length) * 100}%`;
    await delay(per);
    if (i === steps.length - 1) await job;
  }
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
  const names = (tone) => items.filter((it) => toneOf(it) === tone).map((it) => esc(lab(it.label))).join('、');
  const miss = [t.no && `<span class="miss">没对上：${names('t-bad')}</span>`, t.near && `<span class="near">差一点：${names('t-warn')}</span>`, t.unk && `<span class="unk">没填：${names('t-unk')}</span>`].filter(Boolean).join('');
  const pct = Math.round((t.met / t.total) * 100);
  return `<div class="fitline"><p><span>${subject === '你' ? `你符合${owner}` : `${subject}符合你`}</span><b>${t.met}<small>/${t.total}</small></b></p>
    <i class="bar"><b style="width:${pct}%"></b></i>${miss ? `<div class="why">${miss}</div>` : ''}</div>`;
}

// 我自己（用户本人）的人称：女生是“她”，男生是“他”
const ME = () => (S.me?.gender === 'female' ? '她' : S.me?.gender === 'male' ? '他' : '你');

// 虚拟理想型：按一组要求拼出来的“样子”，明确标出不是真人
function idealCard(reqs, { title, sub, edit = false, fold = false }) {
  if (fold) return `<details class="ideal-fold"><summary>${ic('user')}<b>${title}</b><span>${reqs.length} 条要求</span><span class="chev">${ic('next')}</span></summary>${idealCard(reqs, { title, sub, edit })}</details>`;
  return `<section class="ideal-card">
    <div class="ideal-head"><span class="ideal-avatar" aria-hidden="true">${ic('user')}</span>
      <div><b>${title}</b><span>${sub}</span></div><span class="badge virtual">想象</span></div>
    <ul class="ideal-list">${[...reqs].sort((x, y) => (IMP_RANK[y.importance] || 0) - (IMP_RANK[x.importance] || 0)).map((q) => `<li><span class="k">${esc(lab(q.label))}</span><span class="v">${esc(nice(String(q.text).replace(/^至少 ?高中及以下$/, '不限')))}</span>
      <span class="badge imp-${IMP_RANK[q.importance] || 0}">${IMP_FROM_SERVER[q.importance] || esc(q.importance)}</span></li>`).join('')}</ul>
    ${edit ? `<a class="ideal-edit" href="#/ideal/review">${ic('edit')}改改我的要求</a>` : ''}
  </section>`;
}
// 把某人的逐条结果按理想型的顺序排好，圆点和对照表才能一一对上
const byIdeal = (reqs, items) => {
  const m = Object.fromEntries((items || []).map((it) => [it.label, it]));
  return reqs.map((q) => m[q.label]).filter(Boolean);
};
// 对照表（手机优先）：三人都符合的条件收成最后一行；其余每行一条，格子只放小图标，
// 对上的是浅绿勾，没对上的可点，点了原地显示对方的实际情况
function compareTable(reqs, people) {
  const itemOf = (p, q) => (p.fit.items || []).find((x) => x.label === q.label);
  const allGood = reqs.filter((q) => people.every((p) => { const it = itemOf(p, q); return it && toneOf(it) === 't-good'; }));
  const rows = reqs.filter((q) => !allGood.includes(q));
  const reqText = (q) => esc(nice(String(q.text).replace(/^至少 ?高中及以下$/, '不限')));
  return `<div class="cmp-wrap"><table class="cmp cmp2">
    <thead><tr><th scope="col"></th>${people.map((p, i) => `<th scope="col"><a href="#/match/${i}"><span class="al">${nameTag(p)}</span><b>${pctQ(p.fit.total)}</b></a></th>`).join('')}</tr></thead>
    <tbody>${rows.map((q) => `<tr><th scope="row"><b>${esc(lab(q.label))}${q.must ? '<em>必须</em>' : ''}</b><span>${reqText(q)}</span></th>
      ${people.map((p) => {
        const it = itemOf(p, q);
        const [tone, icon, word] = it ? (STATUS[it.status] || ['t-unk', 'help', '没填']) : ['t-unk', 'help', '没填'];
        if (it && tone !== 't-good') return `<td class="${tone}"><button type="button" class="cell-tap" aria-expanded="false" aria-label="${word}"><span class="st">${ic(icon)}</span><span class="v">${it.value === null ? '不公开' : esc(nice(it.value))}</span></button></td>`;
        return `<td class="${tone}"><span class="st" aria-label="${word}">${ic(icon)}</span></td>`;
      }).join('')}</tr>`).join('')}
    ${allGood.length ? `<tr class="all-good"><td colspan="${people.length + 1}">${ic('check')}<span><b>都符合</b>${allGood.map((q) => esc(lab(q.label))).join('、')}</span></td></tr>` : ''}</tbody>
  </table>${rows.length ? '<p class="cmp-hint">点 ✕ 或 ◐ 看对方的实际情况</p>' : ''}</div>`;
}

function pcard(c, inner, { href = '', i = 0, head = '', more = '', quick = '' } = {}) {
  const sub = [c.facts['年龄'], c.facts['常住城市']].filter(Boolean).map(esc).join(' · ');
  // 手机上默认收起：只露头像、代号、一句符合几条；点开再看细节
  return `<details class="pcard fold" style="--i:${i}">
    <summary class="pcard-head"><div class="pcard-name"><b>${nameTag(c)}</b><span>${sub}</span></div>
      ${quick ? `<span class="quick">${quick}</span>` : head}<span class="chev">${ic('next')}</span></summary>
    ${brokerTag(c) ? `<div class="broker-tags">${brokerTag(c)}</div>` : ''}
    <div class="facts">${Object.entries(c.facts).filter(([k]) => k !== '年龄' && k !== '常住城市').slice(0, 4).map(([, v]) => `<span>${esc(nice(v))}</span>`).join('')}</div>
    ${inner}
    ${href ? `<a class="pcard-more" href="${href}">${more || '看详细'} ${ic('next')}</a>` : ''}
  </details>`;
}

const TABS = {
  ideal: { flow: () => ['你', T()], text: () => `先看你心中的${T()}，再看最接近的真人。` },
  seekers: { flow: () => [T(), '你'], text: () => `你正好符合${T()}的要求。只是条件对得上，不代表${T()}已经对你有意思。` },
  mutual: { flow: () => ['你', T(), true], text: () => `${T()}符合你的要求，你也符合${T()}的要求。` },
  theirs: { flow: () => [T(), '你'], text: () => `你喜欢的${T()}们，喜欢什么样的人。` },
};
// 两边都对得上的人，在卡片上加一枚“双向”小标，不再单独成组
const mutualIds = (r) => new Set((r.mutual || []).map((m) => m.id));
const twoWay = (r, m) => (mutualIds(r).has(m.id) ? '<span class="two-way">双向</span>' : '');

function tabList(r, tab) {
  const t = T();
  if (r.summary.counterpartCount === 0) return emptyCard('还没有人', `人选库里还没有${THEM()}，不是你的要求太高。过几天再来看看。`);
  if (tab === 'ideal') {
    const reqs = r.myIdeal || [], people = r.idealMatches, table = S.view === 'table' && people.length;
    const head = idealCard(reqs, { title: `你心中的${t}`, sub: '', edit: true, fold: true });
    if (!people.length) return head + emptyCard('没有人达到你所有的“必须有”', '把一两条“必须有”改成“很在意”试试。', '#/ideal/review', '去改要求');
    // 正式环境里虚拟人选和真人在同一个池子：标题不写“真人”，另外说清其中几位是真人
    const real = people.filter((p) => !p.simulated).length;
    const tie = r.summary.topTie > 1 ? `<p class="small muted near-note">有 ${r.summary.topTie} 位和第 1 名一样符合你的要求，所以是并列。</p>` : '';
    const switcher = `<div class="near-head"><h3>最接近的 ${people.length} 位${real < people.length ? `<small>其中真人 ${real} 位</small>` : ''}</h3>
      <div class="seg-switch" role="tablist"><button data-view="cards" class="${table ? '' : 'on'}" role="tab" aria-selected="${!table}">一个个看</button><button data-view="table" class="${table ? 'on' : ''}" role="tab" aria-selected="${!!table}">对照着看</button></div></div>`;
    const body = tie + (table ? compareTable(reqs, people)
      : `<div class="cards">${people.map((m, i) => pcard(m,
        fitLine('你', t, byIdeal(reqs, m.fit.items)) + fitLine(t, '你', m.myFitToThem.items) + brokerBox(m),
        { href: `#/match/${i}`, i, quick: twoWay(r, m) + rankQ(i, m.fit.total, m.rankRange), more: `看看${t}在找什么样的人` })).join('')}</div>`);
    return head + switcher + body;
  }
  if (tab === 'theirs') {
    const list = r.idealOfIdeal || [];
    if (!r.idealMatches.length) return emptyCard('先要有理想型人选', '把一两条“必须有”放宽，理想型人选多了，这里才算得出来。', '#/ideal/review', '去改要求');
    const n = r.idealMatches.length;
    const tieA = r.summary.topTieA > 1 ? `<p class="small muted near-note">有 ${r.summary.topTieA} 位和第 1 名一样接近，所以是并列。</p>` : '';
    return `<div class="near-head"><h3>你的 ${n} 位理想型人选，最常看中的 ${list.length} 位</h3></div>` + tieA
      + cardsOr(list.map((a, i) => pcard(a, `<p class="small muted" style="margin:8px 0 0">完全符合其中 ${a.fullyMetIdeals} 位的要求</p>`, { i, quick: rankQ(i, a.score, a.rankRange) })).join(''),
        emptyCard('暂时算不出来', `人选库里和你同为${S.me?.gender === 'female' ? '女生' : '男生'}的人还不够多。`));
  }
  // 三组卡片统一：两条进度条，顺序固定为“他符合你 / 你符合他”，颜色跟所在组一致
  const both = (m, mine) => fitLine('你', t, m.fit?.items) + fitLine(t, '你', mine?.items);
  if (tab === 'mutual') {
    return cardsOr(r.mutual.map((m, i) => pcard(m, both(m, m.mine) + brokerBox(m), { i, quick: rankQ(i, m.mutualScore, m.rankRange), href: `#/match/${i}/mutual`, more: `看看${t}在找什么样的人` })).join(''),
      emptyCard('暂时没有两边都适合的人', `先看看“${REL.ideal()}”和“${REL.seekers()}”，或者把要求放宽一点。`));
  }
  return cardsOr(r.seekers.map((m, i) => pcard(m, both(m, m.myFitToThem) + brokerBox(m), { i, quick: twoWay(r, m) + rankQ(i, m.myFitToThem.total, m.rankRange), href: `#/match/${i}/seekers`, more: `看看${t}在找什么样的人` })).join(''),
    emptyCard('暂时没有', '人选库里还没有人的要求正好对上你。'));
}

// 卡片右侧：名次 + 契合度。名次按加权分排（越在意的条件分量越大），所以 8/11 也可能排在 9/11 前面
// 资料没填全时分数是个区间：只显示保底的低值，后面加个小“+”表示可能更高（排序本来就按低值）
const pctQ = (t) => `${Math.round(t.low)}%${Math.round(t.high) > Math.round(t.low) ? '<sup title="有些资料没填，实际可能更高">+</sup>' : ''}`;
// 名次：同分的人是并列，写“并列第 1”，不让人以为第 1、2、3 有高低
const rankQ = (i, t, rr) => `<span class="rk">${rr && rr[1] > rr[0] ? `并列第 ${rr[0]}` : `第 ${i + 1}`}</span>${t ? `<span class="pc">${pctQ(t)}</span>` : ''}`;
// 代号：名字右上角一枚小小的、斜着的朱红印章“代号”，提醒这不是真名
const nameTag = (c) => `<span class="nm">${esc(c.name || c.alias)}<i class="seal" aria-label="代号">代号</i></span>`;
const cardsOr = (html, empty) => (html ? `<div class="cards">${html}</div>` : empty);

function emptyCard(title, text, href, btn) {
  return `<div class="empty">${ic('search')}<b>${title}</b>${text}${href ? `<div class="stack" style="margin-top:14px"><a class="btn sm" href="${href}">${btn}</a></div>` : ''}</div>`;
}

// 结果页关系图：你 → 三组 → 每位人选；“他适合你”的人再展开“他想找的”
function resultTree(r) {
  const t = T(), met = (items = []) => items.filter((x) => x.status === '符合').length;
  const who = (m) => [...String(m.alias).replace(/[^A-Za-z0-9一-龥]/g, '')][0]?.toUpperCase() || '?';
  const age = (m) => m.facts['年龄'] ? `${m.facts['年龄']}` : '';
  const person = (m, pre, i, extra) => ({ id: `${pre}${i}`, kind: 'person', short: [...(m.name || who(m))][0], label: m.name || age(m), seal: !!m.name, ...extra });
  const group = (id, tab, list, note, kid) => ({ id, kind: 'group', tab, label: REL[tab](), short: String(list.length), note: list.length ? note : '暂时没有', kids: list.map(kid) });
  return {
    id: 'me', kind: 'me', label: '你', note: '点一个圆圈看看',
    kids: [
      group('ideal', 'ideal', r.idealMatches, `符合你要求的人`, (m, i) => {
        const a = met(m.fit.items), b = met(m.myFitToThem.items), n = m.myFitToThem.items.length;
        return person(m, 'i', i, { fit: `${a}/${m.fit.items.length}`, note: `符合你 ${a} 条 · 再点看${t}想找谁`, href: `#/match/${i}`,
          kids: [{ id: `it${i}`, kind: 'theirs', short: t, label: `${t}想找的`, fit: `你 ${b}/${n}`, note: `你符合${t} ${b} 条`, href: `#/match/${i}` }] });
      }),
      group('seekers', 'seekers', r.seekers, `你符合${t}们的要求`, (m, i) => {
        const b = met(m.myFitToThem.items);
        return person(m, 's', i, { fit: `${b}/${m.myFitToThem.items.length}`, note: `你符合${t} ${b} 条`, href: `#/match/${i}/seekers` });
      }),
      group('theirs', 'theirs', r.idealOfIdeal || [], `你的理想型人选最常看中的人`, (m, i) => person(m, 'a', i, { fit: `${m.fullyMetIdeals}/${r.idealMatches.length}`, note: `完全符合其中 ${m.fullyMetIdeals} 位的要求` })),
    ],
  };
}

// 你的位置：多少位异性的要求你全都满足，最常没对上的是哪一条。只说事实，不给人打分
function positionCard(s, tab, r) {
  if (tab === 'theirs') {
    const a = r?.myPlaceA;
    if (!a) return '';
    const top = a.rankRange[1];
    const miss = a.topMisses?.length ? `<div class="pos-miss"><span>你最常差的：</span>${a.topMisses.map((m) => `<em>${esc(m.label)}<small>${m.count} 位</small></em>`).join('')}</div>` : '';
    return `<div class="pos-card">
      <div class="pos-main"><b class="pos-n">${a.fullyMet}</b><div><strong>位理想型人选的要求，你完全符合</strong><span>一共 ${a.ofIdeals} 位 · ${a.eligible ? `按他们的要求，你在 ${a.of} 位里排前 ${top} 位左右` : '按他们的要求，你暂时还没排进去'}</span></div></div>
      ${miss}
    </div>`;
  }
  const p = s.position?.[tab];
  if (!p?.of) return '';
  const them = THEM();
  const text = {
    ideal: [`位${them}完全符合你的要求`, '最常不符合你的：'],
    seekers: [`位${them}的要求，你完全符合`, '你最常没达到的：'],
    mutual: [`位${them}和你互相完全符合`, ''],
  }[tab];
  const miss = p.topMisses?.length ? `<div class="pos-miss"><span>${text[1]}</span>${p.topMisses.map((m) => tab === 'ideal'
    // 他适合你：点一下直接去改这条要求
    ? `<a class="miss-link" href="#/ideal/${esc(m.field)}" data-edit-req>${esc(m.label)}<small>${m.count} 位</small>${ic('edit')}</a>`
    : `<em>${esc(m.label)}<small>${m.count} 位</small></em>`).join('')}</div>${tab === 'ideal' ? '<p class="pos-tip">点一下可以改这条要求</p>' : ''}` : '';
  return `<div class="pos-card">
    <div class="pos-main"><b class="pos-n">${p.allMet}</b><div><strong>${text[0]}</strong><span>一共 ${p.of} 位${them}</span></div></div>
    ${miss}
  </div>`;
}

async function renderResults() {
  await saveChain;
  if (!S.me.gender) return go('#/me/gender');
  if (!S.me.requirements?.length) return go('#/ideal/age');
  if (!S.me.consent?.scoring) return go('#/consent');
  if (!S.results) await renderCalc();
  const r = await loadResults();
  if (S.tab === 'mutual') S.tab = 'ideal';
  const s = r.summary, plan = S.config.plans[r.plan];
  const payOn = (S.config.payments?.providers || []).length > 0; // 支付关闭时不出现 VIP 入口
  const few = s.counterpartCount === 0; // 真人模式刚上线，人还没有

  paint(`<section class="res-head">
      <h1 class="display rise">你喜欢的人，喜欢谁</h1>
      ${few ? '' : '<div class="relmap rise" id="relmap" style="--i:1"></div>'}
    </section>
    ${brokerNotice()}
    ${few ? `<div class="note-card">${ic('users')}<span>人还不多，过几天再来看看。<br></span></div>` : ''}
    <div class="tabs" role="tablist">${['ideal', 'theirs', 'seekers'].map((k) => `<button role="tab" data-tab="${k}" aria-selected="${S.tab === k}" class="g-${k} ${S.tab === k ? 'on' : ''}"><i class="tdot"></i>${REL[k]()}</button>`).join('')}</div>
    <div id="tabpanel"></div>
    ${r.plan === 'vip'
    ? `<div class="vip">${ic('crown')}<div class="t"><b>你是 VIP</b><span>每组可以看 ${S.config.plans.vip.matches} 位</span></div></div>`
    : payOn ? `<button class="vip-line" id="upgrade">${ic('crown')}<span>每组看 ${S.config.plans.vip.matches} 位</span><b>¥${(S.config.plans.vip.priceFen / 100).toFixed(2)}</b></button>` : ''}
    <div class="row-2"><a class="btn sm" href="#/ideal/review">${ic('edit')}改要求</a><a class="btn sm" href="#/me/review">${ic('user')}改资料</a></div>
    <p class="disclaimer">只比较条件，不代表一个人好不好。</p>`, { wide: true });

  const panel = document.getElementById('tabpanel');
  const show = (tab, scroll) => {
    S.tab = tab;
    view.querySelectorAll('.tabs [data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    panel.innerHTML = (r.summary.counterpartCount ? positionCard(r.summary, tab, r) : '') + tabList(r, tab); panel.dataset.g = tab;
    panel.querySelectorAll('[data-edit-req]').forEach((a) => (a.onclick = () => { S.backToReview = true; }));
    panel.querySelectorAll(".cell-tap").forEach((b) => (b.onclick = () => b.setAttribute("aria-expanded", b.getAttribute("aria-expanded") !== "true")));
    panel.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { S.view = b.dataset.view; store.set('vier.view', S.view); show(tab); }));
    bindAsk(panel, [...r.idealMatches, ...r.seekers, ...r.mutual]);
    if (scroll) view.querySelector('.tabs').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab, b.tagName.toLowerCase() === 'g')));
  show(S.tab);
  // 图上的三个圆和下面三个页签是同一件事：点哪边，另一边跟着走
  const map = few ? null : relMap(document.getElementById('relmap'), resultTree(r), { esc, onFocus: (n) => { if (n.tab && n.tab !== S.tab) show(n.tab); } });
  view.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => map?.show(b.dataset.tab)));
  const up = document.getElementById('upgrade');
  if (up) up.onclick = () => openPayment('vip');
}

// ---------- 人选详情：先讲“对方在找什么样的人”，分数和名次收起来 ----------
// 逐条对照：没对上的放前面、醒目；对上的收成一行，不抢眼
function checks(items, whoReq, whoVal) {
  const order = { 't-bad': 0, 't-warn': 1, 't-unk': 2, 't-good': 3 };
  const list = [...items].sort((a, b) => order[toneOf(a)] - order[toneOf(b)]);
  const good = list.filter((it) => toneOf(it) === 't-good'), rest = list.filter((it) => toneOf(it) !== 't-good');
  return `<div class="checks2">${rest.map((it) => {
    const [tone, icon, word] = STATUS[it.status] || ['t-unk', 'help', nice(it.status)];
    return `<div class="ck ${tone}"><div class="ck-top"><span class="st">${ic(icon)}</span><b>${esc(lab(it.label))}</b>${it.must ? '<span class="badge imp-4">必须有</span>' : ''}<span class="res">${word}</span></div>
      <div class="ck-kv"><span class="k">${whoReq}</span><span>${esc(nice(it.requirement))}</span><span class="k">${whoVal}</span><span class="val">${it.value === null ? '没填' : esc(nice(it.value))}</span></div></div>`;
  }).join('')}
  ${good.length ? `<div class="ck-good">${ic('check')}<span><b>都符合的 ${good.length} 条</b>${good.map((it) => esc(lab(it.label))).join('、')}</span></div>` : ''}</div>`;
}

function ring(label, t) {
  const v = Math.max(0, Math.min(100, t.low));
  return `<div class="ring-card"><div class="ring"><svg viewBox="0 0 110 110" aria-hidden="true"><circle class="bg" cx="55" cy="55" r="46"/><circle class="fg" cx="55" cy="55" r="46" data-v="${v}"/></svg><b class="${Math.round(t.low) === Math.round(t.high) ? '' : 'range'}">${fmt(t)}</b></div>
    <p>${label}</p></div>`;
}

// 三组都能进详情：#/match/序号 是“他适合你”，#/match/序号/seekers 或 /mutual 是另外两组
async function renderMatch(idx, tab = 'ideal') {
  const r = await loadResults();
  const list = { ideal: r.idealMatches, seekers: r.seekers, mutual: r.mutual }[tab] || r.idealMatches;
  const raw = list[idx];
  if (!raw) return go('#/results', 'back');
  const m = { theirPicks: [], theirIdeal: [], ...raw, myFitToThem: raw.mine || raw.myFitToThem };
  if (!m.fit || !m.myFitToThem?.items) return go('#/results', 'back');
  const t = T(), n = list.length, sfx = tab === 'ideal' ? '' : `/${tab}`;
  const top = m.myPlace ? m.myPlace.rankRange[1] : null;
  paint(`<div class="detail-nav">
      <button class="btn ghost sm" data-back="#/results">${ic('back')}返回</button>
      <div class="pager"><a href="#/match/${idx - 1}${sfx}" aria-label="上一位" aria-disabled="${idx === 0}">${ic('back')}</a><a href="#/match/${idx + 1}${sfx}" aria-label="下一位" aria-disabled="${idx >= n - 1}">${ic('next')}</a></div>
    </div>
    <section class="profile-top rise">
      
      <h1>${nameTag(m)}</h1>
      <p class="small muted" style="margin:2px 0 0">${esc([m.facts['年龄'], m.facts['常住城市']].filter(Boolean).join(' · '))} · 第 ${idx + 1} 位</p>
      <div class="facts">${Object.entries(m.facts).filter(([k]) => k !== '年龄' && k !== '常住城市').slice(0, 8).map(([, v]) => `<span>${esc(nice(v))}</span>`).join('')}</div>
    </section>
    <div class="summary-card rise" style="--i:1">
      ${fitLine('你', t, m.fit.items)}
      ${fitLine(t, '你', m.myFitToThem.items)}
    </div>
    ${brokerBox(m, { full: true })}

    <details class="more fold"><summary>${ic('user')}${t}的要求，你符合哪些</summary>${checks(m.myFitToThem.items, `${t}要`, '你是')}</details>
    <details class="more fold"><summary>${ic('heart')}你的要求，${t}符合哪些</summary>${checks(m.fit.items, '你要', `${t}是`)}</details>
    <details class="more fold"><summary>${ic('search')}${t}在找什么样的人</summary>
      ${m.theirIdeal.length ? idealCard(m.theirIdeal, { title: `${t}心中的${ME()}`, sub: '' }) : `<p class="muted">${t}没有写要求。</p>`}</details>

    <details class="more" id="more">
      <summary>${ic('info')}想看分数和更多比较？</summary>
      <p class="small muted">100 分 = 全部符合。</p>
      <div class="rings">${ring(`${t}符合你的要求`, m.fit.total)}${ring(`你符合${t}的要求`, m.myFitToThem.total)}</div>
      ${tab !== 'ideal' ? '' : `<p class="small" style="margin:14px 0 0">${top ? `按${t}的要求，在 ${m.myPlace.of} 位条件合适的人里，你在前 ${top} 位左右。` : `按${t}的要求，你还没排进去。`}</p>`}
      ${m.theirPicks.length ? `<h3 class="small" style="margin:18px 0 8px">按${t}的要求，最合适的几位</h3><div class="pick-list">${m.theirPicks.map((p, i) => `<details class="pick"><summary><span class="rk">${i + 1}</span><div><b>${nameTag(p)}</b><span>${esc([p.facts['年龄'], p.facts['常住城市']].filter(Boolean).join(' · '))}</span></div><em>${pctQ(p.score)}</em><span class="chev">${ic('next')}</span></summary>
        <div class="facts">${Object.entries(p.facts).filter(([k]) => k !== '年龄' && k !== '常住城市').map(([, v]) => `<span>${esc(nice(v))}</span>`).join('')}</div></details>`).join('')}</div>` : ''}
    </details>
    <div class="stack"><button class="btn block" data-back="#/results">${ic('back')}返回</button></div>`, { wide: true });
  bindBack();
  bindAsk(view, [m]);
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
      if (s.status === 'expired') { m.el.querySelector('#pay-hint').textContent = '二维码过期了，请重新选。'; return; }
      if (manual) toast('还没收到钱。已付款的话，稍等会自动升级。');
    } catch { /* 网络抖动时继续轮询 */ }
    timer = setTimeout(() => poll(orderNo), 2000);
  }

  m.el.querySelectorAll('[data-p]').forEach((a) => (a.onclick = () => start(a.dataset.p)));
  if (providers.length) start(providers[0].id);
}

// ---------- 手机号登录 ----------
// 没有密码：手机号 + 验证码。测试环境不发短信，验证码直接显示在页面上。
const loggedInNote = () => `<div class="note-card" style="margin:0">${ic('check')}<span>已登录 <b>${esc(S.me.phone)}</b></span></div>`;
const loginBlock = () => `<div class="login-box">
    <input class="text-input" id="lphone" inputmode="tel" maxlength="11" autocomplete="tel" placeholder="11 位手机号" aria-label="手机号">
    <div class="row" style="margin-top:10px;gap:10px"><input class="text-input" id="lcode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码" aria-label="验证码" style="margin:0;flex:1"><button type="button" class="btn sm" id="lsend">获取验证码</button></div>
    <p class="small muted" id="lhint" hidden></p>
    <button type="button" class="btn primary block" id="lgo" style="margin-top:12px">登录</button></div>`;
function bindLogin(root, onDone) {
  const $ = (id) => root.querySelector('#' + id);
  const hint = (t) => { $('lhint').innerHTML = t; $('lhint').hidden = !t; };
  let wait = 0, timer;
  $('lsend').onclick = async () => {
    if (wait) return;
    try {
      const r = await api('POST', '/api/auth/code', { phone: $('lphone').value.trim() });
      hint(r.devCode ? `测试环境不发短信，验证码是 <b>${esc(r.devCode)}</b>` : '验证码已发送，5 分钟内有效');
      if (r.devCode) $('lcode').value = r.devCode;
      wait = 60; $('lsend').disabled = true;
      timer = setInterval(() => { wait--; $('lsend').textContent = wait ? `${wait} 秒后重发` : '获取验证码'; if (!wait) { clearInterval(timer); $('lsend').disabled = false; } }, 1000);
      $('lcode').focus();
    } catch (e) { hint(`<span class="err">${esc(e.message)}</span>`); }
  };
  $('lgo').onclick = async () => {
    const b = $('lgo'); b.classList.add('loading');
    const verify = (keep) => api('POST', '/api/auth/verify', { phone: $('lphone').value.trim(), code: $('lcode').value.trim(), ...(keep ? { keep } : {}) });
    try {
      let r;
      try { r = await verify(); } catch (e) {
        if (!e.data?.choose) throw e;
        // 这个号码以前填过，这台手机上又刚填了一份：问一句留哪份，不悄悄丢掉
        const keep = await new Promise((done) => {
          const m = sheet(`<h2>这个号码以前填过资料</h2><p class="lead">留哪一份？另一份会被删掉。</p>
            <div class="stack"><button class="btn primary block" data-k="this">用刚才填的</button><button class="btn block" data-k="saved">用以前的</button></div>`);
          m.el.querySelectorAll('[data-k]').forEach((x) => (x.onclick = () => { m.close(); done(x.dataset.k); }));
        });
        r = await verify(keep);
      }
      if (r.token) store.set('vier.token', r.token);
      S.me = await api('GET', '/api/me');
      if (r.switched) { S.results = null; toast('已找回你之前的资料'); } else toast('已登录');
      clearInterval(timer);
      onDone(r);
    } catch (e) { b.classList.remove('loading'); hint(`<span class="err">${esc(e.message)}</span>`); }
  };
}

function renderLogin() {
  const back = S.prev && !/login/.test(S.prev) ? S.prev : '#/privacy';
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${back}">${ic('back')}返回</button></div>
    <h1 class="q">用手机号登录</h1>
    <p class="qhint">${ic('lock')}换手机也能找回资料。不用密码，用验证码。</p>
    ${S.me.phone ? loggedInNote() + `<div class="stack" style="margin-top:14px"><button class="btn block" id="logout">退出登录</button></div>` : `<div id="lbox">${loginBlock()}</div>`}`);
  bindBack();
  if (!S.me.phone) bindLogin(document.getElementById('lbox'), () => go(back, 'back'));
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = () => { store.del('vier.token'); Object.assign(S, { me: null, results: null, pDraft: null, iDraft: null }); go('#/', 'back'); };
}

// ---------- 牵线（docs/CONTACT-BROKER.md）----------
// 甲看中乙 → 乙看到甲的极简信息并自己决定 → 乙同意后，甲的联系方式发给乙一次。
const CONTACT_TYPES = { phone: '手机号', wechat: '微信号' };
const BROKER_TAG = {
  open: null, // 能联系是默认，不再每张卡都标
  demo: ['', '虚拟人选，不能联系'],
  ineligible: ['', '“必须有”没对上，不能联系'],
  closed: ['', '该用户暂未开放牵线'],
  pending: ['gold', '已发出牵线请求'],
  accepted: ['l3', '已牵线'],
  cooldown: ['', '暂时不能再次发起'],
};
const brokerTag = (c) => {
  const t = BROKER_TAG[c.broker?.state];
  if (c.broker?.state === 'cooldown') return `<span class="badge broker-tag">${waitText(c.broker.until)}后可以再联系</span>`;
  return t ? `<span class="badge ${t[0]} broker-tag">${t[1]}</span>` : '';
};

const waitText = (until) => {
  const ms = new Date(until) - Date.now();
  if (!(ms > 0)) return '稍等一会儿';
  const h = Math.ceil(ms / 3600e3);
  return h < 24 ? `约 ${h} 小时` : `约 ${Math.ceil(h / 24)} 天`;
};

// 人选卡片下方的牵线入口；详情页用 full 版，带说明
function brokerBox(c, { full = false } = {}) {
  const t = T(), st = c.broker?.state;
  if (!st) return '';
  const line = {
    demo: `这是虚拟人选，不能牵线。`,
    closed: `该用户暂未开放牵线。`,
    ineligible: `有“必须有”没对上，不能牵线。`,
    pending: `已发出牵线请求，等${t}回应。${t}同意前你可以在“牵线”里取消。`,
    accepted: `${t}已同意，你的联系方式已发给${t}。留意来电或好友申请。`,
    cooldown: `${waitText(c.broker.until)}后可以再联系${t}。`,
    open: full ? `${t}同意后，我们把你的联系方式发给${t}一次。${t}的联系方式不会给你。` : '',
  }[st];
  const btn = st === 'open'
    ? `<button class="btn primary sm" data-ask="${esc(c.alias)}">${ic('heart')}想联系${t}</button>`
    : st === 'pending' || st === 'accepted' ? `<a class="btn sm" href="#/broker">去“牵线”看看</a>` : '';
  if (!full && !btn) return '';
  return `<div class="broker-box ${full ? 'full' : ''}">${full ? `<b>${ic('heart')}牵线</b>` : ''}${line ? `<p>${line}</p>` : ''}${btn}</div>`;
}

function bindAsk(root, list) {
  root.querySelectorAll('[data-ask]').forEach((b) => (b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const c = list.find((x) => x.alias === b.dataset.ask);
    if (c) openAsk(c);
  }));
}

function contactFields(cur) {
  const type = cur?.type || 'phone';
  return `<div class="chips" role="radiogroup" aria-label="联系方式">${Object.entries(CONTACT_TYPES).map(([v, l]) => `<button type="button" class="chip ${type === v ? 'on' : ''}" data-ctype="${v}" role="radio" aria-checked="${type === v}">${ic('check')}${l}</button>`).join('')}</div>
    <input class="text-input" id="cvalue" autocomplete="off" maxlength="20" inputmode="${type === 'phone' ? 'tel' : 'text'}" placeholder="${type === 'phone' ? '11 位手机号' : '微信号'}" value="${esc(cur?.value || '')}" aria-label="联系方式">`;
}
function bindContactFields(root) {
  let type = root.querySelector('.chip.on[data-ctype]')?.dataset.ctype || 'phone';
  const input = root.querySelector('#cvalue');
  root.querySelectorAll('[data-ctype]').forEach((b) => (b.onclick = () => {
    type = b.dataset.ctype;
    root.querySelectorAll('[data-ctype]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    input.inputMode = type === 'phone' ? 'tel' : 'text';
    input.placeholder = type === 'phone' ? '11 位手机号' : '微信号';
    input.focus();
  }));
  return () => ({ type, value: input.value.trim() });
}

// 甲：想联系 → 留联系方式（第一次）→ 看清楚会发什么 → 勾选同意 → 发送
async function openAsk(c) {
  const t = T();
  let ov;
  try { ov = await api('GET', '/api/me/broker'); } catch (e) { return toast(e.message); }
  if (!ov.loggedIn) {
    const lm = sheet(`<h2>先用手机号登录</h2><p class="lead">${t}可能过几天才回复。登录后，换手机也能看到。</p><div id="lbox">${loginBlock()}</div>`);
    bindLogin(lm.el, () => { lm.close(); openAsk(c); });
    return;
  }
  const has = !!ov.contact;
  const m = sheet(`<h2>想认识${t}？</h2>
    <ul class="perks broker-rules">
      <li>${ic('check')}${t}只看到你的年龄段、城市、职业，和你们合得上几条。</li>
      <li>${ic('check')}${t}点了同意，我们才把你的联系方式发给${t}一次，由${t}联系你。${t}的联系方式不会给你。</li>
      <li>${ic('check')}${t}同意前，你可以取消。</li>
      <li>${ic('check')}${t}不同意，你只会看到“暂未同意”。</li>
    </ul>
    <h3 class="small" style="margin:16px 0 8px">发给${t}的联系方式</h3>
    ${has ? `<p class="mine">${CONTACT_TYPES[ov.contact.type]}：<b>${esc(ov.contact.value)}</b> <a href="#/broker" class="small">改一下</a></p>
      <p class="small muted" style="margin:4px 0 0">只留你愿意被联系的号码。</p>`
    : `${contactFields()}<p class="small muted" style="margin:6px 0 0">只在${t}同意后发给${t}一次。只留你愿意被联系的号码。</p>`}
    <label class="agree"><input type="checkbox" id="agree"> <span>我同意：${t}同意后，把我的联系方式发给${t}</span></label>
    <p class="err" id="ask-err" hidden></p>
    <div class="stack"><button class="btn primary block" id="send" disabled>${ic('heart')}发送请求</button><button class="btn block" id="later">先不了</button></div>`);
  const get = has ? null : bindContactFields(m.el);
  const send = m.el.querySelector('#send'), err = m.el.querySelector('#ask-err');
  m.el.querySelector('#agree').onchange = (e) => { send.disabled = !e.target.checked; };
  m.el.querySelector('#later').onclick = m.close;
  send.onclick = async () => {
    send.classList.add('loading'); send.disabled = true; err.hidden = true;
    try {
      if (!has) await api('PUT', '/api/me/broker/contact', get());
      await api('POST', '/api/me/broker/requests', { alias: c.alias, consent: true });
      m.close();
      toast(`已发出，等${t}回应`);
      if (S.results) await loadResults(true); // 静默刷新卡片状态，不重播计算动画
      dir = 'none'; route();
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      send.classList.remove('loading'); send.disabled = false;
    }
  };
}

const brokerCountText = () => {
  const b = S.me?.broker || {};
  return [b.incomingPending ? `${b.incomingPending} 个请求等你回复` : '', b.contactsToRead ? `${b.contactsToRead} 个号码等你记下` : ''].filter(Boolean).join('，');
};
const brokerNotice = () => (brokerCountText() ? `<a class="note-card broker-notice" href="#/broker">${ic('heart')}<span><b>有人想认识你</b><br>${brokerCountText()}。</span>${ic('next')}</a>` : '');

const OUT_TEXT = {
  pending: ['gold', '等待对方回应'],
  accepted: ['l3', '对方已同意，你的联系方式已发给对方'],
  not_agreed: ['', '对方暂未同意'],
  cancelled: ['', '已取消'],
};

function minimalText(mi) {
  const t = T();
  const who = [mi.gender, mi.ageBand, mi.city, mi.occupation].filter(Boolean).map(esc).join(' · ');
  return `<p class="who">${who || '对方没有填写基本信息'}</p>
    <p class="small muted" style="margin:4px 0 0">${t}符合你 ${mi.theyFitYou.met}/${mi.theyFitYou.of} 条要求；你符合${t} ${mi.youFitThem.met}/${mi.youFitThem.of} 条要求</p>`;
}

function incomingCard(r, i) {
  const t = T();
  if (r.status === 'pending') {
    return `<div class="pcard broker-req" style="--i:${i}"><div class="pcard-head"><div class="pcard-name"><b>${nameTag(r)}</b><span>想认识你</span></div></div>
      ${minimalText(r.minimal)}
      <div class="row wrap" style="margin-top:12px"><button class="btn primary sm" data-acc="${r.id}">${ic('check')}同意</button><button class="btn sm" data-dec="${r.id}">暂不同意</button><button class="btn ghost sm" data-blk="${r.id}">屏蔽</button></div>
      <p class="small muted" style="margin:8px 0 0">同意后，你会拿到${t}的号码。不同意，${t}不会知道原因。</p></div>`;
  }
  return `<div class="pcard broker-req" style="--i:${i}"><div class="pcard-head"><div class="pcard-name"><b>${nameTag(r)}</b><span>你已同意</span></div></div>
    ${minimalText(r.minimal)}
    ${r.contact ? `<div class="released"><span>${CONTACT_TYPES[r.contact.type]}</span><b>${esc(r.contact.value)}</b></div>
      <p class="small muted" style="margin:6px 0 0">先记下来。点“我已记下”后，号码会被删掉。</p>
      <div class="row wrap" style="margin-top:10px"><button class="btn primary sm" data-seen="${r.id}">${ic('check')}我已记下</button><button class="btn ghost sm" data-blk="${r.id}">屏蔽</button></div>`
    : `<p class="small muted" style="margin:8px 0 0">号码已经隐藏。</p><div class="row" style="margin-top:8px"><button class="btn ghost sm" data-blk="${r.id}">屏蔽</button></div>`}</div>`;
}

function outgoingRow(r) {
  const [tone, word] = r.blocked ? ['', '已屏蔽'] : OUT_TEXT[r.status] || ['', r.status];
  const act = r.status === 'pending' ? `<button class="btn ghost sm" data-cancel="${r.id}">取消</button>`
    : r.status === 'accepted' && !r.blocked ? `<button class="btn ghost sm" data-blk="${r.id}">屏蔽</button>` : '';
  return `<div class="out-row"><div class="t"><b>${nameTag(r)}</b><span class="badge ${tone}">${word}</span></div>${act}</div>`;
}

async function renderBroker() {
  const ov = await api('GET', '/api/me/broker');
  const t = T();
  if (!ov.loggedIn) {
    const back = S.me.consent?.scoring ? '#/results' : '#/privacy';
    paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${back}">${ic('back')}返回</button></div>
      <h1 class="q">牵线</h1><p class="qhint">${ic('lock')}先用手机号登录，换手机也能看到回复。</p><div id="lbox">${loginBlock()}</div>`);
    bindBack();
    bindLogin(document.getElementById('lbox'), () => { dir = 'none'; renderBroker(); });
    return;
  }
  const back = /^#\/(match|results)/.test(S.prev || '') ? S.prev : S.me.consent?.scoring ? '#/results' : '#/privacy';
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${back}">${ic('back')}返回</button></div>
    <h1 class="q">牵线</h1>
    <p class="qhint">${ic('lock')}你的号码加密保存，别人看不到。</p>

    ${ov.incoming.length ? `<h2 class="sec-title">${ic('heart')}收到的请求</h2><div class="cards">${ov.incoming.map(incomingCard).join('')}</div>` : ''}

    <h2 class="sec-title">${ic('users')}被别人联系</h2>
    <form id="wf">${toggleCard('willing', '愿意被牵线', `打开后，有人想认识你会来问你。你同意了才互相联系。`, ov.willing)}</form>
    ${ov.inPool ? '' : `<p class="small muted" style="margin:8px 4px 0">先在“我的资料”里打开“让别人也能找到我”。</p>`}

    <h2 class="sec-title">${ic('user')}我的联系方式</h2>
    ${ov.contact ? `<div class="contact-line"><span class="muted">${CONTACT_TYPES[ov.contact.type]}</span><b>${esc(ov.contact.value)}</b><button class="btn ghost sm" id="cedit">修改</button><button class="btn ghost sm" id="cdel">${ic('trash')}删除</button></div>` : ''}
    <p class="small muted" style="margin:6px 0 10px">${ov.contact ? '默认用登录手机号，也可以改成微信号。' : '还没有联系方式。'}对方同意后才发给对方一次。</p>
    <div id="cbox" ${ov.contact ? 'hidden' : ''}>${contactFields(ov.contact)}
      <div class="row wrap" style="margin-top:12px"><button class="btn primary sm" id="csave">${ic('check')}保存</button></div></div>

    ${ov.outgoing.length ? `<h2 class="sec-title">${ic('arrow')}我发出的</h2><div class="list-card out-list">${ov.outgoing.map(outgoingRow).join('')}</div>
      <p class="small muted" style="margin:8px 4px 0">7 天没回复，也算“暂未同意”。</p>` : ''}`, { wide: true });
  bindBack();
  const redraw = async (msg) => { if (msg) toast(msg); S.me = await api('GET', '/api/me'); if (S.results) await loadResults(true); dir = 'none'; return renderBroker(); };
  const act = (fn, msg) => async (e) => { const b = e.currentTarget; b.classList.add('loading'); b.disabled = true; try { await fn(b); await redraw(msg); } catch (err) { toast(err.message); b.classList.remove('loading'); b.disabled = false; } };
  const confirmSheet = (title, text, yes, fn, msg, danger) => {
    const m = sheet(`<h2>${title}</h2><p class="lead">${text}</p><div class="stack"><button class="btn ${danger ? 'danger' : 'primary'} block" id="yes">${yes}</button><button class="btn block" id="no">再想想</button></div>`);
    m.el.querySelector('#no').onclick = m.close;
    m.el.querySelector('#yes').onclick = act(async () => { await fn(); m.close(); }, msg);
  };

  document.getElementById('wf').addEventListener('change', async (e) => {
    try { await api('PUT', '/api/me/broker/willing', { willing: e.target.checked }); toast(e.target.checked ? '已打开，有人发来请求时会出现在这里' : '已关闭'); }
    catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
  });
  const get = bindContactFields(document.getElementById('cbox'));
  document.getElementById('csave').onclick = act(() => api('PUT', '/api/me/broker/contact', get()), '已保存');
  const edit = document.getElementById('cedit');
  if (edit) edit.onclick = () => { document.getElementById('cbox').hidden = false; edit.hidden = true; };
  const del = document.getElementById('cdel');
  if (del) del.onclick = () => confirmSheet('删除联系方式？', '删掉后，别人联系不到你。已经发出去的号码收不回来。', `${ic('trash')}确定删除`, () => api('DELETE', '/api/me/broker/contact'), '已删除', true);

  const q = (sel, fn) => view.querySelectorAll(sel).forEach((b) => (b.onclick = fn(b)));
  q('[data-acc]', (b) => () => confirmSheet('确定同意吗？', `同意后，你会拿到${t}的号码。不能反悔。`, `${ic('check')}确定同意`, () => api('POST', `/api/me/broker/requests/${b.dataset.acc}/accept`, { confirm: true }), '已同意，号码在下面'));
  q('[data-dec]', (b) => act(() => api('POST', `/api/me/broker/requests/${b.dataset.dec}/decline`), `已回复，${t}只会看到“对方暂未同意”`));
  q('[data-seen]', (b) => act(() => api('POST', `/api/me/broker/requests/${b.dataset.seen}/seen`), '号码已从服务器删除'));
  q('[data-cancel]', (b) => act(() => api('POST', `/api/me/broker/requests/${b.dataset.cancel}/cancel`), '已取消'));
  q('[data-blk]', (b) => () => confirmSheet(`屏蔽${t}？`, `${t}以后联系不到你，也不会知道被屏蔽。`, '确定屏蔽', () => api('POST', `/api/me/broker/requests/${b.dataset.blk}/block`), '已屏蔽', true));
}


// ---------- 管理后台：用户、号码（打码，查看要写理由）、牵线记录 ----------
async function adminApi(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-admin-token': store.get('vier.admin') || '' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '出错了'), { status: res.status });
  return data;
}
const who = (p) => p ? `${p.virtual ? '<span class="badge sim">虚拟</span> ' : ''}${esc([p.gender, p.age && `${p.age} 岁`, p.city, p.occupation].filter(Boolean).join(' · ') || '资料未填')}` : '<span class="muted">已删除</span>';
const ADMIN_STATUS = { pending: ['gold', '等待回应'], accepted: ['l3', '已同意'], declined: ['', '已拒绝'], cancelled: ['', '已取消'], expired: ['', '已过期'], withdrawn: ['', '已作废'] };
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const ctext = (c) => (c ? `${CONTACT_TYPES[c.type]} ${esc(c.value)}` : '');

function adminUserRow(u, testMode) {
  const tags = [
    u.suspended ? '<span class="badge must">已暂停</span>' : '',
    u.pool ? '<span class="badge">在人选池</span>' : '',
    u.willing ? '<span class="badge l3">愿意被牵线</span>' : '',
    u.plan === 'vip' ? '<span class="badge gold">VIP</span>' : '',
    u.filled ? '' : '<span class="badge">资料未填完</span>',
  ].join('');
  const phones = [u.loginPhone && `登录 ${esc(u.loginPhone)}`, u.contact && `联系 ${ctext(u.contact)}`].filter(Boolean).join(' · ');
  return `<div class="pcard admin-user" data-uid="${esc(u.id)}">
    <div class="row wrap" style="justify-content:space-between"><b>${who(u)}</b><span class="small muted">活跃 ${fmtTime(u.lastActiveAt)}</span></div>
    <div class="row wrap" style="margin-top:8px;gap:6px">${tags}</div>
    <p class="small" style="margin:8px 0 0">${phones || '<span class="muted">没留号码</span>'} <span class="reveal-out"></span></p>
    <p class="small muted" style="margin:4px 0 0">发出 ${u.sent} · 收到 ${u.received} · 被屏蔽 ${u.blockedBy} · <span class="mono">${esc(u.id)}</span></p>
    <div class="row wrap" style="margin-top:10px">
      ${u.loginPhone || u.contact ? `<button class="btn sm" data-act="reveal">查看号码</button>` : ''}
      <button class="btn sm" data-act="${u.suspended ? 'unsuspend' : 'suspend'}">${u.suspended ? '恢复' : '暂停'}</button>
      <button class="btn ghost sm" data-act="delete">删除</button>
      ${testMode && u.willing ? `<button class="btn ghost sm" data-act="vreq">让虚拟人发起</button>` : ''}
    </div></div>`;
}

async function renderAdmin() {
  let data;
  try { data = await adminApi('GET', '/api/admin/overview'); } catch (e) {
    paint(`<h1 class="q">管理后台</h1><p class="qhint">${ic('lock')}输入管理员口令（服务器的环境变量 ADMIN_TOKEN；测试环境没设时是 admin）</p>
      <input class="text-input" id="tok" type="password" autocomplete="off"><div class="stack" style="margin-top:12px"><button class="btn primary block" id="go">进入</button></div>${e.status === 401 && store.get('vier.admin') ? '<p class="err">口令不对</p>' : `<p class="err">${e.status === 401 ? '' : esc(e.message)}</p>`}`);
    document.getElementById('go').onclick = () => { store.set('vier.admin', document.getElementById('tok').value.trim()); dir = 'none'; renderAdmin(); };
    return;
  }
  const tab = S.adminTab || 'users';
  const q = (S.adminQ || '').trim();
  const users = data.users.filter((u) => !q || [u.id, u.city, u.loginPhone, u.contact?.value, u.occupation].join(' ').includes(q));
  const counts = { users: data.users.length, contact: data.users.filter((u) => u.contact).length, willing: data.users.filter((u) => u.willing).length, pending: data.requests.filter((r) => r.status === 'pending').length };
  paint(`<div class="row" style="justify-content:space-between"><h1 class="q" style="margin:0">管理后台</h1><button class="btn ghost sm" id="out">退出</button></div>
    ${data.testMode ? `<p class="qhint">${ic('info')}测试环境：用户界面不标虚拟人选，这里可以替虚拟人回应。</p>` : ''}
    <div class="admin-stats"><div><b>${counts.users}</b><span>用户</span></div><div><b>${counts.contact}</b><span>留了号码</span></div><div><b>${counts.willing}</b><span>愿意被牵线</span></div><div><b>${counts.pending}</b><span>等待回应</span></div></div>
    <div class="tabs" role="tablist" style="margin-top:16px">${[['users', '用户'], ['contact', '带号码的'], ['requests', '牵线记录']].map(([k, l]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
    ${tab === 'requests' ? (data.requests.length ? `<div class="cards">${data.requests.map((r) => { const [tone, word] = ADMIN_STATUS[r.status] || ['', r.status]; return `<div class="pcard">
        <div class="row wrap" style="justify-content:space-between"><span class="badge ${tone}">${word}</span><span class="small muted">${fmtTime(r.createdAt)}</span></div>
        <p class="small" style="margin:8px 0 0">发起：${who(r.from)}</p><p class="small" style="margin:4px 0 0">接收：${who(r.to)}</p>
        ${data.testMode && r.status === 'pending' && r.to?.virtual ? `<div class="row wrap" style="margin-top:10px"><button class="btn primary sm" data-a="${r.id}/accept">替虚拟人同意</button><button class="btn sm" data-a="${r.id}/decline">替虚拟人拒绝</button></div>` : ''}</div>`; }).join('')}</div>` : '<p class="muted">还没有牵线记录。</p>')
    : `<input class="text-input" id="aq" type="search" placeholder="按城市、职业、号码后四位、用户 id 搜索" value="${esc(q)}">
      <div class="cards" style="margin-top:12px">${users.filter((u) => tab !== 'contact' || u.contact).map((u) => adminUserRow(u, data.testMode)).join('') || '<p class="muted">没有符合的用户。</p>'}</div>`}`, { wide: true });

  const again = () => { dir = 'none'; renderAdmin(); };
  document.getElementById('out').onclick = () => { store.del('vier.admin'); again(); };
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { S.adminTab = b.dataset.tab; again(); }));
  const aq = document.getElementById('aq');
  if (aq) aq.onchange = () => { S.adminQ = aq.value; again(); };
  const ask = (title, text, label, danger, fn) => {
    const m = sheet(`<h2>${title}</h2><p class="lead">${text}</p><input class="text-input" id="why" placeholder="理由（会记入审计日志）"><p class="err" id="whyerr" hidden></p>
      <div class="stack" style="margin-top:12px"><button class="btn ${danger ? 'danger' : 'primary'} block" id="yes">${label}</button><button class="btn block" id="no">取消</button></div>`);
    m.el.querySelector('#no').onclick = m.close;
    m.el.querySelector('#yes').onclick = async (ev) => {
      const b = ev.currentTarget; b.classList.add('loading');
      try { await fn(m.el.querySelector('#why').value.trim()); m.close(); } catch (e) { b.classList.remove('loading'); const er = m.el.querySelector('#whyerr'); er.textContent = e.message; er.hidden = false; }
    };
  };
  view.querySelectorAll('.admin-user [data-act]').forEach((b) => (b.onclick = () => {
    const card = b.closest('.admin-user'), id = card.dataset.uid, act = b.dataset.act;
    if (act === 'reveal') return ask('查看完整号码', '每次查看都会记录：谁、什么时候、为什么。', '查看', false, async (reason) => {
      const r = await adminApi('POST', `/api/admin/users/${id}/reveal`, { reason });
      card.querySelector('.reveal-out').innerHTML = `<br><b>${[r.loginPhone && `登录 ${esc(r.loginPhone)}`, r.contact && `联系 ${ctext(r.contact)}`].filter(Boolean).join(' · ')}</b>`;
    });
    if (act === 'suspend') return ask('暂停这个用户？', '暂停后不出现在任何人的结果里，不能发起或接收牵线，等待中的请求作废。可以随时恢复。', '暂停', true, async (reason) => { await adminApi('POST', `/api/admin/users/${id}/suspend`, { reason }); toast('已暂停'); again(); });
    if (act === 'unsuspend') return adminApi('POST', `/api/admin/users/${id}/unsuspend`, {}).then(() => { toast('已恢复'); again(); }).catch((e) => toast(e.message));
    if (act === 'delete') return ask('永久删除这个用户？', '资料、要求、号码、牵线记录全部删除，不能恢复。', '永久删除', true, async (reason) => { await adminApi('DELETE', `/api/admin/users/${id}`, { reason }); toast('已删除'); again(); });
    if (act === 'vreq') return adminApi('POST', '/api/admin/broker/virtual-request', { to: id }).then(() => { toast('已让一位虚拟人发起，去这个用户的“牵线”页看看'); again(); }).catch((e) => toast(e.message));
  }));
  view.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => adminApi('POST', `/api/admin/broker/requests/${b.dataset.a}`).then(() => { toast('已处理'); again(); }).catch((e) => toast(e.message))));
}

// ---------- 我的资料 ----------
function toggleCard(name, title, text, checked, { required = false, i = 0 } = {}) {
  return `<label class="toggle-card" style="--i:${i}">
    <div class="t"><b>${title}${required ? '<span class="req-pill">必须</span>' : ''}</b><span>${text}</span></div>
    <span class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} role="switch"><i></i></span>
  </label>`;
}

// ---------- 用户协议 / 隐私政策 ----------
// 大白话写，短句。上线前请懂《个人信息保护法》的人再看一遍（docs/PRIVACY.md）
const LEGAL = {
  terms: ['用户协议', [
    ['这是什么', 'VIER 帮你看清：你想找的人是谁、谁在找你这样的人。结果只比较条件，不代表一个人好不好，也不保证能成。'],
    ['谁能用', '只给年满 18 岁的人用。目前只为男生和女生之间做推荐。'],
    ['请如实填写', '填假资料会让别人的结果不准。冒充别人、骚扰别人的账户会被暂停或删除。'],
    ['牵线', '对方同意后，我们才把你的联系方式发给对方一次。见面和来往请注意安全，不要转账给没见过面的人。'],
    ['付费', 'VIP 只是多看几位人选。付款前会写清楚价格。'],
    ['不能做的事', '不能批量抓取页面、反复改要求来“扫”别人，不能把看到的信息拿去别处用。'],
    ['改动', '协议改了会在这里更新，重要的改动会提醒你。'],
  ]],
  policy: ['隐私政策', [
    ['我们收什么', '你填的资料和要求；登录用的手机号；你同意了哪些事、什么时候同意的。不收照片和身份证。'],
    ['为什么收', '只为了帮你找人、帮别人找到你（你同意后），以及你同意的匿名统计。'],
    ['敏感信息', '收入、家里的情况属于敏感信息。别人只能看到大概的档位或“是否符合”，看不到原值。'],
    ['怎么存', '全部加密存在中国境内的服务器上。手机号和资料分开存放。'],
    ['谁能看到', '别人只看到你的代号，每个人看到的代号都不一样。没有你同意，不会把联系方式给任何人。不卖给任何第三方。'],
    ['存多久', '一年没用就自动删除。你也可以随时在“我的资料”里下载或永久删除。'],
    ['你的权利', '随时查看、修改、下载、删除你的资料，随时关掉“让别人也能找到我”。'],
    ['未成年人', '不满 18 岁请不要使用。发现后会删除相关资料。'],
  ]],
};
function renderLegal(k) {
  const [title, items] = LEGAL[k];
  const back = S.prev && !/terms|policy/.test(S.prev) ? S.prev : '#/';
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${back}">${ic('back')}返回</button></div>
    <h1 class="q">${title}</h1>
    <div class="legal">${items.map(([h, p]) => `<h2>${h}</h2><p>${p}</p>`).join('')}</div>`);
  bindBack();
}

// 页脚：协议、隐私政策、备案号（备案号在 config 的 site.icp 里填，空着就不显示）
function renderFoot() {
  const f = document.getElementById('foot');
  if (!f || !S.config) return;
  const icp = S.config.site?.icp;
  f.innerHTML = `<a href="#/terms">用户协议</a><a href="#/policy">隐私政策</a>${icp ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">${esc(icp)}</a>` : ''}`;
}

function renderPrivacy() {
  const c = S.me.consent || {};
  const st = S.me.gender ? (S.me.requirements?.length && c.scoring ? 'done' : 'partial') : 'new';
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${st === 'done' ? '#/results' : '#/'}">${ic('back')}返回</button></div>
    <h1 class="q">我的资料</h1>
    <p class="qhint">${ic('lock')}你的资料加密保存。</p>
    ${st !== 'done' ? `<a class="btn primary block" href="${resumeHash()}" style="margin-bottom:8px">${st === 'new' ? '开始填写' : '继续填写'} ${ic('arrow')}</a>` : ''}
    <div class="list-card">
      <a href="#/me/review"><span class="ico">${ic('user')}</span><span class="t">我填的资料<span>年龄、学历、家庭等，点进去可以改</span></span>${ic('next')}</a>
      <a href="${S.me.requirements?.length ? '#/ideal/review' : '#/ideal/age'}"><span class="ico">${ic('heart')}</span><span class="t">我的要求<span>${S.me.requirements?.length || 0} 条</span></span>${ic('next')}</a>
      <a href="#/login"><span class="ico">${ic('lock')}</span><span class="t">账号<span>${S.me.phone ? `已登录 ${esc(S.me.phone)}` : '用手机号登录，换手机也能找回'}</span></span>${ic('next')}</a>
      <a href="#/broker"><span class="ico">${ic('users')}</span><span class="t">牵线<span>${brokerCountText() || '联系方式、愿意被牵线、收到和发出的请求'}</span></span>${ic('next')}</a>
    </div>
    <h2 class="sec-title">${ic('shield')}你的资料怎么用</h2>
    <form id="f">
      ${toggleCard('scoring', '用我的资料帮我找人', '关掉后就看不到结果了。', !!c.scoring, { required: true, i: 0 })}
      ${toggleCard('pool', '让别人也能找到我', '别人只看到你的代号，看不到收入和家里情况。', !!c.pool, { i: 1 })}
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
    } catch (e) { toast(e.message); if (/18/.test(e.message)) go('#/consent'); }
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
  S.prev = S.cur; S.cur = location.hash; // 记住从哪一页来，确认页的返回键要用
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a = '', b = ''] = h.split('/');
  try {
    if (!S.config) {
      S.config = await api('GET', '/api/config');
      S.F = Object.fromEntries(S.config.fields.map((f) => [f.key, f]));
      renderFoot();
    }
    if (a === '') return await renderHome();
    if (a === 'intro') return renderIntro();
    if (a === 'admin') return await renderAdmin();
    if (a === 'terms' || a === 'policy') return renderLegal(a);
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
    if (a === 'match') return await renderMatch(Number(b), h.split('/')[3] || 'ideal');
    if (a === 'privacy') return renderPrivacy();
    if (a === 'broker') return await renderBroker();
    if (a === 'login') return renderLogin();
    return await renderHome();
  } catch (e) {
    paint(`<section class="milestone"><h1 class="display">出了点小问题</h1><p class="lead">${esc(e.message)}</p>
      <div class="stack"><button class="btn primary block" id="retry">再试一次</button><a class="btn block" href="#/">回到首页</a></div></section>`);
    document.getElementById('retry').onclick = () => route();
  } finally {
    if (dir !== 'none') window.scrollTo(0, 0);
    dir = 'fwd';
    requestAnimationFrame(placeToast);
  }
}
// 选项很多（如 100 个城市）时，列表上方有搜索框，按名字筛选
document.addEventListener('input', (e) => {
  if (!e.target.classList?.contains('opt-filter')) return;
  const q = e.target.value.trim();
  // 没输入时：只显示常见城市和已选的；输入后：显示所有名字里带这几个字的
  e.target.nextElementSibling?.querySelectorAll('[data-v]').forEach((b) => {
    b.hidden = q ? !b.textContent.includes(q) : b.hasAttribute('data-more') && !b.classList.contains('on');
  });
});
window.addEventListener('hashchange', route);
route();

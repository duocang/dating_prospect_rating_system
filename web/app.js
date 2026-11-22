// VIER 前端：一屏一问的引导式流程。hash 路由；所有打分在服务端完成。
// 设计原则：每一步都自动保存、随时能退回来；全站只用一套说法；用“他 / 她”代替“TA”。
const view = document.getElementById('view');
const S = { view: 'cards', config: null, F: null, me: null, results: null, pDraft: null, iDraft: null, backToReview: false, backToMeReview: false, tab: 'ideal', saved: '' };
let dir = 'fwd';
// 每次换页编一个号；异步等数据的页面回来时号码已经不是最新，说明用户已经去了别处，就不再画（不把人拉回去）
let routeGen = 0;
import { relMap, EXAMPLE, planetOf } from './relmap.js';

// ---------- 基础工具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 单选：选中这一个，同组其余取消（样式和读屏状态一起改）
const selectOne = (nodes, on) => nodes.forEach((x) => { x.classList.toggle('on', x === on); x.setAttribute('aria-checked', x === on); });
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式下忽略 */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};
S.view = store.get('vier.view') === 'table' ? 'table' : 'cards';
S.diffOnly = store.get('vier.diff') !== '0'; // 对照表默认只看不一样的那几行 // 结果页“一个个看 / 对照着看”的偏好
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

// 没过验证码之前，答案只存在这台设备上（vier.draft），服务器上不留任何记录；过了验证才建账户（docs/AUTH.md）
const DRAFT_KEYS = ['gender', 'profile', 'requirements', 'consent', 'identity'];
function loadDraft() {
  let d = {};
  try { d = JSON.parse(store.get('vier.draft') || '{}') || {}; } catch { /* 坏了就当没填过 */ }
  return { gender: d.gender || null, profile: d.profile || null, requirements: d.requirements || null, consent: d.consent || null, identity: d.identity || {}, hasRecovery: false, local: true };
}
function saveDraft() {
  if (!S.me?.local) return;
  store.set('vier.draft', JSON.stringify(Object.fromEntries(DRAFT_KEYS.map((k) => [k, S.me[k]]))));
}
async function ensureSession() {
  if (store.get('vier.token')) {
    try { S.me = await api('GET', '/api/me'); return; } catch (e) { if (e.status !== 401) throw e; store.del('vier.token'); }
  }
  S.me = loadDraft();
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
const P1 = ['gender', 'age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'maritalStatus', 'childrenStatus', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle', 'looksCare'];
const P2 = ['incomeAnnual', 'housing', 'car', 'debt', 'personalNetAssets', 'familyNetAssets', 'familySupport', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage'];
const I1 = ['age', 'heightCm', 'city', 'settlement', 'education', 'occupation', 'incomeAnnual', 'maritalStatus', 'childrenStatus', 'marriagePlan', 'childrenPlan', 'personality', 'lifestyle', 'looksCare'];
const I2 = ['housing', 'car', 'debt', 'personalNetAssets', 'familyNetAssets', 'familySupport', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage'];
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
  looksCare: ['你在意另一半的长相吗？', '和你自己比，选最接近的一个。'],
  incomeAnnual: ['你一年大概挣多少钱？', '选个大概。工资加奖金，扣税前。'],
  personalNetAssets: ['你自己有多少家底？', '选个大概。房子、车、存款，减掉欠的钱。'],
  housing: ['你现在住在哪里？'],
  car: ['你有车吗？'],
  debt: ['除了房贷车贷，你还欠多少钱？', '比如消费贷、网贷、欠亲友的钱。选个大概。'],
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
  looksCare: ['你希望{T}对长相怎么看？', '可以选好几个。'],
  personalNetAssets: ['你希望{T}自己至少有多少家底？', '选一个最低要求。'],
  housing: ['你能接受{T}现在住哪里？', '可以选好几个。'],
  car: ['你希望{T}有车吗？', '可以选好几个。'],
  debt: ['{T}除了房贷车贷，最多能欠多少？', '比如消费贷、网贷、欠亲友的钱。'],
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
  希望对方更好看: '希望另一半比我好看', 和我差不多就好: '两个人长相差不多', 对方普通也可以: '另一半不如我好看也没关系', 不太在意长相: '更看重别的方面',
  计划长期定居本城: '打算一直在现在的城市', 城市可协商: '去哪里可以商量', 未来可能离开本城: '以后可能换城市',
};
const NUM = { age: { min: 18, max: 80, unit: '岁' }, heightCm: { min: 140, max: 210, unit: '厘米' } };
const INCOME_P = [['5 万以下', 30000, 0, 50000], ['5 到 10 万', 75000, 50000, 100000], ['10 到 15 万', 125000, 100000, 150000], ['15 到 20 万', 175000, 150000, 200000], ['20 到 30 万', 250000, 200000, 300000], ['30 到 50 万', 400000, 300000, 500000], ['50 万以上', 700000, 500000, Infinity]];
const MAX_WAN = { debt: [0, 5, 20, 50] };
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
  marriagePlan: { m: '3', f: '3' }, childrenPlan: { m: '3', f: '3' }, personality: { m: '2', f: '2' }, lifestyle: { m: '1', f: '1' }, looksCare: { m: '1', f: '1' },
  personalNetAssets: { m: '1', f: '1' }, housing: { m: '2', f: '1' }, car: { m: '1', f: '1' }, debt: { m: '2', f: '2' }, familySupport: { m: '1', f: '1' }, familyNetAssets: { m: '1', f: '1' },
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
  return S.me.local ? '#/verify' : '#/results';
}

// ---------- 通用界面片段 ----------
// 换个人 / 删除资料：清掉这个人的一切本地状态（跳过的题也算），界面偏好（主题、看法）保留
function resetSession() {
  store.del('vier.token'); store.del('vier.skipped'); store.del('vier.draft');
  Object.assign(S, { me: null, results: null, pDraft: null, iDraft: null, tab: 'ideal' });
}
// 页面里用到的观察器（滑到时淡入、吸顶栏）：换页时统一断开，不留在旧页面上
const observers = new Set();
const watch = (io) => (observers.add(io), io);
function paint(html, { wide = false } = {}) {
  observers.forEach((o) => o.disconnect()); observers.clear();
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
  return `${searchBox(items)}<div class="opts ${cls}" role="${multi ? 'group' : 'radiogroup'}" aria-labelledby="qt">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="opt ${multi ? 'multi' : ''} ${it.soft ? 'soft' : ''} ${on ? 'on' : ''}" data-v="${esc(it.v)}" data-label="${esc(it.label)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}"${hiddenMore(items, it, on) ? ' data-more hidden' : ''}>
      <span class="mark">${ic('check')}</span><span class="opt-t">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`;
  }).join('')}</div>`;
}

function chipList(items, sel, { multi = false } = {}) {
  return `${searchBox(items)}<div class="chips" role="${multi ? 'group' : 'radiogroup'}" aria-labelledby="qt">${items.map((it, i) => {
    const on = multi ? sel.includes(it.v) : sel === it.v;
    return `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${esc(it.v)}" data-label="${esc(it.label)}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" style="--i:${i}"${hiddenMore(items, it, on) ? ' data-more hidden' : ''}>${ic('check')}${esc(it.label)}</button>`;
  }).join('')}</div>`;
}

function stepperHtml(id, val, unit, lab2 = '') {
  return `<div class="stepper" data-stepper="${id}">
    ${lab2 ? `<span class="lab">${lab2}</span>` : ''}
    <button type="button" data-d="-1" aria-label="减一">${ic('minus')}</button>
    <div class="val"><span class="sr" aria-live="polite" data-said></span><b data-val role="button" tabindex="0" aria-label="点一下直接输入">${val}</b><span>${unit}</span></div>
    <button type="button" data-d="1" aria-label="加一">${ic('plus')}</button>
  </div>`;
}

// 加减按钮：点一下加减 1，按住不放会连续变化
function bindStepper(el, get, set) {
  let t1, t2, moved = false;
  const stop = () => {
    clearTimeout(t1); clearInterval(t2);
    if (moved) { moved = false; const said = el.querySelector('[data-said]'); if (said) said.textContent = `${get()}${el.querySelector('.val span:last-child')?.textContent || ''}`; }
  };
  const step = (d) => {
    if (!el.isConnected) return stop(); // 按住时换了页：停止连续加减
    set(get() + d); moved = true;
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
    btn.addEventListener('click', (e) => { if (e.detail === 0) { step(d); stop(); } }); // 键盘操作
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

const DONE_RING = '<svg class="done-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52"/><path d="M38 61l15 15 30-32"/></svg>';
// 段落之间的小结页：和题目页一样——顶上是返回 + 进度（这一段已满），按钮固定在底部
function milestone(title, text, note, actions, { back = '', seg = -1 } = {}) {
  return `${seg >= 0 ? qHead(back, seg, SEGS[seg].list.length - 1) : ''}
  <section class="milestone">
    ${DONE_RING}
    <h1 class="display rise">${title}</h1>
    <p class="lead rise" style="--i:1">${text}</p>
    ${note ? `<div class="note-card rise" style="--i:2">${ic('lock')}<span>${note}</span></div>` : ''}
  </section>
  <div class="qfoot col">${actions}</div>`;
}

// 返回时取消“改完回到确认页”的标记，免得之后点“下一题”又被拉回确认页
function bindBack(before) {
  view.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => {
    before?.();
    if (S.backToReview) S.fromEdit = true; // 从“改一条”退回确认页，确认页的返回键保持原来的去处
    S.backToReview = false; S.backToMeReview = false; S.returnTo = null;
    go(b.dataset.back, 'back');
  }));
}

// ---------- 首页 ----------
async function renderHome() {
  const state = () => {
    if (!S.me?.gender) return 'new';
    // 还没过验证的人：结果在服务器上算，先当“没填完”，继续填写会走到验证码
    return S.me.requirements?.length && S.me.consent?.scoring && !S.me.local ? 'done' : 'partial';
  };
  const draw = () => {
    const st = state();
    const filled = S.me ? Object.keys(S.me.profile || {}).length + (S.me.gender ? 1 : 0) + (S.me.requirements?.length || 0) : 0;
    const actions = {
      new: `<a class="btn primary block" href="${store.get('vier.intro') ? '#/me/gender' : '#/intro'}">开始填写 ${ic('arrow')}</a>
            <a class="btn ghost block" href="#/recover">已经填过？用恢复码找回</a>`,
      partial: `<a class="btn primary block" href="${resumeHash()}">继续填写 ${ic('arrow')}</a>
            <p class="small muted" style="margin:0">上次已经填了 ${filled} 题，都保存好了。</p>
            <a class="btn block" href="#/me/review">看看我填了什么</a>`,
      done: `<a class="btn primary block" href="#/results">看全部结果 ${ic('arrow')}</a>
            <a class="btn block" href="#/me/review">改改我填的资料</a>`,
    }[st];
    if (st === 'new') { paintIntroHome(); const el = document.getElementById('relmap'); const room = heroRoom(el); room(); relMap(el, EXAMPLE, { esc, still: true, maxH: room }); return; }
    if (st === 'done') {
      paint(`<section class="hero home-back">
        <div class="home-stage">
          <p class="ap-eyebrow rise">欢迎回来</p>
          <h1 class="display rise" style="--i:1">你的结果</h1>
          <div class="relmap rise" id="relmap" style="--i:2"></div>
        </div>
        <div class="home-rows rise" style="--i:3" id="home-rows" aria-busy="true"><p class="small muted">正在整理…</p></div>
        <div class="stack rise" style="--i:4">${actions}</div>
      </section>`);
      const box = document.getElementById('home-rows'), mapEl = document.getElementById('relmap');
      // 首页的星球图只画三组（不展开到人）；点 A、B、D 直接进结果页的那一组
      const onlyGroups = (t) => ({ ...t, note: '点 A、B、D，看这一组的人', kids: (t.kids || []).map((k) => ({ ...k, kids: [] })) });
      const openTab = (n) => { if (n.tab) { S.tab = n.tab; go('#/results'); } };
      // 手机一屏放下整页、又不留空：先排好三行和按钮，剩下多少高度都给星球图
      const fitMap = (tree) => {
        const end = document.getElementById('restart') || view.querySelector('.home-back .stack');
        let y = end.offsetHeight; for (let e = end; e; e = e.offsetParent) y += e.offsetTop; // 用排版位置，不受进场动画的位移影响
        const used = y - mapEl.offsetHeight;
        const room = Math.round(window.innerHeight - used - 16);
        relMap(mapEl, tree, { esc, onFocus: openTab, hug: true, maxH: Math.max(150, Math.min(440, room)) });
      };
      loadResults().then((r) => {
        if (!box.isConnected) return;
        box.innerHTML = homeRows(r); box.removeAttribute('aria-busy');
        fitMap(onlyGroups(resultTree(r)));
        box.querySelectorAll('[data-tab]').forEach((a) => (a.onclick = () => { S.tab = a.dataset.tab; }));
      }).catch((e) => {
        // 结果没加载出来（比如网络断了）：星球图用示例的三组，三行概况换成一句提示，不留空白
        if (!box.isConnected) return;
        console.warn('首页结果加载失败', e);
        box.innerHTML = `<div class="note-card">${ic('info')}<span>结果暂时没加载出来。点下面“看全部结果”再试一次。</span></div>`; box.removeAttribute('aria-busy');
        fitMap(onlyGroups(EXAMPLE));
      });
    } else paint(`<section class="hero home-mid">
      <div class="home-stage">
        <h1 class="display rise"><span class="nw">你找谁，</span><span class="nw">TA 找谁，</span><span class="nw">谁找你。</span></h1>
      <div class="relmap rise eclipse" id="relmap" style="--i:1"></div>
      </div>
      <div class="stack rise" style="--i:2">${actions}</div>
    </section>`);
    if (st !== 'done') relMap(document.getElementById('relmap'), EXAMPLE, { esc });
    // 已经开始填的人：首页底部可以存恢复码 / 换个人重新开始
    if (st !== 'new') {
      const acts = document.querySelector('.hero .stack');
      // 恢复码要有服务器上的账户：过了验证才能生成
      acts.insertAdjacentHTML('beforeend', `${S.me.local ? '<p class="small muted" style="margin:0">恢复码完成验证后可以生成。</p>' : `<button class="btn ghost block" id="rcode">${S.me.hasRecovery ? '重新生成恢复码' : '存个恢复码，换手机也能找回'}</button>`}
        <button class="btn block" id="restart">换个人，从头开始</button>`);
      const rc = document.getElementById('rcode');
      if (rc) rc.onclick = () => { openRecovery().onclose = () => { dir = 'none'; draw(); }; };
      document.getElementById('restart').onclick = () => {
        if (S.me.local) {
          const m = askSheet('从头开始？', '这台设备上填的会清掉，服务器上本来就没有。', '从头开始');
          m.el.querySelector('#yes').onclick = () => { m.close(); resetSession(); dir = 'none'; draw(); };
          return;
        }
        const lose = !S.me.hasRecovery;
        const m = askSheet('从头开始？', lose ? '你还没存恢复码，资料会丢。想留着就先存一个。' : '这台设备上的资料会清掉。用恢复码可以找回来。',
          lose ? '不保留，从头开始' : '从头开始', { danger: lose, pre: lose ? '<button class="btn primary block" id="pre-rc">先存恢复码</button>' : '' });
        m.el.querySelector('#pre-rc')?.addEventListener('click', () => { m.close(); openRecovery(); });
        m.el.querySelector('#yes').onclick = () => { m.close(); resetSession(); dir = 'none'; draw(); };
      };
    }
  };
  draw();
  // 已有会话时读取资料，把按钮换成“继续填写”或“看谁适合我”
  if (!S.me) {
    try { await ensureSession(); if ((location.hash.replace(/^#/, '') || '/') === '/' && state() !== 'new') { dir = 'none'; draw(); } } catch { /* 忽略 */ }
  }
}

// 小星球：A、B 用蓝色星球，D 保持原色
const planetOrb = (k) => `<span class="ap-orb o-${k}" aria-hidden="true"><i style="background-image:url(/brand/${k === 'a' || k === 'b' ? 'blue' : 'planet'}-${k}.jpg)"></i></span>`;

// A 组里“你排第几”的一句话，结果页和首页共用
function placeA(r) {
  const a = r.myPlaceA;
  if (!a || !(r.idealOfIdeal || []).length) return '暂时算不出来';
  if (!a.eligible) return '有几条你还没达到，暂时排不上';
  const pct = Math.max(1, Math.round((a.rankRange[1] / a.of) * 100));
  return pct <= 50 ? `你排在前 ${pct}%` : '你排在后一半';
}
// 回头客首页：一上来就是自己的三组概况，点哪一行进哪一组（像苹果官网对老用户先给“你的东西”）
function homeRows(r) {
  const s = r.summary, all = s.position?.ideal?.allMet || 0, n = r.idealMatches.length, two = (r.mutual || []).length;
  if (!s.counterpartCount) return `<div class="note-card">${ic('users')}<span>人还不多，过几天再来看看。</span></div>`;
  const b = n ? (all ? `有 ${all} 位完全符合你的要求${two ? `，其中 ${two} 位两边都合适` : ''}` : `还没人完全符合，最接近的有 ${n} 位`) : '暂时没有，放宽一两条要求试试';
  const d = r.seekers.length ? `${r.summary.iFitCount ?? r.seekers.length} 位的“必须有”，你都满足` : '暂时没有';
  const row = (k, tab, title, text) => `<a class="ap-row home-row" href="#/results" data-tab="${tab}">${planetOrb(k)}<div><h3><b>${k.toUpperCase()}</b>${title}</h3><p>${text}</p></div><span class="chev">${ic('next')}</span></a>`;
  return row('b', 'ideal', REL.ideal(), b) + row('a', 'theirs', REL.theirs(), placeA(r)) + row('d', 'seekers', REL.seekers(), d);
}

// 第一次来的人：一段一段往下滑的首页，每段只讲一件事，滑到时淡入（苹果官网式）
// 首页星图像产品图一样在第一屏完整露出：高度 = 屏幕可见高度 − 星图上沿；只在宽度变了时重算（手机滚动时地址栏伸缩不让图跳）
function heroRoom(el) {
  let w = 0, h = 0;
  const hero = el.closest('.ap-hero');
  return () => {
    if (innerWidth !== w || !h) {
      w = innerWidth;
      // 先收起留白量出星图最高能多高，再让整块首屏刚好占满一屏；星图被宽度限住时，多出的高度由上方几处留白分掉
      hero?.classList.remove('fit');
      const top = el.getBoundingClientRect().top + scrollY;
      h = Math.max(240, Math.min(640, innerHeight - top - 12));
      if (hero) {
        hero.style.setProperty('--hero-h', `${Math.max(0, innerHeight - (hero.getBoundingClientRect().top + scrollY))}px`);
        hero.classList.add('fit');
      }
    }
    return h;
  };
}
function paintIntroHome() {
  const start = store.get('vier.intro') ? '#/me/gender' : '#/intro';
  const orb = planetOrb;
  const check = ic('check');
  paint(`<section class="hero ap-hero">
      <i class="hs hs-top"></i>
      <h1 class="display rise"><span class="nw">你找谁，</span><span class="nw">TA 找谁，</span><span class="nw">谁找你。</span></h1>
      <p class="ap-sub rise" style="--i:1">说说你，和你想找的人。看看谁和你<b>两边都合适</b>。</p>
      <div class="ap-ctas rise" style="--i:3"><a class="btn primary" href="${start}">开始填写</a><button type="button" class="ap-more" data-scroll="ap-how">看看怎么用 ${ic('next')}</button></div>
      <i class="hs hs-mid"></i>
      <div class="relmap rise eclipse" id="relmap" style="--i:2"></div>
      <i class="hs hs-end"></i>
    </section>
    <section class="ap-sec" id="ap-how">
      <h2 class="ap-h2 reveal">三步，看清谁适合你。</h2>
      <p class="ap-sub reveal">点一点就能选，不想说的可以跳过。</p>
      <div class="ap-grid3">
        <div class="ap-tile reveal"><div class="n">第一步</div><h3>说说你自己</h3><p>年龄、身高、在哪工作。大约 2 分钟。</p></div>
        <div class="ap-tile reveal"><div class="n">第二步</div><h3>说说你想找的人</h3><p>每条要求，告诉我们你有多在意。</p></div>
        <div class="ap-tile reveal"><div class="n">第三步</div><h3>看谁适合你</h3><p>谁符合你几条，你又符合谁几条。</p></div>
      </div>
    </section>
    <section class="ap-sec">
      <h2 class="ap-h2 reveal">不只是你喜欢谁。</h2>
      <p class="ap-sub reveal">还有他们喜欢谁，以及谁正好在找你。</p>
      <div class="ap-rows">
        <div class="ap-row reveal">${orb('b')}<div><h3><b>B</b>你的理想型</h3><p>最符合你要求的人，以及他们符合你几条。</p></div></div>
        <div class="ap-row reveal">${orb('a')}<div><h3><b>A</b>理想型的理想型</h3><p>你的理想型自己想找什么样的人，你在里面排第几。</p></div></div>
        <div class="ap-row reveal">${orb('d')}<div><h3><b>D</b>想找你这样的人</h3><p>你正好符合他们的要求。只是条件对得上，不代表已经喜欢你。</p></div></div>
      </div>
    </section>
    <section class="ap-sec">
      <h2 class="ap-h2 reveal">简单到不用想。</h2>
      <div class="ap-grid3">
        <div class="ap-fact reveal"><b>5 分钟</b><span>点选为主，不用打字</span></div>
        <div class="ap-fact reveal"><b>免费</b><span>填完就能看结果</span></div>
        <div class="ap-fact reveal"><b>不用注册</b><span>每题自动保存，随时回来接着填</span></div>
      </div>
    </section>
    <section class="ap-sec">
      <span class="ap-lock reveal">${ic('lock')}</span>
      <h2 class="ap-h2 reveal">你的资料，<br>只用来帮你找人。</h2>
      <ul class="ap-plist">
        <li class="reveal">${check}加密保存，只在我们的服务器里计算。</li>
        <li class="reveal">${check}别人看不到你的名字、收入细节和家里情况。</li>
        <li class="reveal">${check}随时可以下载或永久删除全部资料。</li>
      </ul>
    </section>
    <section class="ap-sec ap-last">
      <h2 class="ap-h2 reveal">现在开始。</h2>
      <p class="ap-sub reveal">大约 5 分钟，看看谁适合你。</p>
      <div class="ap-ctas reveal"><a class="btn primary" href="${start}">开始填写</a><a class="ap-more" href="#/recover">已经填过？用恢复码找回 ${ic('next')}</a></div>
    </section>`, { wide: true });
  view.querySelectorAll('[data-scroll]').forEach((b) => (b.onclick = () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' })));
  revealOnScroll();
}
// 滑到时淡入：用 IntersectionObserver；浏览器不支持或减少动态效果时直接显示
function revealOnScroll() {
  const els = view.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reduceMotion()) { els.forEach((e) => e.classList.add('in')); return; }
  // 同一组里的几块依次出来，每块晚 90ms
  els.forEach((e) => { const sib = [...e.parentElement.children].filter((c) => c.classList.contains('reveal')); e.style.setProperty('--d', `${sib.indexOf(e) * 0.09}s`); });
  const io = watch(new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 }));
  els.forEach((e) => io.observe(e));
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
  </section>
  <div class="qfoot col"><button class="btn primary block" id="nx">下一页 ${ic('arrow')}</button><button class="btn ghost" id="skip">跳过介绍</button></div>`);
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
    if (!S.me.local) await api('PUT', '/api/me/profile', { gender: d.gender, profile, identity: { nickname: d.nickname } });
    S.me.gender = d.gender;
    S.me.profile = profile;
    S.me.identity = { ...(S.me.identity || {}), nickname: d.nickname };
    saveDraft();
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
const incomeBand = (v) => INCOME_P.find(([, , lo, hi]) => v >= lo && v < hi);
function profileText(key, v) {
  if (key === 'gender') return { female: '女生', male: '男生' }[v] || '';
  if (v === undefined || v === null || v === '') return '';
  if (key === 'incomeAnnual' && typeof v === 'number') return incomeBand(v)?.[0] || `${wan(v)} 万`;
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
    body = `<div class="gender" role="radiogroup" aria-labelledby="qt">${[['female', '我是女生', '想认识男生'], ['male', '我是男生', '想认识女生']].map(([v, l, s], i) =>
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
      if (typeof cur === 'number') sel = String(incomeBand(cur)?.[1] ?? '');
    } else {
      items = (f.bands ? Object.keys(f.bands) : f.levels || f.options).map((o) => ({ v: o, label: nice(o), sub: OPT_SUB[o] }));
    }
    // 敏感题：既可以“不清楚”，也可以“不想说”
    if (f.tier === 'L2') items.push({ v: '不清楚', label: '不清楚', soft: true }, { v: '不愿透露', label: '不想说', soft: true });
    // 城市和“你想找的人”里一样：小圆角标签，只摆 10 个大城市，其他搜索
    body = key === 'city' ? chipList(items, String(sel)) : optList(items, String(sel), { cls: key === 'occupation' ? 'grid2' : '' });
  }

  paint(`${qHead(nav.back, nav.seg, nav.i)}
    <h1 class="q" id="qt">${q}</h1>
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
  const here = location.hash; // 等待跳题期间用户点了别处（顶栏、我的资料），就不再跳

  const advance = () => {
    cancel();
    if (busy || location.hash !== here) return; busy = true;
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
    selectOne(view.querySelectorAll('.opt, .chip'), b);
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
    '这些都选填。别人只看到大概的档位，看不到具体数字。',
    `<button class="btn primary block" id="more">继续填（${P2.length} 题，大约 1 分钟）</button>
     <button class="btn block" id="skip">这 ${P2.length} 题都跳过，去说说想找的人</button>`, { back: '#/me/looksCare', seg: 0 }));
  bindBack(); growBar();
  document.getElementById('more').onclick = () => go('#/me/incomeAnnual');
  document.getElementById('skip').onclick = () => go(S.me.requirements?.length ? '#/ideal/review' : '#/ideal/age');
}

function renderMeDone() {
  paint(milestone('你的情况填好了', '接下来说说<b>你想找什么样的人</b>。每条要求，再告诉我们你有多在意。', '',
    `<button class="btn primary block" id="go">说说我想找的人 ${ic('arrow')}</button>
     <a class="btn block" href="#/me/review">看看我填了什么</a>`, { back: '#/me/parentsMarriage', seg: 1 }));
  bindBack(); growBar();
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
  if (!/^#\/me\//.test(S.prev || '')) S.meReviewFrom = /^#\/(results|privacy|ideal\/review)/.test(S.prev || '') ? S.prev : '#/';
  paint(`${simpleHead(S.meReviewFrom || '#/', '我填的资料', '随时可以改')}
    <h1 class="q" id="qt">这是你填的资料</h1>
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
  if (MAX_WAN[key]) return { field: key, op: 'atMost', target: Number(e.target), importance };
  if (f.type === 'money' || f.type === 'ordinal') return { field: key, op: 'atLeast', target: e.target, importance };
  return { field: key, op: 'in', target: e.target, importance };
}

function describe(key, e) {
  const f = S.F[key];
  if (!e.dirty && e.orig && f.type === 'number' && e.orig.op !== 'range') {
    return `${{ atLeast: '至少', atMost: '最多', about: '大约' }[e.orig.op] || ''} ${e.orig.target} ${NUM[key].unit}`;
  }
  if (f.type === 'number') return `${e.target[0]} 到 ${e.target[1]} ${NUM[key].unit}`;
  if (MAX_WAN[key]) return Number(e.target) ? `最多 ${wan(e.target)} 万` : '没有负债';
  if (f.type === 'money') return `至少 ${wan(e.target)} 万`;
  if (f.type === 'ordinal') return `${e.target}及以上`;
  return e.target.map(nice).join('、');
}

function saveReqs() {
  const d = iDraft();
  const requirements = [...I1, ...I2].map((k) => toReq(k, d[k])).filter(Boolean);
  return queueSave(async () => {
    if (!S.me.local) await api('PUT', '/api/me/requirements', { requirements });
    S.me.requirements = requirements;
    saveDraft();
    S.results = null;
  });
}

function iNav(key) {
  const seg = I1.includes(key) ? 2 : 3, list = SEGS[seg].list, i = list.indexOf(key);
  return {
    seg, i,
    back: S.returnTo || (S.backToReview ? '#/ideal/review' : i > 0 ? `#/ideal/${list[i - 1]}` : seg === 2 ? '#/me/done' : '#/ideal/break'),
    next() {
      if (S.returnTo) { const r = S.returnTo; S.returnTo = null; S.backToReview = false; saveReqs(); return go(r, 'back'); }
      if (S.backToReview) { S.backToReview = false; S.fromEdit = true; return go('#/ideal/review'); }
      if (i < list.length - 1) return go(`#/ideal/${list[i + 1]}`);
      if (seg === 2) return go('#/ideal/break');
      finishIdeal();
    },
  };
}

function impBlock(e) {
  return `<div class="imp" id="imp">
    <h3>这一条，你有多在意？<span class="imp-wait">先选上面的条件。</span></h3>
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
  } else if (MAX_WAN[key]) {
    body = chipList(MAX_WAN[key].map((w) => ({ v: String(w * 10000), label: w ? `最多 ${w} 万` : '不能有负债' })), e.target == null ? '' : String(e.target));
  } else if (f.type === 'money') {
    body = chipList(MIN_WAN[key].map((w) => ({ v: String(w * 10000), label: `至少 ${w} 万` })), e.target == null ? '' : String(e.target));
  } else if (f.type === 'ordinal') {
    body = chipList(f.levels.map((l, i) => ({ v: l, label: i === 0 ? '都可以' : `${l}及以上` })), e.target || ''); // 最低一档写“及以上”很别扭（如“高中及以下及以上”）
  } else {
    body = chipList(f.options.map((o) => ({ v: o, label: nice(o) })), e.target || [], { multi: true });
  }

  paint(`${qHead(nav.back, nav.seg, nav.i)}
    <h1 class="q" id="qt">${tx(q)}</h1>
    <p class="qhint">${hint}</p>
    <div id="target">${body}</div>
    <div id="impwrap" ${f.type === 'number' || entryValid(key, e) ? '' : 'class="off" inert aria-disabled="true"'}>${impBlock(e)}</div>
    <div class="qfoot">
      ${e.imp !== 'off' ? `<button class="btn primary" id="ok">${S.backToReview ? '改好了' : '好了，下一题'} ${ic('arrow')}</button><button class="btn ghost" id="skip">不在意</button>` : '<button class="btn block" id="skip">不在意，跳过这题</button>'}
    </div>`);
  growBar();

  const setImp = (v, flash) => {
    e.imp = v;
    selectOne(view.querySelectorAll('[data-imp]'), view.querySelector(`[data-imp="${v}"]`));
    if (flash) { const box = document.getElementById('imp'); box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  };
  // 和“关于你”一样：选完条件，下面才出现“有多在意”；点了在意程度，就自动进入下一题
  let timer = null, busy = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  bindBack(() => { cancel(); if (e.imp === 'off' || entryValid(key, e)) saveReqs(); });
  const here = location.hash;
  const advance = () => {
    cancel(); if (busy || location.hash !== here) return; busy = true;
    saveReqs();
    nav.next();
  };
  const touched = () => {
    e.dirty = true;
    const w = document.getElementById('impwrap'), ok = entryValid(key, e);
    // 和苹果选配置一样：在意程度一直摆着，没选条件时是灰的、点不了；选好条件就亮起来
    w.classList.toggle('off', !ok); w.inert = !ok;
    if (ok) w.removeAttribute('aria-disabled'); else { w.setAttribute('aria-disabled', 'true'); cancel(); }
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
        selectOne(view.querySelectorAll('#target .chip'), c);
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
     <button class="btn ghost" id="review">${ic('list')} 先检查一下我的要求</button>`, { back: '#/ideal/looksCare', seg: 2 }));
  bindBack(); growBar();
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
    <h1 class="q" id="qt">这是你的要求</h1>
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
  return `<div class="choice" role="radiogroup" aria-labelledby="q-${name}">${[['1', '可以', yes], ['0', '不要', no]].map(([v, l, s]) =>
    `<button type="button" class="opt ${cur === v ? 'on' : ''}" data-name="${name}" data-v="${v}" role="radio" aria-checked="${cur === v}"><span class="mark">${ic('check')}</span><span class="opt-t"><b>${l}</b><small>${s}</small></span></button>`).join('')}</div>`;
}

function renderConsent() {
  const c = S.me.consent || {};
  const st = { pool: c.pool ? '1' : '0', research: c.research ? '1' : '0' };
  paint(`${simpleHead('#/ideal/review', '最后一步', '你的资料，你做主')}
    <h1 class="q" id="qt">最后，问你几件事</h1>
    <div class="privacy-label">
      <div><span class="ico">${ic('user')}</span><p><b>收集什么</b>你填的情况和要求。不要手机号，也不要名字。</p></div>
      <div><span class="ico">${ic('heart')}</span><p><b>拿来做什么</b>只用来算谁和你合适。匿名统计要你同意才算。</p></div>
      <div><span class="ico">${ic('eyeOff')}</span><p><b>谁能看到</b>别人看不到你的名字、存款和家里情况。随时可以下载或永久删除。</p></div>
    </div>
    <h2 class="sec-title" id="q-pool">1. 让别人也能找到你吗？</h2>
    ${choice('pool', st.pool, '别人的结果里也可能出现你', '别人搜不到你')}
    ${SEE_CARD()}
    <h2 class="sec-title" id="q-research">2. 用于匿名统计吗？</h2>
    ${choice('research', st.research, '只算很多人加在一起的数', '不参与统计')}
    <h2 class="sec-title">${ic('lock')}换手机也想找回？</h2>
    <p class="small muted" style="margin:0 0 10px">存个恢复码。在别的手机上输入，就能回到你的资料。${S.me.local ? '完成验证后可以生成。' : ''}</p>
    ${S.me.local ? '' : `<div class="stack"><button type="button" class="btn block" id="rcode">${S.me.hasRecovery ? '重新生成恢复码' : '生成恢复码'}</button></div>`}
    <label class="check-row ${c.adult ? 'on' : ''}" id="adult"><input type="checkbox" class="sr"${c.adult ? ' checked' : ''}><span class="mark">${ic('check')}</span><span>我已满 18 岁，同意<a href="#/terms">用户协议</a>和<a href="#/policy">隐私政策</a></span></label>
    <div class="qfoot"><button class="btn primary block" id="go">同意，开始找人 ${ic('arrow')}</button></div>`);
  bindBack();
  view.querySelectorAll('.choice .opt').forEach((b) => (b.onclick = () => {
    st[b.dataset.name] = b.dataset.v;
    selectOne(view.querySelectorAll(`[data-name="${b.dataset.name}"]`), b);
  }));
  const rc = document.getElementById('rcode');
  if (rc) rc.onclick = () => openRecovery();
  let adult = !!c.adult;
  const ad = document.getElementById('adult');
  ad.querySelector('input').onchange = (e) => { adult = e.target.checked; ad.classList.toggle('on', adult); };
  const btn = document.getElementById('go');
  btn.onclick = async () => {
    if (!adult) { toast('请先勾选“我已满 18 岁”'); ad.classList.add('shake'); setTimeout(() => ad.classList.remove('shake'), 500); return; }
    const consent = { adult: true, scoring: true, pool: st.pool === '1', research: st.research === '1' };
    // 还没过验证：同意先存本机，下一步输验证码，过了才一起交给服务器
    if (S.me.local) { S.me.consent = consent; saveDraft(); return go('#/verify'); }
    btn.classList.add('loading');
    try {
      await api('PUT', '/api/me/consent', consent);
      S.me = await api('GET', '/api/me');
      go('#/results');
    } catch (e) { btn.classList.remove('loading'); toast(e.message); }
  };
}

// ---------- 验证码 ----------
// 填完、同意之后输一次图片验证码；过了才在服务器上建账户，把资料、要求、同意一次存好
function renderVerify() {
  if (!S.me.local) return go('#/results');
  if (resumeHash() !== '#/verify') return go(resumeHash());
  paint(`${simpleHead('#/consent', '最后一步', '确认一下')}
    <h1 class="q" id="qt">输入图里的字</h1>
    <p class="qhint">${ic('shield')}5 个字符，不分大小写。验证后保存你的资料。</p>
    <div class="cap-card" id="cap">
      <div class="cap-img" id="capimg" role="img" aria-label="验证码图片"></div>
      <button type="button" class="btn ghost sm" id="capnew">换一张</button>
    </div>
    <input class="text-input mono cap-input" id="capin" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="8" placeholder="·····" aria-label="验证码" aria-describedby="caperr">
    <p class="err" id="caperr" role="alert" hidden></p>
    <div class="qfoot"><button class="btn primary block" id="capgo">验证并查看结果 ${ic('arrow')}</button></div>`);
  bindBack();
  const card = document.getElementById('cap'), img = document.getElementById('capimg'), input = document.getElementById('capin');
  const err = document.getElementById('caperr'), btn = document.getElementById('capgo');
  let id = null;
  const load = async () => {
    img.classList.add('loading'); id = null;
    try { const c = await api('GET', '/api/captcha'); id = c.id; img.innerHTML = c.svg; }
    catch (e) { img.innerHTML = ''; err.textContent = e.message; err.hidden = false; }
    img.classList.remove('loading');
  };
  const fail = (msg) => {
    err.textContent = msg; err.hidden = false;
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    input.value = ''; input.focus();
    load();
  };
  document.getElementById('capnew').onclick = () => { err.hidden = true; input.value = ''; input.focus(); load(); };
  input.oninput = () => { err.hidden = true; };
  input.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
  btn.onclick = async () => {
    const answer = input.value.trim();
    if (!answer) { fail('先输入图里的字'); return; }
    if (!id) return;
    btn.classList.add('loading'); err.hidden = true;
    try {
      const { token } = await api('POST', '/api/session', { captchaId: id, answer, gender: S.me.gender, profile: S.me.profile || {}, requirements: S.me.requirements, consent: S.me.consent, identity: S.me.identity || {} });
      store.set('vier.token', token);
      store.del('vier.draft');
      S.me = await api('GET', '/api/me');
      S.results = null;
      go('#/results');
    } catch (e) { btn.classList.remove('loading'); fail(e.status === 400 && /验证码/.test(e.message) ? '不对，换了一张，再试一次' : e.message); }
  };
  input.focus();
  load();
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
  const job = loadResults(), gen = routeGen;
  const per = reduceMotion() ? 0 : 450;
  for (let i = 0; i < steps.length; i++) {
    if (gen !== routeGen) return;
    t.textContent = steps[i];
    bar.style.width = `${((i + 1) / steps.length) * 100}%`;
    await delay(per);
    if (i === steps.length - 1) await job;
  }
}

// ---------- 结果：主结论是“符合几条”，分数收进详情 ----------
const fmt = (t) => (Math.round(t.low) === Math.round(t.high) ? `${Math.round(t.low)}` : `${Math.round(t.low)} 到 ${Math.round(t.high)}`);

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
function fitLine(owner, subject, items, plain = false) {
  if (!items?.length) return '';
  const t = tally(items);
  const names = (tone) => items.filter((it) => toneOf(it) === tone).map((it) => esc(lab(it.label))).join('、');
  const miss = [t.no && `<span class="miss">没对上：${names('t-bad')}</span>`, t.near && `<span class="near">差一点：${names('t-warn')}</span>`, t.unk && `<span class="unk">没填：${names('t-unk')}</span>`].filter(Boolean).join('');
  const pct = Math.round((t.met / t.total) * 100);
  // 点开看逐条：每条要求是什么、对方实际是什么（和详情页同一套）
  const head = `<p><span>${subject === '你' ? `你符合${owner}` : `${subject}符合你`}${plain ? '' : `<em class="fl-more"><i>明细</i><i>收起</i><span class="chev">${ic('next')}</span></em>`}</span><b>${t.met}<small>/${t.total}</small></b></p>
    <i class="bar"><b style="width:${pct}%"></b></i>${miss ? `<div class="why">${miss}</div>` : ''}`;
  if (plain) return `<div class="fitline">${head}</div>`; // 详情页下面另有逐条，不重复
  return `<details class="fitline"><summary>${head}</summary>${checks(items, `${owner}要`, `${subject}是`)}</details>`;
}

// 我自己（用户本人）的人称：女生是“她”，男生是“他”
const ME = () => (S.me?.gender === 'female' ? '她' : S.me?.gender === 'male' ? '他' : '你');

const reqText = (q) => nice(String(q.text).replace(/^至少 ?高中及以下$/, '不限'));
// 虚拟理想型：按一组要求拼出来的“样子”，明确标出不是真人
function idealCard(reqs, { title, sub, edit = false, fold = false }) {
  if (fold) return `<details class="ideal-fold"><summary>${ic('user')}<b>${title}</b><span>${reqs.length} 条要求</span><span class="chev">${ic('next')}</span></summary>${idealCard(reqs, { title, sub, edit })}</details>`;
  return `<section class="ideal-card">
    <div class="ideal-head"><span class="ideal-avatar" aria-hidden="true">${ic('user')}</span>
      <div><b>${title}</b><span>${sub}</span></div><span class="badge virtual">想象</span></div>
    <ul class="ideal-list">${[...reqs].sort((x, y) => (IMP_RANK[y.importance] || 0) - (IMP_RANK[x.importance] || 0)).map((q) => `<li><span class="k">${esc(lab(q.label))}</span><span class="v">${esc(reqText(q))}</span>
      <span class="badge imp-${IMP_RANK[q.importance] || 0}">${IMP_FROM_SERVER[q.importance] || esc(q.importance)}</span></li>`).join('')}</ul>
    ${edit ? `<a class="ideal-edit" href="#/ideal/review">${ic('edit')}改改我的要求</a>` : ''}
  </section>`;
}
// 把某人的逐条结果按理想型的顺序排好，圆点和对照表才能一一对上
const byIdeal = (reqs, items) => {
  const m = Object.fromEntries((items || []).map((it) => [it.label, it]));
  return reqs.map((q) => m[q.label]).filter(Boolean);
};
// 对照表的行：三张表统一按这六组排，组名单独一行
const ROW_GROUPS = [
  ['基本情况', ['age', 'heightCm', 'city', 'settlement']],
  ['学历与工作', ['education', 'occupation', 'incomeAnnual']],
  ['房车与负债', ['housing', 'car', 'debt', 'personalNetAssets']],
  ['家庭', ['familyNetAssets', 'familySupport', 'parentsSecurity', 'siblings', 'care', 'parentsMarriage']],
  ['婚育', ['maritalStatus', 'childrenStatus', 'marriagePlan', 'childrenPlan']],
  ['相处', ['personality', 'lifestyle', 'looksCare']],
];
// 一组行标签（服务端的字段名）→ [[组名, [标签…]], …]，按上面的顺序；不认识的放最后
function groupRows(labels) {
  const keyOf = Object.fromEntries(Object.values(S.F || {}).map((f) => [f.label, f.key]));
  const set = new Set(labels);
  const out = ROW_GROUPS.map(([g, keys]) => [g, keys.map((k) => S.F?.[k]?.label).filter((l) => l && set.has(l))]).filter(([, ls]) => ls.length);
  const known = new Set(out.flatMap(([, ls]) => ls));
  const rest = labels.filter((l) => !known.has(l) || !keyOf[l]);
  if (rest.length) out.push(['其他', [...new Set(rest)]]);
  return out;
}
// 三张对照表共用的骨架：第一列是“你”或“你的要求”，后面每人一列，格子里都是实际情况；
// 橙色 = 不一样 / 没达到要求。same(label) 为真的行在“只看不一样的”打开时折叠
function cmpGrid({ cls, firstHead, heads, labels, first, cell, same, mark = () => '', hint, sameNote, full = false }) {
  const n = heads.length + 2;
  const rows = groupRows(labels).map(([g, ls]) => {
    const allSame = !full && ls.every(same);
    const shut = S.foldGrp.has(g);
    return `<tr class="grp ${allSame ? 'same' : ''}"><th scope="rowgroup" colspan="${n}"><div class="cx"><button type="button" class="grp-tog" data-grp="${g}" aria-expanded="${!shut}"><span class="gl">${g}</span><span class="chev">${ic('next')}</span></button></div></th></tr>` +
      ls.map((l) => `<tr data-grp="${g}" class="${!full && same(l) ? 'same' : ''} ${shut ? 'gf' : ''}"><th scope="row"><div class="cx"><b>${esc(lab(l))}${mark(l)}</b></div></th><td class="me-col">${first(l)}</td>${heads.map((_, i) => cell(i, l)).join('')}</tr>`).join('');
  }).join('');
  return `<div class="cmp-block ${S.diffOnly && !full ? 'diff-on' : ''}"><div class="cmp-wrap"><table class="cmp ${cls}">
    <thead><tr><th scope="col"></th>${firstHead}${heads.join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${CMP_NAV()}${sameNote || ''}${hint ? `<p class="cmp-hint">${hint}</p>` : ''}</div>`;
}
// 表格里的值：金额档位保持“10–50万元”的短写法，其他按说人话的写法再缩短
const cellText = (v) => (/\d\s*–\s*\d/.test(String(v)) && !/岁|cm/.test(String(v)) ? String(v).replace(/\s*–\s*/g, '–') : shortRange(nice(v)));
// 分组收起：点组名收起 / 展开这一组的行；记在本次打开的页面里，切页签、看详情都保持
S.foldGrp = new Set();
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('.grp-tog');
  if (!b) return;
  const g = b.dataset.grp, open = b.getAttribute('aria-expanded') !== 'true';
  open ? S.foldGrp.delete(g) : S.foldGrp.add(g);
  const tb = b.closest('tbody');
  // 收起前先量好每格的真实高度，收起 / 展开按这个距离走
  const cells = [...tb.querySelectorAll(`tr[data-grp="${CSS.escape(g)}"] .cx`)];
  const hs = cells.map((c) => c.scrollHeight);
  cells.forEach((c, i) => c.style.setProperty('--h', `${hs[i]}px`));
  b.setAttribute('aria-expanded', open);
  tb.querySelectorAll(`tr[data-grp="${CSS.escape(g)}"]`).forEach((tr) => tr.classList.toggle('gf', !open));
});
const cxv = (v, cls = '') => `<div class="cx">${v ? `<span class="${cls}">${esc(cellText(v))}</span>` : '<span class="muted">—</span>'}</div>`;
// 你的理想型 / 想找你的人：每行是一项条件，第一列是你的要求（没要求写“不限”），格子是对方实际情况
function compareTable(reqs, people, sfx = '') {
  const reqOf = Object.fromEntries(reqs.map((q) => [q.label, q]));
  const itemOf = (p, l) => (p.fit?.items || []).find((x) => x.label === l);
  const labels = [...new Set([...reqs.map((q) => q.label), ...people.flatMap((p) => Object.keys(p.facts || {}))])];
  const good = (p, l) => { const it = itemOf(p, l); return !reqOf[l] || (it && toneOf(it) === 't-good'); };
  const same = (l) => people.every((p) => good(p, l));
  const heads = people.map((p, i) => `<th scope="col"><a href="#/match/${i}${sfx}"><span class="al">${nameTag(p)}</span><b>${pctQ(p.fit.total)}</b></a></th>`);
  return cmpGrid({
    cls: 'cmp2', labels, heads, same,
    firstHead: '<th scope="col" class="me-col"><span class="al">你的要求</span></th>',
    first: (l) => (reqOf[l] ? cxv(reqText(reqOf[l])) : '<div class="cx"><span class="muted">不限</span></div>'),
    mark: (l) => (reqOf[l]?.must ? '<em>必须</em>' : ''),
    cell: (i, l) => {
      const p = people[i], it = reqOf[l] && itemOf(p, l);
      if (it) {
        const tone = toneOf(it);
        if (tone === 't-unk') return '<td><div class="cx"><span class="muted">没填</span></div></td>';
        return `<td class="${tone === 't-good' ? '' : 't-diff'}">${cxv(it.value === null ? '不公开' : it.value)}</td>`;
      }
      return `<td>${cxv(p.facts?.[l] === '未填写' ? '' : p.facts?.[l])}</td>`;
    },
    sameNote: sameLine('都符合', reqs.filter((q) => same(q.label)).map((q) => lab(q.label))),
    hint: '橙色字 = 没达到你的要求',
  });
}

// 表格里的范围写短：“27 岁 到 33 岁”→“27–33 岁”，“15 万 到 20 万”→“15–20 万”，一格放得下
const shortRange = (t) => String(t).replace(/(\d+(?:\.\d+)?)\s*([^\d\s到]+)\s*到\s*(\d+(?:\.\d+)?)\s*\2/g, '$1–$3 $2');
// 表格下面的“都符合 / 和你一样”：放在可左右滑的表格外面，一直看得见，太长就换行
const sameLine = (title, labels) => (labels.length ? `<p class="same-line">${ic('check')}<span><b>${title}</b>${labels.map(esc).join('、')}</span></p>` : '');
// 表格上方一行工具条：左边“只看不一样的”开关（像系统设置里的开关），右边“左右滑动看更多”
const diffBtn = () => `<button type="button" class="diff-toggle" role="switch" aria-checked="${S.diffOnly}" data-diff><span>只看不一样的</span><i class="mini-switch" aria-hidden="true"></i></button>`;

const subLine = (c) => [c.facts['年龄'], c.facts['常住城市']].filter(Boolean).map(esc).join(' · ');
function pcard(c, inner, { href = '', i = 0, head = '', more = '', quick = '' } = {}) {
  // 手机上默认收起：只露头像、代号、一句符合几条；点开再看细节
  return `<details class="pcard fold" style="--i:${i}">
    <summary class="pcard-head"><div class="pcard-name"><b>${nameTag(c)}</b><span>${subLine(c)}</span></div>
      ${quick ? `<span class="quick">${quick}</span>` : head}<span class="chev">${ic('next')}</span></summary>
    <div class="facts">${Object.entries(c.facts).filter(([k]) => k !== '年龄' && k !== '常住城市').slice(0, 4).map(([, v]) => `<span>${esc(nice(v))}</span>`).join('')}</div>
    ${inner}
    ${href ? `<a class="pcard-more" href="${href}">${more || '看详细'} ${ic('next')}</a>` : ''}
  </details>`;
}

// 两边都对得上的人，在卡片上加一枚“双向”小标，不再单独成组
const mutualIds = (r) => (r.mutualIds ||= new Set((r.mutual || []).map((m) => m.alias)));
const twoWay = (r, m) => (mutualIds(r).has(m.alias) ? '<span class="two-way">双向</span>' : '');

// 名单区的头（苹果式）：标题，紧跟一句说明，下面一行工具——左边“一个个看 / 对照着看”，右边“只看不一样的”（对照时才有）
const viewSwitch = (table) => `<div class="seg-switch" role="group" aria-label="显示方式"><button type="button" data-view="cards" class="${table ? '' : 'on'}" aria-pressed="${!table}">一个个看</button><button type="button" data-view="table" class="${table ? 'on' : ''}" aria-pressed="${!!table}">对照着看</button></div>`;
const secHead = (title, note, table) => `<div class="sec-head"><h3>${title}</h3>${note ? `<p class="sec-note">${note}</p>` : ''}<div class="sec-tools">${viewSwitch(table)}${table ? diffBtn() : ''}</div></div>`;

function tabList(r, tab) {
  const t = T();
  if (r.summary.counterpartCount === 0) return emptyCard('还没有人', `人选库里还没有${THEM()}，不是你的要求太高。过几天再来看看。`);
  if (tab === 'ideal') {
    const reqs = r.myIdeal || [], people = r.idealMatches, table = S.view === 'table' && people.length;
    if (!people.length) return emptyCard('没有人达到你所有的“必须有”', '把一两条“必须有”改成“很在意”试试。', '#/ideal/review', '去改要求');
    // 正式环境里虚拟人选和真人在同一个池子：标题不写“真人”，另外说清其中几位是真人
    const real = people.filter((p) => !p.simulated).length;
    const tie = r.summary.topTie > 1 ? `${r.summary.topTie} 位一样符合，都算第 1。` : '';
    const switcher = secHead(`最符合你要求的 ${people.length} 位${real < people.length ? `<small>其中真人 ${real} 位</small>` : ''}`, tie, table);
    const body = (table ? compareTable(reqs, people)
      : `<div class="cards">${people.map((m, i) => pcard(m,
        fitLine('你', t, byIdeal(reqs, m.fit.items)) + fitLine(t, '你', m.myFitToThem.items),
        { href: `#/match/${i}`, i, quick: twoWay(r, m) + rankQ(i, m.fit.total, m.rankRange), more: `看${t}想找什么样的人` })).join('')}</div>`);
    return switcher + body;
  }
  if (tab === 'theirs') {
    const list = r.idealOfIdeal || [];
    if (!r.idealMatches.length) return emptyCard('先要有理想型人选', '把一两条“必须有”放宽，理想型人选多了，这里才算得出来。', '#/ideal/review', '去改要求');
    if (!list.length) return emptyCard('暂时算不出来', `人选库里和你同为${S.me?.gender === 'female' ? '女生' : '男生'}的人还不够多。`);
    const table = S.view === 'table';
    const mine = r.myPlaceA?.score;
    const tieA = r.summary.topTieA > 1 ? `${r.summary.topTieA} 位一样接近，都算第 1。` : '';
    const switcher = secHead(`理想型看中的 ${list.length} 位`, tieA, table);
    // 同一把尺子（你的理想型的要求）量两个人：TA 和你
    const vs = (a) => mine ? `<div class="a-bars vs"><p>用你的理想型的标准打分：</p>${bars([['', esc(a.name || 'TA'), Math.round(a.score.low)], ['me', '你', Math.round(mine.low)]])}</div>` : '';
    const body = table ? aCompareTable(r.myFacts || {}, list, mine)
      : `<div class="cards">${list.map((a, i) => pcard(a, vs(a), { i, quick: rankQ(i, a.score, a.rankRange), href: `#/match/${i}/theirs`, more: '和你逐条对照' })).join('')}</div>`;
    return switcher + body;
  }
  // 三组卡片统一：两条进度条，顺序固定为“他符合你 / 你符合他”，颜色跟所在组一致
  const both = (m, mine) => fitLine('你', t, m.fit?.items) + fitLine(t, '你', mine?.items);

  if (!r.seekers.length) return emptyCard('暂时没有', '人选库里还没有人的要求正好对上你。');
  const table = S.view === 'table', reqs = r.myIdeal || [];
  const switcherD = secHead(`你最符合${T()}们要求的 ${r.seekers.length} 位`, '', table);
  if (table) return switcherD + compareTable(reqs, r.seekers, '/seekers');
  return switcherD + `<div class="cards">${r.seekers.map((m, i) => pcard(m, both(m, m.myFitToThem), { i, quick: twoWay(r, m) + rankQ(i, m.myFitToThem.total, m.rankRange), href: `#/match/${i}/seekers`, more: `看${t}想找什么样的人` })).join('')}</div>`;
}

// 卡片右侧：名次 + 契合度。名次按加权分排（越在意的条件分量越大），所以 8/11 也可能排在 9/11 前面
// 资料没填全时分数是个区间：只显示保底的低值，后面加个小“+”表示可能更高（排序本来就按低值）
const pctQ = (t) => `${Math.round(t.low)}%${Math.round(t.high) > Math.round(t.low) ? '<sup title="有些资料没填，实际可能更高">+</sup>' : ''}`;
// 名次：同分的人是并列，写“并列第 1”，不让人以为第 1、2、3 有高低
const rankQ = (i, t, rr) => `<span class="rk">${rr && rr[1] > rr[0] ? `并列第 ${rr[0]}` : `第 ${i + 1}`}</span>${t ? `<span class="pc">${pctQ(t)}</span>` : ''}`;
// 代号：名字右上角一枚小小的、斜着的朱红印章“代号”，提醒这不是真名
const nameTag = (c) => `<span class="nm">${esc(c.name || c.alias)}<i class="seal">代号</i></span>`;

function emptyCard(title, text, href, btn) {
  return `<div class="empty">${ic('search')}<b>${title}</b>${text}${href ? `<div class="stack" style="margin-top:14px"><a class="btn sm" href="${href}">${btn}</a></div>` : ''}</div>`;
}

// 结果页关系图：你 → 三组 → 每位人选；“他适合你”的人再展开“他想找的”
function resultTree(r) {
  const LETTER = { ideal: 'B', theirs: 'A', seekers: 'D' };
  // 图上每组只放最合适的前几位，排在轨道上：越合适离中心越近；完整名单在下面
  const TOP = 6, t = T();
  const people = (tab, list, score, sfx, line) => list.slice(0, TOP).map((m, i) => {
    const pct = Math.round(score(m)?.low || 0), name = m.name || m.alias;
    return { id: `${tab}-${i}`, kind: 'person', label: name, pct, href: `#/match/${i}${sfx}`, note: `${name} · ${line(pct)}` };
  });
  // hub：轨道中心代表拿谁来比——B、D 比的是你，A 比的是你的理想型
  const ME = { label: '你', planet: 'planet-c', at: 'me' }; // at：中心由哪颗星球走过来站着
  const HUB = {
    ideal: { ...ME, note: '离你越近，越符合你的要求' },
    seekers: { ...ME, note: `离你越近，你越符合${t}们的要求` },
    theirs: { label: '你的理想型', planet: 'blue-b', at: 'ideal', note: '越近，越符合你理想型的要求' },
  };
  const group = (id, tab, list, note, kids) => ({ id, kind: 'group', tab, count: list.length, label: REL[tab](), short: LETTER[tab],
    note: list.length ? `${LETTER[tab]} · ${note}（${list.length} 位）` : '暂时没有', kids,
    hub: list.length ? { ...HUB[tab], note: HUB[tab].note + (list.length > TOP ? `（图上是前 ${TOP} 位）` : '') } : null });
  const theirs = r.idealOfIdeal || [];
  return {
    id: 'me', kind: 'me', label: '你', short: 'C', note: '点 A、B、D 切换下面的内容',
    kids: [
      group('ideal', 'ideal', r.idealMatches, '你的理想型', people('ideal', r.idealMatches, (m) => m.fit?.total, '', (p) => `符合你的要求 ${p}%`)),
      group('seekers', 'seekers', r.seekers, '想找你这样的人', people('seekers', r.seekers, (m) => m.myFitToThem?.total, '/seekers', (p) => `你符合${t}的要求 ${p}%`)),
      group('theirs', 'theirs', theirs, '理想型的理想型', people('theirs', theirs, (m) => m.score, '/theirs', (p) => `符合你理想型的要求 ${p}%`)),
    ],
  };
}

// 你的位置：多少位异性的要求你全都满足，最常没对上的是哪一条。只说事实，不给人打分
const avgLow = (list, f) => Math.round(list.reduce((x, q) => x + (f(q)?.low || 0), 0) / list.length);
const bars = (rows) => rows.map(([cls, label, v]) => `<div${cls ? ` class="${cls}"` : ''}><span>${label}</span><i style="--w:${v}%"></i><b>${v}%</b></div>`).join('');
function positionCard(tab, r) {
  if (tab === 'theirs') {
    const a = r?.myPlaceA, list = r?.idealOfIdeal || [];
    if (!a || !list.length) return '';
    const avg = avgLow(list, (p) => p.score), me = Math.round(a.score.low), gap = avg - me;
    const miss = a.topMisses?.length ? `<div class="pos-miss"><span>主要差在：</span>${a.topMisses.map((m) => `<em>${esc(lab(m.label))}<small>${m.count}/${a.ofIdeals} 位在意</small></em>`).join('')}</div>` : '';
    return `<div class="pos-card a-sum">
      <p class="a-sum-q">你差在哪</p>
      <div class="a-bars">${bars([['', `理想型看中的 ${list.length} 位`, avg], ['me', '你', me]])}</div>
      <p class="a-sum-t">${gap > 0 ? `按理想型的要求，你比他们看中的人低 ${gap} 个百分点。` : `按理想型的要求，你和他们看中的人差不多。`}</p>
      ${miss}
    </div>`;
  }
  if (tab === 'ideal') {
    const list = r?.idealMatches || [], p = r.summary.position?.ideal;
    if (!list.length) return '';
    const t = T(), them = THEM(), theirs = avgLow(list, (q) => q.fit?.total), mine = avgLow(list, (q) => q.myFitToThem?.total);
    const miss = p?.topMisses?.length ? `<div class="pos-miss"><span>最常卡在：</span>${p.topMisses.map((m) => `<a class="miss-link" href="#/ideal/${esc(m.field)}" data-edit-req>${esc(lab(m.label))}<small>${m.count} 位</small>${ic('edit')}</a>`).join('')}</div><p class="pos-tip">点一下可以改这条要求</p>` : '';
    return `<div class="pos-card a-sum">
      <p class="a-sum-q">${t}们合你的要求吗</p>
      <div class="a-bars">${bars([['b', `${t}们符合你`, theirs], ['me', `你符合${t}们`, mine]])}</div>
      ${p?.of ? `<p class="a-sum-t">在 ${p.of} 位${them}里，有 ${p.allMet} 位完全符合你的要求。</p>` : ''}
      ${miss}
    </div>`;
  }
  if (tab === 'seekers') {
    const list = r?.seekers || [];
    if (!list.length) return '';
    const t = T(), theirs = avgLow(list, (p) => p.fit?.total), mine = avgLow(list, (p) => p.myFitToThem?.total);
    const miss = new Map();
    for (const p of list) for (const it of p.fit?.items || []) if (toneOf(it) !== 't-good') miss.set(it.label, (miss.get(it.label) || 0) + 1);
    const top = [...miss.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const two = list.filter((p) => mutualIds(r).has(p.alias)).length;
    return `<div class="pos-card a-sum">
      <p class="a-sum-q">你合${t}们的要求吗</p>
      <div class="a-bars">${bars([['me', `你符合${t}们`, mine], ['d', `${t}们符合你`, theirs]])}</div>
      <p class="a-sum-t">${t}们想找的人，你${mine >= 80 ? '基本都符合' : '符合一部分'}。${two ? `其中 ${two} 位两边都合适，标着“双向”。` : ''}</p>
      ${top.length ? `<div class="pos-miss"><span>反过来，${t}们最常没达到你的：</span>${top.map(([l, c]) => `<em>${esc(lab(l))}<small>${c}/${list.length} 位</small></em>`).join('')}</div>` : ''}
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

// 结果页最上面的一句结论（苹果式：先说结论，细节点开才看）
function verdict(r) {
  const s = r.summary, all = s.position?.ideal?.allMet || 0, two = s.mutualCount ?? (r.mutual || []).length, n = r.idealMatches.length, t = T();
  if (!s.counterpartCount) return ['人还不多', '过几天再来看看。'];
  if (two) return [`有 ${two} 位和你两边都合适`, `你们都满足对方的“必须有”，名单里标着“双向”。下面是最符合你要求的 ${n} 位。`];
  if (all) return [`有 ${all} 位完全符合你的要求`, `下面是最符合你要求的 ${n} 位。`];
  if (n) return [`最接近你要求的 ${n} 位`, '还没人完全符合。点下面“为什么是这几位”，看差在哪。'];
  return ['还没人达到你的“必须有”', '把一两条“必须有”改成“很在意”试试。'];
}
// 每组的统计和“卡在哪”收起来，点开才看
const WHY = { ideal: '为什么是这几位', theirs: '你和他们差在哪', seekers: '他们为什么找你' };
const whyFold = (tab, html) => (html ? `<details class="more why-fold"><summary>${WHY[tab]}</summary>${html}</details>` : '');
// A、D 两组在名单上面先给一句话结论
const tabLead = (r, tab) => tab === 'theirs' && (r.idealOfIdeal || []).length ? `<p class="tab-lead">按你理想型的要求：<b>${placeA(r)}</b></p>`
  : tab === 'seekers' && r.seekers.length ? `<p class="tab-lead"><b>${r.summary.iFitCount ?? r.seekers.length} 位的“必须有”，你都满足</b></p>` : '';

async function renderResults() {
  const gen = routeGen;
  await saveChain;
  if (gen !== routeGen) return;
  if (!S.me.gender) return go('#/me/gender');
  if (!S.me.requirements?.length) return go('#/ideal/age');
  if (!S.me.consent?.scoring) return go('#/consent');
  if (!S.results) await renderCalc();
  const r = await loadResults();
  if (gen !== routeGen) return;
  if (S.tab === 'mutual') S.tab = 'ideal';
  const restoreY = /^#\/(match|ideal|me|privacy)/.test(S.prev || '') && S.resY != null ? S.resY : null;
  const s = r.summary;
  const few = s.counterpartCount === 0; // 真人模式刚上线，人还没有

  const [vt, vs] = verdict(r);
  paint(`<section class="res-head">
      <p class="ap-eyebrow rise">你的结果</p>
      <h1 class="display rise">${vt}</h1>
      <p class="res-sub rise">${vs}</p>
      ${few ? '' : '<div class="relmap rise" id="relmap" style="--i:1"></div>'}
    </section>
    <div class="tb-sentinel" aria-hidden="true"></div><div class="tabs-bar"><div class="tb-title" aria-hidden="true"><b>你的结果</b><span>${vt}</span></div><div class="tabs" role="tablist" aria-label="三组人">${['ideal', 'theirs', 'seekers'].map((k) => `<button role="tab" id="tab-${k}" aria-controls="tabpanel" tabindex="${S.tab === k ? 0 : -1}" data-tab="${k}" aria-selected="${S.tab === k}" class="g-${k} ${S.tab === k ? 'on' : ''}"><i class="tdot"></i>${REL[k]()}<b class="tl">${{ ideal: 'B', theirs: 'A', seekers: 'D' }[k]}</b></button>`).join('')}</div></div>
    <div id="tabpanel" role="tabpanel"></div>
    <div class="list-card edit-links">
      <a href="#/ideal/review"><span class="ico">${ic('edit')}</span><span class="t">改我的要求<span>${S.me.requirements?.length || 0} 条，改完马上重新算</span></span>${ic('next')}</a>
      <a href="#/me/review"><span class="ico">${ic('user')}</span><span class="t">改我填的资料<span>年龄、学历、家庭等</span></span>${ic('next')}</a>
    </div>
    <p class="disclaimer">只比较条件，不代表一个人好不好。</p>`, { wide: true });

  const panel = document.getElementById('tabpanel');
  // anim：用户切换页签或“一个个看 / 对照着看”时，新内容淡入上移（苹果切换分段控件时内容的过渡）
  const show = (tab, scroll, anim) => {
    S.tab = tab;
    view.querySelectorAll('.tabs [data-tab]').forEach((b) => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); b.tabIndex = b.dataset.tab === tab ? 0 : -1; });
    panel.setAttribute('aria-labelledby', `tab-${tab}`);
    panel.innerHTML = (r.summary.counterpartCount ? tabLead(r, tab) : '') + tabList(r, tab) + (r.summary.counterpartCount ? whyFold(tab, positionCard(tab, r)) : ''); panel.dataset.g = tab;
    // 记下每一行、每一句的真实高度：收起 / 展开按这个距离走，快慢才均匀（不用一个统一的大数）
    // 先一次读完所有高度，再一次写回（边读边写会让浏览器每一行都重新排版）
    const measure = () => { const els = [...panel.querySelectorAll('.cmp tr.same .cx, .cmp-block .same-line')]; const hs = els.map((el) => el.scrollHeight); els.forEach((el, i) => el.style.setProperty('--h', `${hs[i]}px`)); };
    measure();
    // 开关不重画页面：只切换一个类名，开关的圆点滑过去，相同的行折叠或展开
    panel.querySelectorAll('[data-diff]').forEach((b) => (b.onclick = () => {
      measure();
      S.diffOnly = !S.diffOnly; store.set('vier.diff', S.diffOnly ? '1' : '0');
      panel.querySelectorAll('[data-diff]').forEach((x) => x.setAttribute('aria-checked', S.diffOnly));
      panel.querySelectorAll('.cmp-block').forEach((k) => k.classList.toggle('diff-on', S.diffOnly));
    }));
    panel.querySelectorAll('[data-edit-req]').forEach((a) => (a.onclick = () => { S.returnTo = '#/results'; }));
    bindScrollHint(panel);
    panel.querySelectorAll(".cell-tap").forEach((b) => (b.onclick = () => b.setAttribute("aria-expanded", b.getAttribute("aria-expanded") !== "true")));
    panel.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => { if (S.view === b.dataset.view) return; S.view = b.dataset.view; store.set('vier.view', S.view); show(tab, false, true); panel.querySelector(`[data-view="${S.view}"]`)?.focus(); }));
    if (anim && !reduceMotion()) { panel.classList.remove('swap-in'); void panel.offsetWidth; panel.classList.add('swap-in'); }
    if (scroll) view.querySelector('.tabs').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { if (b.dataset.tab !== S.tab) show(b.dataset.tab, false, true); }));
  view.querySelector('.tabs').addEventListener('keydown', (e) => {
    const tabs = [...view.querySelectorAll('.tabs [data-tab]')], i = tabs.indexOf(document.activeElement);
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (i < 0 || j === undefined) return;
    e.preventDefault();
    const to = tabs[(j + tabs.length) % tabs.length];
    to.focus(); to.click();
  });
  show(S.tab);
  // 大标题滑出屏幕后，吸顶栏里才出现“你的结果 + 一句结论”（苹果商品页往下滑后顶部的商品名 + 价格）
  // 用页签栏正上方的一个“哨兵”判断：哨兵滑出屏幕顶 = 页签栏已经贴到顶上
  const bar = view.querySelector('.tabs-bar'), sentinel = view.querySelector('.tb-sentinel');
  if (bar && sentinel && 'IntersectionObserver' in window) {
    const io = watch(new IntersectionObserver(([e]) => bar.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 0)));
    io.observe(sentinel);
  }
  // 图上的三个圆和下面三个页签是同一件事：点哪边，另一边跟着走
  const map = few ? null : relMap(document.getElementById('relmap'), resultTree(r), { esc,
    // 点星球只换下面的名单、不滚走：让人看完星图展开；页签轻轻亮一下，提示下面也跟着换了
    onFocus: (n) => {
      if (!n.tab || n.tab === S.tab) return;
      show(n.tab, false, true);
      const b = view.querySelector(`.tabs [data-tab="${n.tab}"]`);
      if (b && !reduceMotion()) { b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); }
    },
    // 星图下方“看全部 N 位”：想看名单时才滚过去
    onList: () => view.querySelector('.tabs').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }),
    // 点一个人的星球：这颗星球飞到详情页顶上（浏览器支持视图过渡时），页面其余部分淡入淡出
    onOpen: (n, b) => {
      const dot = b.querySelector('.dot');
      if (!document.startViewTransition || reduceMotion() || !dot) return go(n.href);
      dot.style.viewTransitionName = 'pick';
      const root = document.documentElement;
      root.classList.add('vt-pick');
      const vt = document.startViewTransition(async () => {
        dot.style.viewTransitionName = ''; dir = 'fwd'; history.pushState(null, '', n.href); await route();
        // 过渡本身就是进场：关掉这一页自己的进场动画，否则过渡结束后会再播一遍（闪一下）
        document.querySelectorAll('.screen, .profile-top.rise').forEach((e) => { e.style.animation = 'none'; });
      });
      vt.finished.finally(() => root.classList.remove('vt-pick'));
    } });
  view.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { touched = true; map?.show(b.dataset.tab); }));
  // 先看一眼 A、B、你、D 的全景，再自动把镜头移到当前页签那一组的轨道；已经点过图或页签就不抢；从详情页回来、或减少动态效果时直接到轨道
  let touched = false;
  const mapEl = document.getElementById('relmap');
  mapEl?.addEventListener('pointerdown', () => { touched = true; }, { once: true });
  const toTab = () => { if (!touched && mapEl?.isConnected) map?.show(S.tab); };
  if (map) { if (restoreY != null || matchMedia('(prefers-reduced-motion: reduce)').matches) toTab(); else setTimeout(toTab, 1500); }
  if (restoreY != null) { dir = 'none'; requestAnimationFrame(() => window.scrollTo(0, restoreY)); }
}

// ---------- 人选详情：先讲“对方在找什么样的人”，分数和名次收起来 ----------
// 逐条对照：没对上的放前面、醒目；对上的收成一行，不抢眼
function checks(items, whoReq, whoVal) {
  const order = { 't-bad': 0, 't-warn': 1, 't-unk': 2, 't-good': 3 };
  const list = [...items].sort((a, b) => order[toneOf(a)] - order[toneOf(b)]);
  const good = list.filter((it) => toneOf(it) === 't-good'), rest = list.filter((it) => toneOf(it) !== 't-good');
  return `<div class="checks2">${rest.map((it) => {
    const [tone, icon, word] = STATUS[it.status] || ['t-unk', 'help', esc(nice(it.status))];
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

// 表格比屏幕宽时，下方右侧一对圆形左右箭头（苹果商品轮播的做法）：一次挪一个人，到头时那一侧变浅
const CMP_NAV = () => `<div class="cmp-nav" hidden><button type="button" class="cmp-prev" aria-label="往左看" disabled>${ic('back')}</button><button type="button" class="cmp-next" aria-label="往右看，看更多人">${ic('next')}</button></div>`;
function bindScrollHint(root = document) {
  root.querySelectorAll('.cmp-wrap').forEach((w) => {
    const upd = () => {
      const more = w.scrollWidth - w.clientWidth - w.scrollLeft > 4;
      w.classList.toggle('more-r', more);
      w.classList.toggle('more-l', w.scrollLeft > 4);
    };
    const nav = w.nextElementSibling?.classList.contains('cmp-nav') ? w.nextElementSibling : null;
    const prevB = nav?.querySelector('.cmp-prev'), nextB = nav?.querySelector('.cmp-next');
    const navUpd = () => {
      if (!nav) return;
      // 放不下才出现左右箭头；窗口变宽变窄、字体载入后宽度会变，每次都重新判断
      nav.hidden = w.scrollWidth <= w.clientWidth + 4;
      prevB.disabled = w.scrollLeft <= 4;
      nextB.disabled = w.scrollWidth - w.clientWidth - w.scrollLeft <= 4;
    };
    // 一步 = 一个人那一列的宽度
    const step = () => w.querySelector('thead th:last-child')?.getBoundingClientRect().width || w.clientWidth / 2;
    if (nav) {
      // 离头 / 尾不到半列时直接到底，不留一条缝让箭头还亮着
      const go = (d) => {
        const max = w.scrollWidth - w.clientWidth, s = step();
        let to = w.scrollLeft + d * s;
        if (to > max - s / 2) to = max;
        if (to < s / 2) to = 0;
        w.scrollTo({ left: to, behavior: reduceMotion() ? 'auto' : 'smooth' });
      };
      prevB.onclick = () => go(-1);
      nextB.onclick = () => go(1);
    }
    w.addEventListener('scroll', () => { upd(); navUpd(); }, { passive: true });
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => { upd(); navUpd(); }); observers.add(ro); ro.observe(w); const t = w.querySelector('table'); if (t) ro.observe(t); }
    document.fonts?.ready.then(() => { upd(); navUpd(); });
    upd(); navUpd();
  });
}

// 你和理想型的理想型逐条对照：第一列是你；和你不一样的格子标橙色
function aCompareTable(myFacts, list, mine, full = false) {
  const labels = [...new Set([...Object.keys(myFacts), ...list.flatMap((a) => Object.keys(a.facts))])];
  const known = (v) => v && v !== '未填写';
  const diff = (a, l) => known(a.facts[l]) && known(myFacts[l]) && a.facts[l] !== myFacts[l];
  const same = (l) => !list.some((a) => diff(a, l));
  return cmpGrid({
    cls: 'cmp-a', labels, same, full,
    heads: list.map((a) => `<th scope="col"><span class="al">${nameTag(a)}</span><b>${pctQ(a.score)}</b></th>`),
    firstHead: `<th scope="col" class="me-col"><span class="al">你</span>${mine ? `<b>${pctQ(mine)}</b>` : ''}</th>`,
    first: (l) => cxv(known(myFacts[l]) ? myFacts[l] : ''),
    cell: (i, l) => `<td class="${diff(list[i], l) ? 't-diff' : ''}">${cxv(known(list[i].facts[l]) ? list[i].facts[l] : '')}</td>`,
    sameNote: full ? '' : sameLine('和你一样', labels.filter((l) => same(l) && known(myFacts[l])).map((l) => lab(l))),
    hint: '橙色字 = 和你不一样',
  });
}

const pagerLink = (to, label, off, icon) => (off ? `<a aria-label="${label}" aria-disabled="true">${ic(icon)}</a>` : `<a href="${to}" aria-label="${label}">${ic(icon)}</a>`);
const detailNav = (idx, n, sfx) => `<div class="detail-nav">
      <button class="btn ghost sm" data-back="#/results">${ic('back')}返回</button>
      <div class="pager">${pagerLink(`#/match/${idx - 1}${sfx}`, '上一位', idx === 0, 'back')}${pagerLink(`#/match/${idx + 1}${sfx}`, '下一位', idx >= n - 1, 'next')}</div>
    </div>`;
// 三组都能进详情：#/match/序号 是“他适合你”，#/match/序号/seekers 或 /mutual 是另外两组
// 理想型的理想型：和你同性别，只读；只和你逐条对照
function renderTheirs(r, idx) {
  const list = r.idealOfIdeal || [], a = list[idx];
  if (!a) return go('#/results', 'back');
  const t = T(), n = list.length;
  paint(`${detailNav(idx, n, '/theirs')}
    <section class="profile-top rise">
      <span class="pick-orb" aria-hidden="true" style="${planetOf(`theirs-${idx}`, 'theirs')}"></span>
      <p class="grp-tag g-theirs">A · 理想型的理想型</p>
      <h1>${nameTag(a)}</h1>
      <p class="small muted" style="margin:2px 0 0">${subLine(a)} · 第 ${idx + 1} 位</p>
    </section>
    <p class="small muted" style="margin:14px 0 10px">用你的理想型的标准打分：${esc(a.name || 'TA')} ${pctQ(a.score)}，你 ${r.myPlaceA ? pctQ(r.myPlaceA.score) : '—'}。只能对照。</p>
    ${aCompareTable(r.myFacts || {}, [a], r.myPlaceA?.score, true)}
    <div class="stack" style="margin-top:22px"><button class="btn block" data-back="#/results">${ic('back')}返回</button></div>`);
  bindBack();
  bindScrollHint();
}

// 详情页的资料：全部列出、带名称（年收入、性格这些不再被截掉；“可协商”这类值单看看不懂是哪一项）
const specList = (facts) => {
  const rows = Object.entries(facts || {}).filter(([k]) => k !== '年龄' && k !== '常住城市');
  return rows.length ? `<dl class="spec rise" style="--i:1">${rows.map(([k, v]) => `<div><dt>${esc(lab(k))}</dt><dd>${esc(shortRange(nice(v)))}</dd></div>`).join('')}</dl>` : '';
};
async function renderMatch(idx, tab = 'ideal') {
  const gen = routeGen;
  const r = await loadResults();
  if (gen !== routeGen) return;
  S.tab = tab === 'seekers' || tab === 'theirs' ? tab : 'ideal';
  if (tab === 'theirs') return renderTheirs(r, idx);
  const list = { ideal: r.idealMatches, seekers: r.seekers, mutual: r.mutual }[tab] || r.idealMatches;
  const raw = list[idx];
  if (!raw) return go('#/results', 'back');
  const m = { theirPicks: [], theirIdeal: [], ...raw, myFitToThem: raw.mine || raw.myFitToThem };
  if (!m.fit || !m.myFitToThem?.items) return go('#/results', 'back');
  const t = T(), n = list.length, sfx = tab === 'ideal' ? '' : `/${tab}`;
  const top = m.myPlace ? m.myPlace.rankRange[1] : null;
  paint(`${detailNav(idx, n, sfx)}
    <section class="profile-top rise">
      <span class="pick-orb" aria-hidden="true" style="${planetOf(`${tab === 'seekers' ? 'seekers' : 'ideal'}-${idx}`, tab === 'seekers' ? 'seekers' : 'ideal')}"></span>
      <p class="grp-tag g-${tab === 'seekers' ? 'seekers' : 'ideal'}">${tab === 'seekers' ? 'D · 想找你这样的人' : 'B · 你的理想型'}</p>
      <h1>${nameTag(m)}</h1>
      <p class="small muted" style="margin:2px 0 0">${subLine(m)} · 第 ${idx + 1} 位</p>
    </section>
    ${specList(m.facts)}
    <div class="summary-card rise" style="--i:1">
      ${fitLine('你', t, m.fit.items, true)}
      ${fitLine(t, '你', m.myFitToThem.items, true)}
    </div>

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
  document.getElementById('more').addEventListener('toggle', (e) => {
    if (e.target.open) requestAnimationFrame(() => requestAnimationFrame(() => view.querySelectorAll('.ring .fg').forEach((c) => (c.style.strokeDashoffset = 289 * (1 - Number(c.dataset.v) / 100)))));
  });
}

// ---------- 弹层 ----------
// 确认弹层：标题、一句说明、“确定”和“取消”；取消已接好，“确定”（#yes）由调用方接
const askSheet = (title, text, yes, { danger = false, no = '再想想', pre = '' } = {}) => {
  const m = sheet(`<h2>${title}</h2><p class="lead">${text}</p><div class="stack">${pre}<button class="btn ${danger ? 'danger' : 'primary'} block" id="yes">${yes}</button><button class="btn block" id="no">${no}</button></div>`);
  m.el.querySelector('#no').onclick = m.close;
  return m;
};
let sheetN = 0;
function sheet(html) {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><button class="close" aria-label="关闭">${ic('x')}</button>${html}</div>`;
  const title = el.querySelector('h2');
  if (title) { title.id = `sheet-t${++sheetN}`; el.firstElementChild.setAttribute('aria-labelledby', title.id); }
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
  const onKey = (e) => {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const f = [...el.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent);
    if (!f.length) return;
    const [first, last] = [f[0], f[f.length - 1]];
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey);
  el.querySelector('.close').onclick = close;
  el.onclick = (e) => { if (e.target === el) close(); };
  el.querySelector('.close').focus();
  const m = { el, close, onclose: null };
  return m;
}

// ---------- 恢复码 ----------
// 没有账号密码：存一个恢复码，换手机时输入就能回到原来的资料。明文只显示这一次。
function openRecovery() {
  const again = !!S.me?.hasRecovery;
  const m = sheet(`<div id="rc"><h2>${again ? '重新生成恢复码' : '恢复码'}</h2>
    <p class="lead">换手机或清了浏览器，输入恢复码就能找回你的资料。${again ? '生成新的以后，旧的就不能用了。' : ''}</p>
    <div class="stack"><button class="btn primary block" id="rc-go">${again ? '生成新的恢复码' : '生成恢复码'}</button><button class="btn block" id="rc-no">先不用</button></div></div>`);
  m.el.querySelector('#rc-no').onclick = m.close;
  m.el.querySelector('#rc-go').onclick = async (ev) => {
    const b = ev.currentTarget; b.classList.add('loading');
    try {
      const { code } = await api('POST', '/api/me/recovery');
      S.me.hasRecovery = true;
      m.el.querySelector('#rc').innerHTML = `<h2>你的恢复码</h2>
        <p class="rc-code mono" id="rc-code">${esc(code)}</p>
        <p class="lead">抄下来或截个图。只显示这一次，我们也查不到。谁拿到它，谁就能看到你的资料。</p>
        <div class="stack"><button class="btn primary block" id="rc-copy">${ic('check')}复制</button><button class="btn block" id="rc-ok">我记好了</button></div>`;
      m.el.querySelector('#rc-copy').onclick = () => navigator.clipboard?.writeText(code).then(() => toast('已复制'), () => toast('复制不了，请手动抄下来'));
      m.el.querySelector('#rc-ok').onclick = m.close;
    } catch (e) { b.classList.remove('loading'); toast(e.message); }
  };
  return m;
}

// 在新设备上输入恢复码：换成那个账户的令牌，这台设备上刚填的资料不保留
function renderRecover() {
  const back = S.prev && !/recover/.test(S.prev) ? S.prev : '#/';
  const lose = !!S.me?.gender;
  paint(`${simpleHead(back, '找回资料')}
    <h1 class="q" id="qt">输入恢复码</h1>
    <p class="qhint">${ic('lock')}12 位，不分大小写。${lose ? '找回后，这台设备上刚填的资料不保留。' : ''}</p>
    <input class="text-input mono" id="rcin" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="XXXX-XXXX-XXXX" aria-label="恢复码">
    <p class="err" id="rcerr" hidden></p>
    <div class="qfoot"><button class="btn primary block" id="rcgo">找回 ${ic('arrow')}</button></div>`);
  bindBack();
  const input = document.getElementById('rcin'), err = document.getElementById('rcerr'), btn = document.getElementById('rcgo');
  input.focus();
  input.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
  btn.onclick = async () => {
    btn.classList.add('loading'); err.hidden = true;
    try {
      const res = await fetch('/api/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: input.value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '出错了');
      resetSession();
      store.set('vier.token', data.token);
      await ensureSession();
      toast('已找回你的资料');
      go(resumeHash());
    } catch (e) { btn.classList.remove('loading'); err.textContent = e.message; err.hidden = false; }
  };
}

// ---------- 管理后台：用户列表、删除用户 ----------
async function adminApi(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-admin-token': store.get('vier.admin') || '' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '出错了'), { status: res.status });
  return data;
}
const who = (p) => p ? `${p.virtual ? '<span class="badge sim">虚拟</span> ' : ''}${esc([p.gender, p.age && `${p.age} 岁`, p.city, p.occupation].filter(Boolean).join(' · ') || '资料未填')}` : '<span class="muted">已删除</span>';
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

function adminUserRow(u) {
  const tags = [
    u.pool ? '<span class="badge">在人选池</span>' : '',
    u.recovery ? '<span class="badge l3">存了恢复码</span>' : '',
    u.filled ? '' : '<span class="badge">资料未填完</span>',
  ].join('');
  return `<div class="pcard admin-user" data-uid="${esc(u.id)}">
    <div class="row wrap" style="justify-content:space-between"><b>${who(u)}</b><span class="small muted">活跃 ${fmtTime(u.lastActiveAt)}</span></div>
    <div class="row wrap" style="margin-top:8px;gap:6px">${tags}</div>
    <p class="small muted" style="margin:4px 0 0"><span class="mono">${esc(u.id)}</span></p>
    <div class="row wrap" style="margin-top:10px;gap:8px"><button class="btn sm" data-act="view">查看全部资料</button><button class="btn ghost sm" data-act="delete">删除</button></div></div>`;
}

async function renderAdmin() {
  let data;
  const gen = routeGen;
  try { data = await adminApi('GET', '/api/admin/overview'); } catch (e) {
    if (gen !== routeGen) return;
    paint(`<h1 class="q" id="qt">管理后台</h1><p class="qhint">${ic('lock')}输入管理员口令（服务器的环境变量 ADMIN_TOKEN；测试环境没设时是 admin）</p>
      <input class="text-input" id="tok" type="password" autocomplete="off"><div class="stack" style="margin-top:12px"><button class="btn primary block" id="go">进入</button></div>${e.status === 401 && store.get('vier.admin') ? '<p class="err">口令不对</p>' : `<p class="err">${e.status === 401 ? '' : esc(e.message)}</p>`}`);
    document.getElementById('go').onclick = () => { store.set('vier.admin', document.getElementById('tok').value.trim()); dir = 'none'; renderAdmin(); };
    return;
  }
  const q = (S.adminQ || '').trim();
  const users = data.users.filter((u) => !q || [u.id, u.city, u.occupation].join(' ').includes(q));
  if (gen !== routeGen) return;
  const counts = { users: data.users.length, pool: data.users.filter((u) => u.pool).length, recovery: data.users.filter((u) => u.recovery).length };
  paint(`<div class="row" style="justify-content:space-between"><h1 class="q" style="margin:0">管理后台</h1><button class="btn ghost sm" id="out">退出</button></div>
    ${data.testMode ? `<p class="qhint">${ic('info')}测试环境：用户界面不标虚拟人选。</p>` : ''}
    <div class="admin-stats"><div><b>${counts.users}</b><span>用户</span></div><div><b>${counts.pool}</b><span>在人选池</span></div><div><b>${counts.recovery}</b><span>存了恢复码</span></div></div>
    <input class="text-input" id="aq" type="search" placeholder="按城市、职业、用户 id 搜索" value="${esc(q)}" style="margin-top:16px">
    <div class="cards" style="margin-top:12px">${users.map((u) => adminUserRow(u)).join('') || '<p class="muted">没有符合的用户。</p>'}</div>`, { wide: true });

  const again = () => { dir = 'none'; renderAdmin(); };
  document.getElementById('out').onclick = () => { store.del('vier.admin'); again(); };
  const aq = document.getElementById('aq');
  aq.onchange = () => { S.adminQ = aq.value; again(); };
  const ask = (title, text, label, danger, fn) => {
    const m = sheet(`<h2>${title}</h2><p class="lead">${text}</p><input class="text-input" id="why" placeholder="理由（会记入审计日志）"><p class="err" id="whyerr" hidden></p>
      <div class="stack" style="margin-top:12px"><button class="btn ${danger ? 'danger' : 'primary'} block" id="yes">${label}</button><button class="btn block" id="no">取消</button></div>`);
    m.el.querySelector('#no').onclick = m.close;
    m.el.querySelector('#yes').onclick = async (ev) => {
      const b = ev.currentTarget; b.classList.add('loading');
      try { await fn(m.el.querySelector('#why').value.trim()); m.close(); } catch (e) { b.classList.remove('loading'); const er = m.el.querySelector('#whyerr'); er.textContent = e.message; er.hidden = false; }
    };
  };
  view.querySelectorAll('.admin-user [data-act="view"]').forEach((b) => (b.onclick = async () => {
    const id = b.closest('.admin-user').dataset.uid;
    b.classList.add('loading');
    try { adminDetail(await adminApi('GET', `/api/admin/users/${id}`)); } catch (e) { toast(e.message); } finally { b.classList.remove('loading'); }
  }));
  view.querySelectorAll('.admin-user [data-act="delete"]').forEach((b) => (b.onclick = () => {
    const id = b.closest('.admin-user').dataset.uid;
    ask('永久删除这个用户？', '资料、要求、恢复码全部删除，不能恢复。', '永久删除', true, async (reason) => { await adminApi('DELETE', `/api/admin/users/${id}`, { reason }); toast('已删除'); again(); });
  }));
}

// 管理后台：一个用户的全部资料和全部要求，按组列出，没填的灰色显示“未填写”
function adminDetail(d) {
  const table = (rows, val) => {
    let g = '';
    return `<table class="admin-kv">${rows.map((r) => `${r.group !== g ? `<tr class="ag"><th colspan="2">${esc((g = r.group))}</th></tr>` : ''}<tr class="${r.filled ? '' : 'nf'}"><td>${esc(r.label)}</td><td>${val(r)}</td></tr>`).join('')}</table>`;
  };
  const c = d.consent;
  const m = sheet(`<h2>${who(d)}</h2>
    <p class="small muted" style="margin:4px 0 0"><span class="mono">${esc(d.id)}</span>${d.nickname ? ` · 昵称 ${esc(d.nickname)}` : ''}</p>
    <p class="small muted" style="margin:4px 0 0">注册 ${fmtTime(d.createdAt)} · 活跃 ${fmtTime(d.lastActiveAt)}${c ? ` · ${c.pool ? '同意进人选池' : '不进人选池'}` : ''}${d.recovery ? ' · 存了恢复码' : ''}</p>
    <h3 style="margin:20px 0 6px">本人资料</h3>${table(d.profile, (r) => esc(r.value))}
    <h3 style="margin:20px 0 6px">对另一半的要求</h3>${table(d.requirements, (r) => esc(r.text) + (r.importance ? ` <span class="badge">${esc(r.importance)}</span>` : ''))}
    <div class="stack" style="margin-top:16px"><button class="btn block" id="no">关闭</button></div>`);
  m.el.querySelector('#no').onclick = m.close;
}

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
    ['恢复码', '恢复码等于你的钥匙。谁拿到它，谁就能看到你的资料。请自己保管好，不要发给别人。'],
    ['免费', '全部功能免费，不收钱。'],
    ['不能做的事', '不能批量抓取页面、反复改要求来“扫”别人，不能把看到的信息拿去别处用。'],
    ['改动', '协议改了会在这里更新，重要的改动会提醒你。'],
  ]],
  policy: ['隐私政策', [
    ['我们收什么', '你填的资料和要求；你同意了哪些事、什么时候同意的。不收手机号、照片和身份证。'],
    ['为什么收', '只为了帮你找人、帮别人找到你（你同意后），以及你同意的匿名统计。'],
    ['敏感信息', '收入、家里的情况属于敏感信息。别人只能看到大概的档位或“是否符合”，看不到原值。'],
    ['怎么存', '全部加密存在中国境内的服务器上。恢复码只存加密后的样子，我们也看不到原码。'],
    ['谁能看到', '别人只看到你的代号，每个人看到的代号都不一样。不卖给任何第三方。'],
    ['存多久', '一年没用就自动删除。你也可以随时在“我的资料”里下载或永久删除。'],
    ['你的权利', '随时查看、修改、下载、删除你的资料，随时关掉“让别人也能找到我”。'],
    ['未成年人', '不满 18 岁请不要使用。发现后会删除相关资料。'],
  ]],
};
function renderLegal(k) {
  const [title, items] = LEGAL[k];
  const back = S.prev && !/terms|policy/.test(S.prev) ? S.prev : '#/';
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${back}">${ic('back')}返回</button></div>
    <h1 class="q" id="qt">${title}</h1>
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
  // 从哪来回哪去；从“我的资料”里点进去的子页面（改资料、找回、协议）回来时，不改原来的去处
  if (!/^#\/(me\/|ideal\/|recover|terms|policy)/.test(S.prev || '')) S.privacyFrom = /^#\/(results|match)/.test(S.prev || '') ? S.prev : (S.prev ? '#/' : (st === 'done' ? '#/results' : '#/'));
  paint(`<div class="detail-nav"><button class="btn ghost sm" data-back="${S.privacyFrom || '#/'}">${ic('back')}返回</button></div>
    <h1 class="q" id="qt">我的资料</h1>
    <p class="qhint">${ic('lock')}你的资料加密保存。</p>
    ${st !== 'done' ? `<a class="btn primary block" href="${resumeHash()}" style="margin-bottom:8px">${st === 'new' ? '开始填写' : '继续填写'} ${ic('arrow')}</a>` : ''}
    <div class="list-card">
      <a href="#/me/review"><span class="ico">${ic('user')}</span><span class="t">我填的资料<span>年龄、学历、家庭等，点进去可以改</span></span>${ic('next')}</a>
      <a href="${S.me.requirements?.length ? '#/ideal/review' : '#/ideal/age'}"><span class="ico">${ic('heart')}</span><span class="t">我的要求<span>${S.me.requirements?.length || 0} 条</span></span>${ic('next')}</a>
      <button id="rcode"${S.me.local ? ' disabled' : ''}><span class="ico">${ic('lock')}</span><span class="t">恢复码<span>${S.me.local ? '完成验证后可以生成' : S.me.hasRecovery ? '已经存过。丢了可以重新生成' : '存一个，换手机也能找回'}</span></span>${ic('next')}</button>
      <a href="#/recover"><span class="ico">${ic('users')}</span><span class="t">用恢复码找回<span>在这台设备上换回原来的资料</span></span>${ic('next')}</a>
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
  document.getElementById('rcode').onclick = () => openRecovery().onclose = () => { dir = 'none'; renderPrivacy(); };
  const form = document.getElementById('f');
  form.addEventListener('change', async () => {
    try {
      const next = { scoring: form.scoring.checked, pool: form.pool.checked, research: form.research.checked };
      if (S.me.local) { S.me.consent = { ...(S.me.consent || {}), ...next }; saveDraft(); toast('已存在这台设备上'); return; }
      await api('PUT', '/api/me/consent', next);
      S.me = await api('GET', '/api/me');
      S.results = null;
      toast(form.scoring.checked ? '已保存' : '已保存。要看结果时，需要重新打开第一项');
    } catch (e) { toast(e.message); if (/18/.test(e.message)) go('#/consent'); }
  });
  document.getElementById('export').onclick = async () => {
    try {
      const data = S.me.local ? { exportedAt: new Date().toISOString(), draft: Object.fromEntries(DRAFT_KEYS.map((k) => [k, S.me[k]])) } : await api('GET', '/api/me/export');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = 'vier-my-data.json';
      a.click();
      toast('已开始下载');
    } catch (e) { toast(e.message); }
  };
  document.getElementById('delete').onclick = () => {
    const m = askSheet('确定要删除吗？', '你的资料、要求、同意记录都会从服务器上永久删除，<b>不能恢复</b>。', `${ic('trash')}确定删除`, { danger: true, no: '先不删' });
    m.el.querySelector('#yes').onclick = async (ev) => {
      ev.currentTarget.classList.add('loading');
      try {
        if (!S.me.local) await api('DELETE', '/api/me');
        resetSession();
        m.close();
        paint(milestone('已经删除', '你的全部资料都已从服务器上删除。', '', `<a class="btn primary block" href="#/">回到首页</a>`));
      } catch (e) { toast(e.message); m.close(); }
    };
  };
}

// ---------- 路由 ----------
async function route() {
  // 离开结果页时记住滚到哪了；从详情、改要求、改资料回来时回到原处、原页签
  if (/^#\/results/.test(S.cur || '')) S.resY = window.scrollY;
  S.prev = S.cur; S.cur = location.hash; // 记住从哪一页来，确认页的返回键要用
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a = '', b = ''] = h.split('/');
  const gen = ++routeGen;
  try {
    if (!S.config) {
      S.config = await api('GET', '/api/config');
      S.F = Object.fromEntries(S.config.fields.map((f) => [f.key, f]));
      // 页面比服务端新时（部署间隙），服务端还不认识的题先不问，免得整页报错
      for (const list of [P1, P2, I1, I2]) for (let i = list.length - 1; i >= 0; i--) if (list[i] !== 'gender' && !S.F[list[i]]) list.splice(i, 1);
      renderFoot();
      if (gen !== routeGen) return;
    }
    if (a === '') return await renderHome();
    if (a === 'intro') return renderIntro();
    if (a === 'admin') return await renderAdmin();
    if (a === 'terms' || a === 'policy') return renderLegal(a);
    if (a === 'recover') return renderRecover();
    if (!S.me) { await ensureSession(); if (gen !== routeGen) return; }
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
    if (a === 'verify') return renderVerify();
    // 没过验证就没有服务器上的结果：先去把剩下的填完或输验证码
    if (S.me.local && (a === 'results' || a === 'match')) return go(resumeHash());
    if (a === 'results') return await renderResults();
    if (a === 'match') return await renderMatch(Number(b), h.split('/')[3] || 'ideal');
    if (a === 'privacy') return renderPrivacy();
    return await renderHome();
  } catch (e) {
    paint(`<section class="milestone"><h1 class="display">出了点小问题</h1><p class="lead">${esc(e.message)}</p>
      <div class="stack"><button class="btn primary block" id="retry">再试一次</button><a class="btn block" href="#/">回到首页</a></div></section>`);
    document.getElementById('retry').onclick = () => route();
  } finally {
    if (gen === routeGen) {
      if (dir !== 'none') window.scrollTo(0, 0);
      if (!view.contains(document.activeElement) && !document.querySelector('.modal')) view.focus({ preventScroll: true });
      dir = 'fwd';
      requestAnimationFrame(placeToast);
    }
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

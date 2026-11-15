// VIER 前端：hash 路由，每个步骤是独立页面。所有打分在服务端完成。
const view = document.getElementById('view');
const S = { config: null, me: null, results: null, error: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 隐私模式下忽略 */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* */ } },
};

async function api(method, path, body) {
  const token = store.get('vier.token');
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'), { status: res.status });
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

const F = () => Object.fromEntries(S.config.fields.map((f) => [f.key, f]));
const wan = (yuan) => Math.round((yuan / 10000) * 10) / 10;
const score = (t) => (t.low === t.high ? `${Math.round(t.low)}` : `${Math.round(t.low)}–${Math.round(t.high)}`);
const IMPORTANCE = [['1', '灵活'], ['2', '重要'], ['3', '很重要'], ['must', '必须']];
const OPS = { range: '范围', atLeast: '至少', atMost: '至多', about: '约' };

// ---------- 示例数据（一键填入，便于快速验证） ----------
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
      { field: 'heightCm', op: 'atLeast', target: 175, importance: 2 },
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
const demoFor = (g) => DEMO[g === 'male' ? 'male' : 'female'];

// 一键体验：直接保存示例资料、理想型和计算同意，然后看结果
async function runFullDemo(gender) {
  await ensureSession();
  const d = demoFor(gender);
  await api('PUT', '/api/me/profile', { gender, profile: d.profile, identity: { nickname: d.nickname } });
  await api('PUT', '/api/me/requirements', { requirements: d.requirements });
  if (!S.me.consent?.scoring) await api('PUT', '/api/me/consent', { scoring: true, pool: false, research: false });
  S.me = await api('GET', '/api/me');
  S.results = null;
  location.hash = '#/results';
}

// ---------- 首页 ----------
function renderHome() {
  view.innerHTML = `
  <section class="hero">
    <p class="eyebrow">VIER TEST</p>
    <h1>你的理想型，想找谁？</h1>
    <p class="lead">把择偶期待放进现实里看：你想遇见的人是谁，他们又在找什么样的人，谁的要求恰好是你。</p>
    ${zMap()}
    <ol class="steps">
      <li><b>关于你</b>写下自己的情况，可以跳过任何一项。</li>
      <li><b>你的理想型</b>每项分清“必须、很重要、重要、灵活”。</li>
      <li><b>看结果</b>五组反馈，每个分数都能看到逐项依据。</li>
    </ol>
    <div class="actions">
      <a class="btn primary" href="#/me">开始</a>
      <button class="btn" data-demo="female">一键体验（女性示例）</button>
      <button class="btn" data-demo="male">一键体验（男性示例）</button>
    </div>
    <p class="fine">一键体验会自动填入示例资料和理想型，直接生成结果，方便快速验证。之后可以在“关于你”“理想型”里随意修改。</p>
  </section>`;
  view.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = () => runFullDemo(b.dataset.demo).catch((e) => { view.insertAdjacentHTML('beforeend', `<p class="err">${esc(e.message)}</p>`); })));
}

function zMap(r) {
  const n = (k) => (r ? ` · ${k}` : '');
  const m = r?.idealMatches?.length ?? '', s = r?.seekers?.length ?? '', mu = r?.mutual?.length ?? '';
  return `
  <figure class="zmap" aria-label="关系图">
    <svg viewBox="0 0 320 190" role="img">
      <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
      <path d="M210 40 L112 40" class="ln" marker-end="url(#ar)"/>
      <path d="M78 150 L232 52" class="ln" marker-end="url(#ar)"/>
      <path d="M250 150 L110 150" class="ln dash" marker-end="url(#ar)"/>
    </svg>
    <a class="node tl" href="#/results">TA 心中的人选</a>
    <a class="node tr" href="#/results">理想型人选${n(m)}</a>
    <a class="node bl me" href="#/me">你</a>
    <a class="node br" href="#/results">在找你的人${n(s)}</a>
    <figcaption>你 → 理想型人选 → TA 心中的人选；在找你的人 → 你。两头都对上的人，是“双向相合”${r ? `（${mu} 位）` : ''}。</figcaption>
  </figure>`;
}

// ---------- 关于你 ----------
function profileInput(f, v) {
  const name = `p_${f.key}`;
  const unk = `<option value="不愿透露" ${v === '不愿透露' ? 'selected' : ''}>不愿透露</option>`;
  if (f.type === 'number') return `<input type="number" name="${name}" inputmode="numeric" value="${esc(typeof v === 'number' ? v : '')}" placeholder="${esc(f.unit)}">`;
  if (f.type === 'money' && f.bands) {
    return `<select name="${name}"><option value="">未填写</option>${Object.keys(f.bands).map((b) => `<option ${v === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}${unk}</select>`;
  }
  if (f.type === 'money') return `<span class="unit"><input type="number" step="0.1" name="${name}" value="${typeof v === 'number' ? wan(v) : ''}" placeholder="如 15"> 万元/年</span>`;
  const opts = f.levels || f.options;
  return `<select name="${name}"><option value="">未填写</option>${opts.map((o) => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}${unk}</select>`;
}

function renderMe() {
  const p = S.me.profile || {};
  const groups = {};
  for (const f of S.config.fields) (groups[f.group] ||= []).push(f);
  view.innerHTML = `
  <section class="page">
    <p class="eyebrow">第 1 步 / 3</p>
    <h1>关于你</h1>
    <p class="lead">只有“性别”必填。不愿意说的就跳过，或选“不愿透露”；没填的项目按“未知”处理，不会当成 0 分。</p>
    <div class="demo-bar">快速验证：<button type="button" class="btn small" data-fill="female">填入女性示例</button><button type="button" class="btn small" data-fill="male">填入男性示例</button></div>
    <form id="f-me" class="form">
      <fieldset><legend>基本</legend>
        <label>性别<select name="gender" required><option value="">请选择</option>
          <option value="female" ${S.me.gender === 'female' ? 'selected' : ''}>女性（寻找男性）</option>
          <option value="male" ${S.me.gender === 'male' ? 'selected' : ''}>男性（寻找女性）</option></select></label>
        <label>昵称（可选，只给你自己看）<input name="nickname" maxlength="20" value="${esc(S.me.identity?.nickname || '')}"></label>
      </fieldset>
      ${Object.entries(groups).map(([g, fs]) => `
      <fieldset><legend>${esc(S.config.groups[g])}</legend>
        ${fs.map((f) => `<label>${esc(f.label)}${f.tier === 'L2' ? ' <small class="tag">敏感 · 不向他人展示原值</small>' : ''}${profileInput(f, p[f.key])}</label>`).join('')}
      </fieldset>`).join('')}
      <p class="err" id="err"></p>
      <div class="actions"><button class="btn primary">保存，下一步</button></div>
    </form>
  </section>`;
  view.querySelectorAll('[data-fill]').forEach((b) => (b.onclick = () => {
    const d = demoFor(b.dataset.fill);
    S.me = { ...S.me, gender: b.dataset.fill, profile: { ...d.profile }, identity: { nickname: d.nickname } };
    renderMe(); // 只填入表单，点“保存”后才会提交
  }));
  document.getElementById('f-me').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const profile = {};
    for (const f of S.config.fields) {
      const raw = fd.get(`p_${f.key}`);
      if (raw === null || raw === '') continue;
      if (f.type === 'number') profile[f.key] = Number(raw);
      else if (f.type === 'money' && !f.bands && raw !== '不愿透露') profile[f.key] = Math.round(Number(raw) * 10000);
      else profile[f.key] = raw;
    }
    try {
      await api('PUT', '/api/me/profile', { gender: fd.get('gender'), profile, identity: { nickname: fd.get('nickname') } });
      S.me = await api('GET', '/api/me');
      S.results = null;
      location.hash = '#/ideal';
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

// ---------- 你的理想型 ----------
function reqEditor(f, r) {
  const on = !!r;
  const imp = r ? String(r.importance) : '2';
  const impSel = `<select name="imp_${f.key}">${IMPORTANCE.map(([v, l]) => `<option value="${v}" ${imp === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  let body = '';
  if (f.type === 'number' || f.type === 'money') {
    const conv = (x) => (x === undefined || x === null ? '' : f.type === 'money' ? wan(x) : x);
    const t = r?.target;
    const op = r?.op || f.ops[0];
    const a = Array.isArray(t) ? conv(t[0]) : conv(t), b = Array.isArray(t) ? conv(t[1]) : '';
    body = `<select name="op_${f.key}" data-op>${f.ops.map((o) => `<option value="${o}" ${o === op ? 'selected' : ''}>${OPS[o]}</option>`).join('')}</select>
      <input type="number" step="any" name="a_${f.key}" value="${a}" placeholder="${f.type === 'money' ? '万元' : esc(f.unit)}">
      <input type="number" step="any" name="b_${f.key}" value="${b}" placeholder="到" ${op === 'range' ? '' : 'hidden'}>
      <span class="hint">${f.type === 'money' ? '万元' : esc(f.unit)}</span>`;
  } else if (f.type === 'ordinal') {
    body = `至少 <select name="t_${f.key}">${f.levels.map((l) => `<option ${r?.target === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else {
    const sel = new Set(r?.target || []);
    body = `<div class="chips">${f.options.map((o) => `<label class="chip"><input type="checkbox" name="c_${f.key}" value="${esc(o)}" ${sel.has(o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div>`;
  }
  return `<div class="req ${on ? 'on' : ''}" data-key="${f.key}">
    <label class="req-head"><input type="checkbox" name="on_${f.key}" ${on ? 'checked' : ''}> <b>${esc(f.label)}</b></label>
    <div class="req-body">${body}<label class="imp">重视程度 ${impSel}</label></div>
  </div>`;
}

function renderIdeal() {
  if (!S.me.gender) { location.hash = '#/me'; return; }
  const byField = Object.fromEntries((S.me.requirements || []).map((r) => [r.field, r]));
  view.innerHTML = `
  <section class="page">
    <p class="eyebrow">第 2 步 / 3</p>
    <h1>你的理想型</h1>
    <p class="lead">只勾选你真的在意的项目。<b>必须</b>是门槛，不满足就不进入结果，别的条件再好也不能抵消；其他等级决定权重。</p>
    <div class="demo-bar">快速验证：<button type="button" class="btn small" data-fill-ideal>填入示例理想型</button></div>
    <form id="f-ideal" class="form">
      ${S.config.fields.map((f) => reqEditor(f, byField[f.key])).join('')}
      <p class="err" id="err"></p>
      <div class="actions"><a class="btn" href="#/me">上一步</a><button class="btn primary">保存，下一步</button></div>
    </form>
  </section>`;
  view.querySelector('[data-fill-ideal]').onclick = () => {
    S.me = { ...S.me, requirements: demoFor(S.me.gender).requirements.map((r) => ({ ...r })) };
    renderIdeal(); // 只填入表单，点“保存”后才会提交
  };
  const form = document.getElementById('f-ideal');
  form.addEventListener('change', (e) => {
    if (e.target.name?.startsWith('on_')) e.target.closest('.req').classList.toggle('on', e.target.checked);
    if (e.target.hasAttribute('data-op')) form.querySelector(`[name=b_${e.target.name.slice(3)}]`).hidden = e.target.value !== 'range';
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const reqs = [];
    for (const f of S.config.fields) {
      if (!fd.get(`on_${f.key}`)) continue;
      const imp = fd.get(`imp_${f.key}`);
      const r = { field: f.key, importance: imp === 'must' ? 'must' : Number(imp) };
      if (f.type === 'number' || f.type === 'money') {
        const m = f.type === 'money' ? 10000 : 1;
        r.op = fd.get(`op_${f.key}`);
        const a = Number(fd.get(`a_${f.key}`)) * m, b = Number(fd.get(`b_${f.key}`)) * m;
        r.target = r.op === 'range' ? [a, b] : a;
      } else if (f.type === 'ordinal') { r.op = 'atLeast'; r.target = fd.get(`t_${f.key}`); }
      else { r.op = 'in'; r.target = fd.getAll(`c_${f.key}`); }
      reqs.push(r);
    }
    try {
      if (!reqs.length) throw new Error('至少勾选一项要求');
      await api('PUT', '/api/me/requirements', { requirements: reqs });
      S.me = await api('GET', '/api/me');
      S.results = null;
      location.hash = S.me.consent?.scoring ? '#/results' : '#/consent';
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

// ---------- 同意 ----------
function renderConsent() {
  const c = S.me.consent || {};
  view.innerHTML = `
  <section class="page">
    <p class="eyebrow">第 3 步 / 3</p>
    <h1>你的资料怎么用，由你决定</h1>
    <form id="f-c" class="form consent">
      <label><input type="checkbox" name="scoring" ${c.scoring ? 'checked' : ''}> <b>用我的资料计算我的结果</b>（必选）<br><small>只在服务端计算，资料加密保存。</small></label>
      <label><input type="checkbox" name="pool" ${c.pool ? 'checked' : ''}> <b>让我以匿名代号出现在别人的结果里</b>（可选）<br><small>别人只能看到年龄、身高、城市等基础项，收入只显示分档，家庭情况只显示“是否符合”；你的理想型要求会匿名展示。随时可以关闭。</small></label>
      <label><input type="checkbox" name="research" ${c.research ? 'checked' : ''}> <b>用于匿名统计</b>（可选）<br><small>只用于人数不少于 10 人的汇总分布，不会单独展示你的资料。</small></label>
      <p class="fine">同意版本 ${esc(S.config.consentVersion)}。你可以在“我的数据”里导出或永久删除全部资料。</p>
      <p class="err" id="err"></p>
      <div class="actions"><a class="btn" href="#/ideal">上一步</a><button class="btn primary">看结果</button></div>
    </form>
  </section>`;
  document.getElementById('f-c').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      if (!fd.get('scoring')) throw new Error('需要同意计算才能生成结果');
      await api('PUT', '/api/me/consent', { scoring: true, pool: !!fd.get('pool'), research: !!fd.get('research') });
      S.me = await api('GET', '/api/me');
      location.hash = '#/results';
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
}

// ---------- 结果 ----------
async function loadResults(force) {
  if (!S.results || force) S.results = await api('GET', '/api/me/results');
  return S.results;
}

const cardFacts = (c) => Object.entries(c.facts).slice(0, 6).map(([k, v]) => `<span>${esc(v)}</span>`).join('');
const simTag = (c) => (c.simulated ? '<small class="tag sim">模拟</small>' : '');

function personCard(c, extra, href) {
  return `<a class="card" ${href ? `href="${href}"` : ''}>
    <div class="card-head"><b>${esc(c.gender)} · ${esc(c.alias)}</b>${simTag(c)}</div>
    <div class="facts">${cardFacts(c)}</div>
    ${extra}
  </a>`;
}

const meter = (label, t, note) => `<div class="meter"><span>${label}</span><b>${score(t)}</b>${note ? `<small>${note}</small>` : ''}<i style="--v:${t.low}%"></i></div>`;

async function renderResults() {
  if (!S.me.gender || !S.me.requirements?.length) { location.hash = S.me.gender ? '#/ideal' : '#/me'; return; }
  if (!S.me.consent?.scoring) { location.hash = '#/consent'; return; }
  view.innerHTML = '<p class="loading">正在计算…</p>';
  const r = await loadResults();
  const s = r.summary;
  const plan = S.config.plans[r.plan];
  view.innerHTML = `
  <section class="page wide">
    <p class="eyebrow">你的结果 · ${esc(plan.label)}（每组最多 ${plan.matches} 位）</p>
    <h1>沿着关系图看</h1>
    ${zMap(r)}
    <div class="summary">
      <div><b>${s.matchesEligible}</b><span>位通过你的门槛</span></div>
      <div><b>${s.iFitCount}</b><span>位的理想型你也符合</span></div>
      <div><b>${s.mutualCount}</b><span>位双向相合</span></div>
      ${s.avgMyFitToMatches ? `<div><b>${score(s.avgMyFitToMatches)}</b><span>你与理想型人选的理想型平均契合度</span></div>` : ''}
    </div>
    <p class="fine">共对照 ${s.counterpartCount} 份档案。${s.matchesPending ? `${s.matchesPending} 位因资料不全待核实，未进入排序。` : ''}${s.seekersExcludedFewRequirements ? `${s.seekersExcludedFewRequirements} 位要求少于 3 项，容易“满分”，没有放进“在找你的人”。` : ''}</p>

    <h2>理想型人选 <small>最接近你理想型的人。点开看 TA 自己的理想型，以及你符合多少。</small></h2>
    <div class="grid">${r.idealMatches.map((m, i) => personCard(m,
      meter('TA 符合你的理想型', m.fit.total) + meter('你符合 TA 的理想型', m.myFitToThem.total, m.myFitToThem.gate === 'fail' ? '有一项必须条件你不满足' : ''),
      `#/match/${i}`)).join('') || '<p class="empty">没有人通过你的全部门槛。可以把某些“必须”改成“很重要”。</p>'}</div>

    <h2>双向相合 <small>既接近你的理想型，你也符合 TA 的理想型。</small></h2>
    <div class="grid">${r.mutual.map((m) => personCard(m, meter('双向相合度', m.mutualScore) + `<small class="sub">TA→你的理想型 ${score(m.fitToMyIdeal)} · 你→TA 的理想型 ${score(m.myFitToThem)}</small>`)).join('') || '<p class="empty">暂时没有两个方向都达标的人。</p>'}</div>

    <h2>在找你的人 <small>你的条件符合 TA 的理想型。只表示条件相合，不代表对方已经对你有兴趣。</small></h2>
    <div class="grid">${r.seekers.map((m) => personCard(m, meter('你符合 TA 的理想型', m.myFitToThem.total) + `<small class="sub">TA 符合你的理想型：${m.theirFitEligible ? score(m.theirFitToMyIdeal) : '未通过你的门槛'}</small>`)).join('') || '<p class="empty">暂时没有。</p>'}</div>

    ${r.plan === 'vip' ? `<div class="plan-switch">你是 VIP，每组可看 ${S.config.plans.vip.matches} 位。</div>`
      : `<div class="plan-switch upgrade"><div><b>升级 VIP</b><br>每组从 ${S.config.plans.free.matches} 位增加到 ${S.config.plans.vip.matches} 位 · ¥${(S.config.plans.vip.priceFen / 100).toFixed(2)}</div>
        <button class="btn primary" id="upgrade">扫码升级</button></div>`}
    <div class="actions"><a class="btn" href="#/ideal">调整理想型</a></div>
  </section>`;
  const up = document.getElementById('upgrade');
  if (up) up.onclick = () => openPayment('vip');
}

function itemsTable(sc) {
  return `<table class="items"><thead><tr><th>条件</th><th>要求</th><th>资料</th><th>结果</th></tr></thead><tbody>
    ${sc.items.map((i) => `<tr class="${i.must ? 'must' : ''}"><td>${esc(i.label)}${i.must ? ' <small class="tag">必须</small>' : ` <small>${i.weight}%</small>`}</td>
      <td>${esc(i.requirement)}</td><td>${i.value === null ? '<small>不公开</small>' : esc(i.value)}</td>
      <td>${esc(i.status)}${i.must ? '' : ` · ${i.score[0] === i.score[1] ? i.score[0] : i.score.join('–')}`}</td></tr>`).join('')}
  </tbody></table>
  <p class="fine">资料覆盖率 ${Math.round(sc.coverage * 100)}%。门槛：${{ pass: '全部通过', fail: '有未通过的必须条件', pending: '有必须条件待核实' }[sc.gate]}。</p>`;
}

async function renderMatch(idx) {
  const r = await loadResults();
  const m = r.idealMatches[idx];
  if (!m) { location.hash = '#/results'; return; }
  view.innerHTML = `
  <section class="page wide">
    <a href="#/results" class="back">← 返回结果</a>
    <div class="tabs">${r.idealMatches.map((x, i) => `<a href="#/match/${i}" class="${i === idx ? 'on' : ''}">人选 ${i + 1}</a>`).join('')}</div>
    <h1>${esc(m.gender)} · ${esc(m.alias)} ${simTag(m)}</h1>
    <div class="facts big">${cardFacts(m)}</div>
    <div class="two">
      <div class="panel">
        <h2>TA 符合你的理想型 <b>${score(m.fit.total)}</b></h2>
        ${itemsTable(m.fit)}
      </div>
      <div class="panel accent">
        <h2>你符合 TA 的理想型 <b>${score(m.myFitToThem.total)}</b></h2>
        ${m.myPlace ? `<p class="callout">按 TA 的理想型，你在 ${m.myPlace.of} 位达标者中大约排第 <b>${m.myPlace.rankRange[0] === m.myPlace.rankRange[1] ? m.myPlace.rankRange[0] : m.myPlace.rankRange.join('–')}</b> 名。</p>` : '<p class="callout">按 TA 的理想型，你暂时没有进入排序（未通过门槛或资料不全）。</p>'}
        ${itemsTable(m.myFitToThem)}
      </div>
    </div>
    <h2>TA 心中的人选 <small>池中最接近 TA 理想型的人（与你同一性别）</small></h2>
    <div class="grid">${m.theirPicks.map((p) => personCard(p, meter('符合 TA 的理想型', p.score))).join('') || '<p class="empty">暂时没有。</p>'}</div>
  </section>`;
}

// ---------- 扫码支付弹窗 ----------
function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

function openPayment(planId) {
  const plan = S.config.plans[planId];
  const providers = S.config.payments?.providers || [];
  const dlg = document.createElement('div');
  dlg.className = 'modal';
  dlg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="扫码支付">
    <button class="close" aria-label="关闭">×</button>
    <h2>升级 ${esc(plan.label)}</h2>
    <p class="price">¥${(plan.priceFen / 100).toFixed(2)}</p>
    ${providers.length ? `<div class="tabs pay-tabs">${providers.map((p, i) => `<a href="#" data-p="${p.id}" class="${i ? '' : 'on'}">${esc(p.label)}</a>`).join('')}</div>
    <div class="qr" id="qr"><p class="loading">正在生成二维码…</p></div>
    <p class="fine" id="pay-hint"></p>` : '<p class="err">暂未开通在线支付。如果刚更新过代码，请重启服务（npm start）后刷新页面。</p>'}
  </div>`;
  document.body.appendChild(dlg);
  let timer = null, closed = false, current = null;
  const close = () => { closed = true; clearTimeout(timer); dlg.remove(); };
  dlg.querySelector('.close').onclick = close;
  dlg.onclick = (e) => { if (e.target === dlg) close(); };

  async function start(providerId) {
    clearTimeout(timer);
    dlg.querySelectorAll('[data-p]').forEach((a) => a.classList.toggle('on', a.dataset.p === providerId));
    const box = dlg.querySelector('#qr'), hint = dlg.querySelector('#pay-hint');
    box.innerHTML = '<p class="loading">正在生成二维码…</p>';
    try {
      const o = await api('POST', '/api/me/orders', { plan: planId, provider: providerId });
      if (closed) return;
      current = o.orderNo;
      const appName = providerId === 'alipay' ? '支付宝' : '微信';
      box.innerHTML = qrSvg(o.codeUrl);
      hint.innerHTML = `请用${appName}扫码支付，二维码 ${Math.round((o.expireAt - Date.now()) / 60000)} 分钟内有效。支付完成后会自动升级。`
        + (o.mock ? '<br><b>当前是模拟支付</b>，不会真的扣款。<button class="btn small" id="mock-pay">模拟支付成功</button>' : '');
      const mp = dlg.querySelector('#mock-pay');
      if (mp) mp.onclick = () => api('POST', `/api/me/orders/${o.orderNo}/mock-pay`);
      poll(o.orderNo);
    } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  async function poll(orderNo) {
    if (closed || orderNo !== current) return;
    try {
      const s = await api('GET', `/api/me/orders/${orderNo}`);
      if (s.status === 'paid') {
        dlg.querySelector('.sheet').innerHTML = '<h2>支付成功</h2><p class="lead">已升级为 VIP，正在刷新结果…</p>';
        S.me = await api('GET', '/api/me');
        await loadResults(true);
        setTimeout(() => { close(); renderResults(); }, 900);
        return;
      }
      if (s.status === 'expired') { dlg.querySelector('#pay-hint').textContent = '二维码已过期，请重新选择支付方式。'; return; }
    } catch { /* 网络抖动时继续轮询 */ }
    timer = setTimeout(() => poll(orderNo), 2000);
  }

  dlg.querySelectorAll('[data-p]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); start(a.dataset.p); }));
  if (providers.length) start(providers[0].id);
}

// ---------- 我的数据 ----------
function renderPrivacy() {
  const c = S.me.consent;
  view.innerHTML = `
  <section class="page">
    <h1>我的数据</h1>
    <p class="lead">资料加密保存在服务端，只按你同意的用途使用。</p>
    <ul class="plain">
      <li>计算我的结果：${c?.scoring ? '已同意' : '未同意'}</li>
      <li>匿名出现在别人的结果里：${c?.pool ? '已同意' : '未同意'}</li>
      <li>匿名统计：${c?.research ? '已同意' : '未同意'}</li>
    </ul>
    <div class="actions">
      <a class="btn" href="#/consent">修改同意</a>
      <button class="btn" id="export">导出全部资料（JSON）</button>
      <button class="btn danger" id="delete">永久删除我的全部资料</button>
    </div>
    <p class="err" id="err"></p>
  </section>`;
  document.getElementById('export').onclick = async () => {
    const data = await api('GET', '/api/me/export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'vier-my-data.json';
    a.click();
  };
  const del = document.getElementById('delete');
  del.onclick = async () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = '再点一次确认删除（不可恢复）'; return; }
    await api('DELETE', '/api/me');
    store.del('vier.token');
    S.me = null; S.results = null;
    view.innerHTML = '<section class="page"><h1>已删除</h1><p class="lead">你的资料、理想型、同意记录和昵称都已从服务端删除。</p><a class="btn" href="#/">回到首页</a></section>';
  };
}

// ---------- 路由 ----------
async function route() {
  try {
    if (!S.config) {
      S.config = await api('GET', '/api/config');
      document.getElementById('sim-banner').hidden = S.config.poolMode !== 'simulated';
    }
    const h = location.hash.replace(/^#/, '') || '/';
    if (h === '/') return renderHome();
    if (!S.me) await ensureSession();
    if (h === '/me') return renderMe();
    if (h === '/ideal') return renderIdeal();
    if (h === '/consent') return renderConsent();
    if (h === '/results') return await renderResults();
    if (h.startsWith('/match/')) return await renderMatch(Number(h.split('/')[2]));
    if (h === '/privacy') return renderPrivacy();
    renderHome();
  } catch (e) {
    view.innerHTML = `<section class="page"><h1>出了点问题</h1><p class="err">${esc(e.message)}</p><a class="btn" href="#/">回到首页</a></section>`;
  } finally {
    window.scrollTo(0, 0);
    document.querySelectorAll('.top nav a').forEach((a) => a.classList.toggle('on', location.hash.startsWith(a.getAttribute('href'))));
  }
}
window.addEventListener('hashchange', route);
route();

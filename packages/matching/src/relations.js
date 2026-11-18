// 关系引擎：把“你”放进人选池，算出五组结果。只通过评分器接口打分，换算法不用改这里。
//
// 命名（取代旧的 A/B/C/D，见 docs/NAMING.md）
//   你                     本次测试的本人（旧 C′）
//   你的理想型              你写下的择偶要求（旧概念 B）
//   理想型人选              池中最接近你理想型的真人（旧 B′）
//   TA 的理想型             某位人选自己写下的择偶要求（旧概念 A）
//   你与 TA 理想型的契合度   你本人对照 TA 理想型的分数（新增，旧设计缺失）
//   TA 的其他人选           池中最接近 TA 理想型的人（旧 A′），以及你在其中的名次范围
//   在找你的人              你的条件符合其理想型的人（旧 D′；只表示条件相合，不代表对方有兴趣）
//   双向相合                既接近你的理想型、你也符合其理想型的人（新增）
import { getScorer, DEFAULT_SCORER_ID } from '../../scoring/src/index.js';

export const DEFAULT_LIMITS = { matches: 3, theirPicks: 3, seekers: 3, mutual: 3 };

const DEFAULTS = {
  minRequirementsForSeekers: 3, // 要求过少的人很容易“满分”，不进入“在找你的人”正式榜
};

// 只做异性恋范围：双方性别方向都要互相符合
export function directionOk(a, b) {
  return (a.seeks || []).includes(b.gender) && (b.seeks || []).includes(a.gender);
}

const reqCount = (p) => (p.requirements || []).length;

function scoreAll(scorer, people, requirements, params) {
  return people.map((p) => ({ id: p.id, person: p, result: scorer.score(p.profile, requirements, { params }) }));
}

function topEligible(scorer, scored, limit) {
  const eligible = scored.filter((e) => e.result.eligible);
  return {
    list: scorer.rank(eligible, { limit }),
    eligibleCount: eligible.length,
    pendingCount: scored.filter((e) => !e.result.eligible && e.result.gate.status !== 'fail').length,
    failedCount: scored.filter((e) => e.result.gate.status === 'fail').length,
  };
}

const geo = (a, b) => Math.round(Math.sqrt(Math.max(0, a) * Math.max(0, b)) * 10) / 10;

export function computeRelations({ me, pool, limits = DEFAULT_LIMITS, scorerId = DEFAULT_SCORER_ID, params = {}, options = {} }) {
  const scorer = getScorer(scorerId);
  const opt = { ...DEFAULTS, ...options };
  const others = pool.filter((p) => p.id !== me.id);
  const counterparts = others.filter((p) => directionOk(me, p));

  // 1. 理想型人选：F(人选资料, 你的理想型)
  // 2. 你对照每个人的理想型：F(你, TA 的要求)
  const meFit = new Map(counterparts.map((p) => [p.id, scorer.score(me.profile, p.requirements, { params })]));

  const toMyIdeal = scoreAll(scorer, counterparts, me.requirements, params);
  // 同分时，优先展示你也更符合其理想型的人
  toMyIdeal.forEach((e) => { e.tieBreak = meFit.get(e.id).total.low; });
  const ideal = topEligible(scorer, toMyIdeal, limits.matches);

  // 理想型的理想型（A）：把每位理想型人选对同性别人选的打分汇总，合成一组
  const aAgg = new Map(); // id -> { person, lows, highs, eligibleN, fullN }
  const meAgg = { lows: [], highs: [], eligibleN: 0, fullN: 0, misses: new Map() };
  const fullyMetR = (r) => r.gate.status === 'pass' && (r.items || []).length > 0 && r.items.every((it) => it.status === 'met');

  const idealMatches = ideal.list.map((entry) => {
    const cand = entry.person;
    // TA 的其他人选：与你同一方向的人（不含你），按 TA 的理想型排序
    const rivals = others.filter((p) => p.id !== cand.id && directionOk(p, cand));
    const scoredRivals = scoreAll(scorer, rivals, cand.requirements, params);
    const picks = topEligible(scorer, scoredRivals, limits.theirPicks);
    for (const e of scoredRivals) {
      const a = aAgg.get(e.id) || { person: e.person, lows: [], highs: [], eligibleN: 0, fullN: 0 };
      a.lows.push(e.result.eligible ? e.result.total.low : 0);
      a.highs.push(e.result.eligible ? e.result.total.high : 0);
      if (e.result.eligible) a.eligibleN++;
      if (fullyMetR(e.result)) a.fullN++;
      aAgg.set(e.id, a);
    }
    // 你在 TA 理想型下的名次范围（把你放进同一个排序池）
    const myResult = meFit.get(cand.id);
    meAgg.lows.push(myResult.eligible ? myResult.total.low : 0);
    meAgg.highs.push(myResult.eligible ? myResult.total.high : 0);
    if (myResult.eligible) meAgg.eligibleN++;
    if (fullyMetR(myResult)) meAgg.fullN++;
    for (const it of myResult.items || []) if (it.status === 'unmet' || it.status === 'partial') {
      const m = meAgg.misses.get(it.field) || { field: it.field, label: it.label, count: 0 };
      m.count++; meAgg.misses.set(it.field, m);
    }
    let myPlace = null;
    if (myResult.eligible) {
      const pool2 = scorer.rank([...scoredRivals.filter((e) => e.result.eligible), { id: me.id, result: myResult }]);
      const mine = pool2.find((e) => e.id === me.id);
      myPlace = { rankRange: mine.rankRange, of: pool2.length };
    }
    return {
      id: cand.id,
      person: cand,
      fit: entry.result,
      rankRange: entry.rankRange,
      tiedWithPrevious: entry.tiedWithPrevious,
      theirIdeal: cand.requirements,
      myFitToThem: myResult,
      theirPicks: picks.list.map((e) => ({ id: e.id, person: e.person, fit: e.result, rankRange: e.rankRange })),
      theirEligibleCount: picks.eligibleCount,
      myPlace,
    };
  });

  // A 分 = 对这几位理想型人选分数的平均（没达门槛的按 0 算）；至少对一半理想型人选达标才入榜
  const nB = idealMatches.length;
  const mean = (xs) => Math.round((xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)) * 10) / 10;
  const aOk = (x) => nB > 0 && x.eligibleN * 2 >= nB;
  const aEntries = [...aAgg.entries()].filter(([, a]) => aOk(a)).map(([id, a]) => ({
    id, person: a.person, tieBreak: a.fullN, fullN: a.fullN, eligibleN: a.eligibleN,
    result: { total: { low: mean(a.lows), high: mean(a.highs) } },
  }));
  const aLimit = limits.idealOfIdeal ?? limits.theirPicks;
  const aRanked = scorer.rank(aEntries);
  const idealOfIdeal = aRanked.slice(0, aLimit);
  // 你在同一口径下的名次
  let myPlaceA = null;
  if (nB) {
    const mine = { id: me.id, tieBreak: meAgg.fullN, result: { total: { low: mean(meAgg.lows), high: mean(meAgg.highs) } } };
    const all = scorer.rank([...aEntries, mine]);
    const me2 = all.find((e) => e.id === me.id);
    myPlaceA = {
      score: mine.result.total, rankRange: me2.rankRange, of: all.length, eligible: aOk(meAgg),
      ofIdeals: nB, fullyMet: meAgg.fullN, eligibleFor: meAgg.eligibleN,
      topMisses: [...meAgg.misses.values()].sort((a, b) => b.count - a.count).slice(0, 2),
    };
  }

  // 3. 在找你的人：你的条件符合其理想型
  const seekerEntries = counterparts
    .filter((p) => reqCount(p) >= opt.minRequirementsForSeekers)
    .map((p) => ({ id: p.id, person: p, result: meFit.get(p.id) }));
  const seekers = topEligible(scorer, seekerEntries, limits.seekers);
  const fewReqCount = counterparts.filter((p) => reqCount(p) < opt.minRequirementsForSeekers).length;

  // 你的位置：在要求写得够多的人里，多少人的要求你全都满足；没对上的条件里哪几条最常见。
  // 只陈述事实（多少人、哪一条），不给人打“市场价值”分。
  // 三个页签各一份：完全符合的人数 + 最常没对上的两条
  const fullyMet = (r) => r.gate.status === 'pass' && (r.items || []).length > 0 && r.items.every((it) => it.status === 'met');
  function tallyOf(results) {
    const miss = new Map();
    let allMet = 0;
    for (const r of results) {
      if (fullyMet(r)) allMet++;
      for (const it of r.items || []) if (it.status === 'unmet' || it.status === 'partial') {
        const m = miss.get(it.field) || { field: it.field, label: it.label, count: 0 };
        m.count++; miss.set(it.field, m);
      }
    }
    return { of: results.length, allMet, topMisses: [...miss.values()].sort((a, b) => b.count - a.count).slice(0, 2) };
  }
  const position = {
    ideal: tallyOf(toMyIdeal.map((e) => e.result)), // 多少人完全符合你的要求
    seekers: tallyOf(seekerEntries.map((e) => e.result)), // 你完全符合多少人的要求
    mutual: { of: counterparts.length, allMet: counterparts.filter((p) => fullyMet(toMyIdeal.find((e) => e.id === p.id).result) && fullyMet(meFit.get(p.id))).length, topMisses: [] },
  };

  // 4. 双向相合：两个方向都通过门槛和覆盖率；按两个方向分数下界的几何平均排序
  const toMyIdealById = new Map(toMyIdeal.map((e) => [e.id, e.result]));
  const mutualAll = counterparts
    .map((p) => ({ p, a: toMyIdealById.get(p.id), b: meFit.get(p.id) }))
    .filter(({ a, b }) => a.eligible && b.eligible)
    .map(({ p, a, b }) => ({
      id: p.id,
      person: p,
      fitToMyIdeal: a,
      myFitToThem: b,
      result: { total: { low: geo(a.total.low, b.total.low), high: geo(a.total.high, b.total.high) } },
    }));
  const mutual = scorer.rank(mutualAll, { limit: limits.mutual });

  const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
  return {
    scorer: scorer.id,
    limits,
    myIdeal: me.requirements,
    idealMatches,
    idealOfIdeal: idealOfIdeal.map((e) => ({ id: e.id, person: e.person, score: e.result.total, rankRange: e.rankRange, fullN: e.fullN, eligibleN: e.eligibleN })),
    myPlaceA,
    seekers: seekers.list.map((e) => ({ id: e.id, person: e.person, myFitToThem: e.result, rankRange: e.rankRange, theirFitToMyIdeal: toMyIdealById.get(e.id) })),
    mutual: mutual.map((e) => ({ id: e.id, person: e.person, mutualScore: e.result.total, fitToMyIdeal: e.fitToMyIdeal, myFitToThem: e.myFitToThem, rankRange: e.rankRange })),
    summary: {
      counterpartCount: counterparts.length,
      matchesEligible: ideal.eligibleCount,
      matchesPending: ideal.pendingCount,
      matchesFailedGate: ideal.failedCount,
      iFitCount: seekers.eligibleCount,
      seekersExcludedFewRequirements: fewReqCount,
      mutualCount: mutualAll.length,
      // 和第一名同分的有几位：分数相同时“第 1、2、3”其实是并列，界面要说清楚
      topTie: ideal.list.length ? toMyIdeal.filter((e) => e.result.eligible && e.result.total.low === ideal.list[0].result.total.low).length : 0,
      position,
      topTieA: idealOfIdeal.length ? aEntries.filter((e) => e.result.total.low === idealOfIdeal[0].result.total.low).length : 0,
      topTieD: seekers.list.length ? seekerEntries.filter((e) => e.result.eligible && e.result.total.low === seekers.list[0].result.total.low).length : 0,
      avgMyFitToMatches: idealMatches.length ? { low: avg(idealMatches.map((m) => m.myFitToThem.total.low)), high: avg(idealMatches.map((m) => m.myFitToThem.total.high)) } : null,
    },
  };
}

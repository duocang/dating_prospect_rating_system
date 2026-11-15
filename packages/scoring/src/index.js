// 评分模块的唯一入口。业务代码只通过这里拿评分器，不直接引用 v1 的文件。
//
// 评分器接口（要换算法时，实现同样的接口并注册即可）：
//   score(profile, requirements, { params }) -> ScoreResult
//     profile       某个人的资料对象，键为 packages/schema/fields.js 的字段 key
//     requirements  [{ field, op, target, importance: 'must'|1|2|3, preferred?, scale? }]
//     ScoreResult   { scorer, total:{low,high}, coverage, exactShare,
//                     gate:{status:'pass'|'fail'|'pending', failed[], pending[]},
//                     eligible, softCount, mustCount, items[] }
//   rank(entries, { limit }) -> entries（entries 为 [{ id, result }]，会附加 rankRange、tiedWithPrevious）
import { fitV1 } from './v1/scorer.js';

const registry = new Map([[fitV1.id, fitV1]]);

export const DEFAULT_SCORER_ID = 'fit-v1';

export function registerScorer(scorer) {
  for (const k of ['id', 'score', 'rank']) if (!scorer[k]) throw new Error(`评分器缺少 ${k}`);
  registry.set(scorer.id, scorer);
}

export function getScorer(id = DEFAULT_SCORER_ID) {
  const s = registry.get(id);
  if (!s) throw new Error(`未注册的评分器: ${id}`);
  return s;
}

export function listScorers() {
  return [...registry.values()].map((s) => ({ id: s.id, label: s.label }));
}

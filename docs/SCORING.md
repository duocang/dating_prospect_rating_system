# 评分：fit-v1 与替换方法

`packages/scoring/` 是独立模块。业务代码只调用 `getScorer(id)` 返回的接口；要换算法，写一个实现同样接口的新评分器，注册后把 `config/app.json` 里的 `scorer.id` 改掉即可，关系引擎、服务端、页面都不用动。

## 接口

```js
import { getScorer, registerScorer } from './packages/scoring/src/index.js';
const scorer = getScorer('fit-v1');

scorer.score(profile, requirements, { params })
// profile:      { age: 29, heightCm: 165, incomeAnnual: 180000, personalNetAssets: '50–100万元', ... }
// requirements: [{ field, op, target, importance: 'must'|1|2|3, preferred?, scale?, weight? }]
// 返回 { scorer, total:{low,high}, coverage, exactShare,
//        gate:{status:'pass'|'fail'|'pending', failed, pending}, eligible, softCount, mustCount, items[] }

scorer.rank(entries, { limit })   // entries: [{ id, result, tieBreak? }]，附加 rankRange 与 tiedWithPrevious
```

字段、单位、选项、隐私分级都在 `packages/schema/fields.js`。新增字段只改那里。

## fit-v1 规则

这是“大概版本”，参数全部写在 `DEFAULT_PARAMS`，可从配置覆盖，待真人数据校准。

| 类型 | 规则 | 例子 |
|---|---|---|
| 金额，至少 t | `100 × min(1, x / t)`，超过封顶 100；t=0 表示没有要求，跳过 | 9 万对至少 10 万 = 90 |
| 金额，范围 [L,U] | 低于 L 按 x/L，高于 U 按 U/x | |
| 数值（年龄、身高） | 先求到理想区间的距离 d，再 `100 × max(0, 1 − d / 尺度)`；尺度：年龄 5 岁、身高 20 cm | 约 180、实际 170 → 50 |
| 学历（有序） | 达到下限 100，低于下限 0（可配置逐级给分） | 至少本科：硕士 100，大专 0 |
| 类别 | 理想类别 100，“可接受”类别 60，其他 0；没单独列理想类别时可接受即 100 | |
| 分档资料 | 对档内所有可能值求分数上下界 | 净资产 50–100 万对至少 100 万 → [50,100] |
| 未知 | 不当 0 分，给 [0,100]，同时降低覆盖率 | |

**必须项是门槛**，不参与加权，也不能被其他高分抵消：全部可能值都满足为通过，一定不满足为失败，跨越阈值或未知为“待核实”。失败和待核实都不进入正式排序。

**权重**：灵活/重要/很重要 = 1/2/3。同一组（如“个人经济”：收入、资产、住房）的总权重等于组内最高重视度，再按重视度分给组内各项，避免经济条件被重复计算多次。

**总分**是加权的区间 `[low, high]`；精确资料时两者相等。**覆盖率**是已知项的权重占比，低于 70% 不进入正式排序。

**排名**按下界、上界、tieBreak、编号排序。并列会标出；名次范围只在对方下界严格高于你的上界时才算“确定在你前面”。

## 关系引擎如何用评分器

`packages/matching/src/relations.js` 对每个方向各算一次 `score`：

- 理想型人选：`score(人选资料, 你的理想型)`；同分时，你也更符合其理想型的人排在前面
- 你符合 TA 的理想型：`score(你的资料, TA 的理想型)`
- TA 心中的人选：`score(同性别其他人资料, TA 的理想型)`，并把你放进同一排序池得到你的名次范围
- 在找你的人：`score(你的资料, TA 的理想型)`；要求少于 3 项的人不进入（他们几乎对谁都满分）
- 双向相合：两个方向都通过门槛和覆盖率，按两个下界的几何平均排序（一边很低就整体低）

## 验证

`npm test` 覆盖：收入比例、封顶与零目标、身高尺度、年龄区间、分档区间、负资产、未知项、必须门槛、学历、类别、组权重，以及复现旧报告 N01 v0.2 的 B′01 = 92、B′08 = [94,100]。

## 下一步

参数（尺度、60 分、70% 覆盖率、几何平均）都只是试算值。拿到获授权的真人档案和独立评价后，比较不同曲线与权重下前几名的稳定性，再定稿。

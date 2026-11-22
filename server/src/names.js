// 显示用代号：从四大名著里挑正面或中性、听着不俗气的人物名，按性别分开（不用“二娘”“大嫂”“某氏”和粗豪、滑稽的绰号式名字；也不用神话人物、封号、冷僻字和谐音不好的名字）。
// 由“看的人 + 被看的人”算出来，同一个人对同一个看的人总是同一个名字；
// 一页结果里如果撞名，顺延到下一个没用过的名字，保证同一页里不重名。
// 名字只是代号，不代表真人，也不带任何资料信息。
import { createHmac } from 'node:crypto';

const MALE = [
  '宝玉', '贾芸', '贾兰', '柳湘莲', '蒋玉菡', '甄宝玉', '刘备', '关羽', '赵云',
  '诸葛亮', '马超', '黄忠', '姜维', '庞统', '徐庶', '周瑜', '鲁肃', '陆逊', '吕蒙',
  '太史慈', '甘宁', '孙策', '孙权', '郭嘉', '张辽', '徐晃', '曹植', '邓艾',
  '宋江', '林冲', '武松', '燕青', '花荣', '卢俊义', '杨志', '史进', '戴宗',
  '张顺', '关胜', '秦明', '石秀', '冯紫英', '卫若兰', '陆抗',
  '诸葛瑾', '文聘', '公孙胜', '朱武',
];
const FEMALE = [
  '黛玉', '宝钗', '湘云', '探春', '迎春', '惜春', '妙玉', '元春', '可卿', '李纨',
  '晴雯', '袭人', '紫鹃', '平儿', '鸳鸯', '香菱', '莺儿', '宝琴',
  '李绮', '李纹', '侍书', '入画', '雪雁', '秋纹', '貂蝉', '小乔', '大乔', '孙尚香',
  '黄月英', '蔡文姬', '辛宪英', '关银屏', '张星彩', '步练师', '琼英', '玉兰',
  '琥珀', '彩霞', '素云', '宝珠',
];

const listFor = (gender) => (gender === 'female' ? FEMALE : MALE);
const start = (key, viewerId, personId) => createHmac('sha256', key).update(`name:${viewerId}:${personId}`).digest().readUInt32BE(0);

export function nameFor(key, viewerId, person) {
  const list = listFor(person.gender);
  return list[start(key, viewerId, person.id) % list.length];
}

// 一页结果用的命名器：同一个人始终同名，不同的人不重名（名字用完时加编号）
export function namer(key, viewerId) {
  const byId = new Map(), used = new Set();
  return (person) => {
    if (byId.has(person.id)) return byId.get(person.id);
    const list = listFor(person.gender), s = start(key, viewerId, person.id);
    let name = null;
    for (let i = 0; i < list.length && !name; i++) { const n = list[(s + i) % list.length]; if (!used.has(n)) name = n; }
    if (!name) { let k = 2; while (used.has(`${list[s % list.length]}${k}`)) k++; name = `${list[s % list.length]}${k}`; }
    used.add(name); byId.set(person.id, name);
    return name;
  };
}

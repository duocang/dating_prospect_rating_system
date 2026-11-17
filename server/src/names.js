// 显示用代号：从四大名著里挑正面或中性的人物名，按性别分开。
// 由“看的人 + 被看的人”算出来，同一个人对同一个看的人总是同一个名字；
// 一页结果里如果撞名，顺延到下一个没用过的名字，保证同一页里不重名。
// 名字只是代号，不代表真人，也不带任何资料信息。
import { createHmac } from 'node:crypto';

const MALE = [
  '宝玉', '贾琏', '贾芸', '贾兰', '贾蔷', '柳湘莲', '秦钟', '蒋玉菡', '北静王', '甄宝玉',
  '刘备', '关羽', '张飞', '赵云', '诸葛亮', '马超', '黄忠', '姜维', '庞统', '徐庶',
  '周瑜', '鲁肃', '陆逊', '吕蒙', '太史慈', '甘宁', '孙策', '孙权', '荀彧', '郭嘉',
  '张辽', '许褚', '典韦', '徐晃', '曹植', '司马昭', '邓艾', '钟会', '魏延', '马岱',
  '宋江', '林冲', '鲁智深', '武松', '燕青', '花荣', '李逵', '吴用', '卢俊义', '杨志',
  '史进', '戴宗', '阮小七', '张顺', '关胜', '秦明', '呼延灼', '朱仝', '雷横', '石秀',
  '悟空', '八戒', '沙僧', '唐僧', '白龙', '哪吒', '二郎', '敖丙', '红孩儿', '木吒',
];
const FEMALE = [
  '黛玉', '宝钗', '湘云', '探春', '迎春', '惜春', '妙玉', '元春', '可卿', '李纨',
  '凤姐', '巧姐', '晴雯', '袭人', '紫鹃', '平儿', '鸳鸯', '香菱', '麝月', '莺儿',
  '小红', '宝琴', '岫烟', '李绮', '李纹', '司棋', '侍书', '入画', '雪雁', '秋纹',
  '貂蝉', '小乔', '大乔', '孙尚香', '甄宓', '黄月英', '蔡文姬', '祝融', '甘夫人', '糜夫人',
  '王异', '辛宪英', '关银屏', '张星彩', '鲍三娘', '步练师', '卞夫人', '樊氏', '夏侯氏', '吴国太',
  '扈三娘', '顾大嫂', '孙二娘', '琼英', '李师师', '金翠莲', '玉兰', '贾氏', '张贞娘', '锦儿',
  '嫦娥', '玉兔', '织女', '观音', '铁扇', '女儿国王', '紫霞', '白晶晶', '玉面', '杏仙',
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

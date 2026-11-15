const { people } = require("../../utils/mock");

const rows = {
  CA: [
    { label:"年龄", left:"29 岁", right:"30 岁", insight:"年龄接近" },
    { label:"身高", left:"165 cm", right:"168 cm", insight:"相差 3 cm" },
    { label:"教育", left:"本科", right:"硕士", insight:"学历路径不同" },
    { label:"年收入", left:"约 16 万", right:"约 36 万", insight:"示例差额约 20 万" },
    { label:"住房安排", left:"租住，家里有限支持", right:"上海有稳定住房", insight:"差异较明显" },
    { label:"生活计划", left:"希望留沪，婚育可沟通", right:"长期留沪，倾向要孩子", insight:"方向有重合" }
  ],
  BD: [
    { label:"年龄", left:"33 岁", right:"31 岁", insight:"相差 2 岁" },
    { label:"身高", left:"180 cm", right:"175 cm", insight:"相差 5 cm" },
    { label:"教育", left:"硕士", right:"本科", insight:"学历路径不同" },
    { label:"年收入", left:"约 27 万", right:"约 18 万", insight:"示例差额约 9 万" },
    { label:"住房安排", left:"计划两年内稳定置业", right:"购房计划仍在评估", insight:"计划清晰度不同" },
    { label:"关系计划", left:"倾向结婚，愿意协商", right:"认真发展，未来可商量", insight:"都有长期意愿" }
  ]
};

Page({
  data: { type: "CA", left: {}, right: {}, rows: [], title: "你与 A 的差距", leftLabel: "C · 你本人", rightLabel: "A · B 所向往" },
  onLoad(options) {
    const type = options.type === "BD" ? "BD" : "CA";
    this.setData({
      type,
      left: people[type === "CA" ? "C" : "B"],
      right: people[type === "CA" ? "A" : "D"],
      rows: rows[type],
      title: type === "CA" ? "你与 A 的差距" : "B 与 D 的差距",
      leftLabel: type === "CA" ? "C · 你本人" : "B · 你的理想型",
      rightLabel: type === "CA" ? "A · B 所向往" : "D · 向往你的人"
    });
  }
});

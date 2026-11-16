const { lists, people } = require("../../utils/mock");
const labels = { A: "B 所向往的类型", B: "你描述的理想型", D: "把你视作理想型的人" };

Page({
  data: { node: "B", label: labels.B, items: [], related: null },
  onLoad(options) {
    const node = ["A", "B", "D"].includes(options.node) ? options.node : "B";
    this.setData({ node, label: labels[node], items: lists[node].map((item, index) => ({ ...item, id: `${node}-${index}` })), related: people[node] });
  },
  openPerson(event) {
    const index = event.currentTarget.dataset.index;
    wx.navigateTo({ url: `/pages/person/index?node=${this.data.node}&index=${index}` });
  }
});

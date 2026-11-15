const { lists } = require("../../utils/mock");

Page({
  data: { person: {}, node: "B", fit: 0 },
  onLoad(options) {
    const node = ["A", "B", "D"].includes(options.node) ? options.node : "B";
    const index = Math.max(0, Math.min(4, Number(options.index) || 0));
    this.setData({ person: lists[node][index], node, fit: lists[node][index].fit });
  }
});

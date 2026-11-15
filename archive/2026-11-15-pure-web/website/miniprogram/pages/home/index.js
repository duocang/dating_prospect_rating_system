const { people } = require("../../utils/mock");

Page({
  data: { people },
  openNode(event) {
    const node = event.currentTarget.dataset.node;
    if (node === "C") {
      wx.navigateTo({ url: "/pages/profile/index" });
      return;
    }
    wx.navigateTo({ url: `/pages/candidates/index?node=${node}` });
  },
  openCompare(event) {
    wx.navigateTo({ url: `/pages/compare/index?type=${event.currentTarget.dataset.type}` });
  },
  openProfile() { wx.navigateTo({ url: "/pages/profile/index" }); }
});

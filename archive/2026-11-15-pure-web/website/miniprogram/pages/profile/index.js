const { people } = require("../../utils/mock");

Page({
  data: { profile: people.C, saved: false },
  onLoad() {
    const local = wx.getStorageSync("vier-profile-demo");
    if (local && local.name) this.setData({ profile: local });
  },
  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`profile.${field}`]: event.detail.value, saved: false });
  },
  saveLocal() {
    wx.setStorageSync("vier-profile-demo", this.data.profile);
    this.setData({ saved: true });
    wx.showToast({ title: "已保存在本机", icon: "success" });
  }
});

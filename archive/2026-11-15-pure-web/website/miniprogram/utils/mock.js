const people = {
  A: {
    key: "A", name: "林知夏", age: 30, gender: "女", city: "上海", height: "168 cm",
    education: "硕士", job: "三甲医院主治医师", income: "约 36 万 / 年", home: "上海有稳定住房安排",
    family: "父母工作稳定，家庭支持边界清楚", relationship: "表达直接，重视平等沟通",
    plan: "希望未来在上海长期生活，倾向要孩子", hobbies: "徒步、看展、做饭",
    intro: "独立、节奏稳定，重视相处质量和长期规划。",
    lookingFor: "有责任感、生活稳定，能一起讨论未来安排的人。",
    note: "示例画像：用于展示 B 所向往的类型，不代表真实用户。"
  },
  B: {
    key: "B", name: "周屿", age: 33, gender: "男", city: "上海", height: "180 cm",
    education: "硕士", job: "互联网产品经理", income: "约 27 万 / 年", home: "目前租住，计划两年内稳定置业",
    family: "父母在外地，能提供部分支持，不要求共同居住", relationship: "慢热、愿意沟通，重视承诺",
    plan: "倾向结婚，孩子与定居安排希望共同商量", hobbies: "跑步、电影、旅行",
    intro: "工作稳定，重视彼此尊重，也愿意分担生活责任。",
    lookingFor: "欣赏成熟独立、沟通坦诚、生活方式合拍的伴侣。",
    note: "示例画像：代表 C 当前描述的理想型。"
  },
  C: {
    key: "C", name: "顾念", age: 29, gender: "女", city: "上海", height: "165 cm",
    education: "本科", job: "品牌运营", income: "约 16 万 / 年", home: "目前租住，家庭可提供有限支持",
    family: "父母关系稳定，有基本保障；是否接受父母资助由本人决定", relationship: "情绪稳定，愿意协商分歧",
    plan: "希望留在上海，婚育时间可沟通", hobbies: "瑜伽、读书、周末短途",
    intro: "重视可靠、平等与日常相处的舒适感。",
    lookingFor: "希望对方身高 178 cm 左右、工作稳定、愿意长期留在上海，沟通坦诚。",
    note: "当前用户示例：表单只保存在本机演示，不会上传。"
  },
  D: {
    key: "D", name: "陈奕舟", age: 31, gender: "男", city: "上海", height: "175 cm",
    education: "本科", job: "工程项目协调", income: "约 18 万 / 年", home: "租住，购房计划还在评估",
    family: "家人在外地，能给予情感支持；经济安排需要双方商量", relationship: "温和、踏实，表达需要时间",
    plan: "愿意认真发展，未来城市与婚育计划可以协商", hobbies: "羽毛球、摄影、做菜",
    intro: "生活方式朴实，愿意投入时间经营稳定关系。",
    lookingFor: "喜欢真诚、温和、愿意一起商量生活的人。",
    note: "示例画像：代表把 C 描述为理想伴侣的人。"
  }
};

const lists = {
  A: [
    { name:"沈书宁", age:29, gender:"女", height:"167 cm", job:"临床药师", income:"约 31 万 / 年", fit:96, degree:"硕士", city:"上海" },
    { name:"程予安", age:31, gender:"女", height:"169 cm", job:"高校讲师", income:"约 28 万 / 年", fit:91, degree:"博士", city:"上海" },
    { name:"许嘉禾", age:30, gender:"女", height:"166 cm", job:"品牌策略", income:"约 25 万 / 年", fit:87, degree:"硕士", city:"上海" },
    { name:"林知夏", age:30, gender:"女", height:"168 cm", job:"三甲医院主治医师", income:"约 36 万 / 年", fit:84, degree:"硕士", city:"上海" },
    { name:"唐雨晴", age:32, gender:"女", height:"170 cm", job:"建筑设计师", income:"约 29 万 / 年", fit:80, degree:"硕士", city:"上海" }
  ],
  B: [
    { name:"周屿", age:33, gender:"男", height:"180 cm", job:"互联网产品经理", income:"约 27 万 / 年", fit:96, degree:"硕士", city:"上海" },
    { name:"许峥", age:32, gender:"男", height:"179 cm", job:"供应链项目经理", income:"约 23 万 / 年", fit:90, degree:"本科", city:"上海" },
    { name:"陆嘉铭", age:34, gender:"男", height:"182 cm", job:"软件工程师", income:"约 31 万 / 年", fit:87, degree:"硕士", city:"上海" },
    { name:"何以南", age:30, gender:"男", height:"178 cm", job:"金融运营", income:"约 25 万 / 年", fit:83, degree:"硕士", city:"上海" },
    { name:"陈奕舟", age:31, gender:"男", height:"175 cm", job:"工程项目协调", income:"约 18 万 / 年", fit:78, degree:"本科", city:"上海" }
  ],
  D: [
    { name:"陈奕舟", age:31, gender:"男", height:"175 cm", job:"工程项目协调", income:"约 18 万 / 年", fit:94, degree:"本科", city:"上海" },
    { name:"吴亦诚", age:30, gender:"男", height:"177 cm", job:"物流运营", income:"约 16 万 / 年", fit:90, degree:"本科", city:"上海" },
    { name:"郑嘉树", age:32, gender:"男", height:"173 cm", job:"教育机构教研", income:"约 17 万 / 年", fit:86, degree:"硕士", city:"上海" },
    { name:"宋闻远", age:29, gender:"男", height:"176 cm", job:"医疗器械销售", income:"约 22 万 / 年", fit:82, degree:"本科", city:"上海" },
    { name:"季承宇", age:33, gender:"男", height:"174 cm", job:"制造业质量管理", income:"约 20 万 / 年", fit:77, degree:"本科", city:"上海" }
  ]
};

module.exports = { people, lists };

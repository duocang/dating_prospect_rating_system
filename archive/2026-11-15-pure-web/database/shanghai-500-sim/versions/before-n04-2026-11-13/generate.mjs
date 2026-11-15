import fs from 'node:fs';
import path from 'node:path';
const dir=path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/(\w:)/,'$1'));
let seed=20261113;
const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const pick=a=>a[Math.floor(rnd()*a.length)];
const int=(a,b)=>a+Math.floor(rnd()*(b-a+1));
const levels=['高中及以下','大专','本科','硕士','博士'];
const homes=['合租','整租','与父母同住','自有住房（有贷款）','自有住房（无贷款）','单位宿舍'];
const support=['主要提供情感支持','可应急小额支持','可部分支持首付','需本人反向支持','不清楚','不愿透露'];
const parentsMarriage=['婚姻关系稳定','父母离异','一方丧偶','不清楚','不愿透露'];
const familyAssetBands=['净资产为负','0–50万元','50–150万元','150–300万元','300–600万元','600–1,000万元','不清楚','不愿透露'];
const personalAssetBands=['净资产为负','0–10万元','10–50万元','50–100万元','100–300万元','300–600万元','600–1,000万元','不清楚','不愿透露'];
const settle=['计划长期上海','城市可协商','未来可能离沪'];
const marriage=['1–3年内考虑结婚','长期伴侣，暂不结婚','婚姻安排可协商'];
const children=['希望育儿','不计划育儿','尚未决定'];
const lifestyle=['规律作息','弹性作息','偏好安静','喜欢社交','户外运动','居家休闲'];
const personality=['直接沟通','慢热温和','活跃外向','独立安静'];
const weights=()=>Object.fromEntries(['年龄','身高','收入','学历','住房','定居','家庭支持','婚姻','育儿','性格','生活方式'].map(k=>[k,int(1,3)]));
const weightedPick=entries=>{let n=rnd()*entries.reduce((sum,[,weight])=>sum+weight,0);for(const [value,weight] of entries){n-=weight;if(n<0)return value;}return entries.at(-1)[0];};
const drawPersonalAssetBand=(age,housing)=>{
 const hasOwnedHome=housing.startsWith('自有住房');
 const entries=hasOwnedHome
  ?[['净资产为负',5],['0–10万元',8],['10–50万元',14],['50–100万元',20],['100–300万元',27],['300–600万元',16],['600–1,000万元',5],['不清楚',3],['不愿透露',2]]
  :[['净资产为负',8],['0–10万元',22],['10–50万元',29],['50–100万元',18],['100–300万元',11],['300–600万元',4],['600–1,000万元',1],['不清楚',4],['不愿透露',3]];
 return weightedPick(entries);
};
const drawFamilyAssetBand=(parentsHousing,supportLevel)=>{
 const ownsParentHome=parentsHousing.startsWith('自有住房');
 const hasMortgage=parentsHousing.includes('有贷款');
 const entries=ownsParentHome&&!hasMortgage
  ?[['净资产为负',2],['0–50万元',7],['50–150万元',15],['150–300万元',23],['300–600万元',29],['600–1,000万元',14],['不清楚',6],['不愿透露',4]]
  :ownsParentHome&&hasMortgage
   ?[['净资产为负',7],['0–50万元',13],['50–150万元',22],['150–300万元',24],['300–600万元',19],['600–1,000万元',7],['不清楚',5],['不愿透露',3]]
   :[['净资产为负',10],['0–50万元',17],['50–150万元',22],['150–300万元',19],['300–600万元',13],['600–1,000万元',5],['不清楚',8],['不愿透露',6]];
 const adjusted=entries.map(([value,weight])=>[value,value==='不清楚'&&supportLevel==='不清楚'?weight+2:weight]);
 return weightedPick(adjusted);
};
const people=Array.from({length:500},(_,i)=>{
 const gender=i<250?'女':'男';
 const age=int(22,39), height=int(152,188);
 const bucket=rnd();const income=bucket<.10?int(3,7)*10000:bucket<.78?int(8,20)*10000:bucket<.96?int(21,35)*10000:int(36,65)*10000;
 const housing=pick(homes);
 const familySupport=pick(support);
 const parentsHousing=pick(['自有住房无贷款','自有住房有贷款','租住','与亲属同住','不清楚','不愿透露']);
 const parentsMarriageStatus=weightedPick([['婚姻关系稳定',86],['父母离异',8],['一方丧偶',3],['不清楚',2],['不愿透露',1]]);
 const personalNetAssetsBand=drawPersonalAssetBand(age,housing);
 const familyNetAssetsBand=drawFamilyAssetBand(parentsHousing,familySupport);
 const seeks=[gender==='女'?'男':'女'];
 return {id:`SH-SIM-${String(i+1).padStart(3,'0')}`,synthetic:true,orientation:'异性恋',city:'上海',status:'单身',monthsInShanghai:int(6,180),gender,seeks,age,heightCm:height,education:pick(['大专','本科','本科','本科','硕士','高中及以下','博士']),occupation:pick(['零售与服务','行政与运营','制造与工程','教育与培训','医疗与健康','软件与技术','物流与交通','财务与商务','设计与传媒']),annualIncomeRmb:income,incomeBasis:'最近12个月税前个人劳动收入（含奖金及兼职；不含家庭转移、房产与投资收益），模拟值',personalNetAssetsBand,housing,settlement:pick(settle),marriage:pick(marriage),children:pick(children),personality:pick(personality),lifestyle:pick(lifestyle),family:{parentsLocation:pick(['上海','长三角其他城市','其他省份城镇','其他省份乡村','不愿透露']),parentsHousing,parentsMarriage:parentsMarriageStatus,netAssetsBand:familyNetAssetsBand,support:familySupport,parentsSecurity:pick(['双方有基本养老与医保','一方有养老金，双方有医保','主要依靠居民养老与医保','保障存在缺口','不清楚','不愿透露']),siblings:pick(['独生子女','一位兄弟姐妹','两位及以上兄弟姐妹','不愿透露']),debt:pick(['自述无家庭债务','住房贷款','经营借款','医疗或教育借款','不清楚','不愿透露']),care:pick(['暂时无固定照护责任','定期探望及协助','需要经济赡养','承担日常照护','不清楚','不愿透露'])},preferences:{age:[Math.max(22,age-int(2,7)),Math.min(39,age+int(2,7))],heightCm:[int(150,170),int(175,195)],minIncomeRmb:pick([0,60000,80000,100000,120000,150000,200000]),incomeHard:rnd()<.28,educationMin:pick(levels.slice(0,4)),housingAccepted:rnd()<.7?homes:[homes[3],homes[4]],settlementAccepted:rnd()<.65?settle:[pick(settle)],familySupportAccepted:rnd()<.8?support:support.slice(0,3),marriageAccepted:rnd()<.65?marriage:[pick(marriage)],childrenAccepted:rnd()<.6?children:[pick(children)],personalityAccepted:rnd()<.65?personality:[pick(personality)],lifestyleAccepted:rnd()<.65?lifestyle:[pick(lifestyle)],importance:weights()}};
});
function evaluate(target,seeker){
 const p=seeker.preferences,w=p.importance;
 const items=[['年龄',target.age>=p.age[0]&&target.age<=p.age[1]],['身高',target.heightCm>=p.heightCm[0]&&target.heightCm<=p.heightCm[1]],['收入',target.annualIncomeRmb>=p.minIncomeRmb],['学历',levels.indexOf(target.education)>=levels.indexOf(p.educationMin)],['住房',p.housingAccepted.includes(target.housing)],['定居',p.settlementAccepted.includes(target.settlement)],['家庭支持',p.familySupportAccepted.includes(target.family.support)],['婚姻',p.marriageAccepted.includes(target.marriage)],['育儿',p.childrenAccepted.includes(target.children)],['性格',p.personalityAccepted.includes(target.personality)],['生活方式',p.lifestyleAccepted.includes(target.lifestyle)]];
 const eligible=seeker.seeks.includes(target.gender)&&(!p.incomeHard||target.annualIncomeRmb>=p.minIncomeRmb);
 return {eligible,score:Math.round(100*items.reduce((s,[k,ok])=>s+(ok?w[k]:0),0)/items.reduce((s,[k])=>s+w[k],0)),items:items.map(([field,overlap])=>({field,overlap,weight:w[field]}))};
}
const distributionSpecs=[
 {group:'个人与城市情况',type:'numeric',title:'年龄',path:'age',unit:'岁',bins:[{label:'22–24岁',min:22,max:25},{label:'25–27岁',min:25,max:28},{label:'28–30岁',min:28,max:31},{label:'31–33岁',min:31,max:34},{label:'34–36岁',min:34,max:37},{label:'37–39岁',min:37,max:40}]},
 {group:'个人与城市情况',type:'numeric',title:'身高',path:'heightCm',unit:'cm',bins:[{label:'150–154cm',min:150,max:155},{label:'155–159cm',min:155,max:160},{label:'160–164cm',min:160,max:165},{label:'165–169cm',min:165,max:170},{label:'170–174cm',min:170,max:175},{label:'175–179cm',min:175,max:180},{label:'180–184cm',min:180,max:185},{label:'185cm及以上',min:185,max:null}]},
 {group:'个人与城市情况',type:'numeric',title:'个人年收入（税前）',path:'annualIncomeRmb',unit:'万元/年',bins:[{label:'3–7万元',min:30000,max:80000},{label:'8–20万元',min:80000,max:210000},{label:'21–35万元',min:210000,max:360000},{label:'36–65万元',min:360000,max:660000}]},
 {group:'个人与城市情况',type:'numeric',title:'在上海生活时间',path:'monthsInShanghai',unit:'月',bins:[{label:'6–11个月',min:6,max:12},{label:'1–2年',min:12,max:24},{label:'2–5年',min:24,max:60},{label:'5–10年',min:60,max:120},{label:'10年以上',min:120,max:null}]},
 {group:'个人与城市情况',type:'categorical',title:'自述性别',path:'gender'},
 {group:'个人与城市情况',type:'categorical',title:'性取向模拟范围',path:'orientation'},
 {group:'个人与城市情况',type:'multi',title:'希望认识的对象性别',path:'seeks'},
 {group:'个人与城市情况',type:'categorical',title:'关系状态',path:'status'},
 {group:'个人与城市情况',type:'categorical',title:'学历',path:'education'},
 {group:'个人与城市情况',type:'categorical',title:'职业类别',path:'occupation'},
 {group:'个人与城市情况',type:'categorical',title:'当前住房安排',path:'housing'},
 {group:'个人与城市情况',type:'categorical',title:'定居意向',path:'settlement'},
 {group:'个人与城市情况',type:'categorical',title:'婚姻计划',path:'marriage'},
 {group:'个人与城市情况',type:'categorical',title:'育儿计划',path:'children'},
 {group:'个人与城市情况',type:'categorical',title:'沟通性格',path:'personality'},
 {group:'个人与城市情况',type:'categorical',title:'生活方式',path:'lifestyle'},
 {group:'家庭与资产情况',type:'categorical',title:'父母居住地',path:'family.parentsLocation'},
 {group:'家庭与资产情况',type:'categorical',title:'父母住房安排',path:'family.parentsHousing'},
 {group:'家庭与资产情况',type:'categorical',title:'父母婚姻状态',path:'family.parentsMarriage'},
 {group:'家庭与资产情况',type:'categorical',title:'家庭净资产分档',path:'family.netAssetsBand'},
 {group:'家庭与资产情况',type:'categorical',title:'个人净资产分档',path:'personalNetAssetsBand'},
 {group:'家庭与资产情况',type:'categorical',title:'家庭支持能力',path:'family.support'},
 {group:'家庭与资产情况',type:'categorical',title:'父母养老及医保保障',path:'family.parentsSecurity'},
 {group:'家庭与资产情况',type:'categorical',title:'兄弟姐妹情况',path:'family.siblings'},
 {group:'家庭与资产情况',type:'categorical',title:'家庭债务情况',path:'family.debt'},
 {group:'家庭与资产情况',type:'categorical',title:'照护责任',path:'family.care'},
 {group:'理想对象偏好',type:'numeric',title:'期待年龄下限',path:'preferences.age.0',unit:'岁',bins:[{label:'22–24岁',min:22,max:25},{label:'25–27岁',min:25,max:28},{label:'28–30岁',min:28,max:31},{label:'31–33岁',min:31,max:34},{label:'34–36岁',min:34,max:37},{label:'37–39岁',min:37,max:40}]},
 {group:'理想对象偏好',type:'numeric',title:'期待年龄上限',path:'preferences.age.1',unit:'岁',bins:[{label:'22–24岁',min:22,max:25},{label:'25–27岁',min:25,max:28},{label:'28–30岁',min:28,max:31},{label:'31–33岁',min:31,max:34},{label:'34–36岁',min:34,max:37},{label:'37–39岁',min:37,max:40}]},
 {group:'理想对象偏好',type:'numeric',title:'期待身高下限',path:'preferences.heightCm.0',unit:'cm',bins:[{label:'150–154cm',min:150,max:155},{label:'155–159cm',min:155,max:160},{label:'160–164cm',min:160,max:165},{label:'165–169cm',min:165,max:170},{label:'170cm及以上',min:170,max:null}]},
 {group:'理想对象偏好',type:'numeric',title:'期待身高上限',path:'preferences.heightCm.1',unit:'cm',bins:[{label:'175–179cm',min:175,max:180},{label:'180–184cm',min:180,max:185},{label:'185–189cm',min:185,max:190},{label:'190–194cm',min:190,max:195},{label:'195cm及以上',min:195,max:null}]},
 {group:'理想对象偏好',type:'numeric',title:'期待年收入下限',path:'preferences.minIncomeRmb',unit:'万元/年',bins:[{label:'未设收入下限',min:0,max:1},{label:'1–8万元',min:1,max:80001},{label:'8–12万元',min:80001,max:120001},{label:'12–20万元',min:120001,max:200001},{label:'20万元及以上',min:200001,max:null}]},
 {group:'理想对象偏好',type:'boolean',title:'收入是否为硬门槛',path:'preferences.incomeHard',categories:[{value:true,label:'设为硬门槛'},{value:false,label:'仅作软偏好'}]},
 {group:'理想对象偏好',type:'categorical',title:'期待最低学历',path:'preferences.educationMin'},
 {group:'理想对象偏好',type:'multi',title:'可接受的住房安排',path:'preferences.housingAccepted'},
 {group:'理想对象偏好',type:'multi',title:'可接受的定居计划',path:'preferences.settlementAccepted'},
 {group:'理想对象偏好',type:'multi',title:'可接受的家庭支持状况',path:'preferences.familySupportAccepted'},
 {group:'理想对象偏好',type:'multi',title:'可接受的婚姻计划',path:'preferences.marriageAccepted'},
 {group:'理想对象偏好',type:'multi',title:'可接受的育儿计划',path:'preferences.childrenAccepted'},
 {group:'理想对象偏好',type:'multi',title:'期待的沟通性格',path:'preferences.personalityAccepted'},
 {group:'理想对象偏好',type:'multi',title:'可接受的生活方式',path:'preferences.lifestyleAccepted'},
 ...['年龄','身高','收入','学历','住房','定居','家庭支持','婚姻','育儿','性格','生活方式'].map(item=>({group:'理想对象偏好 · 重视程度',type:'importance',title:`${item}重视程度`,path:`preferences.importance.${item}`,categories:[{value:1,label:'1 · 灵活'},{value:2,label:'2 · 重要'},{value:3,label:'3 · 很重要'}]}))
];
function readPath(record,path){return path.split('.').reduce((value,key)=>value?.[key],record);}
for(const spec of distributionSpecs){
 if(!spec.categories&&['categorical','multi'].includes(spec.type)){
  spec.categories=[...new Set(people.flatMap(person=>{const value=readPath(person,spec.path);return spec.type==='multi'?(Array.isArray(value)?value:[]):[value];}))].sort((a,b)=>String(a).localeCompare(String(b),'zh-CN'));
 }
}
function distributionRows(records,spec){
 if(spec.type==='numeric')return spec.bins.map(bin=>({label:bin.label,count:records.filter(person=>{const value=readPath(person,spec.path);return Number.isFinite(value)&&value>=bin.min&&(bin.max==null||value<bin.max);}).length}));
 const categories=spec.categories??[...new Set(records.flatMap(person=>{const value=readPath(person,spec.path);return spec.type==='multi'?(Array.isArray(value)?value:[]):[value];}))].sort((a,b)=>String(a).localeCompare(String(b),'zh-CN'));
 return categories.map(category=>{
  const value=typeof category==='object'?category.value:category;
  const label=typeof category==='object'?category.label:String(category);
  const count=records.filter(person=>{const actual=readPath(person,spec.path);return spec.type==='multi'?(Array.isArray(actual)&&actual.includes(value)):actual===value;}).length;
  return {label,count};
 });
}
const ranked=(seeker,exclude)=>people.filter(t=>!exclude.includes(t.id)).map(t=>({person:t,result:evaluate(t,seeker)})).filter(x=>x.result.eligible).sort((a,b)=>b.result.score-a.result.score||a.person.id.localeCompare(b.person.id));
// Strict complete directional coverage is used only for the illustrative chain; no manual profile edits.
let chain;
outer:for(const c of people)for(const b of ranked(c,[c.id]).filter(x=>x.result.score===100))for(const a of ranked(b.person,[c.id,b.person.id]).filter(x=>x.result.score===100)){
 const d=people.find(t=>![c.id,b.person.id,a.person.id].includes(t.id)&&evaluate(c,t).eligible&&evaluate(c,t).score===100);
 if(d){chain={A:a.person.id,B:b.person.id,C:c.id,D:d.id};break outer;}
}
if(!chain)throw Error('No complete Z chain');
const meta={version:'1.1',generatedDate:'2026-11-13',seed:20261113,count:500,notice:'全部程序模拟，不是实际用户样本或上海人口代表性调查。仅模拟异性恋男女各250人，所有人寻找异性；该人为均衡设置不代表真实性别或取向比例。不得用于宣传真实命中率。',orientationScope:'仅异性恋；女用户寻找男用户，男用户寻找女用户',incomeDistribution:'10% 3–7万元；68% 8–20万元；18% 21–35万元；4% 36–65万元，分段均匀抽取；非统计拟合',familyNetAssetsBasis:'模拟父母原生家庭净资产区间，包含房产估值、存款及其他资产，扣除未偿贷款和其他债务；不含用户单独持有的个人资产。仅为宽区间模拟自述，不核验。',personalNetAssetsBasis:'模拟用户个人名下净资产区间，包含个人房产估值、存款及其他资产，扣除个人未偿房贷和其他债务；明确不含父母资产或尚未实际取得的家庭支持。仅为宽区间模拟自述，不核验。',assetBandCap:'最高展示区间为600–1,000万元；不会生成具体资产数值或1,000万元以上、亿级资产。负净资产只标为“净资产为负”。',normalityNote:'正态性只适用于数值变量的分布讨论；分类变量没有正态性。当前合成频数是程序模拟，不是实测频数，不应强行改成正态或声称真实市场符合正态。',rule:'单向计算：目标性别在寻找范围内且满足收入硬门槛；11项二元重合按1–3重视程度加权，四舍五入至0–100规则分。未知/不愿透露作为原样类别，不推断经济能力。不做互选预设。',chain,chainSelection:'依编号扫描C，再按规则分降序和编号寻找互不重复、三条边均为100规则分的路径，仅为解释结构而选择，不代表常见路径。'};
const data={meta,people};
const csvRows=people.map(p=>({...p,family:JSON.stringify(p.family),preferences:JSON.stringify(p.preferences),seeks:p.seeks.join('|')}));
const csv=(rows)=>{const keys=Object.keys(rows[0]);const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';return '\ufeff'+[keys.map(q).join(','),...rows.map(r=>keys.map(k=>q(r[k])).join(','))].join('\r\n');};
fs.writeFileSync(path.join(dir,'profiles.json'),JSON.stringify(data,null,2));
fs.writeFileSync(path.join(dir,'profiles.csv'),csv(csvRows));
let html=fs.readFileSync(path.join(dir,'template.html'),'utf8').replace('/*DATA*/',`const DB=${JSON.stringify(data)};const levels=${JSON.stringify(levels)};const evaluate=${evaluate.toString()};const DISTRIBUTION_SPECS=${JSON.stringify(distributionSpecs)};const readPath=${readPath.toString()};const distributionRows=${distributionRows.toString()};`);
fs.writeFileSync(path.join(dir,'index.html'),html);
const incomes=people.map(p=>p.annualIncomeRmb).sort((a,b)=>a-b);
const fieldPresence={parentsMarriage:people.every(p=>typeof p.family.parentsMarriage==='string'),familyNetAssetsBand:people.every(p=>familyAssetBands.includes(p.family.netAssetsBand)),personalNetAssetsBand:people.every(p=>personalAssetBands.includes(p.personalNetAssetsBand))};
const chartAudit=distributionSpecs.map(spec=>{const rows=distributionRows(people,spec);const total=rows.reduce((sum,row)=>sum+row.count,0);const expected=spec.type==='multi'?undefined:people.length;return {group:spec.group,title:spec.title,type:spec.type,bucketCount:rows.length,selectedCount:total,exhaustive:expected===undefined?rows.every(row=>row.count>=0&&row.count<=people.length):total===expected};});
const femaleRows=people.filter(p=>p.gender==='女');
const filteredChartAudit=distributionSpecs.map(spec=>{const rows=distributionRows(femaleRows,spec);const total=rows.reduce((sum,row)=>sum+row.count,0);return {title:spec.title,type:spec.type,denominator:femaleRows.length,exhaustive:spec.type==='multi'?rows.every(row=>row.count<=femaleRows.length):total===femaleRows.length};});
const assetBandCounts={family:Object.fromEntries(familyAssetBands.map(band=>[band,people.filter(p=>p.family.netAssetsBand===band).length])),personal:Object.fromEntries(personalAssetBands.map(band=>[band,people.filter(p=>p.personalNetAssetsBand===band).length]))};
const validation={count:people.length,uniqueIds:new Set(people.map(p=>p.id)).size,genderCounts:{female:people.filter(p=>p.gender==='女').length,male:people.filter(p=>p.gender==='男').length},orientationScope:people.every(p=>p.orientation==='异性恋'&&p.seeks.length===1&&p.seeks[0]!==p.gender),ageRange:[Math.min(...people.map(p=>p.age)),Math.max(...people.map(p=>p.age))],incomeRange:[incomes[0],incomes.at(-1)],medianIncome:(incomes[249]+incomes[250])/2,meanIncome:incomes.reduce((a,b)=>a+b)/500,incomeOver350k:incomes.filter(x=>x>350000).length,assetBandCounts,assetBandsUnderCap:[...people.map(p=>p.family.netAssetsBand),...people.map(p=>p.personalNetAssetsBand)].every(value=>!value.includes('1000万以上')&&!value.includes('亿')),fieldPresence,distributionSpecCount:distributionSpecs.length,chartAudit,filteredChartAudit,chartLogic:{numericBinsCoverAllNonMissing:true,categoricalCountsSumToDenominator:true,multiSelectDenominator:'当前筛选档案人数，选项比例可相加超过100%',importanceLevels:[1,2,3]},chain,edges:[[chain.A,chain.B],[chain.B,chain.C],[chain.C,chain.D]].map(([t,s])=>({target:t,seeker:s,...evaluate(people.find(p=>p.id===t),people.find(p=>p.id===s))}))};
fs.writeFileSync(path.join(dir,'validation.json'),JSON.stringify(validation,null,2));
const chartLogicPass=chartAudit.every(a=>a.exhaustive)&&filteredChartAudit.every(a=>a.exhaustive);
const interactionChecks={method:'Generator-level distribution checks using the same pure bucket function embedded in the dashboard; no browser DOM rendering test',checks:['500个异性恋样本，女250/男250，寻求对象均为异性','父母婚姻状态、家庭净资产分档、个人净资产分档在500条档案中均完整','所有个人/家庭资产值只使用允许的宽区间，最高区间不超过1,000万元','所有数值分布区间在完整样本及女性筛选子集中均覆盖每条数值记录一次','单选分类分布计数合计等于当前筛选档案数','多选分布以当前筛选档案数为分母，单项计数不超过分母','每项重视程度均展示1灵活、2重要、3很重要','主render流程每次执行时重新生成全部分布图'],chartSpecCount:distributionSpecs.length,fullSampleChartsExhaustive:chartAudit.every(a=>a.exhaustive),filteredSubsetChartsExhaustive:filteredChartAudit.every(a=>a.exhaustive),renderCallsDistribution:html.includes('renderDistributions();'),rendering:'未做浏览器视觉与手机实机检查；CSS包含响应式布局，仍需在真实浏览器确认长图表的排版。'};
if(!chartLogicPass||!interactionChecks.renderCallsDistribution||Object.values(fieldPresence).some(present=>!present))throw Error('New field or distribution check failed');
fs.writeFileSync(path.join(dir,'interaction-checks.json'),JSON.stringify(interactionChecks,null,2));
console.log(JSON.stringify({count:500,chartSpecCount:distributionSpecs.length,chartLogicPass,chain,dir}));

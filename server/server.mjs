// 启动：node server/server.mjs   然后打开 http://localhost:8787
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const { server, store, config, keySource } = createApp({
  root,
  dataDir: process.env.VIER_DATA_DIR || resolve(root, 'data'),
  configPath: process.env.VIER_CONFIG || resolve(root, 'config/app.json'),
});
if (keySource === 'dev-file') console.warn('⚠ 使用开发密钥 data/.dev-key。正式环境请设置 VIER_DATA_KEY。');
if (config.poolMode === 'simulated') console.warn('⚠ 人选池为模拟模式：结果中的人物全部是程序模拟档案。');
server.listen(port, () => console.log(`VIER 已启动：http://localhost:${port}`));

// 每天自动删除超过保留期未活跃的账户，不需要另配 cron（scripts/purge-inactive.mjs 仍可手动运行）
const purge = () => {
  try {
    const n = store.purgeInactive(config.privacy.inactiveRetentionDays);
    if (n) console.log(`已删除 ${n} 个超过 ${config.privacy.inactiveRetentionDays} 天未活跃的账户`);
    const e = store.purgeEmpty(config.privacy.emptyRetentionDays ?? 7);
    if (e) console.log(`已删除 ${e} 个一题没填的空账户`);
  } catch (e) { console.error('清理不活跃账户失败：', e.message); }
};
purge();
setInterval(purge, 24 * 3600 * 1000).unref();

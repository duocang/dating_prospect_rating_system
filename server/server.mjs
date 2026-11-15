// 启动：node server/server.mjs   然后打开 http://localhost:8787
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const { server, config, keySource } = createApp({
  root,
  dataDir: process.env.VIER_DATA_DIR || resolve(root, 'data'),
  configPath: process.env.VIER_CONFIG || resolve(root, 'config/app.json'),
});
if (keySource === 'dev-file') console.warn('⚠ 使用开发密钥 data/.dev-key。正式环境请设置 VIER_DATA_KEY。');
if (config.poolMode === 'simulated') console.warn('⚠ 人选池为模拟模式：结果中的人物全部是程序模拟档案。');
server.listen(port, () => console.log(`VIER 已启动：http://localhost:${port}`));

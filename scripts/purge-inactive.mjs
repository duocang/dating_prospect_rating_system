// 删除超过保留期未活跃的账户。建议每天定时运行一次。
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStore } from '../server/src/store.js';
import { loadKey } from '../server/src/crypto.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(process.env.VIER_CONFIG || join(root, 'config/app.json'), 'utf8')); // 与服务端读同一份配置
const dataDir = process.env.VIER_DATA_DIR || join(root, 'data');
const { key } = loadKey(join(dataDir, '.dev-key'));
const n = new FileStore(dataDir, key).purgeInactive(config.privacy.inactiveRetentionDays);
console.log(`已删除 ${n} 个超过 ${config.privacy.inactiveRetentionDays} 天未活跃的账户`);

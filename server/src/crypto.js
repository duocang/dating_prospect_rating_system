// 静态加密：L2 敏感资料、择偶要求和 L3 身份资料都用 AES-256-GCM 加密后才写盘。
// 生产环境必须通过环境变量 VIER_DATA_KEY 提供 32 字节密钥（base64），并与数据分开保管。
// 开发环境缺少密钥时会在 data/.dev-key 生成一个，并在启动时警告。
import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadKey(devKeyPath) {
  if (process.env.VIER_DATA_KEY) {
    const k = Buffer.from(process.env.VIER_DATA_KEY, 'base64');
    if (k.length !== 32) throw new Error('VIER_DATA_KEY 必须是 32 字节的 base64');
    return { key: k, source: 'env' };
  }
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境必须设置 VIER_DATA_KEY');
  mkdirSync(dirname(devKeyPath), { recursive: true });
  if (!existsSync(devKeyPath)) writeFileSync(devKeyPath, randomBytes(32).toString('base64'), { mode: 0o600 });
  return { key: Buffer.from(readFileSync(devKeyPath, 'utf8').trim(), 'base64'), source: 'dev-file' };
}

export function encryptJson(key, obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function decryptJson(key, box) {
  if (!box) return null;
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
}

export const newToken = () => randomBytes(32).toString('base64url');
export const newId = () => 'u_' + randomBytes(12).toString('hex');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function safeEqualHex(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

// 每位查看者看到的人选代号不同，防止多个用户拼合同一人的信息
export function aliasFor(key, viewerId, personId) {
  return createHmac('sha256', key).update(`${viewerId}:${personId}`).digest('base64url').slice(0, 8);
}

// 审计日志中的主体只记录带密钥的哈希，不记录原 id
export const auditSubject = (key, id) => createHmac('sha256', key).update('audit:' + id).digest('hex').slice(0, 16);

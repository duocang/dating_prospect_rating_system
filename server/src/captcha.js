// 图片验证码：零依赖。字形是手画的折线（不是 <text>），每个字随机旋转、平移、缩放、抖动，再加几条干扰线。
// 服务端只在内存里存答案的哈希，5 分钟过期；一次验证不管对错都作废，答错要换一张。
import { randomInt, randomBytes } from 'node:crypto';
import { sha256, safeEqualHex } from './crypto.js';

// 去掉 0/O、1/I/L 这些容易看错的字符；折线画出来的 G/6、Z/2 也容易混，一并去掉
export const CAPTCHA_ALPHABET = '23456789ABCDEFHJKMNPQRSTUVWXY';
const LEN = 5;
const TTL = 5 * 60e3;
const MAX_LIVE = 20000; // 内存里最多存这么多张，防止被刷爆

// 笔画字库：坐标在 8 宽 12 高的格子里，每个字是若干条折线
const GLYPHS = {
  2: [[0, 3, 1, 1, 3, 0, 5, 0, 7, 1, 8, 3, 7, 5, 0, 12, 8, 12]],
  3: [[0, 1, 2, 0, 6, 0, 8, 2, 8, 4, 6, 6, 3, 6], [6, 6, 8, 8, 8, 10, 6, 12, 2, 12, 0, 11]],
  4: [[6, 12, 6, 0, 0, 8, 8, 8]],
  5: [[8, 0, 1, 0, 0, 5, 5, 5, 8, 7, 8, 10, 6, 12, 2, 12, 0, 11]],
  6: [[7, 0, 3, 1, 1, 4, 0, 8, 1, 11, 4, 12, 7, 11, 8, 8, 6, 6, 3, 6, 0, 8]],
  7: [[0, 0, 8, 0, 3, 12]],
  8: [[4, 6, 1, 5, 1, 2, 4, 0, 7, 2, 7, 5, 4, 6, 0, 8, 0, 11, 4, 12, 8, 11, 8, 8, 4, 6]],
  9: [[8, 4, 6, 6, 2, 6, 0, 4, 1, 1, 4, 0, 7, 1, 8, 4, 7, 9, 4, 12, 1, 12]],
  A: [[0, 12, 4, 0, 8, 12], [2, 7, 6, 7]],
  B: [[0, 0, 0, 12, 6, 12, 8, 10, 8, 8, 5, 6, 0, 6], [5, 6, 7, 4, 7, 2, 5, 0, 0, 0]],
  C: [[8, 2, 6, 0, 3, 0, 1, 2, 0, 6, 1, 10, 3, 12, 6, 12, 8, 10]],
  D: [[0, 0, 0, 12, 4, 12, 7, 10, 8, 6, 7, 2, 4, 0, 0, 0]],
  E: [[8, 0, 0, 0, 0, 12, 8, 12], [0, 6, 6, 6]],
  F: [[8, 0, 0, 0, 0, 12], [0, 6, 6, 6]],
  G: [[8, 2, 6, 0, 3, 0, 1, 2, 0, 6, 1, 10, 3, 12, 6, 12, 8, 10, 8, 7, 5, 7]],
  H: [[0, 0, 0, 12], [8, 0, 8, 12], [0, 6, 8, 6]],
  J: [[8, 0, 8, 9, 6, 12, 2, 12, 0, 9]],
  K: [[0, 0, 0, 12], [8, 0, 0, 7], [3, 5, 8, 12]],
  M: [[0, 12, 0, 0, 4, 7, 8, 0, 8, 12]],
  N: [[0, 12, 0, 0, 8, 12, 8, 0]],
  P: [[0, 12, 0, 0, 6, 0, 8, 2, 8, 4, 6, 6, 0, 6]],
  Q: [[3, 0, 1, 2, 0, 6, 1, 10, 3, 12, 5, 12, 7, 10, 8, 6, 7, 2, 5, 0, 3, 0], [5, 9, 8, 13]],
  R: [[0, 12, 0, 0, 6, 0, 8, 2, 8, 4, 6, 6, 0, 6], [4, 6, 8, 12]],
  S: [[8, 1, 6, 0, 2, 0, 0, 2, 1, 5, 7, 7, 8, 10, 6, 12, 2, 12, 0, 11]],
  T: [[0, 0, 8, 0], [4, 0, 4, 12]],
  U: [[0, 0, 0, 9, 2, 12, 6, 12, 8, 9, 8, 0]],
  V: [[0, 0, 4, 12, 8, 0]],
  W: [[0, 0, 2, 12, 4, 5, 6, 12, 8, 0]],
  X: [[0, 0, 8, 12], [8, 0, 0, 12]],
  Y: [[0, 0, 4, 6, 8, 0], [4, 6, 4, 12]],
  Z: [[0, 0, 8, 0, 0, 12, 8, 12]],
};

const W = 250, H = 70;
const rnd = (a, b) => a + (randomInt(1e6) / 1e6) * (b - a);
const f1 = (n) => n.toFixed(1);
const norm = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// 画一张：坐标直接算好写进 path，不留 transform，也不按字的顺序排
function draw(text) {
  const paths = [];
  const cell = W / (LEN + 0.6);
  [...text].forEach((ch, i) => {
    const s = rnd(2.6, 3.1), rot = rnd(-0.3, 0.3);
    const cx = cell * (i + 0.8) + rnd(-2, 2), cy = H / 2 + rnd(-6, 6);
    const cos = Math.cos(rot), sin = Math.sin(rot);
    for (const line of GLYPHS[ch]) {
      let d = '';
      for (let k = 0; k < line.length; k += 2) {
        const x = (line[k] - 4 + rnd(-0.35, 0.35)) * s, y = (line[k + 1] - 6 + rnd(-0.35, 0.35)) * s;
        d += `${k ? 'L' : 'M'}${f1(cx + x * cos - y * sin)} ${f1(cy + x * sin + y * cos)}`;
      }
      paths.push(`<path d="${d}" stroke-width="${f1(rnd(2.4, 3.2))}"/>`);
    }
  });
  // 干扰线：两三条横穿的曲线，加几段短线
  for (let i = 0, n = randomInt(2, 4); i < n; i++) {
    paths.push(`<path d="M${f1(rnd(-5, 20))} ${f1(rnd(5, H - 5))}C${f1(rnd(W * .2, W * .45))} ${f1(rnd(-20, H + 20))} ${f1(rnd(W * .55, W * .8))} ${f1(rnd(-20, H + 20))} ${f1(rnd(W * .9, W + 5))} ${f1(rnd(5, H - 5))}" stroke-width="${f1(rnd(1.2, 2))}" opacity=".7"/>`);
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd(0, W), y = rnd(0, H);
    paths.push(`<path d="M${f1(x)} ${f1(y)}L${f1(x + rnd(-14, 14))} ${f1(y + rnd(-10, 10))}" stroke-width="${f1(rnd(1, 2))}" opacity=".55"/>`);
  }
  for (let i = paths.length - 1; i > 0; i--) { const j = randomInt(i + 1); [paths[i], paths[j]] = [paths[j], paths[i]]; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.join('')}</svg>`;
}

// onIssue 只给进程内的测试用（拿到明文答案），不会经过 HTTP，见 docs/SECURITY.md
export function createCaptcha({ onIssue } = {}) {
  const live = new Map(); // id -> { hash, exp }
  const hashOf = (id, answer) => sha256(`captcha:${id}:${norm(answer)}`);
  function sweep() {
    const now = Date.now();
    for (const [id, c] of live) if (c.exp <= now) live.delete(id);
  }
  return {
    issue() {
      if (live.size >= MAX_LIVE) sweep();
      if (live.size >= MAX_LIVE) live.delete(live.keys().next().value);
      let text = '';
      for (let i = 0; i < LEN; i++) text += CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)];
      const id = 'c_' + randomBytes(12).toString('hex');
      live.set(id, { hash: hashOf(id, text), exp: Date.now() + TTL });
      onIssue?.(id, text);
      return { id, svg: draw(text) };
    },
    // 一次性：不管对错，验过就作废
    verify(id, answer) {
      const c = live.get(String(id || ''));
      if (!c) return false;
      live.delete(id);
      if (c.exp <= Date.now() || norm(answer).length !== LEN) return false;
      return safeEqualHex(c.hash, hashOf(id, answer));
    },
    sweep,
    get size() { return live.size; },
  };
}

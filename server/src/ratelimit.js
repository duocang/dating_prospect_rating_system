// 内存里的滑动窗口计数。单进程够用；以后多进程部署时换成 Redis 实现同样的 hit / count 即可。
export class RateLimiter {
  constructor() { this.hits = new Map(); } // key -> 时间戳数组

  #recent(key, windowMs) {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    this.hits.set(key, list);
    return list;
  }

  // 记一次；超过上限返回 false（这次不计入）
  hit(key, max, windowMs) {
    const list = this.#recent(key, windowMs);
    if (list.length >= max) return false;
    list.push(Date.now());
    return true;
  }

  count(key, windowMs) { return this.#recent(key, windowMs).length; }

  // 定时清理：一天前的记录全部丢掉
  sweep(maxAgeMs = 86400e3) {
    const now = Date.now();
    for (const [k, list] of this.hits) {
      const keep = list.filter((t) => now - t < maxAgeMs);
      if (keep.length) this.hits.set(k, keep); else this.hits.delete(k);
    }
  }
}

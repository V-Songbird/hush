'use strict';

// Fixed-size connection pool. Callers must always release what they acquire —
// there is no finalizer or timeout-based reclaim, so a missed release is
// permanent for the life of the process.
class Pool {
  constructor(size) {
    this.size = size;
    this.available = Array.from({ length: size }, (_, i) => ({ id: i }));
    this.inUse = new Set();
  }

  acquire() {
    const conn = this.available.pop();
    if (!conn) throw new Error('pool exhausted: no connections available');
    this.inUse.add(conn);
    return conn;
  }

  release(conn) {
    if (!this.inUse.has(conn)) return;
    this.inUse.delete(conn);
    this.available.push(conn);
  }

  availableCount() {
    return this.available.length;
  }
}

// Safe wrapper: always releases, even if fn throws.
async function withConnection(pool, fn) {
  const conn = pool.acquire();
  try {
    return await fn(conn);
  } finally {
    pool.release(conn);
  }
}

module.exports = { Pool, withConnection };

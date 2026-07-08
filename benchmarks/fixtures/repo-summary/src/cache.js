'use strict';

// Tiny LRU read-through cache in front of the store. 256 entries, no TTL —
// freshness is the store's job, this only absorbs repeated reads.
const MAX = 256;
const lru = new Map();

async function cached(key, loader) {
  if (lru.has(key)) {
    const v = lru.get(key);
    lru.delete(key);
    lru.set(key, v); // bump to most-recent
    return v;
  }
  const v = await loader();
  lru.set(key, v);
  if (lru.size > MAX) lru.delete(lru.keys().next().value);
  return v;
}

module.exports = { cached };

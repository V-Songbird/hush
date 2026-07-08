'use strict';

// In-memory store with per-record TTL. Stand-in for a real database: every
// record expires 15 minutes after its last write.
const TTL_MS = 15 * 60 * 1000;
const records = new Map();

function now() { return Date.now(); }

function put(key, value) {
  records.set(key, { value, expiresAt: now() + TTL_MS });
  return value;
}

function get(key) {
  const rec = records.get(key);
  if (!rec) return null;
  if (rec.expiresAt <= now()) {
    records.delete(key);
    return null;
  }
  return rec.value;
}

function getUser(id) { return get(`user:${id}`); }
function listOrders(userId) { return get(`orders:${userId}`) || []; }
function putOrder(userId, order) {
  const orders = listOrders(userId);
  orders.push(order);
  return put(`orders:${userId}`, orders);
}

module.exports = { getUser, listOrders, putOrder };

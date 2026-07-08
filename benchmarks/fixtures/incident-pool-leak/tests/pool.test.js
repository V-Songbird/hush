'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('../src/db/pool.js');
const { processOrder } = require('../src/jobs/processOrder.js');
const { handleRequest } = require('../src/handlers/api.js');

test('handleRequest always releases the connection, even on failure', async () => {
  const pool = new Pool(5);
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => handleRequest(pool, {}, async () => { throw new Error('boom'); }));
  }
  assert.strictEqual(pool.availableCount(), 5);
});

test('processOrder does not leak a connection when an order fails validation', async () => {
  const pool = new Pool(5);
  const badOrder = { id: 'bad-1' };
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => processOrder(pool, badOrder, async () => { throw new Error('invalid order payload'); }));
  }
  assert.strictEqual(pool.availableCount(), 5, 'pool should recover after failed orders, not stay exhausted');
});

test('pool recovers once concurrent in-flight failures all settle', async () => {
  const pool = new Pool(3);
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () => processOrder(pool, { id: 'concurrent' }, async () => { throw new Error('fail'); }))
  );
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.strictEqual(pool.availableCount(), 3);
});

test('a healthy order still round-trips a connection normally', async () => {
  const pool = new Pool(2);
  const out = await processOrder(pool, { id: 'ok-1' }, async (conn, order) => ({ conn, order }));
  assert.strictEqual(out.order.id, 'ok-1');
  assert.strictEqual(pool.availableCount(), 2);
});

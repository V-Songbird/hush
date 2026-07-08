'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeTotal, buildInvoice, dailyReport } = require('../src/index.js');

const LINES = [
  { price: 10, qty: 2, discount: 0 },
  { price: 100, qty: 1, discount: 0.25 },
];

test('computeTotal sums discounted lines', () => {
  assert.strictEqual(computeTotal(LINES), 95);
});

test('computeTotal is exported from cart', () => {
  const cart = require('../src/cart.js');
  assert.strictEqual(typeof cart.computeTotal, 'function');
  assert.strictEqual(cart.calcTotal, undefined);
});

test('invoice uses the shared total', () => {
  assert.strictEqual(buildInvoice('acme', LINES).total, 95);
});

test('daily report grand total', () => {
  const { grand } = dailyReport([
    { id: 1, lines: LINES },
    { id: 2, lines: [{ price: 5, qty: 1 }] },
  ]);
  assert.strictEqual(grand, 100);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeTotal } = require('../src/services/pricing.js');
const { findCoupon } = require('../src/models/coupon.js');

const order100usd = (currency) => ({
  currency,
  items: [{ sku: 'WIDGET', priceUsd: 100, qty: 1 }],
});

test('no coupon, USD stays USD', () => {
  assert.strictEqual(computeTotal(order100usd('USD'), null), 100);
});

test('no coupon, EUR converts at the store rate', () => {
  assert.strictEqual(computeTotal(order100usd('EUR'), null), 90);
});

test('percent coupon applies the same in any currency', () => {
  const coupon = findCoupon('SAVE20PCT');
  assert.strictEqual(computeTotal(order100usd('EUR'), coupon), 72);
});

test('flat coupon is converted before being subtracted, not after', () => {
  // $10 off a $100 order in EUR: (100 - 10) * 0.9 = 81, not 100*0.9 - 10 = 80.
  const coupon = findCoupon('WELCOME10');
  assert.strictEqual(computeTotal(order100usd('EUR'), coupon), 81);
});

test('flat coupon in USD is unaffected by the currency bug', () => {
  const coupon = findCoupon('WELCOME10');
  assert.strictEqual(computeTotal(order100usd('USD'), coupon), 90);
});

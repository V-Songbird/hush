'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeTotal, sumItems } = require('../src/pricing/engine.js');
const { convert, decimalsFor } = require('../src/pricing/currency.js');
const { findCoupon } = require('../src/pricing/coupons.js');

// Independent reference: rounds exactly once, at the very end, in the target
// currency's own decimal places. This is the contract computeTotal is
// supposed to honor.
function round(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
function referenceTotal(order, couponCodes) {
  const coupons = couponCodes.map(findCoupon).filter(Boolean);
  const percent = coupons.find((c) => c.type === 'percent');
  const flat = coupons.find((c) => c.type === 'flat');
  let usd = sumItems(order.items);
  if (percent) usd = usd * (1 - percent.amount);
  if (flat) usd = usd - flat.amountUsd;
  const target = convert(usd, order.currency);
  return round(target, decimalsFor(order.currency));
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'JPY'];
const COUPON_COMBOS = [[], ['SAVE10PCT'], ['FLAT5'], ['SAVE10PCT', 'FLAT5']];
const BASKETS = [
  [{ priceUsd: 9.99, qty: 2 }],
  [{ priceUsd: 10.04, qty: 2 }],
];

for (const currency of CURRENCIES) {
  for (const coupons of COUPON_COMBOS) {
    for (const basket of BASKETS) {
      const label = `${currency} | coupons=[${coupons.join(',') || 'none'}] | basket=${basket.map((i) => `${i.qty}x$${i.priceUsd}`).join('+')}`;
      test(label, () => {
        const order = { currency, items: basket };
        const expected = referenceTotal(order, coupons);
        const actual = computeTotal(order, coupons);
        assert.strictEqual(actual, expected);
      });
    }
  }
}

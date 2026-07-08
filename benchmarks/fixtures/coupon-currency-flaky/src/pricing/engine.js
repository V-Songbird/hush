'use strict';
const { convert, decimalsFor } = require('./currency.js');
const { findCoupon } = require('./coupons.js');

function round(n, decimals) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function sumItems(items) {
  return items.reduce((sum, item) => sum + item.priceUsd * item.qty, 0);
}

// Applies stacked coupons (percent, then flat) and converts to the order's
// currency. Coupons are optional; either, both, or neither may be present.
function computeTotal(order, couponCodes = []) {
  const coupons = couponCodes.map(findCoupon).filter(Boolean);
  const percent = coupons.find((c) => c.type === 'percent');
  const flat = coupons.find((c) => c.type === 'flat');

  let usd = sumItems(order.items);

  if (percent) {
    usd = round(usd * (1 - percent.amount), 2);
  }
  if (flat) {
    usd = round(usd - flat.amountUsd, 2);
  }

  const target = convert(usd, order.currency);
  return round(target, decimalsFor(order.currency));
}

module.exports = { computeTotal, sumItems, round };

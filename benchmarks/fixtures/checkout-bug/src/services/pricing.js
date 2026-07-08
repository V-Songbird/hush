'use strict';
const { convert } = require('./currency.js');

function sumItems(items) {
  return items.reduce((sum, item) => sum + item.priceUsd * item.qty, 0);
}

// Computes the order total in the customer's checkout currency, after coupon.
function computeTotal(order, coupon) {
  const subtotalUsd = sumItems(order.items);
  const converted = convert(subtotalUsd, order.currency);

  if (!coupon) return round2(converted);

  if (coupon.type === 'percent') {
    // A percentage is currency-agnostic, so applying it after conversion is fine.
    return round2(converted * (1 - coupon.amount));
  }

  // Flat coupons are stored in USD (see coupon.js) but subtracted here from
  // the already-converted total, as if it were in the target currency.
  return round2(converted - coupon.amount);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { computeTotal, sumItems };

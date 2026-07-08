'use strict';

// Coupon catalog. Percent coupons are currency-agnostic; flat coupons are
// denominated in USD. Orders can stack at most one of each.
const COUPONS = {
  SAVE10PCT: { type: 'percent', amount: 0.1 },
  SAVE20PCT: { type: 'percent', amount: 0.2 },
  FLAT5: { type: 'flat', amountUsd: 5 },
  FLAT15: { type: 'flat', amountUsd: 15 },
};

function findCoupon(code) {
  return code ? COUPONS[code] || null : null;
}

module.exports = { findCoupon, COUPONS };

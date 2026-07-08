'use strict';

// Coupon catalog. `amount` on a flat coupon is always denominated in the
// store's base currency (USD) — see config.js — regardless of what currency
// the customer eventually checks out in.
const COUPONS = {
  WELCOME10: { type: 'flat', amount: 10 },
  SAVE20PCT: { type: 'percent', amount: 0.2 },
};

function findCoupon(code) {
  return code ? COUPONS[code] || null : null;
}

module.exports = { findCoupon };

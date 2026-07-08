'use strict';
const { requireAuth } = require('../middleware/auth.js');
const { assertOrder } = require('../utils/validate.js');
const { computeTotal } = require('../services/pricing.js');
const { findCoupon } = require('../models/coupon.js');
const { reserve } = require('../services/inventory.js');

// POST /checkout — validates, reserves stock, prices the order.
function handleCheckout(req) {
  const user = requireAuth(req);
  const order = req.body;
  assertOrder(order);

  for (const item of order.items) reserve(item.sku, item.qty);

  const coupon = findCoupon(order.couponCode);
  const total = computeTotal(order, coupon);

  return { userId: user.id, currency: order.currency, total };
}

module.exports = { handleCheckout };

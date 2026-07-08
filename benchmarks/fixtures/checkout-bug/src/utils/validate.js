'use strict';

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function assertOrder(order) {
  if (!order || !isNonEmptyArray(order.items)) {
    throw new Error('order must have at least one item');
  }
  if (!order.currency) throw new Error('order.currency is required');
}

module.exports = { assertOrder, isNonEmptyArray };

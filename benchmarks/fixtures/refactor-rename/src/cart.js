'use strict';

// Cart math. `calcTotal` sums line items after per-line discounts.

function calcTotal(lines) {
  let total = 0;
  for (const line of lines) {
    const discounted = line.price * (1 - (line.discount || 0));
    total += discounted * line.qty;
  }
  return Math.round(total * 100) / 100;
}

module.exports = { calcTotal };

'use strict';
const { calcTotal } = require('./cart.js');

// Daily sales report: one row per order, grand total at the bottom.
function dailyReport(orders) {
  const rows = orders.map((o) => ({ id: o.id, total: calcTotal(o.lines) }));
  const grand = Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100;
  return { rows, grand };
}

module.exports = { dailyReport };

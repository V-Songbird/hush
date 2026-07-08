'use strict';
const { calcTotal } = require('./cart.js');

function buildInvoice(customer, lines) {
  return {
    customer,
    lines,
    total: calcTotal(lines),
    currency: 'EUR',
  };
}

module.exports = { buildInvoice };

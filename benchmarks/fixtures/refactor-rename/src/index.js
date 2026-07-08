'use strict';
const { calcTotal } = require('./cart.js');
const { buildInvoice } = require('./invoice.js');
const { dailyReport } = require('./report.js');

module.exports = { calcTotal, buildInvoice, dailyReport };

'use strict';
const { handleCheckout } = require('./routes/checkout.js');
const { computeTotal } = require('./services/pricing.js');

module.exports = { handleCheckout, computeTotal };

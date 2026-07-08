'use strict';
const { RATES } = require('../config.js');

// Converts an amount from the store's base currency (USD) to `targetCurrency`.
function convert(amountUsd, targetCurrency) {
  const rate = RATES[targetCurrency];
  if (!rate) throw new Error(`unknown currency: ${targetCurrency}`);
  return amountUsd * rate;
}

module.exports = { convert };

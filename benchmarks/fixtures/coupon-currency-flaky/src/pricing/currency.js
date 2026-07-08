'use strict';

// Store's base currency is USD. Rates are USD -> target, and JPY is a
// zero-decimal currency (no fractional yen) — a common real-world edge case
// that trips up pricing code written only against 2-decimal currencies.
const RATES = {
  USD: 1,
  EUR: 0.9,
  GBP: 0.78,
  CAD: 1.35,
  JPY: 149,
};

const ZERO_DECIMAL = new Set(['JPY']);

function convert(amountUsd, currency) {
  const rate = RATES[currency];
  if (!rate) throw new Error(`unknown currency: ${currency}`);
  return amountUsd * rate;
}

function decimalsFor(currency) {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

module.exports = { convert, decimalsFor, RATES };

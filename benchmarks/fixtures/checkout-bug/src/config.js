'use strict';

// Store operates in USD internally. All prices, coupon amounts, and
// inventory costs are stored in USD; conversion happens only at checkout
// display time.
const BASE_CURRENCY = 'USD';

const RATES = {
  USD: 1,
  EUR: 0.9,
  GBP: 0.78,
  JPY: 149.5,
};

module.exports = { BASE_CURRENCY, RATES };

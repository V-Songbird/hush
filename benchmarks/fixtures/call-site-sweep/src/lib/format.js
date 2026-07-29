'use strict';

// Money formatting. The second parameter is the deprecated legacy-rounding
// flag: it rounds half away from zero instead of half to even, and it is on
// its way out. New code passes one argument and gets half to even.
function formatAmount(value, legacyRounding) {
  const scaled = value * 100;
  let cents;
  if (legacyRounding) {
    cents = Math.sign(scaled) * Math.round(Math.abs(scaled));
  } else {
    const floor = Math.floor(scaled);
    cents = scaled - floor === 0.5
      ? (floor % 2 === 0 ? floor : floor + 1)
      : Math.round(scaled);
  }
  return (cents / 100).toFixed(2);
}

module.exports = { formatAmount };

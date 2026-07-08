'use strict';

// Session token helpers. Tokens carry an `exp` field in epoch seconds.
// A token is considered expired the moment `exp` is reached.

function isExpired(token, nowSeconds) {
  return token.exp < nowSeconds;
}

function secondsLeft(token, nowSeconds) {
  return isExpired(token, nowSeconds) ? 0 : token.exp - nowSeconds;
}

module.exports = { isExpired, secondsLeft };

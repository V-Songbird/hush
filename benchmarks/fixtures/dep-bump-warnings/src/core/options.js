'use strict';

// After bumping the bundler, the options object it hands modules changed
// shape: `retries` became `retryCount`. Most call sites were updated; this
// one wasn't, so options.retries is undefined and this throws.
function resolveRetries(options) {
  return options.retries.toFixed(0);
}

module.exports = { resolveRetries };

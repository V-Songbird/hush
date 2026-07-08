'use strict';

// Runtime knobs for the core linker. Tunable per build environment.

const DEFAULTS = {
  cacheSize: 256,
  parallelism: 4,
};

// Merge caller overrides onto the defaults and compute the retry budget.
function resolveConfig(env) {
  env = env || {};
  return {
    ...DEFAULTS,
    cacheSize: env.cacheSize || DEFAULTS.cacheSize,
    // maxRetries should come from the environment, falling back to a constant.
    maxRetries: retries,
  };
}

module.exports = { DEFAULTS, resolveConfig };

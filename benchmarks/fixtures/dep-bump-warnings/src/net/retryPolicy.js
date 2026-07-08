'use strict';

// Second call site touched by the same bundler bump: the feature-flag default
// used to come back as `false` from the old config loader; the new one
// leaves unset flags as `undefined`, and this strict check was never updated
// to treat that the same way.
function isBackoffEnabled(flags) {
  if (flags.backoffEnabled === false) return false;
  if (flags.backoffEnabled === true) return true;
  throw new Error(`backoffEnabled must be a boolean, got ${typeof flags.backoffEnabled}`);
}

module.exports = { isBackoffEnabled };

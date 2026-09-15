#!/usr/bin/env node
"use strict";

// Compatibility entry point for older local hook installations. Foundry's
// research policy permits public source names and attribution. The former
// private-name blocklist is retired; this is not a secret scanner.
function main() { return 0; }
if (require.main === module) process.exit(main());
module.exports = { main };

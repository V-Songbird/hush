'use strict';
const { withConnection } = require('../db/pool.js');

// Request path goes through the safe wrapper — always releases.
async function handleRequest(pool, req, run) {
  return withConnection(pool, (conn) => run(conn, req));
}

module.exports = { handleRequest };

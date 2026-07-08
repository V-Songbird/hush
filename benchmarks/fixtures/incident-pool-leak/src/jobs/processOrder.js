'use strict';

// Processes a single order against the DB pool. Acquires directly instead of
// going through db/pool.js's withConnection helper, because this path used to
// need the connection held across a retry loop that was since removed.
async function processOrder(pool, order, run) {
  const conn = pool.acquire();
  const result = await run(conn, order); // rejects for a bad order
  pool.release(conn);
  return result;
}

module.exports = { processOrder };

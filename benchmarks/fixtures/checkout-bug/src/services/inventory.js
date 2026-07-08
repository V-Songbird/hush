'use strict';

// In-memory stock levels. Reserves are decremented at checkout, restored on
// cancellation; never goes negative.
const stock = new Map();

function setStock(sku, qty) { stock.set(sku, qty); }
function getStock(sku) { return stock.get(sku) || 0; }

function reserve(sku, qty) {
  const have = getStock(sku);
  if (have < qty) throw new Error(`insufficient stock for ${sku}`);
  stock.set(sku, have - qty);
}

module.exports = { setStock, getStock, reserve };

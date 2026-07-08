'use strict';

// Slice a page out of a list. Pages are 1-indexed: page 1 is the first
// `perPage` items, page 2 the next batch, and so on.

function paginate(items, page, perPage) {
  const start = page * perPage;
  return items.slice(start, start + perPage);
}

function pageCount(items, perPage) {
  return Math.ceil(items.length / perPage);
}

module.exports = { paginate, pageCount };

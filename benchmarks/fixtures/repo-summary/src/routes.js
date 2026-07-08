'use strict';
const { getUser, listOrders, putOrder } = require('./store.js');
const { cached } = require('./cache.js');

// Route table. Reads go through the LRU cache; writes go straight to the store
// and invalidate the affected keys.
const TABLE = {
  'GET /users': (q, user) => cached(`user:${q.id}`, () => getUser(q.id)),
  'GET /orders': (q, user) => cached(`orders:${user.id}`, () => listOrders(user.id)),
  'POST /orders': (q, user) => putOrder(user.id, q.body),
};

function route(req, res, user) {
  const key = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
  const handler = TABLE[key];
  if (!handler) {
    res.writeHead(404).end('not found');
    return;
  }
  Promise.resolve(handler(parseQuery(req), user))
    .then((body) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body)))
    .catch((err) => res.writeHead(500).end(err.message));
}

function parseQuery(req) {
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams);
}

module.exports = { route };

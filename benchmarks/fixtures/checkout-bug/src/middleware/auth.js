'use strict';

// Bearer-token check. Stand-in only — no real crypto, this is a fixture.
function requireAuth(req) {
  const header = req.headers && req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    throw new Error('unauthorized');
  }
  return { id: header.slice(7) };
}

module.exports = { requireAuth };

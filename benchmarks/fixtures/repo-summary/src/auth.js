'use strict';
const crypto = require('node:crypto');

// HMAC bearer tokens: "<userId>.<hex signature>". Shared secret from env.
const SECRET = process.env.AUTH_SECRET || 'dev-secret';

function sign(userId) {
  return crypto.createHmac('sha256', SECRET).update(String(userId)).digest('hex');
}

function verifyToken(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  const [userId, sig] = header.slice(7).split('.');
  if (!userId || !sig) return null;
  const expected = sign(userId);
  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? { id: userId } : null;
}

module.exports = { verifyToken, sign };

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isExpired, secondsLeft } = require('../token.js');

test('token expiring exactly now is expired', () => {
  assert.strictEqual(isExpired({ exp: 100 }, 100), true);
});

test('future token is valid', () => {
  assert.strictEqual(isExpired({ exp: 200 }, 100), false);
});

test('past token is expired', () => {
  assert.strictEqual(isExpired({ exp: 50 }, 100), true);
});

test('secondsLeft is 0 at the expiry instant', () => {
  assert.strictEqual(secondsLeft({ exp: 100 }, 100), 0);
});

test('secondsLeft counts down', () => {
  assert.strictEqual(secondsLeft({ exp: 160 }, 100), 60);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { paginate, pageCount } = require('../paginate.js');

const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test('page 1 returns the first batch', () => {
  assert.deepStrictEqual(paginate(ITEMS, 1, 3), [1, 2, 3]);
});

test('page 2 returns the second batch', () => {
  assert.deepStrictEqual(paginate(ITEMS, 2, 3), [4, 5, 6]);
});

test('last partial page returns the remainder', () => {
  assert.deepStrictEqual(paginate(ITEMS, 4, 3), [10]);
});

test('page past the end is empty', () => {
  assert.deepStrictEqual(paginate(ITEMS, 5, 3), []);
});

test('pageCount rounds up', () => {
  assert.strictEqual(pageCount(ITEMS, 3), 4);
});

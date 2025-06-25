import test from 'node:test';
import assert from 'node:assert/strict';
import { Formatters } from '../js/utils/formatters.js';

test('Formatters.currency formats numbers as CAD currency', () => {
  assert.strictEqual(Formatters.currency(1234.5), 'CA$1,234.50');
});

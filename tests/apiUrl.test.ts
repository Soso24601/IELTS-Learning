import test from 'node:test';
import assert from 'node:assert/strict';
import { apiUrl } from '../frontend/src/lib/apiUrl';

test('API URL builder preserves same-origin paths when no production API is configured', () => {
  assert.equal(apiUrl('/api/health'), '/api/health');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInternalUrl } from '../server/services/internal-access.service.ts';

test('internal access accepts private HTTPS endpoints', () => {
  assert.equal(validateInternalUrl('https://192.168.1.20:3000/'), 'https://192.168.1.20:3000');
  assert.equal(validateInternalUrl('https://media.internal/app'), 'https://media.internal/app');
});

test('internal access rejects unsafe or public endpoints', () => {
  assert.throws(() => validateInternalUrl('http://192.168.1.20:3000'), /HTTPS/);
  assert.throws(() => validateInternalUrl('https://user:pass@192.168.1.20'), /ورود/);
  assert.throws(() => validateInternalUrl('https://example.com'), /داخلی/);
});

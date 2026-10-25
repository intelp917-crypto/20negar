import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidSubscription } from '../server/services/push.service.ts';

const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };
const subscription = (endpoint: string) => ({ endpoint, keys });

test('push accepts a public HTTPS subscription endpoint', () => {
  assert.equal(isValidSubscription(subscription('https://fcm.googleapis.com/fcm/send/abc:123')), true);
  assert.equal(isValidSubscription(subscription('https://updates.push.services.mozilla.com/wpush/v2/token')), true);
});

test('push rejects plain HTTP and malformed endpoints', () => {
  assert.equal(isValidSubscription(subscription('http://fcm.googleapis.com/fcm/send/abc')), false);
  assert.equal(isValidSubscription(subscription('not a url')), false);
  assert.equal(isValidSubscription(subscription('https://')), false);
});

test('push rejects localhost and private-network endpoints to prevent SSRF', () => {
  assert.equal(isValidSubscription(subscription('https://localhost/push')), false);
  assert.equal(isValidSubscription(subscription('https://127.0.0.1/push')), false);
  assert.equal(isValidSubscription(subscription('https://192.168.1.10/push')), false);
  assert.equal(isValidSubscription(subscription('https://10.0.0.5/push')), false);
  assert.equal(isValidSubscription(subscription('https://172.20.1.5/push')), false);
  assert.equal(isValidSubscription(subscription('https://[::1]/push')), false);
  assert.equal(isValidSubscription(subscription('https://intranet/push')), false);
});

test('push requires both encryption keys', () => {
  assert.equal(isValidSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: '', auth: 'A' } }), false);
  assert.equal(isValidSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'B' } }), false);
  assert.equal(isValidSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }), false);
  assert.equal(isValidSubscription(null), false);
});

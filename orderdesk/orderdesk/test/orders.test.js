'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { store, orders, inventory, notifications, api } = require('../src');

beforeEach(() => {
  store.reset();
  store.seed();
  notifications.outbox.length = 0;
});

test('place, pay and ship an order', async () => {
  const order = await orders.placeOrder('u1', [{ sku: 'SKU-A', qty: 2 }], { country: 'AT' });
  assert.strictEqual(order.status, 'pending');
  assert.strictEqual(order.totalCents, 2400);
  assert.strictEqual(inventory.available('SKU-A'), 8);

  await orders.payOrder(order.id, 'tok_visa');
  assert.strictEqual(store.orders.get(order.id).status, 'paid');
  assert.strictEqual(orders.getGateway().charges.length, 1);

  await orders.shipOrder(order.id);
  assert.strictEqual(store.orders.get(order.id).status, 'shipped');
  assert.ok(notifications.outbox.some((m) => m.template === 'receipt'));
});

test('insufficient stock is rejected', async () => {
  await assert.rejects(
    orders.placeOrder('u1', [{ sku: 'SKU-B', qty: 99 }], { country: 'AT' }),
    /Insufficient stock/
  );
});

test('customer can cancel their own pending order via the API', async () => {
  const order = await orders.placeOrder('u1', [{ sku: 'SKU-A', qty: 1 }], { country: 'AT' });
  const res = await api.cancelOrder({ user: store.users.get('u1'), params: { id: order.id } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'cancelled');
});

test('another customer cannot cancel the order', async () => {
  const order = await orders.placeOrder('u1', [{ sku: 'SKU-A', qty: 1 }], { country: 'AT' });
  const res = await api.cancelOrder({ user: store.users.get('u2'), params: { id: order.id } });
  assert.strictEqual(res.status, 403);
});

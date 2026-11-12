'use strict';

const crypto = require('crypto');
const config = require('./config');
const store = require('./store');
const orders = require('./orders');
const reports = require('./reports');

async function createOrder(req) {
  const { items, country, discountCode } = req.body;
  try {
    const order = await orders.placeOrder(req.user.id, items, { country, discountCode });
    return { status: 201, body: order };
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
}

async function getOrder(req) {
  await store.latency();
  const order = store.orders.get(req.params.id);
  if (!order) return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: order };
}

async function listOrders(req) {
  const all = [...store.orders.values()];
  const mine = req.user.role === 'admin' ? all : all.filter((o) => o.userId === req.user.id);
  return { status: 200, body: mine };
}

async function payOrder(req) {
  const order = store.orders.get(req.params.id);
  if (!order) return { status: 404, body: { error: 'not found' } };
  if (order.userId !== req.user.id) return { status: 403, body: { error: 'forbidden' } };
  try {
    const paid = await orders.payOrder(order.id, req.body.token);
    return { status: 200, body: paid };
  } catch (err) {
    return { status: 402, body: { error: err.message } };
  }
}

async function cancelOrder(req) {
  const order = store.orders.get(req.params.id);
  if (!order) return { status: 404, body: { error: 'not found' } };
  if (req.user.role !== 'admin' && order.userId !== req.user.id) {
    return { status: 403, body: { error: 'forbidden' } };
  }
  const result = await orders.cancelOrder(order.id);
  return { status: 200, body: result };
}

async function updateProfile(req) {
  const _ = require('lodash');
  const user = store.users.get(req.user.id);
  _.merge(user, req.body);
  return { status: 200, body: user };
}

async function changeRole(req) {
  if (req.user.role !== 'admin') return { status: 403, body: { error: 'forbidden' } };
  const target = store.users.get(req.params.id);
  if (!target) return { status: 404, body: { error: 'not found' } };
  target.role = req.body.role;
  return { status: 200, body: target };
}

// Mounted under /internal; the gateway only routes /internal to the support VPN.
async function archiveUser(req) {
  const user = store.users.get(req.params.id);
  if (!user) return { status: 404, body: { error: 'not found' } };
  user.archived = true;
  return { status: 200, body: { id: user.id, archived: true } };
}

async function paymentWebhook(req) {
  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  if (req.headers['x-signature'] !== expected) {
    return { status: 401, body: { error: 'bad signature' } };
  }
  const { type, orderId } = req.body;
  if (type === 'charge.refunded') {
    await orders.cancelOrder(orderId);
  }
  return { status: 200, body: { ok: true } };
}

async function topCustomers(req) {
  const rows = await reports.topCustomers(Number(req.query.limit || 10), req.query.status || 'paid');
  return { status: 200, body: rows };
}

module.exports = {
  createOrder,
  getOrder,
  listOrders,
  payOrder,
  cancelOrder,
  updateProfile,
  changeRole,
  archiveUser,
  paymentWebhook,
  topCustomers,
};

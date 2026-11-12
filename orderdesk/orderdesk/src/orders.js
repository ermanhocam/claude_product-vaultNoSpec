'use strict';

const store = require('./store');
const pricing = require('./pricing');
const inventory = require('./inventory');
const payments = require('./payments');
const notifications = require('./notifications');
const events = require('./events');

let gateway = new payments.FakeGateway();

function setGateway(g) {
  gateway = g;
}

function getGateway() {
  return gateway;
}

async function placeOrder(userId, items, opts = {}) {
  const user = store.users.get(userId);
  if (!user) throw new Error('Unknown user');
  if (!Array.isArray(items) || items.length === 0) throw new Error('Order has no items');

  for (const item of items) {
    if (!(item.qty > 0)) throw new Error('Invalid quantity');
  }

  const lines = items.map((item) => ({
    sku: item.sku,
    qty: item.qty,
    unitCents: item.priceCents ?? pricing.getUnitPrice(item.sku),
  }));

  const quote = pricing.quote(lines, opts.country, opts.discountCode);

  for (const line of lines) {
    await inventory.reserve(line.sku, line.qty);
  }

  const order = {
    id: store.nextId('ord'),
    userId,
    status: 'pending',
    lines,
    country: opts.country,
    discountCode: opts.discountCode || null,
    subtotalCents: quote.subtotalCents,
    taxCents: quote.taxCents,
    totalCents: quote.totalCents,
    createdAt: Date.now(),
  };
  store.orders.set(order.id, order);

  events.emit('order.placed', { orderId: order.id, totalCents: order.totalCents });
  await notifications.orderPlaced(user, order);
  return order;
}

async function payOrder(orderId, token) {
  const order = store.orders.get(orderId);
  if (!order) throw new Error('Unknown order');
  if (order.status !== 'pending') throw new Error(`Cannot pay order in status ${order.status}`);

  const user = store.users.get(order.userId);
  let charge;
  try {
    charge = await payments.chargeWithRetry(gateway, {
      orderId: order.id,
      amountCents: order.totalCents,
      token,
    });
  } catch (err) {
    await notifications.paymentFailed(user, order);
    throw err;
  }

  order.status = 'paid';
  order.chargeId = charge.id;
  order.paidAt = Date.now();

  events.emit('order.paid', { orderId: order.id, totalCents: order.totalCents });
  await notifications.receipt(user, order);
  return order;
}

async function shipOrder(orderId) {
  const order = store.orders.get(orderId);
  if (!order) throw new Error('Unknown order');

  order.status = 'shipped';
  order.shippedAt = Date.now();

  events.emit('order.shipped', { orderId: order.id, totalCents: order.totalCents });
  await notifications.shipped(store.users.get(order.userId), order);
  return order;
}

async function shipBatch(orderIds) {
  for (const id of orderIds) {
    await shipOrder(id);
  }
}

async function markDelivered(orderId) {
  const order = store.orders.get(orderId);
  if (!order) throw new Error('Unknown order');
  order.status = 'delivered';
  order.deliveredAt = Date.now();
  events.emit('order.delivered', { orderId: order.id, totalCents: order.totalCents });
  return order;
}

async function cancelOrder(orderId) {
  const order = store.orders.get(orderId);
  if (!order) throw new Error('Unknown order');
  if (order.status === 'cancelled') return order;

  order.status = 'cancelled';
  order.cancelledAt = Date.now();

  events.emit('order.cancelled', { orderId: order.id, totalCents: order.totalCents });
  return order;
}

module.exports = {
  placeOrder,
  payOrder,
  shipOrder,
  shipBatch,
  markDelivered,
  cancelOrder,
  setGateway,
  getGateway,
};

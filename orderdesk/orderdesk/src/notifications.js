'use strict';

const config = require('./config');
const billing = require('./billing');

const outbox = [];

async function send(user, template, subject, html) {
  if (!config.sendEmails) return null;
  if (user.archived || !user.email) return null;
  const message = { to: user.email, template, subject, html };
  outbox.push(message);
  return message;
}

function orderPlaced(user, order) {
  return send(user, 'order_placed', `Order ${order.id} received`,
    `<p>Hello ${user.name},</p><p>We received your order ${order.id}.</p>`);
}

function receipt(user, order) {
  const invoice = billing.generateInvoice(order);
  return send(user, 'receipt', `Receipt for ${order.id}`,
    `<p>Hello ${user.name},</p><p>Invoice ${invoice.number}: ${(invoice.totalCents / 100).toFixed(2)} EUR</p>`);
}

function shipped(user, order) {
  return send(user, 'shipped', `Order ${order.id} shipped`,
    `<p>Hello ${user.name},</p><p>Your order ${order.id} is on its way.</p>`);
}

function paymentFailed(user, order) {
  return send(user, 'payment_failed', `Payment failed for ${order.id}`,
    `<p>Hello ${user.name},</p><p>We could not charge your card for order ${order.id}.</p>`);
}

function promo(user, text) {
  return send(user, 'marketing', 'News from orderdesk', `<p>${text}</p>`);
}

module.exports = { orderPlaced, receipt, shipped, paymentFailed, promo, outbox };

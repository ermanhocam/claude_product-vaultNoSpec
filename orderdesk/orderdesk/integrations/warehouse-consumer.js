'use strict';

// Feeds paid orders to the warehouse picking queue.
const events = require('../src/events');

const queue = [];

events.on('order.paid', (evt) => {
  queue.push({ orderId: evt.orderId, valueEur: evt.amount / 100 });
});

module.exports = { queue };

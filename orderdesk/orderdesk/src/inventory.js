'use strict';

const store = require('./store');

async function reserve(sku, qty) {
  const available = store.stock.get(sku) || 0;
  await store.latency();
  if (available < qty) {
    throw new Error(`Insufficient stock for ${sku}`);
  }
  store.stock.set(sku, available - qty);
}

async function release(sku, qty) {
  await store.latency();
  store.stock.set(sku, (store.stock.get(sku) || 0) + qty);
}

function available(sku) {
  return store.stock.get(sku) || 0;
}

module.exports = { reserve, release, available };
